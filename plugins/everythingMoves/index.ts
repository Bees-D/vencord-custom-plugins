/*
 * Vencord, a Discord client mod
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { PaintbrushIcon } from "@components/Icons";
import SettingsPlugin from "@plugins/_core/settings";
import { removeFromArray } from "@utils/misc";
import definePlugin, { OptionType } from "@utils/types";

import { OpenPageSetting, SafeEverythingMovesPage } from "./page";

const PLUGIN_NAME = "EverythingMoves";

type MotionStyle = "scale" | "zoom" | "slideUp" | "slideSide" | "fade";
type EasingName = "smooth" | "snappy" | "bouncy" | "easeInOut" | "linear";
type PresetName = "subtle" | "smooth" | "snappy" | "bouncy" | "slide" | "fade" | "dramatic" | "custom";

interface MotionConfig {
    style: MotionStyle;
    easing: EasingName;
    scaleTarget: number;
    scaleDuration: number;
    fadeInDuration: number;
    fadeOutDuration: number;
    fadeBlend: number;
}

const easings: Record<EasingName, string> = {
    smooth: "cubic-bezier(0.22, 0.61, 0.36, 1)",
    snappy: "cubic-bezier(0.2, 0.9, 0.1, 1)",
    bouncy: "cubic-bezier(0.34, 1.56, 0.64, 1)",
    easeInOut: "cubic-bezier(0.65, 0, 0.35, 1)",
    linear: "linear"
};

const presets: Record<Exclude<PresetName, "custom">, MotionConfig> = {
    subtle: { style: "scale", easing: "smooth", scaleTarget: 97, scaleDuration: 250, fadeInDuration: 200, fadeOutDuration: 150, fadeBlend: 50 },
    smooth: { style: "scale", easing: "smooth", scaleTarget: 90, scaleDuration: 600, fadeInDuration: 500, fadeOutDuration: 400, fadeBlend: 0 },
    snappy: { style: "scale", easing: "snappy", scaleTarget: 95, scaleDuration: 180, fadeInDuration: 150, fadeOutDuration: 120, fadeBlend: 50 },
    bouncy: { style: "scale", easing: "bouncy", scaleTarget: 85, scaleDuration: 550, fadeInDuration: 300, fadeOutDuration: 250, fadeBlend: 50 },
    slide: { style: "slideUp", easing: "smooth", scaleTarget: 90, scaleDuration: 350, fadeInDuration: 300, fadeOutDuration: 200, fadeBlend: 50 },
    fade: { style: "fade", easing: "easeInOut", scaleTarget: 100, scaleDuration: 250, fadeInDuration: 250, fadeOutDuration: 200, fadeBlend: 100 },
    dramatic: { style: "zoom", easing: "easeInOut", scaleTarget: 75, scaleDuration: 1000, fadeInDuration: 800, fadeOutDuration: 700, fadeBlend: 0 }
};

export const PAGE_KEY = "vencord_everything_moves";

export const presetList: { value: PresetName; name: string; description: string; }[] = [
    { value: "subtle", name: "Subtle", description: "Barely there, very quick" },
    { value: "smooth", name: "Smooth", description: "Gentle shrink and fade" },
    { value: "snappy", name: "Snappy", description: "Fast and crisp" },
    { value: "bouncy", name: "Bouncy", description: "Springs into place" },
    { value: "slide", name: "Slide", description: "Glides up into view" },
    { value: "fade", name: "Fade", description: "Opacity only, no movement" },
    { value: "dramatic", name: "Dramatic", description: "Big, slow zoom" },
    { value: "custom", name: "Custom", description: "Fine-tune everything yourself" }
];

export const settings = definePluginSettings({
    openPage: {
        type: OptionType.COMPONENT,
        component: OpenPageSetting
    },
    preset: {
        hidden: true,
        type: OptionType.SELECT,
        description: "Pick a ready-made animation feel. Choose Custom to fine-tune every value yourself.",
        options: [
            { label: "Subtle - barely there, very quick", value: "subtle" },
            { label: "Smooth - gentle shrink and fade", value: "smooth", default: true },
            { label: "Snappy - fast and crisp", value: "snappy" },
            { label: "Bouncy - springs into place", value: "bouncy" },
            { label: "Slide - glides up into view", value: "slide" },
            { label: "Fade - opacity only, no movement", value: "fade" },
            { label: "Dramatic - big, slow zoom", value: "dramatic" },
            { label: "Custom - use the sliders below", value: "custom" }
        ]
    },
    speed: {
        type: OptionType.SLIDER,
        description: "Overall speed. 2 plays everything twice as fast, 0.5 at half speed.",
        markers: [0.25, 0.5, 0.75, 1, 1.5, 2, 3],
        default: 1,
        stickToMarkers: true,
        hidden: true
    },
    channelNavigation: {
        type: OptionType.BOOLEAN,
        description: "Animate switching between channels and direct messages",
        default: true,
        hidden: true
    },
    serverNavigation: {
        type: OptionType.BOOLEAN,
        description: "Animate switching between servers",
        default: true,
        hidden: true
    },
    otherPages: {
        type: OptionType.BOOLEAN,
        description: "Animate navigation to other Discord pages",
        default: true,
        hidden: true
    },
    settingsPanels: {
        type: OptionType.BOOLEAN,
        description: "Animate opening, closing, and switching settings panels",
        default: true,
        hidden: true
    },
    menus: {
        type: OptionType.BOOLEAN,
        description: "Animate menus, context menus, and popouts opening and closing",
        default: true,
        hidden: true
    },
    growFromCursor: {
        type: OptionType.BOOLEAN,
        description: "Menus and popouts grow out of the spot you clicked instead of their center",
        default: true,
        hidden: true
    },
    modals: {
        type: OptionType.BOOLEAN,
        description: "Animate dialogs and modal windows opening and closing",
        default: true,
        hidden: true
    },
    style: {
        type: OptionType.SELECT,
        description: "Custom: how things move",
        options: [
            { label: "Shrink and grow", value: "scale", default: true },
            { label: "Zoom through (incoming starts large)", value: "zoom" },
            { label: "Slide up", value: "slideUp" },
            { label: "Slide sideways", value: "slideSide" },
            { label: "Fade only", value: "fade" }
        ],
        hidden: true
    },
    easing: {
        type: OptionType.SELECT,
        description: "Custom: speed curve",
        options: [
            { label: "Smooth", value: "smooth", default: true },
            { label: "Snappy", value: "snappy" },
            { label: "Bouncy (overshoots slightly)", value: "bouncy" },
            { label: "Ease in and out", value: "easeInOut" },
            { label: "Linear", value: "linear" }
        ],
        hidden: true
    },
    scaleTarget: {
        type: OptionType.SLIDER,
        description: "Custom: movement amount. Lower = bigger shrink, zoom, or slide distance.",
        markers: [50, 60, 70, 80, 90, 95, 100],
        default: 90,
        stickToMarkers: true,
        hidden: true
    },
    scaleDuration: {
        type: OptionType.SLIDER,
        description: "Custom: how long the movement takes, in milliseconds",
        markers: [0, 250, 500, 750, 1000, 1500, 2000, 3000, 5000, 10000],
        default: 600,
        stickToMarkers: false,
        hidden: true
    },
    fadeInDuration: {
        type: OptionType.SLIDER,
        description: "Custom: how long incoming views take to fade in, in milliseconds",
        markers: [0, 250, 500, 750, 1000, 1500, 2000, 3000, 5000, 10000],
        default: 500,
        stickToMarkers: false,
        hidden: true
    },
    fadeOutDuration: {
        type: OptionType.SLIDER,
        description: "Custom: how long outgoing views take to fade out, in milliseconds",
        markers: [0, 250, 500, 750, 1000, 1500, 2000, 3000, 5000, 10000],
        default: 400,
        stickToMarkers: false,
        hidden: true
    },
    fadeBlend: {
        type: OptionType.SLIDER,
        description: "Custom: when the fade-out starts. 0% = after moving finishes, 100% = right away",
        markers: [0, 25, 50, 75, 100],
        default: 0,
        stickToMarkers: true,
        hidden: true
    },
    respectReducedMotion: {
        type: OptionType.BOOLEAN,
        description: "Disable animations when your system requests reduced motion",
        default: true,
        hidden: true
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

const settingsShell = '[class*="standardSidebarView"], [class*="settingsPage"]';
const settingsPanel = '[class*="contentColumn"], [role="tabpanel"]';
const menuStrict = '[role="menu"], [class*="contextMenu"]';
const popout = '[class*="popout"]';
// Class tokens starting with "layer" (Discord's popout layers), without matching words like "player".
const layerAncestor = '[class^="layer"], [class*=" layer"]';
const tooltip = '[role="tooltip"], [class*="tooltip"]';

// Broad selectors used to find candidates; getKind narrows them down.
const selectors: Record<AnimationKind, string> = {
    settings: settingsShell + ", " + settingsPanel,
    menu: menuStrict + ", " + popout,
    modal: '[role="dialog"], [aria-modal="true"], [class*="modalRoot"]'
};

let observer: MutationObserver | undefined;
let popStateListener: (() => void) | undefined;
let pointerListener: ((event: PointerEvent) => void) | undefined;
let originalPushState: History["pushState"] | undefined;
let originalReplaceState: History["replaceState"] | undefined;
let installedPushState: History["pushState"] | undefined;
let installedReplaceState: History["replaceState"] | undefined;
let lastHref = location.href;
let lastPointer: { x: number; y: number; time: number; } | undefined;
let overlayFrame = 0;

const trackedOverlays = new Set<HTMLElement>();
const overlayKinds = new WeakMap<HTMLElement, AnimationKind>();
const overlayRects = new WeakMap<HTMLElement, DOMRect>();
const elementAnimations = new WeakMap<HTMLElement, Animation>();
const activeAnimations = new Set<Animation>();
const exitClones = new Set<HTMLElement>();

export function motionConfig(): MotionConfig {
    const store = settings.store;
    const base: MotionConfig = store.preset === "custom" || !presets[store.preset as keyof typeof presets]
        ? {
            style: store.style as MotionStyle,
            easing: store.easing as EasingName,
            scaleTarget: store.scaleTarget,
            scaleDuration: store.scaleDuration,
            fadeInDuration: store.fadeInDuration,
            fadeOutDuration: store.fadeOutDuration,
            fadeBlend: store.fadeBlend
        }
        : presets[store.preset as keyof typeof presets];
    const speed = store.speed > 0 ? store.speed : 1;

    return {
        ...base,
        scaleDuration: Math.max(0, base.scaleDuration) / speed,
        fadeInDuration: Math.max(0, base.fadeInDuration) / speed,
        fadeOutDuration: Math.max(0, base.fadeOutDuration) / speed
    };
}

export function animationsAllowed(): boolean {
    return !(settings.store.respectReducedMotion && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
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

    if (from.guildId && to.guildId) {
        if (from.guildId !== to.guildId)
            return "server";
        // Same channel with a message id (jump to message) or a guild redirecting to its default channel.
        if (from.channelId === to.channelId || !from.channelId)
            return;
        return "channel";
    }

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

export function makeSafeClone(source: HTMLElement): HTMLElement {
    // Scroll positions are not cloned, so remember them and restore them on the copy.
    // Off-screen list items become empty spacers of the same size, so long chats stay cheap to snapshot.
    const marked: HTMLElement[] = [];
    if (source.isConnected) {
        for (const element of [source, ...source.querySelectorAll<HTMLElement>('[class*="scroller"], [class*="Scroller"]')]) {
            if (element.scrollTop || element.scrollLeft) {
                element.dataset.vcEmScroll = element.scrollTop + "," + element.scrollLeft;
                marked.push(element);
            }
        }

        const visible = source.getBoundingClientRect();
        for (const item of source.querySelectorAll<HTMLElement>("li")) {
            const rect = item.getBoundingClientRect();
            if (rect.height && (rect.bottom < visible.top || rect.top > visible.bottom)) {
                item.dataset.vcEmSpacer = String(rect.height);
                marked.push(item);
            }
        }
    }

    const clone = source.cloneNode(true) as HTMLElement;
    marked.forEach(element => {
        delete element.dataset.vcEmScroll;
        delete element.dataset.vcEmSpacer;
    });

    clone.querySelectorAll<HTMLElement>("[data-vc-em-spacer]").forEach(item => {
        const spacer = document.createElement("li");
        spacer.className = item.className;
        spacer.style.cssText = `box-sizing: border-box !important; height: ${item.dataset.vcEmSpacer}px !important; min-height: 0 !important; overflow: hidden !important;`;
        item.replaceWith(spacer);
    });

    clone.dataset.vcEverythingMovesClone = "true";
    clone.setAttribute("aria-hidden", "true");
    clone.inert = true;
    clone.querySelectorAll(
        'iframe, embed, object, [class*="channelTextArea"], [class*="membersWrap"], [class*="profilePanel"], [class*="userPanel"], [class*="panels"]'
    ).forEach(node => node.remove());
    clone.querySelectorAll<HTMLMediaElement>("video, audio").forEach(media => {
        media.removeAttribute("autoplay");
        media.muted = true;
        media.pause();
    });
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

function restoreCloneScroll(clone: HTMLElement) {
    for (const element of [clone, ...clone.querySelectorAll<HTMLElement>("[data-vc-em-scroll]")]) {
        const saved = element.dataset.vcEmScroll;
        if (!saved)
            continue;
        const [top, left] = saved.split(",").map(Number);
        element.scrollTop = top;
        element.scrollLeft = left;
        delete element.dataset.vcEmScroll;
    }
}

function snapshot(element: HTMLElement | null): Snapshot | undefined {
    if (!element)
        return;

    const rect = element.getBoundingClientRect();
    if (!rect.width || !rect.height)
        return;

    return { node: makeSafeClone(element), rect };
}

function playAnimation(element: HTMLElement, frames: Keyframe[], time: number, easing: string, removeWhenDone = false) {
    if (!element.isConnected)
        return;
    if (!animationsAllowed() || time <= 0) {
        if (removeWhenDone) {
            exitClones.delete(element);
            element.remove();
        }
        return;
    }

    elementAnimations.get(element)?.cancel();
    const animation = element.animate(frames, { duration: time, easing, fill: "both" });
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
        if (removeWhenDone) {
            exitClones.delete(element);
            element.remove();
        }
    };
}

function addFrame(frames: Map<number, Keyframe>, offset: number, values: Keyframe) {
    const current = frames.get(offset) ?? { offset };
    frames.set(offset, Object.assign(current, values, { offset }));
}

function orderedFrames(frames: Map<number, Keyframe>, origin?: string): Keyframe[] {
    const list = [...frames.values()].sort((a, b) => Number(a.offset) - Number(b.offset));
    if (origin)
        list.forEach(frame => frame.transformOrigin = origin);
    return list;
}

function normalizedOffset(time: number, total: number): number {
    return total > 0 ? Math.max(0, Math.min(1, time / total)) : 1;
}

const restingPose: Keyframe = { scale: "1", translate: "0 0" };

function movedPose(config: MotionConfig, direction: "in" | "out"): Keyframe {
    const amount = config.scaleTarget / 100;
    const distance = Math.round((1 - amount) * 300);
    const sign = direction === "in" ? 1 : -1;

    switch (config.style) {
        case "zoom": return { scale: String(2 - amount), translate: "0 0" };
        case "slideUp": return { scale: "1", translate: `0 ${sign * distance}px` };
        case "slideSide": return { scale: "1", translate: `${sign * distance}px 0` };
        case "fade": return restingPose;
        default: return { scale: String(amount), translate: "0 0" };
    }
}

export function animateIn(element: HTMLElement, origin?: string) {
    const config = motionConfig();
    const scaleTime = config.scaleDuration;
    const fadeTime = config.fadeInDuration;
    const total = Math.max(scaleTime, fadeTime);
    const frames = new Map<number, Keyframe>();

    addFrame(frames, 0, { opacity: 0, ...movedPose(config, "in") });
    addFrame(frames, normalizedOffset(fadeTime, total), { opacity: 1 });
    addFrame(frames, normalizedOffset(scaleTime, total), restingPose);
    addFrame(frames, 1, { opacity: 1, ...restingPose });

    playAnimation(element, orderedFrames(frames, origin), total, easings[config.easing] ?? easings.smooth);
}

export function animateOutClone(clone: HTMLElement, rect: DOMRect) {
    clone.style.setProperty("left", `${rect.left}px`, "important");
    clone.style.setProperty("top", `${rect.top}px`, "important");
    clone.style.setProperty("width", `${rect.width}px`, "important");
    clone.style.setProperty("height", `${rect.height}px`, "important");
    document.body.appendChild(clone);
    restoreCloneScroll(clone);
    exitClones.add(clone);

    const config = motionConfig();
    const scaleTime = config.scaleDuration;
    const fadeTime = config.fadeOutDuration;
    const fadeStart = scaleTime * (1 - config.fadeBlend / 100);
    const total = Math.max(scaleTime, fadeStart + fadeTime);
    const moved = movedPose(config, "out");
    const frames = new Map<number, Keyframe>();

    addFrame(frames, 0, { opacity: 1, ...restingPose });
    addFrame(frames, normalizedOffset(fadeStart, total), { opacity: 1 });
    addFrame(frames, normalizedOffset(scaleTime, total), moved);
    addFrame(frames, normalizedOffset(fadeStart + fadeTime, total), { opacity: 0 });
    addFrame(frames, 1, { opacity: 0, ...moved });

    playAnimation(clone, orderedFrames(frames), total, easings[config.easing] ?? easings.smooth, true);
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

function getKind(element: Element): AnimationKind | undefined {
    if (element.matches(tooltip))
        return;
    // Tab panels and content columns appear all over Discord; only animate them inside settings.
    if (element.matches(settingsShell) || (element.matches(settingsPanel) && element.parentElement?.closest(settingsShell)))
        return "settings";
    // Many inline elements have "popout" in a class name; real popouts are rendered inside a layer.
    if (element.matches(menuStrict) || (element.matches(popout) && element.parentElement?.closest(layerAncestor)))
        return "menu";
    if (element.matches(selectors.modal))
        return "modal";
}

function hasSameKindAncestor(element: Element, kind: AnimationKind): boolean {
    return Boolean(element.parentElement?.closest(selectors[kind]));
}

function cursorOrigin(rect: DOMRect): string | undefined {
    if (!settings.store.growFromCursor || !lastPointer || performance.now() - lastPointer.time > 1000)
        return;

    const x = Math.max(0, Math.min(rect.width, lastPointer.x - rect.left));
    const y = Math.max(0, Math.min(rect.height, lastPointer.y - rect.top));
    return `${x}px ${y}px`;
}

function registerOverlay(element: HTMLElement, kind: AnimationKind) {
    if (trackedOverlays.has(element) || !isKindEnabled(kind))
        return;

    const rect = element.getBoundingClientRect();
    trackedOverlays.add(element);
    overlayKinds.set(element, kind);
    overlayRects.set(element, rect);
    animateIn(element, kind === "menu" ? cursorOrigin(rect) : undefined);

    if (!overlayFrame)
        overlayFrame = requestAnimationFrame(trackOverlayRects);
}

function discoverOverlays(root: Element) {
    if (root instanceof HTMLElement && root.dataset.vcEverythingMovesClone === "true")
        return;

    const candidates: HTMLElement[] = [];
    if (root instanceof HTMLElement && getKind(root))
        candidates.push(root);

    for (const kind of ["settings", "menu", "modal"] as const)
        root.querySelectorAll<HTMLElement>(selectors[kind]).forEach(element => candidates.push(element));

    const registered: HTMLElement[] = [];
    for (const element of new Set(candidates)) {
        const kind = getKind(element);
        if (!kind || (element !== root && hasSameKindAncestor(element, kind)))
            continue;
        // Avoid stacking an animation inside one that started in this same batch (e.g. a tab panel inside a new modal).
        if (registered.some(parent => parent !== element && parent.contains(element)))
            continue;

        const wasTracked = trackedOverlays.has(element);
        registerOverlay(element, kind);
        if (!wasTracked && trackedOverlays.has(element))
            registered.push(element);
    }
}

function animateRemovedOverlay(element: HTMLElement) {
    const kind = overlayKinds.get(element);
    const rect = overlayRects.get(element);
    trackedOverlays.delete(element);

    if (!kind || !rect || !isKindEnabled(kind) || !animationsAllowed() || !rect.width || !rect.height)
        return;

    animateOutClone(makeSafeClone(element), rect);
}

function processMutations(records: MutationRecord[]) {
    for (const record of records) {
        record.removedNodes.forEach(node => {
            if (!(node instanceof HTMLElement) || node.dataset.vcEverythingMovesClone === "true")
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

// Removed nodes have no layout, so their last on-screen position is recorded every frame while they exist.
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

    overlayFrame = trackedOverlays.size ? requestAnimationFrame(trackOverlayRects) : 0;
}

function prepareRoute(fromHref: string, toHref: string) {
    try {
        const kind = routeChange(fromHref, toHref);
        if (!kind || !isRouteEnabled(kind) || !animationsAllowed())
            return;
        return { kind, oldSnapshot: snapshot(pageTarget(kind)) };
    } catch {
        return;
    }
}

function finishRoute(prepared: ReturnType<typeof prepareRoute>) {
    lastHref = location.href;
    if (!prepared)
        return;
    try {
        addRouteTransition(prepared.kind, prepared.oldSnapshot);
    } catch { }
}

function wrapHistoryMethod(original: History["pushState"]): History["pushState"] {
    return function (this: History, ...args: Parameters<History["pushState"]>) {
        let prepared: ReturnType<typeof prepareRoute>;
        try {
            const toHref = args[2] == null ? location.href : new URL(String(args[2]), location.href).href;
            prepared = prepareRoute(lastHref, toHref);
        } catch { }

        // Navigation must always happen, even if the animation code fails.
        const result = original.apply(this, args);
        finishRoute(prepared);
        return result;
    };
}

function installHistoryHooks() {
    lastHref = location.href;
    originalPushState = history.pushState;
    originalReplaceState = history.replaceState;
    installedPushState = wrapHistoryMethod(originalPushState);
    installedReplaceState = wrapHistoryMethod(originalReplaceState);
    history.pushState = installedPushState;
    history.replaceState = installedReplaceState;

    // Capture phase runs before Discord's router re-renders, so the old page can still be snapshotted.
    popStateListener = () => finishRoute(prepareRoute(lastHref, location.href));
    window.addEventListener("popstate", popStateListener, true);
}

function cleanup() {
    observer?.disconnect();
    observer = undefined;

    if (overlayFrame)
        cancelAnimationFrame(overlayFrame);
    overlayFrame = 0;

    for (const animation of [...activeAnimations])
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
    if (pointerListener) {
        document.removeEventListener("pointerdown", pointerListener, true);
        pointerListener = undefined;
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
    description: "Adds shrink, fade, slide, and zoom transitions to Discord navigation, menus, and dialogs",
    authors: [],
    tags: ["Appearance", "Customisation"],
    enabledByDefault: true,
    settings,

    start() {
        SettingsPlugin.customEntries.push({
            key: PAGE_KEY,
            title: "Everything Moves",
            Component: SafeEverythingMovesPage,
            Icon: PaintbrushIcon
        });
        installHistoryHooks();

        pointerListener = event => {
            lastPointer = { x: event.clientX, y: event.clientY, time: performance.now() };
        };
        document.addEventListener("pointerdown", pointerListener, { capture: true, passive: true });

        observer = new MutationObserver(processMutations);
        if (document.body)
            observer.observe(document.body, { childList: true, subtree: true });
    },

    stop() {
        cleanup();
        removeFromArray(SettingsPlugin.customEntries, entry => entry.key === PAGE_KEY);
    }
});
