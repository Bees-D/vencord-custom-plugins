/*
 * Vencord, a Discord client mod
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./everythingMoves.css";

import { Button } from "@components/Button";
import ErrorBoundary from "@components/ErrorBoundary";
import { FormSwitch } from "@components/FormSwitch";
import { Paragraph } from "@components/Paragraph";
import { SettingsTab } from "@components/settings/tabs/BaseTab";
import { classNameFactory } from "@utils/css";
import { React, SettingsRouter } from "@webpack/common";

import { animationsAllowed, PAGE_KEY, presetList, settings } from ".";
import { PreviewSetting } from "./preview";

const cl = classNameFactory("vc-everythingMoves-");

type Store = typeof settings.store;
type ToggleKey = "channelNavigation" | "serverNavigation" | "otherPages" | "settingsPanels" | "menus" | "growFromCursor" | "modals" | "respectReducedMotion";

const toggles: { key: ToggleKey; title: string; description: string; }[] = [
    { key: "channelNavigation", title: "Channels and DMs", description: "When you switch channels or direct messages" },
    { key: "serverNavigation", title: "Servers", description: "When you switch servers" },
    { key: "otherPages", title: "Other pages", description: "Friends, Nitro, Shop, Discovery and similar pages" },
    { key: "settingsPanels", title: "Settings", description: "Opening, closing, and switching settings pages" },
    { key: "menus", title: "Menus and popouts", description: "Right-click menus, profile cards, and other popouts" },
    { key: "growFromCursor", title: "Grow from cursor", description: "Menus and popouts grow out of the spot you clicked" },
    { key: "modals", title: "Dialogs", description: "Pop-up windows and confirmation dialogs" }
];

const styles = [
    { value: "scale", label: "Shrink and grow" },
    { value: "zoom", label: "Zoom through" },
    { value: "slideUp", label: "Slide up" },
    { value: "slideSide", label: "Slide sideways" },
    { value: "fade", label: "Fade only" }
];

const easings = [
    { value: "smooth", label: "Smooth" },
    { value: "snappy", label: "Snappy" },
    { value: "bouncy", label: "Bouncy" },
    { value: "easeInOut", label: "Ease in and out" },
    { value: "linear", label: "Linear" }
];

const speeds = [0.25, 0.5, 0.75, 1, 1.5, 2, 3];

function set<K extends keyof Store>(key: K, value: Store[K]) {
    settings.store[key] = value;
}

function Section({ title, children }: { title: string; children: React.ReactNode; }) {
    return (
        <section className={cl("section")}>
            <h3 className={cl("sectionTitle")}>{title}</h3>
            {children}
        </section>
    );
}

function RangeRow({ label, value, min, max, step = 1, unit, onChange }: {
    label: string;
    value: number;
    min: number;
    max: number;
    step?: number;
    unit: string;
    onChange(value: number): void;
}) {
    return (
        <label className={cl("range")}>
            <span className={cl("rangeLabel")}>{label}<b>{value}{unit}</b></span>
            <input type="range" min={min} max={max} step={step} value={value} onChange={event => onChange(Number(event.target.value))} />
        </label>
    );
}

function EverythingMovesPage() {
    const store = settings.use();
    const isCustom = store.preset === "custom";
    const speedIndex = Math.max(0, speeds.indexOf(store.speed));

    return (
        <SettingsTab>
            <div className={cl("page")}>
                <Paragraph>Choose how Discord moves. Changes apply right away.</Paragraph>

                {!animationsAllowed() && (
                    <div className={cl("warning")}>
                        Animations are off because Windows asks apps to reduce motion.
                        <Button size="small" variant="secondary" onClick={() => set("respectReducedMotion", false)}>Animate anyway</Button>
                    </div>
                )}

                <Section title="Style">
                    <div className={cl("presets")}>
                        {presetList.map(preset => (
                            <button
                                key={preset.value}
                                className={cl("preset", { "preset-selected": store.preset === preset.value })}
                                onClick={() => set("preset", preset.value)}
                            >
                                <strong>{preset.name}</strong>
                                <span>{preset.description}</span>
                            </button>
                        ))}
                    </div>
                </Section>

                <Section title="Speed">
                    <RangeRow
                        label="Overall speed"
                        value={speeds[speedIndex]}
                        min={0}
                        max={speeds.length - 1}
                        unit="×"
                        onChange={index => set("speed", speeds[index])}
                    />
                    <div className={cl("scale")}><span>Slower</span><span>Faster</span></div>
                </Section>

                <Section title="Try it">
                    <PreviewSetting />
                </Section>

                {isCustom && (
                    <Section title="Custom style">
                        <div className={cl("selects")}>
                            <label>
                                Movement
                                <select value={store.style} onChange={event => set("style", event.target.value as Store["style"])}>
                                    {styles.map(style => <option key={style.value} value={style.value}>{style.label}</option>)}
                                </select>
                            </label>
                            <label>
                                Speed curve
                                <select value={store.easing} onChange={event => set("easing", event.target.value as Store["easing"])}>
                                    {easings.map(easing => <option key={easing.value} value={easing.value}>{easing.label}</option>)}
                                </select>
                            </label>
                        </div>
                        <RangeRow label="Movement amount" value={100 - store.scaleTarget} min={0} max={50} unit="%" onChange={value => set("scaleTarget", 100 - value)} />
                        <RangeRow label="Movement time" value={store.scaleDuration} min={0} max={2000} step={25} unit="ms" onChange={value => set("scaleDuration", value)} />
                        <RangeRow label="Fade in time" value={store.fadeInDuration} min={0} max={2000} step={25} unit="ms" onChange={value => set("fadeInDuration", value)} />
                        <RangeRow label="Fade out time" value={store.fadeOutDuration} min={0} max={2000} step={25} unit="ms" onChange={value => set("fadeOutDuration", value)} />
                        <RangeRow label="Start fading out early" value={store.fadeBlend} min={0} max={100} step={5} unit="%" onChange={value => set("fadeBlend", value)} />
                    </Section>
                )}

                <Section title="What animates">
                    {toggles.map(toggle => (
                        <FormSwitch
                            key={toggle.key}
                            title={toggle.title}
                            description={toggle.description}
                            value={store[toggle.key]}
                            onChange={value => set(toggle.key, value)}
                            disabled={toggle.key === "growFromCursor" && !store.menus}
                        />
                    ))}
                    <FormSwitch
                        title="Respect reduced motion"
                        description="Turn animations off when Windows accessibility settings ask apps to reduce motion"
                        value={store.respectReducedMotion}
                        onChange={value => set("respectReducedMotion", value)}
                        hideBorder
                    />
                </Section>

                <div className={cl("footer")}>
                    <Button variant="secondary" onClick={() => {
                        for (const [key, def] of Object.entries(settings.def))
                            if ("default" in def && def.default !== undefined)
                                (settings.store as any)[key] = def.default;
                        set("preset", "smooth");
                        set("style", "scale");
                        set("easing", "smooth");
                    }}>
                        Reset everything
                    </Button>
                </div>
            </div>
        </SettingsTab>
    );
}

export const SafeEverythingMovesPage = ErrorBoundary.wrap(EverythingMovesPage, { noop: false });

export function OpenPageSetting({ closePluginSettings }: { closePluginSettings(): void; }) {
    return (
        <div className={cl("openPage")}>
            <Paragraph>All Everything Moves options are on their own settings page now.</Paragraph>
            <Button onClick={() => {
                closePluginSettings();
                SettingsRouter.openUserSettings(PAGE_KEY + "_panel");
            }}>
                Open Everything Moves settings
            </Button>
        </div>
    );
}
