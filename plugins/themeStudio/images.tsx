/*
 * Vencord, a Discord client mod
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import * as DataStore from "@api/DataStore";
import { Settings, useSettings } from "@api/Settings";
import { userStyleRootNode } from "@api/Styles";
import { Button } from "@components/Button";
import { ImageIcon } from "@components/Icons";
import { classNameFactory } from "@utils/css";
import type { Guild, User } from "@vencord/discord-types";
import { GuildStore, Menu, PopoutWindowStore, React, useEffect, useState } from "@webpack/common";

export type ImageKind = "avatar" | "guild" | "src" | "selector";

export interface ImageRule {
    key: string;
    kind: ImageKind;
    target: string;
    label: string;
    enabled: boolean;
}

interface ImageTarget {
    kind: ImageKind;
    target: string;
    label: string;
}

const PLUGIN = "ThemeStudio";
const LAYER = "vc-theme-studio";
const DATA_PREFIX = "ThemeStudio_image_";
const cl = classNameFactory("vc-themeStudio-");

const imageData = new Map<string, string>();
const listeners = new Set<() => void>();
let imageStyle: HTMLStyleElement | undefined;
let loadToken = 0;

const pluginSettings = () => Settings.plugins[PLUGIN] as { images?: ImageRule[]; };

export function getImageRules(): ImageRule[] {
    const rules = pluginSettings()?.images;
    return Array.isArray(rules) ? rules.filter(rule => rule && typeof rule.key === "string" && validTarget(rule)) : [];
}

function setImageRules(rules: ImageRule[]) {
    pluginSettings().images = rules.map(rule => ({ ...rule }));
}

function validTarget(rule: Pick<ImageRule, "kind" | "target">) {
    switch (rule.kind) {
        case "avatar":
        case "guild": return /^\d{5,25}$/.test(rule.target);
        case "src": return /^[\w./%:@~-]{4,300}$/.test(rule.target);
        case "selector":
            if (/[{};]/.test(rule.target))
                return false;
            try {
                document.createDocumentFragment().querySelector(rule.target);
                return true;
            } catch {
                return false;
            }
    }
}

const validData = (data: unknown): data is string => typeof data === "string" && /^data:image\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]+$/i.test(data);

function imageCss(rule: ImageRule, data: string): string {
    const url = `url("${data}")`;
    const replaceImg = `content: ${url} !important; object-fit: cover !important;`;
    const replaceBg = `background-image: ${url} !important; background-size: cover !important; background-position: center !important;`;

    switch (rule.kind) {
        case "avatar": {
            const id = rule.target;
            return `img[src*="/avatars/${id}/"], img[src*="/users/${id}/avatars/"] { ${replaceImg} }\n`
                + `[style*="/avatars/${id}/"], [style*="/users/${id}/avatars/"] { ${replaceBg} }`;
        }
        case "guild": {
            const id = rule.target;
            // Servers without an icon show their initials instead of an image.
            return `img[src*="/icons/${id}/"] { ${replaceImg} }\n`
                + `[style*="/icons/${id}/"] { ${replaceBg} }\n`
                + `[data-list-item-id="guildsnav___${id}"] [class*="childWrapper_"], [data-vc-guild-id="${id}"] { ${replaceBg} color: transparent !important; }\n`
                + `[data-vc-guild-id="${id}"] [class*="acronym_"] { color: transparent !important; }`;
        }
        case "src":
            return `img[src*="${rule.target}"] { ${replaceImg} }\n[style*="${rule.target}"] { ${replaceBg} }`;
        case "selector":
            return `img:is(${rule.target}) { ${replaceImg} }\n`
                + `:is(${rule.target}):not(img) { background: ${url} center / contain no-repeat !important; }\n`
                + `:is(${rule.target}):not(img) > * { visibility: hidden !important; }`;
    }
}

function updateImageStyle() {
    if (!imageStyle)
        return;

    const body = getImageRules()
        .filter(rule => rule.enabled && validData(imageData.get(rule.key)))
        .map(rule => imageCss(rule, imageData.get(rule.key)!))
        .join("\n");
    imageStyle.textContent = body ? `@layer ${LAYER} {\n${body}\n}` : "";

    if (PopoutWindowStore) {
        for (const key of PopoutWindowStore.getWindowKeys()) {
            const style = PopoutWindowStore.getWindow(key)?.document?.getElementById(imageStyle.id);
            if (style && style.textContent !== imageStyle.textContent)
                style.textContent = imageStyle.textContent;
        }
    }
    listeners.forEach(listener => listener());
}

async function loadImageData() {
    const token = ++loadToken;
    const rules = getImageRules();
    const values = await DataStore.getMany<string>(rules.map(rule => DATA_PREFIX + rule.key));
    if (token !== loadToken)
        return;

    imageData.clear();
    rules.forEach((rule, index) => {
        if (validData(values[index]))
            imageData.set(rule.key, values[index]!);
    });
    updateImageStyle();
}

export function startImages() {
    imageStyle = document.createElement("style");
    imageStyle.id = "vc-themeStudio-images";
    userStyleRootNode.prepend(imageStyle);
    loadImageData();
}

export function stopImages() {
    loadToken++;
    imageStyle?.remove();
    imageStyle = undefined;
    imageData.clear();
}

export const onImageRulesChanged = () => loadImageData();

function readFile(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
    });
}

// Large photos are scaled down so the stylesheet stays small; GIFs and SVGs are kept as-is to stay animated or sharp.
async function prepareImage(file: File, maxSize: number): Promise<string> {
    if (!file.type.startsWith("image/"))
        throw new Error("That file is not an image.");

    if (file.type === "image/gif" || file.type === "image/svg+xml") {
        if (file.size > 8 * 1024 * 1024)
            throw new Error("GIFs and SVGs must be under 8 MB.");
        return readFile(file);
    }

    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    return canvas.toDataURL("image/webp", 0.92);
}

function chooseFile(): Promise<File | undefined> {
    return new Promise(resolve => {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = "image/png,image/jpeg,image/webp,image/gif,image/svg+xml,image/avif,image/bmp";
        input.onchange = () => resolve(input.files?.[0]);
        input.oncancel = () => resolve(undefined);
        input.click();
    });
}

export async function replaceImage(target: ImageTarget): Promise<string | undefined> {
    const file = await chooseFile();
    if (!file)
        return;

    const data = await prepareImage(file, target.kind === "avatar" || target.kind === "guild" ? 512 : 1024);
    if (!validData(data))
        throw new Error("Could not read that image.");

    const existing = getImageRules().find(rule => rule.kind === target.kind && rule.target === target.target);
    const key = existing?.key ?? `${target.kind}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

    await DataStore.set(DATA_PREFIX + key, data);
    imageData.set(key, data);
    setImageRules([
        ...getImageRules().filter(rule => rule.key !== key),
        { key, kind: target.kind, target: target.target, label: target.label, enabled: true }
    ]);
    return target.label;
}

export async function removeImage(key: string) {
    setImageRules(getImageRules().filter(rule => rule.key !== key));
    imageData.delete(key);
    await DataStore.del(DATA_PREFIX + key);
}

function toggleImage(key: string) {
    setImageRules(getImageRules().map(rule => rule.key === key ? { ...rule, enabled: !rule.enabled } : rule));
}

function targetFromUrl(raw: string, fallbackLabel: string): ImageTarget | undefined {
    let url: URL;
    try {
        url = new URL(raw, location.href);
    } catch {
        return;
    }
    if (url.protocol === "data:" || url.protocol === "blob:")
        return;

    const avatar = /\/(?:avatars|users)\/(\d{5,25})\//.exec(url.pathname);
    if (avatar)
        return { kind: "avatar", target: avatar[1], label: "Avatar " + avatar[1] };

    const icon = /\/icons\/(\d{5,25})\//.exec(url.pathname);
    if (icon)
        return { kind: "guild", target: icon[1], label: "Server icon " + icon[1] };

    // Match on host and path without the size/format query so every size of the same image is replaced.
    const target = (url.host + url.pathname).replace(/[^\w./%:@~-]/g, "");
    return target.length >= 4 ? { kind: "src", target, label: fallbackLabel + " (" + url.pathname.split("/").pop() + ")" } : undefined;
}

/** Works out what to replace for an element picked in Discord. */
export function imageTargetForElement(element: Element | undefined, fallbackSelector: string, label: string): ImageTarget | undefined {
    if (!element)
        return fallbackSelector ? { kind: "selector", target: fallbackSelector, label } : undefined;

    // Servers without an icon render shared "acronym" classes, so a class selector would hit every icon-less server.
    const taggedId = (element.closest("[data-vc-guild-id]") ?? element.querySelector("[data-vc-guild-id]"))?.getAttribute("data-vc-guild-id");
    const guildItem = element.closest('[data-list-item-id^="guildsnav___"]')?.getAttribute("data-list-item-id");
    const guildId = (taggedId && /^\d{5,25}$/.test(taggedId) ? taggedId : undefined) ?? (guildItem && /^guildsnav___(\d{5,25})$/.exec(guildItem)?.[1]);
    if (guildId) {
        const name = GuildStore.getGuild(guildId)?.name;
        return { kind: "guild", target: guildId, label: "Server: " + (name || guildId) };
    }

    const img = element instanceof HTMLImageElement ? element : element.querySelector("img") ?? element.closest("img");
    if (img?.src) {
        const target = targetFromUrl(img.currentSrc || img.src, label);
        if (target)
            return target;
    }

    for (let node: Element | null = element, depth = 0; node && depth < 3; node = node.parentElement, depth++) {
        const background = /url\(["']?([^"')]+)["']?\)/.exec(getComputedStyle(node).backgroundImage);
        if (background) {
            const target = targetFromUrl(background[1], label);
            if (target)
                return target;
        }
    }

    return fallbackSelector ? { kind: "selector", target: fallbackSelector, label } : undefined;
}

function useImageVersion() {
    const [, setVersion] = useState(0);
    useEffect(() => {
        const listener = () => setVersion(v => v + 1);
        listeners.add(listener);
        return () => void listeners.delete(listener);
    }, []);
}

export function ImagesSection({ element, selector, label, onStatus }: {
    element?: Element;
    selector: string;
    label: string;
    onStatus(message: string): void;
}) {
    useSettings([`plugins.${PLUGIN}.images`] as any);
    useImageVersion();
    const rules = getImageRules();
    const target = imageTargetForElement(element, selector, label);
    const [busy, setBusy] = useState(false);

    async function upload() {
        if (!target)
            return;
        setBusy(true);
        try {
            const done = await replaceImage(target);
            if (done)
                onStatus("Replaced " + done + ". It stays replaced after restarting.");
        } catch (error) {
            onStatus((error as Error)?.message ?? "Could not use that image.");
        } finally {
            setBusy(false);
        }
    }

    return (
        <div className={cl("images")}>
            <strong>Images</strong>
            <div className={cl("hint")}>
                Pick an image, icon, or avatar above, or right-click a server or user and choose "Change ... (Theme Studio)".
            </div>
            <Button size="small" onClick={upload} disabled={!target || busy}>
                {busy ? "Loading..." : target ? `Upload new image for ${target.kind === "avatar" ? "this avatar" : target.kind === "guild" ? "this server icon" : "this part"}` : "Pick a part to replace its image"}
            </Button>
            {target?.kind === "selector" && (() => {
                let count = 0;
                try { count = document.querySelectorAll(target.target).length; } catch { }
                return count > 1 && <div className={cl("warning")}>This part's style is shared, so the image will replace all {count} matching parts.</div>;
            })()}
            {rules.map(rule => {
                const data = imageData.get(rule.key);
                return (
                    <div key={rule.key} className={cl("savedRow", { "savedRow-off": !rule.enabled })}>
                        <input type="checkbox" checked={rule.enabled} title="Turn this image on or off" onChange={() => toggleImage(rule.key)} />
                        {data ? <img className={cl("thumb")} src={data} alt="" /> : <span className={cl("thumb")} title="Image data is missing on this device">?</span>}
                        <span className={cl("savedRule")} title={rule.target}>{rule.label}</span>
                        <button className={cl("iconButton")} aria-label={"Remove " + rule.label} title="Remove" onClick={() => removeImage(rule.key)}>×</button>
                    </div>
                );
            })}
        </div>
    );
}

async function contextReplace(target: ImageTarget) {
    try {
        await replaceImage(target);
    } catch (error) {
        console.error("[ThemeStudio]", error);
    }
}

function resetItem(kind: ImageKind, id: string) {
    const rule = getImageRules().find(r => r.kind === kind && r.target === id);
    return rule
        ? <Menu.MenuItem id={`vc-themeStudio-reset-${kind}`} label="Reset Image (Theme Studio)" action={() => removeImage(rule.key)} />
        : null;
}

export const UserContextPatch: NavContextMenuPatchCallback = (children, { user }: { user?: User; }) => {
    if (!user)
        return;
    children.push(
        <Menu.MenuItem
            id="vc-themeStudio-avatar"
            label="Change Avatar (Theme Studio)"
            icon={ImageIcon}
            action={() => contextReplace({ kind: "avatar", target: user.id, label: "Avatar: " + (user.globalName ?? user.username) })}
        />,
        resetItem("avatar", user.id)
    );
};

export const GuildContextPatch: NavContextMenuPatchCallback = (children, { guild }: { guild?: Guild; }) => {
    if (!guild)
        return;
    children.push(
        <Menu.MenuItem
            id="vc-themeStudio-guild-icon"
            label="Change Server Icon (Theme Studio)"
            icon={ImageIcon}
            action={() => contextReplace({ kind: "guild", target: guild.id, label: "Server: " + guild.name })}
        />,
        resetItem("guild", guild.id)
    );
};
