/*
 * Vencord, a Discord client mod
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import * as DataStore from "@api/DataStore";
import { definePluginSettings } from "@api/Settings";
import { userStyleRootNode } from "@api/Styles";
import { Button } from "@components/Button";
import ErrorBoundary from "@components/ErrorBoundary";
import { ImageIcon } from "@components/Icons";
import { Paragraph } from "@components/Paragraph";
import { SettingsTab } from "@components/settings/tabs/BaseTab";
import SettingsPlugin from "@plugins/_core/settings";
import { removeFromArray } from "@utils/misc";
import definePlugin, { OptionType } from "@utils/types";
import { React, useEffect, useState } from "@webpack/common";

const PLUGIN_NAME = "CustomBackground";
const IMAGE_KEY = "CustomBackground_image";
const TAB_ID = "vc-custom-background";

type Source = "upload" | "url" | "color";
type Fit = "cover" | "contain" | "tile" | "center" | "stretch";

export const settings = definePluginSettings({
    source: { type: OptionType.CUSTOM, default: "upload" as Source, onChange: () => update() },
    imageUrl: { type: OptionType.CUSTOM, default: "", onChange: () => update() },
    color: { type: OptionType.CUSTOM, default: "#0b0420", onChange: () => update() },
    fit: { type: OptionType.CUSTOM, default: "cover" as Fit, onChange: () => update() },
    blur: { type: OptionType.CUSTOM, default: 0, onChange: () => update() },
    brightness: { type: OptionType.CUSTOM, default: 70, onChange: () => update() },
    panelOpacity: { type: OptionType.CUSTOM, default: 45, onChange: () => update() },
    panelTint: { type: OptionType.CUSTOM, default: "#000000", onChange: () => update() },
    page: {
        type: OptionType.COMPONENT,
        component: () => <SafeBackgroundPanel compact />
    }
});

let style: HTMLStyleElement | undefined;
let uploaded: string | undefined;
const listeners = new Set<() => void>();

const clamp = (value: unknown, min: number, max: number, fallback: number) =>
    Math.max(min, Math.min(max, typeof value === "number" && Number.isFinite(value) ? value : fallback));
const validHex = (value: unknown): value is string => typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);
const validUrl = (value: unknown): value is string => typeof value === "string" && /^https:\/\/[^\s"'()\\<>]+$/i.test(value);
const validData = (value: unknown): value is string => typeof value === "string" && /^data:image\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]+$/i.test(value);

function imageUrl(): string | undefined {
    const { source } = settings.store;
    if (source === "upload" && validData(uploaded))
        return uploaded;
    if (source === "url" && validUrl(settings.store.imageUrl))
        return settings.store.imageUrl;
}

const fits: Record<Fit, string> = {
    cover: "center / cover no-repeat",
    contain: "center / contain no-repeat",
    stretch: "center / 100% 100% no-repeat",
    center: "center / auto no-repeat",
    tile: "top left / auto repeat"
};

// Discord paints every surface with these variables; making them translucent lets the background show through.
const surfaceVars = {
    chat: ["--chat-background", "--chat-background-default", "--background-base-low", "--background-primary", "--bg-base-primary", "--home-background"],
    sidebar: ["--background-base-lower", "--background-secondary", "--bg-base-secondary", "--panel-bg", "--background-secondary-alt"],
    frame: ["--background-base-lowest", "--background-tertiary", "--bg-base-tertiary", "--app-frame-background"]
};

function buildCss(): string {
    const store = settings.store;
    const url = imageUrl();
    const color = validHex(store.color) ? store.color : "#000000";
    const tint = validHex(store.panelTint) ? store.panelTint : "#000000";
    const opacity = clamp(store.panelOpacity, 0, 100, 45);
    const blur = clamp(store.blur, 0, 40, 0);
    const brightness = clamp(store.brightness, 10, 150, 70);
    const fit = fits[store.fit as Fit] ?? fits.cover;

    const mix = (percent: number) => `color-mix(in srgb, ${tint} ${Math.min(100, Math.round(percent))}%, transparent)`;
    const vars = [
        ...surfaceVars.chat.map(v => `${v}: ${mix(opacity)} !important;`),
        ...surfaceVars.sidebar.map(v => `${v}: ${mix(opacity * 1.2)} !important;`),
        ...surfaceVars.frame.map(v => `${v}: ${mix(opacity * 1.4)} !important;`)
    ].join("\n    ");
    const themes = ".theme-dark, .theme-light, .theme-darker, .theme-midnight";

    return `
html body::before {
    content: "";
    position: fixed;
    inset: ${-blur * 2}px;
    z-index: -1;
    pointer-events: none;
    background: ${url ? `url("${url}") ${fit}, ` : ""}${color};
    filter: blur(${blur}px) brightness(${brightness}%);
}
html, html body, #app-mount, #app-mount [class*="bg_"] {
    background: transparent !important;
}
:root:root:is(${themes}), :root:root :is(${themes}) {
    ${vars}
}`;
}

function update() {
    if (style)
        style.textContent = buildCss();
    listeners.forEach(listener => listener());
}

async function loadUploaded() {
    const data = await DataStore.get<string>(IMAGE_KEY);
    uploaded = validData(data) ? data : undefined;
    update();
}

function chooseFile(): Promise<File | undefined> {
    return new Promise(resolve => {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = "image/png,image/jpeg,image/webp,image/gif,image/avif,image/bmp";
        input.onchange = () => resolve(input.files?.[0]);
        input.oncancel = () => resolve(undefined);
        input.click();
    });
}

function readFile(file: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
    });
}

// Very large photos are scaled to 2560 px so the stylesheet stays fast; GIFs are kept as-is to stay animated.
async function prepare(file: File): Promise<string> {
    if (file.type === "image/gif") {
        if (file.size > 15 * 1024 * 1024)
            throw new Error("GIFs must be under 15 MB.");
        return readFile(file);
    }
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 2560 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    return canvas.toDataURL("image/webp", 0.9);
}

export async function setUploadedImage(data: string | undefined) {
    if (data && !validData(data))
        throw new Error("Not an image.");
    uploaded = data;
    if (data) await DataStore.set(IMAGE_KEY, data);
    else await DataStore.del(IMAGE_KEY);
    update();
}

export const getUploadedImage = () => uploaded;

const presets: { name: string; apply: Partial<typeof settings.store>; }[] = [
    { name: "Clear glass", apply: { panelOpacity: 25, panelTint: "#000000", blur: 0, brightness: 85 } },
    { name: "Readable", apply: { panelOpacity: 60, panelTint: "#000000", blur: 4, brightness: 60 } },
    { name: "Dreamy blur", apply: { panelOpacity: 35, panelTint: "#1e1033", blur: 16, brightness: 75 } },
    { name: "Purple night", apply: { panelOpacity: 45, panelTint: "#2e1065", blur: 2, brightness: 55 } },
    { name: "Ocean", apply: { panelOpacity: 45, panelTint: "#0c2a4a", blur: 2, brightness: 65 } }
];

function useBackgroundVersion() {
    const [, setVersion] = useState(0);
    useEffect(() => {
        const listener = () => setVersion(v => v + 1);
        listeners.add(listener);
        return () => void listeners.delete(listener);
    }, []);
}

function Range({ label, value, min, max, unit, onChange }: { label: string; value: number; min: number; max: number; unit: string; onChange(value: number): void; }) {
    return (
        <label className="vc-custombg-range">
            <span>{label}<b>{value}{unit}</b></span>
            <input type="range" min={min} max={max} value={value} onChange={event => onChange(Number(event.target.value))} />
        </label>
    );
}

function BackgroundPanel({ compact = false }: { compact?: boolean; }) {
    const store = settings.use();
    useBackgroundVersion();
    const [status, setStatus] = useState("");
    const [urlDraft, setUrlDraft] = useState(store.imageUrl);
    const preview = imageUrl();

    async function upload() {
        const file = await chooseFile();
        if (!file)
            return;
        try {
            setStatus("Loading image...");
            await setUploadedImage(await prepare(file));
            settings.store.source = "upload";
            setStatus("Background set. It is saved on this device.");
        } catch (error) {
            setStatus((error as Error)?.message ?? "Could not use that image.");
        }
    }

    function applyUrl() {
        if (!validUrl(urlDraft.trim())) {
            setStatus("Use a direct https:// link to an image.");
            return;
        }
        settings.store.imageUrl = urlDraft.trim();
        settings.store.source = "url";
        setStatus("Background set from link.");
    }

    return (
        <div className="vc-custombg">
            {!compact && <Paragraph>Set a background image or color behind Discord. Panels turn see-through so it shows.</Paragraph>}

            <div className="vc-custombg-preview" style={{
                background: `${preview ? `url("${preview}") ${fits[store.fit as Fit] ?? fits.cover}, ` : ""}${store.color}`,
                filter: `blur(${Math.min(store.blur, 6) / 2}px) brightness(${store.brightness}%)`
            }}>
                <div style={{ background: `color-mix(in srgb, ${store.panelTint} ${store.panelOpacity}%, transparent)` }}>Panel preview</div>
            </div>

            <div className="vc-custombg-row">
                <Button onClick={upload}>Upload image</Button>
                <input className="vc-custombg-input" placeholder="or paste an https:// image link" value={urlDraft} onChange={event => setUrlDraft(event.target.value)} onKeyDown={event => event.key === "Enter" && applyUrl()} />
                <Button variant="secondary" onClick={applyUrl}>Use link</Button>
            </div>

            <div className="vc-custombg-row">
                <label className="vc-custombg-field">Show
                    <select value={store.source} onChange={event => settings.store.source = event.target.value as Source}>
                        <option value="upload" disabled={!uploaded}>Uploaded image</option>
                        <option value="url" disabled={!validUrl(store.imageUrl)}>Image link</option>
                        <option value="color">Color only</option>
                    </select>
                </label>
                <label className="vc-custombg-field">Fit
                    <select value={store.fit} onChange={event => settings.store.fit = event.target.value as Fit}>
                        <option value="cover">Fill (crop)</option>
                        <option value="contain">Fit whole image</option>
                        <option value="stretch">Stretch</option>
                        <option value="center">Center</option>
                        <option value="tile">Tile</option>
                    </select>
                </label>
                <label className="vc-custombg-field">Base color
                    <input type="color" value={store.color} onChange={event => settings.store.color = event.target.value} />
                </label>
                <label className="vc-custombg-field">Panel tint
                    <input type="color" value={store.panelTint} onChange={event => settings.store.panelTint = event.target.value} />
                </label>
            </div>

            <Range label="Panel darkness" value={store.panelOpacity} min={0} max={100} unit="%" onChange={v => settings.store.panelOpacity = v} />
            <Range label="Image brightness" value={store.brightness} min={10} max={150} unit="%" onChange={v => settings.store.brightness = v} />
            <Range label="Image blur" value={store.blur} min={0} max={40} unit="px" onChange={v => settings.store.blur = v} />

            <div className="vc-custombg-row">
                {presets.map(preset => (
                    <button key={preset.name} className="vc-custombg-preset" onClick={() => Object.assign(settings.store, preset.apply)}>{preset.name}</button>
                ))}
                {uploaded && <Button size="small" variant="dangerSecondary" onClick={() => setUploadedImage(undefined).then(() => settings.store.source = "color")}>Remove uploaded image</Button>}
            </div>
            {status && <Paragraph>{status}</Paragraph>}
        </div>
    );
}

const SafeBackgroundPanel = ErrorBoundary.wrap(BackgroundPanel, { noop: false });

function BackgroundPage() {
    return <SettingsTab><SafeBackgroundPanel /></SettingsTab>;
}

const panelCss = `
.vc-custombg { display: flex; flex-direction: column; gap: 12px; color: var(--text-default, #dbdee1); }
.vc-custombg-preview { position: relative; height: 150px; border-radius: 10px; overflow: hidden; border: 1px solid var(--border-subtle, #3f4147); }
.vc-custombg-preview > div { position: absolute; left: 16px; bottom: 16px; padding: 10px 14px; border-radius: 8px; color: #fff; font-weight: 600; }
.vc-custombg-row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.vc-custombg-input { flex: 1; min-width: 180px; padding: 8px; color: var(--text-default, #dbdee1); background: var(--background-base-lowest, #111); border: 1px solid var(--border-subtle, #3f4147); border-radius: 6px; }
.vc-custombg-field { display: flex; flex-direction: column; gap: 4px; font-size: 12px; }
.vc-custombg-field select { padding: 6px; color: var(--text-default, #dbdee1); background: var(--background-base-lowest, #111); border: 1px solid var(--border-subtle, #3f4147); border-radius: 6px; }
.vc-custombg-field input[type="color"] { width: 54px; height: 32px; padding: 0; border: 1px solid var(--border-subtle, #3f4147); border-radius: 6px; background: none; cursor: pointer; }
.vc-custombg-range { display: flex; flex-direction: column; gap: 4px; }
.vc-custombg-range span { display: flex; justify-content: space-between; }
.vc-custombg-range input { width: 100%; accent-color: var(--brand-500, #5865f2); }
.vc-custombg-preset { padding: 5px 12px; color: var(--text-default, #dbdee1); background: var(--background-base-lowest, #111); border: 1px solid var(--border-subtle, #3f4147); border-radius: 999px; cursor: pointer; }
.vc-custombg-preset:hover { border-color: var(--brand-500, #5865f2); }
`;

interface ExtraThemeTab { id: string; title: string; Component: React.ComponentType; }
declare global {
    interface Window { VcExtraThemeTabs?: ExtraThemeTab[]; VcExtraThemeTabsReady?: boolean; }
}

let panelStyle: HTMLStyleElement | undefined;

export default definePlugin({
    name: PLUGIN_NAME,
    description: "Set a background image or color behind Discord, with blur, brightness, and see-through panels. Found under Vencord → Themes → Background",
    authors: [],
    tags: ["Appearance", "Customisation"],
    enabledByDefault: true,
    settings,

    start() {
        style = document.createElement("style");
        style.id = "vc-custom-background";
        userStyleRootNode.append(style);
        panelStyle = document.createElement("style");
        panelStyle.textContent = panelCss;
        document.head.append(panelStyle);

        // The installer adds a hook to Vencord's Themes tab; without it, use a separate settings page.
        if (window.VcExtraThemeTabsReady) {
            (window.VcExtraThemeTabs ??= []).push({ id: TAB_ID, title: "Background", Component: BackgroundPanel });
        } else {
            SettingsPlugin.customEntries.push({ key: "vencord_custom_background", title: "Background", Component: BackgroundPage, Icon: ImageIcon });
        }

        update();
        loadUploaded();
    },

    stop() {
        if (window.VcExtraThemeTabs)
            removeFromArray(window.VcExtraThemeTabs, tab => tab.id === TAB_ID);
        removeFromArray(SettingsPlugin.customEntries, entry => entry.key === "vencord_custom_background");
        style?.remove();
        style = undefined;
        panelStyle?.remove();
        panelStyle = undefined;
    }
});

