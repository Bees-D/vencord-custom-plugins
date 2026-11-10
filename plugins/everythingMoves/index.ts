/*
 * Vencord, a Discord client mod
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import definePlugin, { OptionType } from "@utils/types";

const PLUGIN_NAME = "EverythingMoves";
const EASING = "cubic-bezier(0.22, 0.61, 0.36, 1)";

const settings = definePluginSettings({
    channelNavigation: {
        type: OptionType.BOOLEAN,
        description: "Animate switching between channels and direct messages",
        default: true
    },
    serverNavigation: {
        type: OptionType.BOOLEAN,
        description: "Animate switching between servers",
        default: true
    },
    otherPages: {
        type: OptionType.BOOLEAN,
        description: "Animate navigation to other Discord pages",
        default: true
    },
    settingsPanels: {
        type: OptionType.BOOLEAN,
        description: "Animate opening, closing, and switching settings panels",
        default: true
    },
    menus: {
        type: OptionType.BOOLEAN,
        description: "Animate menus, context menus, and popouts opening and closing",
        default: true
    },
    modals: {
        type: OptionType.BOOLEAN,
        description: "Animate dialogs and modal windows opening and closing",
        default: true
    },
    scaleTarget: {
        type: OptionType.SLIDER,
        description: "Scale percentage reached before the outgoing view fades; the incoming view grows from this size",
        markers: [50, 60, 70, 80, 90, 95, 100],
        default: 90,
        stickToMarkers: true
    },
    scaleDuration: {
        type: OptionType.SLIDER,
        description: "How long shrinking and enlarging take, in milliseconds (up to 10 seconds)",
        markers: [0, 1000, 2500, 5000, 7500, 10000],
        default: 600,
        stickToMarkers: false
    },
    fadeInDuration: {
        type: OptionType.SLIDER,
        description: "How long incoming views take to fade in, in milliseconds (up to 10 seconds)",
        markers: [0, 1000, 2500, 5000, 7500, 10000],
        default: 500,
        stickToMarkers: false
    },
    fadeOutDuration: {
        type: OptionType.SLIDER,
        description: "How long outgoing views take to fade out, in milliseconds (up to 10 seconds)",
        markers: [0, 1000, 2500, 5000, 7500, 10000],
        default: 400,
        stickToMarkers: false
    },
    fadeBlend: {
        type: OptionType.SLIDER,
        description: "How far through shrinking the fade-out starts: 0% starts after shrinking; 100% starts immediately",
        markers: [0, 25, 50, 75, 100],
        default: 0,
        stickToMarkers: true
    },
    respectReducedMotion: {
        type: OptionType.BOOLEAN,
        description: "Disable animations when your system requests reduced motion",
        default: true
    }
});

type AnimationKind = "settings" | "menu" | "modal";
type RouteKind = "channel" | "server" | "page";

interface RouteInfo {
    href: string;
    pathname: string;
    guildId?: string;
    channelId?: string;
}

interface Snapshot {
    node: HTMLElement;
    rect: DOMRect;
}

const selectors: Record<AnimationKind, string> = {
    settings: '[class*="standardSidebarView"], [class*="settingsPage"], [class*="contentColumn"], [role="tabpanel"]',
    menu: '[role="menu"], [class*="contextMenu"], [class*="popout"]',
    modal: '[role="dialog"], [aria-modal="true"], [class*="modalRoot"]'
};

let observer: MutationObserver | undefined;
let popStateListener: (() => void) | undefined;
let originalPushState: History["pushState"] | undefined;
let originalReplaceState: History["replaceState"] | undefined;
let installedPushState: History["pushState"] | undefined;
let installedReplaceState: History["replaceState"] | undefined;
let lastHref = location.href;
let overlayFrame = 0;

const trackedOverlays = new Set<HTMLElement>();
const overlayKinds = new WeakMap<HTMLElement, AnimationKind>();
const overlayRects = new WeakMap<HTMLElement, DOMRect>();
const elementAnimations = new WeakMap<HTMLElement, Animation>();
const activeAnimations = new Set<Animation>();
const exitClones = new Set<HTMLElement>();

function animationsAllowed(): boolean {
    if (settings.store.respectReducedMotion && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches)
        return false;

    return true;
}

function isKindEnabled(kind: AnimationKind): boolean {
    switch (kind) {
        case "settings": return settings.store.settingsPanels;
        case "menu": return settings.store.menus;
        case "modal": return settings.store.modals;
    }
}

function isRouteEnabled(kind: RouteKind): boolean {
    switch (kind) {
        case "channel": return settings.store.channelNavigation;
        case "server": return settings.store.serverNavigation;
        case "page": return settings.store.otherPages;
    }
}

function parseRoute(href: string): RouteInfo {
    const url = new URL(href, location.href);
    const match = url.pathname.match(/^\/channels\/([^/]+)(?:\/([^/]+))?/);

    return {
        href: url.href,
        pathname: url.pathname,
        guildId: match?.[1],
        channelId: match?.[2]
    };
}

function routeChange(fromHref: string, toHref: string): RouteKind | undefined {
    const from = parseRoute(fromHref);
    const to = parseRoute(toHref);

    if (from.href === to.href)
        return;

    if (from.guildId && to.guildId && from.guildId !== to.guildId)
        return "server";

    if (from.guildId && to.guildId && from.channelId !== to.channelId && (from.channelId || to.channelId))
        return "channel";

    if (from.pathname !== to.pathname)
        return "page";
}

function pageTarget(kind: RouteKind): HTMLElement | null {
    const app = document.querySelector<HTMLElement>("#app-mount");
    if (!app)
        return null;

    const targets = kind === "channel" || kind === "server"
        ? ['[class*="messagesWrapper"]', '[class*="messageList"]', '[class*="pageWrapper"]']
        : ['[class*="contentRegion"]', '[class*="pageWrapper"]', '[class*="friendsPage"]'];

    for (const selector of targets) {
        const target = app.querySelector<HTMLElement>(selector);
        if (target)
            return target;
    }

    return null;
}

function makeSafeClone(source: HTMLElement): HTMLElement {
    const clone = source.cloneNode(true) as HTMLElement;
    clone.dataset.vcEverythingMovesClone = "true";
    clone.setAttribute("aria-hidden", "true");
    clone.inert = true;
    clone.querySelectorAll(
        '[class*="channelTextArea"], [class*="membersWrap"], [class*="profilePanel"], [class*="userPanel"], [class*="panels"]'
    ).forEach(node => node.remove());
    clone.querySelectorAll("[id]").forEach(node => node.removeAttribute("id"));
    clone.removeAttribute("id");
    clone.querySelectorAll<HTMLElement>("button, input, select, textarea, a, [tabindex]").forEach(node => {
        node.tabIndex = -1;
    });
    clone.style.setProperty("position", "fixed", "important");
    clone.style.setProperty("margin", "0", "important");
    clone.style.setProperty("z-index", "2147483000", "important");
    clone.style.setProperty("pointer-events", "none", "important");
    clone.style.setProperty("transform-origin", "center center", "important");
    clone.style.setProperty("transform", "none", "important");
    clone.style.setProperty("overflow", "hidden", "important");

    return clone;
}

function snapshot(element: HTMLElement | null): Snapshot | undefined {
    if (!element)
        return;

    const rect = element.getBoundingClientRect();
    if (!rect.width || !rect.height)
        return;

    return { node: makeSafeClone(element), rect };
}

function preparePositionedClone(clone: HTMLElement, rect: DOMRect) {
    clone.style.setProperty("left", `${rect.left}px`, "important");
    clone.style.setProperty("top", `${rect.top}px`, "important");
    clone.style.setProperty("width", `${rect.width}px`, "important");
    clone.style.setProperty("height", `${rect.height}px`, "important");
}

function playAnimation(element: HTMLElement, frames: Keyframe[], time: number, removeWhenDone = false) {
    if (!element.isConnected)
        return;
    if (!animationsAllowed()) {
        if (removeWhenDone)
            element.remove();
        return;
    }

    elementAnimations.get(element)?.cancel();
    const animation = element.animate(frames, {
        duration: time,
        easing: EASING,
        fill: "both"
    });
    elementAnimations.set(element, animation);
    activeAnimations.add(animation);
    animation.onfinish = () => {
        activeAnimations.delete(animation);
        if (elementAnimations.get(element) === animation)
            elementAnimations.delete(element);
        animation.cancel();
        if (removeWhenDone) {
            exitClones.delete(element);
            element.remove();
        }
    };
    animation.oncancel = () => {
        activeAnimations.delete(animation);
        if (elementAnimations.get(element) === animation)
            elementAnimations.delete(element);
    };
}

function addFrame(frames: Map<number, Keyframe>, offset: number, values: Keyframe) {
    const current = frames.get(offset) ?? { offset };
    frames.set(offset, Object.assign(current, values, { offset }));
}

function orderedFrames(frames: Map<number, Keyframe>): Keyframe[] {
    return [...frames.values()].sort((a, b) => Number(a.offset) - Number(b.offset));
}

function normalizedOffset(time: number, total: number): number {
    return total > 0 ? Math.max(0, Math.min(1, time / total)) : 1;
}

function animateIn(element: HTMLElement) {
    const scaleTime = settings.store.scaleDuration;
    const fadeTime = settings.store.fadeInDuration;
    const total = Math.max(scaleTime, fadeTime);
    const startScale = String(settings.store.scaleTarget / 100);
    const frames = new Map<number, Keyframe>();

    addFrame(frames, 0, { opacity: 0, scale: startScale });
    addFrame(frames, normalizedOffset(fadeTime, total), { opacity: 1 });
    addFrame(frames, normalizedOffset(scaleTime, total), { scale: "1" });
    addFrame(frames, 1, { opacity: 1, scale: "1" });

    playAnimation(element, orderedFrames(frames), total);
}

function animateOutClone(clone: HTMLElement, rect: DOMRect) {
    preparePositionedClone(clone, rect);
    document.body.appendChild(clone);
    exitClones.add(clone);

    const scaleTime = settings.store.scaleDuration;
    const fadeTime = settings.store.fadeOutDuration;
    const fadeStart = scaleTime * (1 - settings.store.fadeBlend / 100);
    const total = Math.max(scaleTime, fadeStart + fadeTime);
    const targetScale = String(settings.store.scaleTarget / 100);
    const frames = new Map<number, Keyframe>();

    addFrame(frames, 0, { opacity: 1, scale: "1" });
    addFrame(frames, normalizedOffset(fadeStart, total), { opacity: 1 });
    addFrame(frames, normalizedOffset(scaleTime, total), { scale: targetScale });
    addFrame(frames, normalizedOffset(fadeStart + fadeTime, total), { opacity: 0 });
    addFrame(frames, 1, { opacity: 0, scale: targetScale });

    playAnimation(clone, orderedFrames(frames), total, true);
}

function addRouteTransition(kind: RouteKind, oldSnapshot?: Snapshot) {
    if (!animationsAllowed())
        return;

    if (oldSnapshot)
        animateOutClone(oldSnapshot.node, oldSnapshot.rect);

    requestAnimationFrame(() => requestAnimationFrame(() => {
        const target = pageTarget(kind);
        if (target)
            animateIn(target);
    }));
}

function selectorForKind(kind: AnimationKind): string {
    return selectors[kind];
}

function getKind(element: Element): AnimationKind | undefined {
    if (element.matches(selectors.settings))
        return "settings";
    if (element.matches(selectors.menu))
        return "menu";
    if (element.matches(selectors.modal))
        return "modal";
}

function hasSameKindAncestor(element: Element, kind: AnimationKind): boolean {
    return Boolean(element.parentElement?.closest(selectorForKind(kind)));
}

function registerOverlay(element: HTMLElement, kind: AnimationKind) {
    if (trackedOverlays.has(element) || !isKindEnabled(kind))
        return;

    trackedOverlays.add(element);
    overlayKinds.set(element, kind);
    overlayRects.set(element, element.getBoundingClientRect());
    animateIn(element);
}

function discoverOverlays(root: Element) {
    if (root instanceof HTMLElement && root.dataset.vcEverythingMovesClone === "true")
        return;

    const candidates: HTMLElement[] = [];
    if (root instanceof HTMLElement && getKind(root))
        candidates.push(root);

    for (const kind of ["settings", "menu", "modal"] as const) {
        root.querySelectorAll<HTMLElement>(selectors[kind]).forEach(element => candidates.push(element));
    }

    for (const element of new Set(candidates)) {
        const kind = getKind(element);
        // If the added node is itself a settings sub-panel, animate it even
        // when the surrounding settings shell is already mounted.
        if (kind && (element === root || !hasSameKindAncestor(element, kind)))
            registerOverlay(element, kind);
    }
}

function animateRemovedOverlay(element: HTMLElement) {
    const kind = overlayKinds.get(element);
    const rect = overlayRects.get(element);
    trackedOverlays.delete(element);

    if (!kind || !rect || !isKindEnabled(kind) || !animationsAllowed() || !rect.width || !rect.height)
        return;

    const clone = makeSafeClone(element);
    animateOutClone(clone, rect);
}

function processMutations(records: MutationRecord[]) {
    for (const record of records) {
        record.removedNodes.forEach(node => {
            if (!(node instanceof HTMLElement))
                return;

            for (const overlay of [...trackedOverlays]) {
                if (overlay === node || node.contains(overlay))
                    animateRemovedOverlay(overlay);
            }
        });

        record.addedNodes.forEach(node => {
            if (node instanceof Element)
                discoverOverlays(node);
        });
    }
}

function trackOverlayRects() {
    for (const element of [...trackedOverlays]) {
        if (!element.isConnected) {
            trackedOverlays.delete(element);
            continue;
        }

        const rect = element.getBoundingClientRect();
        if (rect.width && rect.height)
            overlayRects.set(element, rect);
    }

    overlayFrame = requestAnimationFrame(trackOverlayRects);
}

function animateRoute(fromHref: string, toHref: string, performNavigation: () => void) {
    const kind = routeChange(fromHref, toHref);
    const enabled = kind && isRouteEnabled(kind) && animationsAllowed();
    const oldSnapshot = enabled && kind ? snapshot(pageTarget(kind)) : undefined;

    performNavigation();
    lastHref = location.href;

    if (enabled && kind)
        addRouteTransition(kind, oldSnapshot);
}

function installHistoryHooks() {
    originalPushState = history.pushState;
    originalReplaceState = history.replaceState;

    installedPushState = function (this: History, ...args: Parameters<History["pushState"]>) {
        const fromHref = lastHref;
        const toHref = args[2] == null ? location.href : new URL(String(args[2]), location.href).href;
        const kind = routeChange(fromHref, toHref);
        const oldSnapshot = kind && isRouteEnabled(kind) && animationsAllowed()
            ? snapshot(pageTarget(kind))
            : undefined;
        const result = originalPushState!.apply(this, args);
        lastHref = location.href;

        if (kind && isRouteEnabled(kind))
            addRouteTransition(kind, oldSnapshot);

        return result;
    };

    installedReplaceState = function (this: History, ...args: Parameters<History["replaceState"]>) {
        const fromHref = lastHref;
        const toHref = args[2] == null ? location.href : new URL(String(args[2]), location.href).href;
        const kind = routeChange(fromHref, toHref);
        const oldSnapshot = kind && isRouteEnabled(kind) && animationsAllowed()
            ? snapshot(pageTarget(kind))
            : undefined;
        const result = originalReplaceState!.apply(this, args);
        lastHref = location.href;

        if (kind && isRouteEnabled(kind))
            addRouteTransition(kind, oldSnapshot);

        return result;
    };

    history.pushState = installedPushState;
    history.replaceState = installedReplaceState;

    popStateListener = () => {
        const fromHref = lastHref;
        const toHref = location.href;
        animateRoute(fromHref, toHref, () => {});
    };
    window.addEventListener("popstate", popStateListener, true);
}

function cleanup() {
    observer?.disconnect();
    observer = undefined;

    if (overlayFrame)
        cancelAnimationFrame(overlayFrame);
    overlayFrame = 0;

    for (const animation of activeAnimations)
        animation.cancel();
    activeAnimations.clear();

    for (const clone of exitClones)
        clone.remove();
    exitClones.clear();
    trackedOverlays.clear();

    if (popStateListener) {
        window.removeEventListener("popstate", popStateListener, true);
        popStateListener = undefined;
    }

    if (originalPushState && history.pushState === installedPushState)
        history.pushState = originalPushState;
    if (originalReplaceState && history.replaceState === installedReplaceState)
        history.replaceState = originalReplaceState;
    originalPushState = undefined;
    originalReplaceState = undefined;
    installedPushState = undefined;
    installedReplaceState = undefined;

}

export default definePlugin({
    name: PLUGIN_NAME,
    description: "Adds shrink, fade, and grow transitions to Discord navigation, menus, and dialogs",
    authors: [],
    tags: ["Appearance", "Customisation"],
    enabledByDefault: true,
    settings,

    start() {
        installHistoryHooks();

        observer = new MutationObserver(processMutations);
        if (document.body)
            observer.observe(document.body, { childList: true, subtree: true });

        overlayFrame = requestAnimationFrame(trackOverlayRects);
    },

    stop: cleanup
});
