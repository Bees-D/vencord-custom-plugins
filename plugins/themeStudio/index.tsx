/*
 * Vencord, a Discord client mod
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./themeStudio.css";

import { definePluginSettings, SettingsStore } from "@api/Settings";
import { userStyleRootNode } from "@api/Styles";
import { Button } from "@components/Button";
import ErrorBoundary from "@components/ErrorBoundary";
import { PaintbrushIcon } from "@components/Icons";
import { Paragraph } from "@components/Paragraph";
import { SettingsTab } from "@components/settings/tabs/BaseTab";
import SettingsPlugin from "@plugins/_core/settings";
import { copyToClipboard } from "@utils/clipboard";
import { classNameFactory } from "@utils/css";
import { removeFromArray } from "@utils/misc";
import definePlugin, { OptionType } from "@utils/types";
import { createRoot, PopoutWindowStore, React, useEffect, useState } from "@webpack/common";

import { GuildContextPatch, ImageRule, ImagesSection, onImageRulesChanged, startImages, stopImages, UserContextPatch } from "./images";

interface ThemeRule {
    selector: string;
    label: string;
    enabled: boolean;
    textColor: string;
    textColorEnabled: boolean;
    affectChildren: boolean;
    backgroundColor: string;
    backgroundEnabled: boolean;
    opacity: number;
    opacityEnabled: boolean;
    fontFamily: string;
    fontWeight: string;
    fontSize: number;
    fontSizeEnabled: boolean;
    borderRadius: number;
    borderRadiusEnabled: boolean;
    hidden: boolean;
}

type DraftRule = Omit<ThemeRule, "selector" | "label" | "enabled">;

interface SelectorResult {
    element?: Element;
    exactSelector: string;
    exactCount: number;
    stableSelector?: string;
    stableCount: number;
    label: string;
}

const PLUGIN_NAME = "ThemeStudio";
const LAYER = "vc-theme-studio";

const fonts = [
    { label: "Discord default", value: "" },
    { label: "Arial", value: "Arial, sans-serif" },
    { label: "Arial Black", value: '"Arial Black", sans-serif' },
    { label: "Comic Sans MS", value: '"Comic Sans MS", cursive' },
    { label: "Courier New", value: '"Courier New", monospace' },
    { label: "Georgia", value: "Georgia, serif" },
    { label: "Impact", value: "Impact, sans-serif" },
    { label: "Segoe UI", value: '"Segoe UI", sans-serif' },
    { label: "Tahoma", value: "Tahoma, sans-serif" },
    { label: "Times New Roman", value: '"Times New Roman", serif' },
    { label: "Trebuchet MS", value: '"Trebuchet MS", sans-serif' },
    { label: "Verdana", value: "Verdana, sans-serif" },
    { label: "Monospace", value: "monospace" },
    { label: "System UI", value: "system-ui, sans-serif" }
];

const fontWeights = [
    { label: "Default", value: "" },
    { label: "Light", value: "300" },
    { label: "Normal", value: "400" },
    { label: "Medium", value: "500" },
    { label: "Semibold", value: "600" },
    { label: "Bold", value: "700" },
    { label: "Extra bold", value: "800" }
];

const swatches = ["#ffffff", "#000000", "#f23f43", "#f0b232", "#23a55a", "#00a8fc", "#5865f2", "#eb459e", "#313338", "#1e1f22"];

const defaultDraft: DraftRule = {
    textColor: "#ffffff",
    textColorEnabled: false,
    affectChildren: true,
    backgroundColor: "#313338",
    backgroundEnabled: false,
    opacity: 100,
    opacityEnabled: false,
    fontFamily: "",
    fontWeight: "",
    fontSize: 16,
    fontSizeEnabled: false,
    borderRadius: 8,
    borderRadiusEnabled: false,
    hidden: false
};

const cl = classNameFactory("vc-themeStudio-");
let themeStyle: HTMLStyleElement | undefined;
let editorHost: HTMLDivElement | undefined;
let editorRoot: ReturnType<typeof createRoot> | undefined;
let pickerHighlight: HTMLDivElement | undefined;
let pickerCleanup: (() => void) | undefined;
const previews = new Map<object, ThemeRule>();

const settings = definePluginSettings({
    applyStyles: {
        type: OptionType.BOOLEAN,
        description: "Apply your saved Theme Studio styles (turn off to quickly compare with your normal theme)",
        default: true
    },
    autoSave: {
        type: OptionType.BOOLEAN,
        description: "Save changes automatically while you edit, so nothing is lost when you close the editor or restart",
        default: true
    },
    rules: {
        type: OptionType.CUSTOM,
        default: [] as ThemeRule[]
    },
    images: {
        type: OptionType.CUSTOM,
        default: [] as ImageRule[]
    },
    panelRect: {
        type: OptionType.CUSTOM,
        default: null as PanelRect | null
    }
});

interface PanelRect { left: number; top: number; width?: number; height?: number; }
type ResizeEdge = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";
const resizeEdges: ResizeEdge[] = ["n", "s", "e", "w", "ne", "nw", "se", "sw"];
const MIN_WIDTH = 260;
const MIN_HEIGHT = 200;

function savedPanelRect(): PanelRect | undefined {
    const rect = settings.store.panelRect;
    if (!rect || !Number.isFinite(rect.left) || !Number.isFinite(rect.top))
        return;
    const width = rect.width ? clamp(rect.width, MIN_WIDTH, window.innerWidth) : undefined;
    const height = rect.height ? clamp(rect.height, MIN_HEIGHT, window.innerHeight) : undefined;
    return {
        left: clamp(rect.left, 0, window.innerWidth - (width ?? 320)),
        top: clamp(rect.top, 0, window.innerHeight - (height ?? MIN_HEIGHT)),
        width,
        height
    };
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

function validColor(color: unknown): string | undefined {
    return typeof color === "string" && /^#(?:[0-9a-f]{6}|[0-9a-f]{8})$/i.test(color) ? color : undefined;
}

function validFont(font: unknown): string | undefined {
    return typeof font === "string" && /^[\w\s,"'.-]{1,120}$/.test(font) ? font : undefined;
}

function validSelector(selector: unknown): selector is string {
    if (typeof selector !== "string" || !selector.trim() || /[{};]/.test(selector))
        return false;
    try {
        document.createDocumentFragment().querySelector(selector);
        return true;
    } catch {
        return false;
    }
}

function num(value: unknown, fallback: number) {
    return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function normalizeRule(raw: any): ThemeRule | undefined {
    if (!raw || !validSelector(raw.selector))
        return;

    return {
        selector: raw.selector,
        label: typeof raw.label === "string" && raw.label ? raw.label : raw.selector,
        enabled: raw.enabled !== false,
        textColor: validColor(raw.textColor) ?? defaultDraft.textColor,
        textColorEnabled: Boolean(raw.textColorEnabled),
        affectChildren: raw.affectChildren !== false,
        backgroundColor: validColor(raw.backgroundColor) ?? defaultDraft.backgroundColor,
        backgroundEnabled: Boolean(raw.backgroundEnabled),
        opacity: clamp(num(raw.opacity, 100), 0, 100),
        opacityEnabled: Boolean(raw.opacityEnabled),
        fontFamily: validFont(raw.fontFamily) ?? "",
        fontWeight: fontWeights.some(w => w.value === raw.fontWeight) ? raw.fontWeight : "",
        fontSize: clamp(num(raw.fontSize, 16), 8, 72),
        fontSizeEnabled: Boolean(raw.fontSizeEnabled),
        borderRadius: clamp(num(raw.borderRadius, 8), 0, 50),
        borderRadiusEnabled: Boolean(raw.borderRadiusEnabled),
        hidden: Boolean(raw.hidden)
    };
}

function getRules(): ThemeRule[] {
    const rules = settings.store.rules;
    return Array.isArray(rules) ? rules.map(normalizeRule).filter((rule): rule is ThemeRule => Boolean(rule)) : [];
}

function setRules(rules: ThemeRule[]) {
    settings.store.rules = rules.map(rule => ({ ...rule }));
}

function toDraft(rule: ThemeRule): DraftRule {
    const { selector, label, enabled, ...draft } = rule;
    return draft;
}

function hasEffect(draft: DraftRule) {
    return draft.textColorEnabled || draft.backgroundEnabled || draft.opacityEnabled || Boolean(draft.fontFamily)
        || Boolean(draft.fontWeight) || draft.fontSizeEnabled || draft.borderRadiusEnabled || draft.hidden;
}

function ruleCss(rule: ThemeRule): string {
    const own: string[] = [];
    const children: string[] = [];
    const textColor = validColor(rule.textColor);
    const backgroundColor = validColor(rule.backgroundColor);
    const font = validFont(rule.fontFamily);

    if (rule.hidden)
        own.push("display: none");
    if (rule.textColorEnabled && textColor) {
        own.push("color: " + textColor, "fill: currentColor");
        if (rule.affectChildren)
            children.push("color: " + textColor);
    }
    if (rule.backgroundEnabled && backgroundColor)
        own.push("background: " + backgroundColor);
    if (rule.opacityEnabled)
        own.push("opacity: " + clamp(rule.opacity, 0, 100) / 100);
    if (font) {
        own.push("font-family: " + font);
        if (rule.affectChildren)
            children.push("font-family: " + font);
    }
    if (rule.fontWeight)
        own.push("font-weight: " + rule.fontWeight);
    if (rule.fontSizeEnabled)
        own.push("font-size: " + clamp(rule.fontSize, 8, 72) + "px");
    if (rule.borderRadiusEnabled)
        own.push("border-radius: " + clamp(rule.borderRadius, 0, 50) + "px");

    const block = (selector: string, declarations: string[]) =>
        declarations.length ? `${selector} {\n    ${declarations.map(d => d + " !important").join(";\n    ")};\n}` : "";

    return [
        block(`:is(${rule.selector})`, own),
        block(`:is(${rule.selector}) *`, children)
    ].filter(Boolean).join("\n");
}

// Important declarations inside a cascade layer beat every unlayered important declaration,
// so saved rules win over QuickCSS and online themes regardless of their selector specificity.
function buildCss(rules: ThemeRule[]) {
    const body = rules.map(ruleCss).filter(Boolean).join("\n");
    return body ? `@layer ${LAYER} {\n${body}\n}` : "";
}

function updateThemeStyle() {
    if (!themeStyle)
        return;

    const previewList = [...previews.values()];
    const previewSelectors = new Set(previewList.map(rule => rule.selector));
    const saved = settings.store.applyStyles
        ? getRules().filter(rule => rule.enabled && !previewSelectors.has(rule.selector))
        : [];

    themeStyle.textContent = buildCss([...saved, ...previewList]);
    syncPopoutWindows();
}

// Popout windows get a copy of Vencord's styles when they open; Vencord only refreshes it when themes change.
function syncPopoutWindows() {
    if (!PopoutWindowStore || !themeStyle)
        return;

    for (const key of PopoutWindowStore.getWindowKeys()) {
        const style = PopoutWindowStore.getWindow(key)?.document?.getElementById(themeStyle.id);
        if (style && style.textContent !== themeStyle.textContent)
            style.textContent = themeStyle.textContent;
    }
}

function countMatches(selector: string | undefined) {
    if (!selector)
        return 0;
    try {
        return document.querySelectorAll(selector).length;
    } catch {
        return 0;
    }
}

// Discord classes look like "messageContent_c19a55". The suffix changes when Discord updates,
// so a prefix match on "messageContent_" keeps working afterwards.
function stableSelectorFor(className: string): string | undefined {
    const match = /^([A-Za-z][\w-]*?)(_{1,2}|-)([A-Za-z0-9]{5,6})$/.exec(className);
    if (!match || match[1].length < 4 || !/[\dA-Z]/.test(match[3]) || !/[a-z\d]/.test(match[3]))
        return;

    const prefix = match[1] + match[2];
    return `[class^="${prefix}"], [class*=" ${prefix}"]`;
}

function selectorForElement(element: Element): SelectorResult | undefined {
    const candidates = Array.from(element.classList)
        .filter(name => name.length > 2 && !name.startsWith("vc-"))
        .map(name => ({ name, selector: "." + CSS.escape(name), count: countMatches("." + CSS.escape(name)) }))
        .filter(item => item.count > 0);

    // Prefer the class shared by the fewest similar elements, but avoid one-off classes when a group exists.
    candidates.sort((a, b) => (a.count === 1 ? 10000 : a.count) - (b.count === 1 ? 10000 : b.count));

    const best = candidates[0];
    if (!best)
        return;

    const stableSelector = stableSelectorFor(best.name);
    const readable = stableSelector ? best.name.replace(/(_{1,2}|-)[A-Za-z0-9]{5,6}$/, "") : best.name;

    return {
        element,
        exactSelector: best.selector,
        exactCount: best.count,
        stableSelector,
        stableCount: countMatches(stableSelector),
        label: element.tagName.toLowerCase() + " ." + readable
    };
}

function buildSelector(start: Element | null): SelectorResult | undefined {
    for (let element = start, depth = 0; element && element !== document.body && depth < 10; element = element.parentElement, depth++) {
        const result = selectorForElement(element);
        if (result)
            return result;
    }
}

function stopElementPicker() {
    pickerCleanup?.();
    pickerCleanup = undefined;
}

function closeEditor() {
    stopElementPicker();
    editorRoot?.unmount();
    editorRoot = undefined;
    editorHost?.remove();
    editorHost = undefined;
    pickerHighlight = undefined;
}

function toggleEditor() {
    if (editorRoot)
        closeEditor();
    else
        openEditor();
}

function onShortcut(event: KeyboardEvent) {
    if (event.key !== "F1" || !event.altKey || event.ctrlKey || event.shiftKey || event.metaKey || event.repeat)
        return;
    event.preventDefault();
    event.stopPropagation();
    toggleEditor();
}

function openEditor() {
    if (editorRoot || !document.body)
        return;

    const host = document.createElement("div");
    host.className = cl("host");
    const highlight = document.createElement("div");
    highlight.className = cl("highlight");
    const mount = document.createElement("div");
    host.append(highlight, mount);
    document.body.append(host);

    editorHost = host;
    pickerHighlight = highlight;
    editorRoot = createRoot(mount);
    editorRoot.render(<SafeThemeEditor onClose={closeEditor} />);
}

function startElementPicker(onSelect: (result: SelectorResult) => void, onStatus: (message: string) => void) {
    stopElementPicker();
    onStatus("Hover over Discord and click the part you want to style. Press Esc to cancel.");

    const isEditor = (event: Event) => Boolean(editorHost && event.composedPath().includes(editorHost));
    const hideHighlight = () => {
        if (pickerHighlight)
            pickerHighlight.style.display = "none";
    };

    let lastTarget: Element | undefined;
    const onMove = (event: PointerEvent) => {
        if (isEditor(event) || !pickerHighlight || !(event.target instanceof Element)) {
            lastTarget = undefined;
            return hideHighlight();
        }

        const rect = event.target.getBoundingClientRect();
        if (event.target !== lastTarget) {
            lastTarget = event.target;
            pickerHighlight.dataset.label = buildSelector(event.target)?.label ?? "no stable class here";
        }
        Object.assign(pickerHighlight.style, {
            display: "block",
            left: rect.left + "px",
            top: rect.top + "px",
            width: rect.width + "px",
            height: rect.height + "px"
        });
    };

    // Swallow the press so Discord does not open links, menus, or drags while picking.
    const block = (event: Event) => {
        if (isEditor(event))
            return;
        event.preventDefault();
        event.stopImmediatePropagation();
    };

    const onClick = (event: MouseEvent) => {
        if (isEditor(event))
            return;
        block(event);

        const result = buildSelector(event.target instanceof Element ? event.target : null);
        if (!result) {
            onStatus("That part has no stable class. Try a spot slightly to the side.");
            return;
        }

        stopElementPicker();
        onSelect(result);
    };

    const onKey = (event: KeyboardEvent) => {
        if (event.key !== "Escape")
            return;
        block(event);
        stopElementPicker();
        onStatus("Picking cancelled.");
    };

    const blocked = ["pointerdown", "mousedown", "mouseup", "contextmenu", "auxclick"] as const;
    document.addEventListener("pointermove", onMove, true);
    document.addEventListener("click", onClick, true);
    document.addEventListener("keydown", onKey, true);
    blocked.forEach(type => document.addEventListener(type, block, true));
    document.documentElement.classList.add(cl("picking"));

    pickerCleanup = () => {
        document.removeEventListener("pointermove", onMove, true);
        document.removeEventListener("click", onClick, true);
        document.removeEventListener("keydown", onKey, true);
        blocked.forEach(type => document.removeEventListener(type, block, true));
        document.documentElement.classList.remove(cl("picking"));
        hideHighlight();
    };
}

function rgbToHex(value: string, skipTransparent = false): string | undefined {
    const match = /rgba?\(([^)]+)\)/.exec(value);
    if (!match)
        return;

    const parts = match[1].split(/[\s,/]+/).filter(Boolean).map(Number);
    if (parts.length < 3 || parts.slice(0, 3).some(n => !Number.isFinite(n)))
        return;
    if (skipTransparent && parts.length > 3 && parts[3] === 0)
        return;

    return "#" + parts.slice(0, 3).map(n => clamp(Math.round(n), 0, 255).toString(16).padStart(2, "0")).join("");
}

function draftFromElement(element: Element | undefined): DraftRule {
    const draft = { ...defaultDraft };
    if (!element?.isConnected)
        return draft;

    const style = getComputedStyle(element);
    draft.textColor = rgbToHex(style.color) ?? draft.textColor;
    draft.backgroundColor = rgbToHex(style.backgroundColor, true) ?? draft.backgroundColor;
    draft.opacity = clamp(Math.round(num(parseFloat(style.opacity), 1) * 100), 0, 100);
    draft.fontSize = clamp(Math.round(num(parseFloat(style.fontSize), 16)), 8, 72);
    draft.borderRadius = clamp(Math.round(num(parseFloat(style.borderTopLeftRadius), 8)), 0, 50);
    return draft;
}

function ThemeStudioPage() {
    return (
        <SettingsTab>
            <div className={cl("pageToolbar")}>
                <Paragraph>
                    Tip: the floating editor lets you pick parts of Discord while it stays on top.
                    Close settings after opening it. Press Alt+F1 anywhere in Discord to open or close it.
                </Paragraph>
                <Button onClick={openEditor}>Open floating editor</Button>
            </div>
            <SafeThemeEditor fullPage />
        </SettingsTab>
    );
}

interface ThemeEditorProps {
    onClose?(): void;
    fullPage?: boolean;
}

const SafeThemeEditor = ErrorBoundary.wrap(ThemeEditor, { noop: false });
const SafeThemeStudioPage = ErrorBoundary.wrap(ThemeStudioPage, { noop: false });

interface Hsv { h: number; s: number; v: number; }

function hexToHsv(hex: string): Hsv {
    const color = validColor(hex) ?? "#ffffff";
    const [r, g, b] = [1, 3, 5].map(i => parseInt(color.slice(i, i + 2), 16) / 255);
    const max = Math.max(r, g, b);
    const delta = max - Math.min(r, g, b);
    let h = 0;
    if (delta) {
        if (max === r) h = ((g - b) / delta) % 6;
        else if (max === g) h = (b - r) / delta + 2;
        else h = (r - g) / delta + 4;
    }
    return { h: (h * 60 + 360) % 360, s: max ? delta / max : 0, v: max };
}

function hsvToHex({ h, s, v }: Hsv): string {
    const channel = (n: number) => {
        const k = (n + h / 60) % 6;
        return Math.round((v - v * s * Math.max(0, Math.min(k, 4 - k, 1))) * 255).toString(16).padStart(2, "0");
    };
    return "#" + channel(5) + channel(3) + channel(1);
}

// Discord's desktop shell does not reliably open the native <input type="color"> dialog, so the picker is drawn inline.
function InlineColorPicker({ value, onChange }: { value: string; onChange(value: string): void; }) {
    const [hsv, setHsv] = useState(() => hexToHsv(value));
    useEffect(() => {
        if (hsvToHex(hsv) !== value.slice(0, 7).toLowerCase())
            setHsv(hexToHsv(value));
    }, [value]);

    const update = (next: Hsv) => {
        setHsv(next);
        onChange(hsvToHex(next) + (value.length === 9 ? value.slice(7) : ""));
    };

    function onArea(event: React.PointerEvent<HTMLDivElement>) {
        if (event.type === "pointerdown")
            event.currentTarget.setPointerCapture(event.pointerId);
        else if (!(event.buttons & 1))
            return;

        const rect = event.currentTarget.getBoundingClientRect();
        update({
            h: hsv.h,
            s: clamp((event.clientX - rect.left) / rect.width, 0, 1),
            v: 1 - clamp((event.clientY - rect.top) / rect.height, 0, 1)
        });
    }

    return (
        <div className={cl("picker")}>
            <div
                className={cl("pickerArea")}
                style={{ backgroundColor: `hsl(${hsv.h}deg 100% 50%)` }}
                onPointerDown={onArea}
                onPointerMove={onArea}
            >
                <div className={cl("pickerThumb")} style={{ left: hsv.s * 100 + "%", top: (1 - hsv.v) * 100 + "%", background: hsvToHex(hsv) }} />
            </div>
            <input
                className={cl("pickerHue")}
                type="range"
                min="0"
                max="359"
                aria-label="Hue"
                value={Math.round(hsv.h)}
                onChange={event => update({ ...hsv, h: Number(event.target.value) })}
            />
        </div>
    );
}

function ColorField({ label, enabled, value, onToggle, onChange }: {
    label: string;
    enabled: boolean;
    value: string;
    onToggle(enabled: boolean): void;
    onChange(value: string): void;
}) {
    const [text, setText] = useState(value);
    const [open, setOpen] = useState(false);
    const [eyeDropperWorks, setEyeDropperWorks] = useState("EyeDropper" in window);
    useEffect(() => setText(value), [value]);

    const pick = (color: string) => {
        onChange(color);
        onToggle(true);
    };

    async function useEyeDropper() {
        try {
            const { sRGBHex } = await new (window as any).EyeDropper().open();
            pick(rgbToHex(sRGBHex) ?? validColor(sRGBHex) ?? value);
        } catch (error) {
            // Cancelling with Esc throws AbortError; anything else means the shell does not support it.
            if ((error as Error)?.name !== "AbortError")
                setEyeDropperWorks(false);
        }
    }

    return (
        <div className={cl("controlColumn")}>
            <div className={cl("control")}>
                <label className={cl("check")}>
                    <input type="checkbox" checked={enabled} onChange={event => onToggle(event.target.checked)} />
                    {label}
                </label>
                <div className={cl("colorControl")}>
                    <button
                        className={cl("colorButton", { "colorButton-open": open })}
                        style={{ background: validColor(value) ?? "#ffffff" }}
                        aria-label={"Choose " + label.toLowerCase()}
                        aria-expanded={open}
                        title="Open color picker"
                        onClick={() => setOpen(!open)}
                    />
                    <input
                        className={cl("hex")}
                        aria-label={label + " hex code"}
                        value={text}
                        spellCheck={false}
                        maxLength={9}
                        onChange={event => {
                            const next = event.target.value.trim();
                            setText(next);
                            const color = validColor(next.startsWith("#") ? next : "#" + next);
                            if (color)
                                pick(color.toLowerCase());
                        }}
                    />
                    {eyeDropperWorks && (
                        <button className={cl("iconButton")} title="Pick a color from the screen" aria-label="Pick a color from the screen" onClick={useEyeDropper}>⌖</button>
                    )}
                </div>
            </div>
            {open && <InlineColorPicker value={validColor(value) ?? "#ffffff"} onChange={pick} />}
            <div className={cl("swatches")}>
                {swatches.map(color => (
                    <button key={color} className={cl("swatch")} style={{ background: color }} title={color} aria-label={"Use " + color} onClick={() => pick(color)} />
                ))}
            </div>
        </div>
    );
}

function ThemeEditor({ onClose, fullPage = false }: ThemeEditorProps) {
    settings.use(["rules", "applyStyles", "autoSave"]);
    const rules = getRules();
    const { autoSave, applyStyles } = settings.store;

    const previewKey = React.useRef({}).current;
    const [selection, setSelection] = useState<SelectorResult>();
    const [useStable, setUseStable] = useState(false);
    const [loadedSelector, setLoadedSelector] = useState<string>();
    const [label, setLabel] = useState("");
    const [status, setStatus] = useState("Pick a part of Discord to begin.");
    const [draft, setDraft] = useState<DraftRule>(defaultDraft);
    const [importText, setImportText] = useState<string>();
    const [confirmClear, setConfirmClear] = useState(false);
    const [panelRect, setPanelRect] = useState<PanelRect | undefined>(() => fullPage ? undefined : savedPanelRect());
    const panelRectRef = React.useRef(panelRect);
    panelRectRef.current = panelRect;
    const dragState = React.useRef<{ pointerId: number; pointerX: number; pointerY: number; left: number; top: number; } | undefined>(undefined);
    const resizeState = React.useRef<{ pointerId: number; edge: ResizeEdge; pointerX: number; pointerY: number; rect: Required<PanelRect>; } | undefined>(undefined);

    const selector = selection ? (useStable && selection.stableSelector ? selection.stableSelector : selection.exactSelector) : "";
    const matchCount = selection ? (useStable && selection.stableSelector ? selection.stableCount : selection.exactCount) : 0;
    const savedRule = loadedSelector ? rules.find(rule => rule.selector === loadedSelector) : undefined;
    const isSaved = Boolean(savedRule);
    const dirty = Boolean(selector) && (savedRule
        ? JSON.stringify(draft) !== JSON.stringify(toDraft(savedRule)) || label !== savedRule.label || selector !== savedRule.selector
        : hasEffect(draft));

    const saveRef = React.useRef<() => void>(() => { });
    saveRef.current = saveRule;
    const pendingSaveRef = React.useRef(false);
    pendingSaveRef.current = autoSave && dirty;

    useEffect(() => {
        if (selector)
            previews.set(previewKey, { selector, label, enabled: true, ...draft });
        else
            previews.delete(previewKey);
        updateThemeStyle();
    }, [selector, label, draft]);

    useEffect(() => {
        if (!autoSave || !dirty)
            return;
        const timer = setTimeout(() => saveRef.current(), 500);
        return () => clearTimeout(timer);
    }, [autoSave, dirty, draft, label, selector]);

    useEffect(() => () => {
        if (pendingSaveRef.current)
            saveRef.current();
        stopElementPicker();
        previews.delete(previewKey);
        updateThemeStyle();
    }, []);

    function updateDraft(patch: Partial<DraftRule>) {
        setDraft(current => ({ ...current, ...patch }));
    }

    function loadSelection(result: SelectorResult) {
        const existing = rules.find(rule => rule.selector === result.exactSelector || rule.selector === result.stableSelector);
        const stable = existing
            ? existing.selector === result.stableSelector
            : Boolean(result.stableSelector) && result.stableCount === result.exactCount;
        const nextDraft = existing ? toDraft(existing) : draftFromElement(result.element);

        setSelection(result);
        setUseStable(stable);
        setLoadedSelector(existing?.selector);
        setLabel(existing?.label ?? result.label);
        setDraft(nextDraft);
        setStatus(existing ? "Editing saved style for " + existing.label + "." : "Selected " + result.label + ". Turn on any option below to change it.");
    }

    function selectSavedRule(rule: ThemeRule) {
        loadSelection({
            exactSelector: rule.selector,
            exactCount: countMatches(rule.selector),
            stableCount: 0,
            label: rule.label
        });
    }

    function selectParent() {
        const parent = selection?.element?.parentElement;
        const result = parent && buildSelector(parent);
        if (result)
            loadSelection(result);
        else
            setStatus("No larger part found.");
    }

    function saveRule() {
        if (!selector)
            return;

        const rule: ThemeRule = { selector, label: label.trim() || selector, enabled: true, ...draft };
        const current = getRules();
        const previous = current.find(item => item.selector === loadedSelector);
        if (previous)
            rule.enabled = previous.enabled;

        const next = current.filter(item => item.selector !== selector && item.selector !== loadedSelector);
        setRules(hasEffect(draft) ? [...next, rule] : next);
        setLoadedSelector(hasEffect(draft) ? selector : undefined);
        setStatus(hasEffect(draft) ? "Saved " + rule.label + ". It will be applied every time Discord starts." : "Nothing is turned on, so no style was saved.");
    }

    function revertDraft() {
        const saved = rules.find(rule => rule.selector === loadedSelector);
        if (saved) {
            setDraft(toDraft(saved));
            setLabel(saved.label);
        } else {
            setDraft(draftFromElement(selection?.element));
        }
        if (selection)
            setUseStable(saved ? saved.selector === selection.stableSelector : useStable);
        setStatus("Reverted unsaved changes.");
    }

    function deleteRule(target = loadedSelector) {
        if (!target)
            return;

        setRules(getRules().filter(rule => rule.selector !== target));
        if (target === loadedSelector) {
            setSelection(undefined);
            setLoadedSelector(undefined);
            setLabel("");
            setDraft({ ...defaultDraft });
        }
        setStatus("Removed the style.");
    }

    function toggleRule(target: string) {
        setRules(getRules().map(rule => rule.selector === target ? { ...rule, enabled: !rule.enabled } : rule));
    }

    async function copy(text: string, what: string) {
        try {
            await copyToClipboard(text);
            setStatus("Copied " + what + " to the clipboard.");
        } catch {
            setStatus("Could not access the clipboard.");
        }
    }

    function importRules() {
        try {
            const parsed = JSON.parse(importText ?? "");
            const incoming = (Array.isArray(parsed) ? parsed : parsed?.rules)?.map(normalizeRule).filter(Boolean) as ThemeRule[] | undefined;
            if (!incoming?.length)
                throw new Error();

            const selectors = new Set(incoming.map(rule => rule.selector));
            setRules([...getRules().filter(rule => !selectors.has(rule.selector)), ...incoming]);
            setImportText(undefined);
            setStatus("Imported " + incoming.length + " style" + (incoming.length === 1 ? "" : "s") + ".");
        } catch {
            setStatus("That text is not a Theme Studio export.");
        }
    }

    function clearAll() {
        if (!confirmClear) {
            setConfirmClear(true);
            setTimeout(() => setConfirmClear(false), 4000);
            return;
        }
        setConfirmClear(false);
        setRules([]);
        setSelection(undefined);
        setLoadedSelector(undefined);
        setStatus("Removed all styles.");
    }

    function beginPanelDrag(event: React.PointerEvent<HTMLDivElement>) {
        if (event.button !== 0 || (event.target instanceof Element && event.target.closest("button, input, select, a, textarea")))
            return;

        const panel = event.currentTarget.closest<HTMLElement>("." + cl("panel"));
        if (!panel)
            return;

        const rect = panel.getBoundingClientRect();
        dragState.current = { pointerId: event.pointerId, pointerX: event.clientX, pointerY: event.clientY, left: rect.left, top: rect.top };
        setPanelRect(current => ({ ...current, left: rect.left, top: rect.top }));
        event.currentTarget.setPointerCapture(event.pointerId);
        event.preventDefault();
    }

    function movePanel(event: React.PointerEvent<HTMLDivElement>) {
        const drag = dragState.current;
        const panel = event.currentTarget.closest<HTMLElement>("." + cl("panel"));
        if (!drag || drag.pointerId !== event.pointerId || !panel)
            return;

        const left = clamp(drag.left + event.clientX - drag.pointerX, 0, window.innerWidth - panel.offsetWidth);
        const top = clamp(drag.top + event.clientY - drag.pointerY, 0, window.innerHeight - panel.offsetHeight);
        setPanelRect(current => ({ ...current, left, top }));
    }

    function endPanelDrag(event: React.PointerEvent<HTMLDivElement>) {
        if (dragState.current?.pointerId === event.pointerId) {
            dragState.current = undefined;
            settings.store.panelRect = panelRectRef.current ?? null;
        }
    }

    function beginResize(edge: ResizeEdge, event: React.PointerEvent<HTMLDivElement>) {
        const panel = event.currentTarget.parentElement;
        if (event.button !== 0 || !panel)
            return;

        const rect = panel.getBoundingClientRect();
        const start = { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
        resizeState.current = { pointerId: event.pointerId, edge, pointerX: event.clientX, pointerY: event.clientY, rect: start };
        setPanelRect(start);
        event.currentTarget.setPointerCapture(event.pointerId);
        event.preventDefault();
        event.stopPropagation();
    }

    function moveResize(event: React.PointerEvent<HTMLDivElement>) {
        const resize = resizeState.current;
        if (!resize || resize.pointerId !== event.pointerId)
            return;

        const { rect, edge } = resize;
        const dx = event.clientX - resize.pointerX;
        const dy = event.clientY - resize.pointerY;
        let { left, top, width, height } = rect;

        if (edge.includes("e"))
            width = clamp(rect.width + dx, MIN_WIDTH, window.innerWidth - rect.left);
        if (edge.includes("s"))
            height = clamp(rect.height + dy, MIN_HEIGHT, window.innerHeight - rect.top);
        if (edge.includes("w")) {
            left = clamp(rect.left + dx, 0, rect.left + rect.width - MIN_WIDTH);
            width = rect.width + rect.left - left;
        }
        if (edge.includes("n")) {
            top = clamp(rect.top + dy, 0, rect.top + rect.height - MIN_HEIGHT);
            height = rect.height + rect.top - top;
        }
        setPanelRect({ left, top, width, height });
    }

    function endResize(event: React.PointerEvent<HTMLDivElement>) {
        if (resizeState.current?.pointerId === event.pointerId) {
            resizeState.current = undefined;
            settings.store.panelRect = panelRectRef.current ?? null;
        }
    }

    const panelStyle: React.CSSProperties | undefined = !fullPage && panelRect ? {
        left: panelRect.left,
        top: panelRect.top,
        right: "auto",
        transform: "none",
        ...(panelRect.width ? { width: panelRect.width } : {}),
        ...(panelRect.height ? { height: panelRect.height, maxHeight: "none" } : {})
    } : undefined;

    return (
        <div className={cl(fullPage ? "page" : "panel")} style={panelStyle}>
            {!fullPage && resizeEdges.map(edge => (
                <div
                    key={edge}
                    className={cl("resize", "resize-" + edge)}
                    onPointerDown={event => beginResize(edge, event)}
                    onPointerMove={moveResize}
                    onPointerUp={endResize}
                    onPointerCancel={endResize}
                    onLostPointerCapture={endResize}
                />
            ))}
            <div className={cl(fullPage ? "pageBody" : "body")}>
            <div
                className={cl(fullPage ? "pageHeader" : "header")}
                onPointerDown={fullPage ? undefined : beginPanelDrag}
                onPointerMove={fullPage ? undefined : movePanel}
                onPointerUp={fullPage ? undefined : endPanelDrag}
                onPointerCancel={fullPage ? undefined : endPanelDrag}
                onLostPointerCapture={fullPage ? undefined : endPanelDrag}
            >
                <div>
                    <div className={cl("title")}>Theme Studio</div>
                    <div className={cl("subtitle")}>{fullPage ? "Pick a part, then style it live" : "Drag here to move"}</div>
                </div>
                {!fullPage && <button className={cl("close")} onClick={onClose} aria-label="Close theme editor">×</button>}
            </div>

            {!applyStyles && (
                <div className={cl("warning")}>
                    Saved styles are turned off.
                    <button className={cl("linkButton")} onClick={() => settings.store.applyStyles = true}>Turn back on</button>
                </div>
            )}

            <div className={cl("actions")}>
                <Button onClick={() => startElementPicker(loadSelection, setStatus)}>Pick a part</Button>
                <Button variant="secondary" onClick={selectParent} disabled={!selection?.element}>Select bigger area</Button>
            </div>
            <div className={cl("status")}>{status}</div>

            {selection && (
                <div className={cl("selected")}>
                    <input className={cl("labelInput")} aria-label="Style name" value={label} onChange={event => setLabel(event.target.value)} />
                    <small>{matchCount} matching on screen{dirty && <span className={cl("dirty")}> • unsaved</span>}</small>
                    {selection.stableSelector && (
                        <label className={cl("check")} title="Discord renames its classes on updates. Matching by name keeps this style working afterwards.">
                            <input type="checkbox" checked={useStable} onChange={event => setUseStable(event.target.checked)} />
                            Keep working after Discord updates ({selection.stableCount} matches)
                        </label>
                    )}
                </div>
            )}

            {!selection && <div className={cl("hint")}>Options unlock after you pick a part or select a saved one.</div>}
            <fieldset className={cl("fields")} disabled={!selection}>
                <ColorField
                    label="Text color"
                    enabled={draft.textColorEnabled}
                    value={draft.textColor}
                    onToggle={textColorEnabled => updateDraft({ textColorEnabled })}
                    onChange={textColor => updateDraft({ textColor })}
                />

                <label className={cl("check", "subOption")}>
                    <input type="checkbox" checked={draft.affectChildren} onChange={event => updateDraft({ affectChildren: event.target.checked })} />
                    Also apply text color and font to everything inside
                </label>

                <ColorField
                    label="Background"
                    enabled={draft.backgroundEnabled}
                    value={draft.backgroundColor}
                    onToggle={backgroundEnabled => updateDraft({ backgroundEnabled })}
                    onChange={backgroundColor => updateDraft({ backgroundColor })}
                />

                <div className={cl("controlColumn")}>
                    <label className={cl("check")}>
                        <input type="checkbox" checked={draft.opacityEnabled} onChange={event => updateDraft({ opacityEnabled: event.target.checked })} />
                        Opacity <span>{draft.opacity}%</span>
                    </label>
                    <input type="range" min="0" max="100" value={draft.opacity} onChange={event => updateDraft({ opacity: Number(event.target.value), opacityEnabled: true })} />
                </div>

                <div className={cl("row")}>
                    <label className={cl("controlColumn")}>
                        Font
                        <input
                            list="vc-themeStudio-fonts"
                            placeholder="Discord default"
                            value={draft.fontFamily}
                            onChange={event => updateDraft({ fontFamily: event.target.value })}
                        />
                        <datalist id="vc-themeStudio-fonts">
                            {fonts.filter(font => font.value).map(font => <option key={font.label} value={font.value}>{font.label}</option>)}
                        </datalist>
                    </label>
                    <label className={cl("controlColumn")}>
                        Weight
                        <select value={draft.fontWeight} onChange={event => updateDraft({ fontWeight: event.target.value })}>
                            {fontWeights.map(weight => <option key={weight.label} value={weight.value}>{weight.label}</option>)}
                        </select>
                    </label>
                </div>
                {draft.fontFamily && !validFont(draft.fontFamily) && <div className={cl("warning")}>Font names can only use letters, numbers, spaces, commas, quotes, dots, and dashes.</div>}

                <div className={cl("controlColumn")}>
                    <label className={cl("check")}>
                        <input type="checkbox" checked={draft.fontSizeEnabled} onChange={event => updateDraft({ fontSizeEnabled: event.target.checked })} />
                        Font size <span>{draft.fontSize}px</span>
                    </label>
                    <input type="range" min="8" max="72" value={draft.fontSize} onChange={event => updateDraft({ fontSize: Number(event.target.value), fontSizeEnabled: true })} />
                </div>

                <div className={cl("controlColumn")}>
                    <label className={cl("check")}>
                        <input type="checkbox" checked={draft.borderRadiusEnabled} onChange={event => updateDraft({ borderRadiusEnabled: event.target.checked })} />
                        Rounded corners <span>{draft.borderRadius}px</span>
                    </label>
                    <input type="range" min="0" max="50" value={draft.borderRadius} onChange={event => updateDraft({ borderRadius: Number(event.target.value), borderRadiusEnabled: true })} />
                </div>

                <label className={cl("check")}>
                    <input type="checkbox" checked={draft.hidden} onChange={event => updateDraft({ hidden: event.target.checked })} />
                    Hide this part completely
                </label>
            </fieldset>

            <div className={cl("actions")}>
                {!autoSave && <Button onClick={saveRule} disabled={!dirty}>Save style</Button>}
                <Button variant="secondary" onClick={revertDraft} disabled={!dirty}>Undo changes</Button>
                <Button variant="dangerSecondary" onClick={() => deleteRule()} disabled={!isSaved}>Remove style</Button>
            </div>
            <label className={cl("check")}>
                <input type="checkbox" checked={autoSave} onChange={event => settings.store.autoSave = event.target.checked} />
                Save automatically
            </label>

            <ImagesSection element={selection?.element} selector={selector} label={label} onStatus={setStatus} />

            {rules.length > 0 && (
                <div className={cl("savedRules")}>
                    <div className={cl("savedHeader")}>
                        <strong>Saved parts ({rules.length})</strong>
                        <label className={cl("check")} title="Turn all saved styles on or off">
                            <input type="checkbox" checked={applyStyles} onChange={event => settings.store.applyStyles = event.target.checked} />
                            On
                        </label>
                    </div>
                    {rules.map(rule => {
                        const count = countMatches(rule.selector);
                        return (
                            <div key={rule.selector} className={cl("savedRow", { "savedRow-selected": rule.selector === loadedSelector, "savedRow-off": !rule.enabled })}>
                                <input type="checkbox" checked={rule.enabled} title="Turn this style on or off" onChange={() => toggleRule(rule.selector)} />
                                <button className={cl("savedRule")} onClick={() => selectSavedRule(rule)} title={rule.selector}>
                                    {rule.label}
                                </button>
                                <small title="Matching parts currently on screen">{count || "–"}</small>
                                <button className={cl("iconButton")} aria-label={"Remove " + rule.label} title="Remove" onClick={() => deleteRule(rule.selector)}>×</button>
                            </div>
                        );
                    })}
                </div>
            )}

            <div className={cl("actions")}>
                <Button size="small" variant="secondary" onClick={() => copy(JSON.stringify(rules, null, 2), "your styles")} disabled={!rules.length}>Export</Button>
                <Button size="small" variant="secondary" onClick={() => setImportText(importText === undefined ? "" : undefined)}>Import</Button>
                <Button size="small" variant="secondary" onClick={() => copy(buildCss(rules.filter(rule => rule.enabled)), "CSS")} disabled={!rules.length}>Copy as CSS</Button>
                <Button size="small" variant="dangerSecondary" onClick={clearAll} disabled={!rules.length}>{confirmClear ? "Click again to confirm" : "Remove all"}</Button>
            </div>

            {importText !== undefined && (
                <div className={cl("controlColumn")}>
                    <textarea className={cl("import")} placeholder="Paste a Theme Studio export here" value={importText} onChange={event => setImportText(event.target.value)} />
                    <Button size="small" onClick={importRules} disabled={!importText.trim()}>Import styles</Button>
                </div>
            )}
            </div>
        </div>
    );
}

const onRulesChanged = () => updateThemeStyle();

export default definePlugin({
    name: PLUGIN_NAME,
    description: "Build a custom theme by clicking parts of Discord and editing their colors, fonts, and visibility",
    authors: [],
    tags: ["Appearance", "Customisation"],
    enabledByDefault: true,
    settings,

    toolboxActions: {
        "Open Theme Studio (Alt+F1)": toggleEditor
    },

    contextMenus: {
        "user-context": UserContextPatch,
        "guild-context": GuildContextPatch
    },

    start() {
        document.addEventListener("keydown", onShortcut, true);
        themeStyle = document.createElement("style");
        themeStyle.id = "vc-themeStudio-rules";
        userStyleRootNode.prepend(themeStyle);

        SettingsStore.addChangeListener(`plugins.${PLUGIN_NAME}.rules`, onRulesChanged);
        SettingsStore.addChangeListener(`plugins.${PLUGIN_NAME}.applyStyles`, onRulesChanged);
        SettingsStore.addChangeListener(`plugins.${PLUGIN_NAME}.images`, onImageRulesChanged);
        startImages();
        SettingsPlugin.customEntries.push({
            key: "vencord_theme_studio",
            title: "Theme Studio",
            Component: SafeThemeStudioPage,
            Icon: PaintbrushIcon
        });
        updateThemeStyle();
    },

    stop() {
        document.removeEventListener("keydown", onShortcut, true);
        closeEditor();
        previews.clear();
        SettingsStore.removeChangeListener(`plugins.${PLUGIN_NAME}.rules`, onRulesChanged);
        SettingsStore.removeChangeListener(`plugins.${PLUGIN_NAME}.applyStyles`, onRulesChanged);
        SettingsStore.removeChangeListener(`plugins.${PLUGIN_NAME}.images`, onImageRulesChanged);
        stopImages();
        removeFromArray(SettingsPlugin.customEntries, entry => entry.key === "vencord_theme_studio");
        themeStyle?.remove();
        themeStyle = undefined;
    }
});
