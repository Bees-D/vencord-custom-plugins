/*
 * Vencord, a Discord client mod
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./themeStudio.css";

import { definePluginSettings } from "@api/Settings";
import { userStyleRootNode } from "@api/Styles";
import { Button } from "@components/Button";
import ErrorBoundary from "@components/ErrorBoundary";
import { PaintbrushIcon } from "@components/Icons";
import { Paragraph } from "@components/Paragraph";
import { SettingsTab } from "@components/settings/tabs/BaseTab";
import SettingsPlugin from "@plugins/_core/settings";
import { classNameFactory, createAndAppendStyle } from "@utils/css";
import { removeFromArray } from "@utils/misc";
import definePlugin, { OptionType } from "@utils/types";
import { ColorPicker, createRoot, React, useEffect, useState } from "@webpack/common";

interface ThemeRule {
    selector: string;
    label: string;
    textColor: string;
    textColorEnabled: boolean;
    backgroundColor: string;
    backgroundEnabled: boolean;
    opacity: number;
    opacityEnabled: boolean;
    fontFamily: string;
    fontSize: number;
    fontSizeEnabled: boolean;
}

interface DraftRule extends Omit<ThemeRule, "selector" | "label"> { }

interface SelectorResult {
    selector: string;
    label: string;
    count: number;
}

const fonts = [
    { label: "Discord default", value: "" },
    { label: "Arial", value: "Arial, sans-serif" },
    { label: "Arial Black", value: '"Arial Black", sans-serif' },
    { label: "Comic Sans MS", value: '"Comic Sans MS", cursive' },
    { label: "Courier New", value: '"Courier New", monospace' },
    { label: "Georgia", value: "Georgia, serif" },
    { label: "Impact", value: "Impact, sans-serif" },
    { label: "Tahoma", value: "Tahoma, sans-serif" },
    { label: "Times New Roman", value: '"Times New Roman", serif' },
    { label: "Trebuchet MS", value: '"Trebuchet MS", sans-serif' },
    { label: "Verdana", value: "Verdana, sans-serif" },
    { label: "Monospace", value: "monospace" },
    { label: "System UI", value: "system-ui, sans-serif" }
];

const defaultDraft: DraftRule = {
    textColor: "#ffffff",
    textColorEnabled: true,
    backgroundColor: "#313338",
    backgroundEnabled: false,
    opacity: 100,
    opacityEnabled: false,
    fontFamily: "",
    fontSize: 16,
    fontSizeEnabled: false
};

const cl = classNameFactory("vc-themeStudio-");
let themeStyle: HTMLStyleElement | undefined;
let editorHost: HTMLDivElement | undefined;
let editorRoot: ReturnType<typeof createRoot> | undefined;
let pickerMoveListener: ((event: PointerEvent) => void) | undefined;
let pickerClickListener: ((event: MouseEvent) => void) | undefined;
let pickerHighlight: HTMLDivElement | undefined;
let themePriorityObserver: MutationObserver | undefined;

function keepThemeStyleLast() {
    if (themeStyle?.isConnected && themeStyle.parentElement === userStyleRootNode && userStyleRootNode.lastElementChild !== themeStyle)
        userStyleRootNode.appendChild(themeStyle);
}

function getRules(): ThemeRule[] {
    const rules = settings.store.rules;
    return Array.isArray(rules) ? rules : [];
}

function validColor(color: string): string | undefined {
    return /^#[0-9a-f]{6}$/i.test(color) ? color : undefined;
}

function ruleCss(rule: ThemeRule): string {
    const declarations: string[] = [];
    const textColor = validColor(rule.textColor);
    const backgroundColor = validColor(rule.backgroundColor);
    const font = fonts.find(item => item.value === rule.fontFamily)?.value;

    if (rule.textColorEnabled && textColor)
        declarations.push("color: " + textColor + " !important", "fill: currentColor !important");
    if (rule.backgroundEnabled && backgroundColor)
        declarations.push("background-color: " + backgroundColor + " !important");
    if (rule.opacityEnabled && Number.isFinite(rule.opacity))
        declarations.push("opacity: " + Math.max(0, Math.min(100, rule.opacity)) / 100 + " !important");
    if (font)
        declarations.push("font-family: " + font + " !important");
    if (rule.fontSizeEnabled && Number.isFinite(rule.fontSize))
        declarations.push("font-size: " + Math.max(8, Math.min(48, rule.fontSize)) + "px !important");

    const selectors = rule.selector.split(",").map(selector => ":root:root:root " + selector.trim()).join(", ");
    return declarations.length ? selectors + " {\n" + declarations.join(";\n") + ";\n}" : "";
}

function updateThemeStyle(rules = getRules(), preview?: ThemeRule) {
    if (!themeStyle?.isConnected)
        return;

    const combined = preview
        ? [...rules.filter(rule => rule.selector !== preview.selector), preview]
        : rules;
    themeStyle.textContent = combined.map(ruleCss).filter(Boolean).join("\n");
}

function buildSelector(element: HTMLElement): SelectorResult | undefined {
    const classNames = Array.from(element.classList).filter(name => name.length > 2 && !name.startsWith("vc-"));
    const candidates = classNames.map(name => {
        const selector = "." + CSS.escape(name);
        try {
            return { selector, name, count: document.querySelectorAll(selector).length };
        } catch {
            return undefined;
        }
    }).filter((item): item is { selector: string; name: string; count: number; } => Boolean(item?.count));

    candidates.sort((a, b) => {
        const aScore = a.count === 1 ? 10000 : a.count;
        const bScore = b.count === 1 ? 10000 : b.count;
        return aScore - bScore;
    });

    const best = candidates[0];
    if (!best)
        return;

    return {
        selector: best.selector,
        label: element.tagName.toLowerCase() + " ." + best.name,
        count: best.count
    };
}

function removePickerListeners() {
    if (pickerMoveListener)
        document.removeEventListener("pointermove", pickerMoveListener, true);
    if (pickerClickListener)
        document.removeEventListener("click", pickerClickListener, true);
    pickerMoveListener = undefined;
    pickerClickListener = undefined;
    if (pickerHighlight)
        pickerHighlight.style.display = "none";
}

function closeEditor() {
    removePickerListeners();
    editorRoot?.unmount();
    editorRoot = undefined;
    editorHost?.remove();
    editorHost = undefined;
    pickerHighlight = undefined;
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
    removePickerListeners();
    onStatus("Click an item in Discord to customize it.");

    pickerMoveListener = (event: PointerEvent) => {
        const path = event.composedPath();
        if (editorHost && path.includes(editorHost))
            return;

        const element = event.target instanceof HTMLElement ? event.target : null;
        if (!element || !pickerHighlight)
            return;

        const rect = element.getBoundingClientRect();
        Object.assign(pickerHighlight.style, {
            display: "block",
            left: rect.left + "px",
            top: rect.top + "px",
            width: rect.width + "px",
            height: rect.height + "px"
        });
    };

    pickerClickListener = (event: MouseEvent) => {
        const path = event.composedPath();
        if (editorHost && path.includes(editorHost))
            return;

        const element = event.target instanceof HTMLElement ? event.target : null;
        if (!element)
            return;

        event.preventDefault();
        event.stopImmediatePropagation();

        const result = buildSelector(element);
        if (result) {
            removePickerListeners();
            onSelect(result);
            onStatus("Selected " + result.label + " (" + result.count + " matching elements).");
        } else {
            onStatus("That item has no stable class. Pick a nearby part of it.");
        }
    };

    document.addEventListener("pointermove", pickerMoveListener, true);
    document.addEventListener("click", pickerClickListener, true);
}

function ThemeStudioPage() {
    return (
        <SettingsTab>
            <div className={cl("pageToolbar")}>
                <Paragraph>Pick an element in Discord, then edit and save its colors, opacity, and font.</Paragraph>
                <Button onClick={openEditor}>Open draggable editor</Button>
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

function ThemeEditor({ onClose, fullPage = false }: ThemeEditorProps) {
    const { rules } = settings.use(["rules"]);
    const [selector, setSelector] = useState("");
    const [label, setLabel] = useState("");
    const [matchCount, setMatchCount] = useState(0);
    const [status, setStatus] = useState("Pick an element to begin.");
    const [draft, setDraft] = useState<DraftRule>(defaultDraft);
    const [panelPosition, setPanelPosition] = useState<{ left: number; top: number; }>();
    const dragState = React.useRef<{ pointerId: number; pointerX: number; pointerY: number; left: number; top: number; } | undefined>(undefined);

    useEffect(() => {
        if (selector)
            updateThemeStyle(rules, { selector, label, ...draft });
        else
            updateThemeStyle(rules);
    }, [rules, selector, label, draft]);

    useEffect(() => () => removePickerListeners(), []);

    function updateDraft(patch: Partial<DraftRule>) {
        setDraft(current => ({ ...current, ...patch }));
    }

    function selectElement(result: SelectorResult) {
        const existing = rules.find(rule => rule.selector === result.selector);
        setSelector(result.selector);
        setLabel(result.label);
        setMatchCount(result.count);
        setDraft(existing ? {
            textColor: existing.textColor,
            textColorEnabled: existing.textColorEnabled,
            backgroundColor: existing.backgroundColor,
            backgroundEnabled: existing.backgroundEnabled,
            opacity: existing.opacity,
            opacityEnabled: existing.opacityEnabled,
            fontFamily: existing.fontFamily,
            fontSize: existing.fontSize,
            fontSizeEnabled: existing.fontSizeEnabled
        } : { ...defaultDraft });
    }

    function saveRule() {
        if (!selector)
            return;

        const next = [...rules.filter(rule => rule.selector !== selector), { selector, label, ...draft }];
        settings.store.rules = next;
        updateThemeStyle(next);
        setStatus("Saved " + label + ".");
    }

    function deleteRule() {
        if (!selector)
            return;

        const next = rules.filter(rule => rule.selector !== selector);
        settings.store.rules = next;
        setSelector("");
        setLabel("");
        setMatchCount(0);
        setDraft({ ...defaultDraft });
        setStatus("Removed the selected style.");
    }

    function beginPanelDrag(event: React.PointerEvent<HTMLDivElement>) {
        if (event.button !== 0 || (event.target instanceof Element && event.target.closest("button, input, select, a")))
            return;

        const panel = event.currentTarget.parentElement;
        if (!panel)
            return;

        const rect = panel.getBoundingClientRect();
        dragState.current = {
            pointerId: event.pointerId,
            pointerX: event.clientX,
            pointerY: event.clientY,
            left: rect.left,
            top: rect.top
        };
        setPanelPosition({ left: rect.left, top: rect.top });
        event.currentTarget.setPointerCapture(event.pointerId);
        event.preventDefault();
    }

    function movePanel(event: React.PointerEvent<HTMLDivElement>) {
        const drag = dragState.current;
        if (!drag || drag.pointerId !== event.pointerId)
            return;

        const panel = event.currentTarget.parentElement;
        if (!panel)
            return;

        const left = Math.max(0, Math.min(window.innerWidth - panel.offsetWidth, drag.left + event.clientX - drag.pointerX));
        const top = Math.max(0, Math.min(window.innerHeight - panel.offsetHeight, drag.top + event.clientY - drag.pointerY));
        setPanelPosition({ left, top });
    }

    function endPanelDrag(event: React.PointerEvent<HTMLDivElement>) {
        if (dragState.current?.pointerId === event.pointerId)
            dragState.current = undefined;
    }

    return (
        <div className={cl(fullPage ? "page" : "panel")} style={!fullPage && panelPosition ? { left: panelPosition.left, top: panelPosition.top, right: "auto", transform: "none" } : undefined}>
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
                    <div className={cl("subtitle")}>Pick an item, then style it live</div>
                </div>
                {!fullPage && <button className={cl("close")} onClick={onClose} aria-label="Close theme editor">×</button>}
            </div>

            <Button onClick={() => startElementPicker(selectElement, setStatus)}>Pick an element</Button>
            <div className={cl("status")}>{status}</div>

            {selector && (
                <div className={cl("selected")}>
                    <strong>{label}</strong>
                    <small>{matchCount} matching elements</small>
                </div>
            )}

            <div className={cl("control")}>
                <label className={cl("check")}>
                    <input type="checkbox" checked={draft.textColorEnabled} onChange={event => updateDraft({ textColorEnabled: event.target.checked })} />
                    Text color
                </label>
                <ColorPicker
                    color={parseInt(draft.textColor.slice(1), 16)}
                    onChange={(color: number) => updateDraft({ textColor: "#" + color.toString(16).padStart(6, "0") })}
                    showEyeDropper={false}
                />
            </div>

            <div className={cl("control")}>
                <label className={cl("check")}>
                    <input type="checkbox" checked={draft.backgroundEnabled} onChange={event => updateDraft({ backgroundEnabled: event.target.checked })} />
                    Background
                </label>
                <ColorPicker
                    color={parseInt(draft.backgroundColor.slice(1), 16)}
                    onChange={(color: number) => updateDraft({ backgroundColor: "#" + color.toString(16).padStart(6, "0") })}
                    showEyeDropper={false}
                />
            </div>

            <div className={cl("controlColumn")}>
                <label className={cl("check")}>
                    <input type="checkbox" checked={draft.opacityEnabled} onChange={event => updateDraft({ opacityEnabled: event.target.checked })} />
                    Opacity <span>{draft.opacity}%</span>
                </label>
                <input type="range" min="0" max="100" value={draft.opacity} onChange={event => updateDraft({ opacity: Number(event.target.value) })} />
            </div>

            <label className={cl("controlColumn")}>
                Font family
                <select value={draft.fontFamily} onChange={event => updateDraft({ fontFamily: event.target.value })}>
                    {fonts.map(font => <option key={font.label} value={font.value}>{font.label}</option>)}
                </select>
            </label>

            <div className={cl("controlColumn")}>
                <label className={cl("check")}>
                    <span><input type="checkbox" checked={draft.fontSizeEnabled} onChange={event => updateDraft({ fontSizeEnabled: event.target.checked })} /> Font size</span>
                    <span>{draft.fontSize}px</span>
                </label>
                <input type="range" min="8" max="48" value={draft.fontSize} onChange={event => updateDraft({ fontSize: Number(event.target.value) })} />
            </div>

            <div className={cl("actions")}>
                <Button onClick={saveRule} disabled={!selector}>Save style</Button>
                <Button onClick={deleteRule} disabled={!selector || !rules.some(rule => rule.selector === selector)} variant="secondary">Remove style</Button>
            </div>

            {rules.length > 0 && (
                <div className={cl("savedRules")}>
                    <strong>Saved parts</strong>
                    {rules.map(rule => (
                        <button
                            key={rule.selector}
                            className={cl("savedRule", { "savedRule-selected": rule.selector === selector })}
                            onClick={() => selectElement({
                                selector: rule.selector,
                                label: rule.label,
                                count: (() => {
                                    try {
                                        return document.querySelectorAll(rule.selector).length;
                                    } catch {
                                        return 0;
                                    }
                                })()
                            })}
                        >
                            {rule.label}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}

const settings = definePluginSettings({
    rules: {
        type: OptionType.CUSTOM,
        default: [] as ThemeRule[]
    }
});

export default definePlugin({
    name: "ThemeStudio",
    description: "Build a custom theme by selecting Discord elements and editing their colors and fonts",
    authors: [],
    tags: ["Appearance", "Customisation"],
    enabledByDefault: true,
    settings,

    start() {
        themeStyle = createAndAppendStyle("vc-themeStudio-rules", userStyleRootNode);
        themePriorityObserver = new MutationObserver(keepThemeStyleLast);
        themePriorityObserver.observe(userStyleRootNode, { childList: true });
        SettingsPlugin.customEntries.push({
            key: "vencord_theme_studio",
            title: "Theme Studio",
            Component: SafeThemeStudioPage,
            Icon: PaintbrushIcon
        });
        updateThemeStyle();
    },

    stop() {
        closeEditor();
        themePriorityObserver?.disconnect();
        themePriorityObserver = undefined;
        removeFromArray(SettingsPlugin.customEntries, entry => entry.key === "vencord_theme_studio");
        themeStyle?.remove();
        themeStyle = undefined;
    }
});
