/*
 * Vencord, a Discord client mod
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { getUserSettingLazy } from "@api/UserSettings";
import { Button } from "@components/Button";
import { Paragraph } from "@components/Paragraph";
import { Logger } from "@utils/Logger";
import definePlugin, { OptionType, PluginNative } from "@utils/types";
import { React, useEffect, useState } from "@webpack/common";

import type { PriorityLevel } from "./native";

const Native = VencordNative.pluginHelpers.PerformanceTuner as PluginNative<typeof import("./native")>;
const logger = new Logger("PerformanceTuner");

const apply = () => void applyAll().catch(error => logger.error(error));
const bool = (description: string, extra: Record<string, unknown> = {}) =>
    ({ type: OptionType.BOOLEAN as const, description, default: false, onChange: apply, ...extra });

const settings = definePluginSettings({
    stats: {
        type: OptionType.COMPONENT,
        component: () => <StatsPanel />
    },
    highPerformance: bool("HIGH PERFORMANCE MODE: turns on every option marked (HP) below, lowers Discord's priority, caps it at 25% of your CPU, and trims memory every 2 minutes. Your own choices come back when you turn it off."),

    // Processes
    priority: {
        type: OptionType.SELECT,
        description: "Process priority for all Discord processes. Lower lets other programs (games, browsers) get the CPU first.",
        options: [
            { label: "Normal", value: "normal", default: true },
            { label: "Below normal (recommended for gaming)", value: "belowNormal" },
            { label: "Lowest (may make voice choppy when the CPU is busy)", value: "idle" }
        ],
        onChange: apply
    },
    cpuLimitPercent: {
        type: OptionType.SLIDER,
        description: "CPU limit: the most of your whole CPU (all cores together) Discord may use, as a hard cap (0 = no limit). Very low values can make voice choppy. Windows only.",
        markers: [0, 5, 10, 15, 20, 25, 30, 40, 50, 75],
        default: 0,
        stickToMarkers: true,
        onChange: apply
    },
    cpuCores: {
        type: OptionType.SLIDER,
        description: "Only let Discord use this many CPU cores (0 = all). Windows only.",
        markers: [0, 1, 2, 3, 4, 6, 8, 12, 16],
        default: 0,
        stickToMarkers: true,
        onChange: apply
    },
    efficiencyMode: bool("(HP) Windows Efficiency mode: run Discord on power-saving CPU settings (the leaf icon in Task Manager)"),
    backgroundThrottling: bool("(HP) Slow Discord down while it is minimized or in the background", { default: true }),
    disableSpellcheck: bool("(HP) Turn off spellcheck (saves memory and typing lag)"),
    powerSavingGpu: bool("Use the power-saving GPU (usually integrated graphics), so the main GPU is free for games. Windows only; restart Discord after changing.", { restartNeeded: true, onChange: (enabled: boolean) => void Native.setPowerSavingGpu(enabled) }),
    hardwareAcceleration: bool("Hardware acceleration. Off moves Discord's drawing to the CPU and frees GPU memory; restart required.", { default: true, onChange: setHardwareAcceleration }),

    // Memory
    autoTrimMinutes: {
        type: OptionType.SLIDER,
        description: "Free unused memory automatically every N minutes (0 = off). Windows only.",
        markers: [0, 1, 2, 5, 10, 15, 30],
        default: 0,
        stickToMarkers: true,
        onChange: apply
    },
    trimOnlyInBackground: bool("Only free memory while Discord is not focused (avoids small hitches while you use it)", { default: true }),
    memoryLimitMB: {
        type: OptionType.SLIDER,
        description: "Soft memory limit in MB: free memory whenever Discord goes over it (0 = off). Windows only.",
        markers: [0, 400, 600, 800, 1000, 1500, 2000, 3000],
        default: 0,
        stickToMarkers: true,
        onChange: apply
    },

    // Visual effects
    disableAnimations: bool("(HP) Turn off animations and transitions"),
    disableBlur: bool("(HP) Turn off blur and glass effects (heavy on the GPU)"),
    disableShadows: bool("(HP) Turn off shadows and glows"),
    hideAvatarDecorations: bool("(HP) Hide avatar decorations"),
    hideProfileEffects: bool("(HP) Hide animated profile effects and nameplates"),
    instantScrolling: bool("(HP) Instant scrolling instead of smooth scrolling"),
    pauseVideosInBackground: bool("(HP) Pause videos and GIFs when you switch away from Discord"),
    hideMemberList: bool("Hide the member list (fewer things to draw in big servers)"),

    // Media (these are your Discord account settings and are restored when turned off)
    stopGifAutoplay: bool("(HP) Don't autoplay GIFs"),
    stopEmojiAnimation: bool("(HP) Don't animate emoji"),
    stopStickerAnimation: bool("(HP) Don't animate stickers"),
    noEmbedMedia: bool("Don't load images and videos inside link previews"),
    noAttachmentMedia: bool("Don't show images and videos sent in chat until clicked"),

    savedDiscordSettings: {
        type: OptionType.CUSTOM,
        default: {} as Record<string, unknown>
    }
});

type Store = typeof settings.store;
type HpKey = "efficiencyMode" | "pauseVideosInBackground" | "backgroundThrottling" | "disableSpellcheck" | "disableAnimations" | "disableBlur" | "disableShadows" | "hideAvatarDecorations"
    | "hideProfileEffects" | "instantScrolling" | "stopGifAutoplay" | "stopEmojiAnimation" | "stopStickerAnimation";
const hpKeys: HpKey[] = ["efficiencyMode", "pauseVideosInBackground", "backgroundThrottling", "disableSpellcheck", "disableAnimations", "disableBlur", "disableShadows", "hideAvatarDecorations",
    "hideProfileEffects", "instantScrolling", "stopGifAutoplay", "stopEmojiAnimation", "stopStickerAnimation"];

/** The settings in force right now: your choices, with high performance mode layered on top. */
function effective() {
    const s = settings.store;
    const on = (key: keyof Store) => Boolean(s[key]) || (s.highPerformance && hpKeys.includes(key as HpKey));
    const rank: Record<PriorityLevel, number> = { normal: 0, belowNormal: 1, idle: 2 };
    const chosen = (s.priority ?? "normal") as PriorityLevel;
    return {
        on,
        priority: s.highPerformance && rank[chosen] < 1 ? "belowNormal" as PriorityLevel : chosen,
        autoTrimMinutes: s.highPerformance ? (s.autoTrimMinutes ? Math.min(s.autoTrimMinutes, 2) : 2) : s.autoTrimMinutes,
        memoryLimitMB: s.memoryLimitMB,
        cpuLimitPercent: s.highPerformance ? (s.cpuLimitPercent ? Math.min(s.cpuLimitPercent, 25) : 25) : s.cpuLimitPercent,
        cpuCores: s.cpuCores
    };
}

const css: Partial<Record<keyof Store, string>> = {
    disableAnimations: `*, *::before, *::after { animation-duration: 0s !important; animation-delay: 0s !important; transition: none !important; }`,
    disableBlur: `*, *::before, *::after { backdrop-filter: none !important; } [class*="spoilerContent_"] [class*="spoilerInnerContainer_"], img, video { filter: none !important; }`,
    disableShadows: `*, *::before, *::after { box-shadow: none !important; text-shadow: none !important; }`,
    hideAvatarDecorations: `[class*="avatarDecoration_"], img[src*="/avatar-decoration-presets/"] { display: none !important; }`,
    hideProfileEffects: `[class*="profileEffects_"], [class*="nameplated_"] > [class*="container_"]:has(> img[src*="nameplates"]), img[src*="/collectibles/nameplates/"], video[src*="/collectibles/nameplates/"] { display: none !important; }`,
    instantScrolling: `* { scroll-behavior: auto !important; }`,
    hideMemberList: `[class*="membersWrap_"] { display: none !important; }`
};

const discordSettings = {
    stopGifAutoplay: { setting: getUserSettingLazy<boolean>("textAndImages", "gifAutoPlay"), off: false },
    stopEmojiAnimation: { setting: getUserSettingLazy<boolean>("textAndImages", "animateEmoji"), off: false },
    // 2 = never animate stickers
    stopStickerAnimation: { setting: getUserSettingLazy<number>("textAndImages", "animateStickers"), off: 2 },
    noEmbedMedia: { setting: getUserSettingLazy<boolean>("textAndImages", "inlineEmbedMedia"), off: false },
    noAttachmentMedia: { setting: getUserSettingLazy<boolean>("textAndImages", "inlineAttachmentMedia"), off: false }
};

let style: HTMLStyleElement | undefined;

function pauseVideos() {
    if (effective().on("pauseVideosInBackground"))
        document.querySelectorAll("video").forEach(video => video.pause());
}
let timer: ReturnType<typeof setInterval> | undefined;
let lastTrim = 0;
let lastFreed = 0;

async function applyDiscordSettings(on: (key: keyof Store) => boolean) {
    const saved = { ...settings.store.savedDiscordSettings };
    for (const [key, entry] of Object.entries(discordSettings)) {
        const setting = entry.setting as ReturnType<typeof getUserSettingLazy<unknown>>;
        const { off } = entry;
        if (!setting)
            continue;
        const current = setting.getSetting();
        if (on(key as keyof Store)) {
            if (!(key in saved))
                saved[key] = current;
            if (current !== off)
                await setting.updateSetting(off);
        } else if (key in saved) {
            if (current === off && saved[key] !== off)
                await setting.updateSetting(saved[key]);
            delete saved[key];
        }
    }
    settings.store.savedDiscordSettings = saved;
}

async function applyAll() {
    const e = effective();

    if (style)
        style.textContent = (Object.keys(css) as (keyof Store)[]).filter(e.on).map(key => css[key]).join("\n");

    await Native.applyPriority(e.priority);
    await Native.tuneCpu(e.cpuLimitPercent, e.cpuCores, e.on("efficiencyMode"));
    await Native.setBackgroundThrottling(e.on("backgroundThrottling"));
    await Native.setSpellcheck(!e.on("disableSpellcheck"));
    await applyDiscordSettings(e.on);
}

async function trimNow() {
    lastTrim = Date.now();
    lastFreed = await Native.trimMemory();
    return lastFreed;
}

// Runs every 15 seconds: re-applies priority to processes Discord starts later, and handles memory trimming.
async function tick() {
    const e = effective();
    await Native.applyPriority(e.priority);
    // Picks up processes Discord started since the last check; does nothing when nothing changed.
    await Native.tuneCpu(e.cpuLimitPercent, e.cpuCores, e.on("efficiencyMode"));

    const background = !document.hasFocus();
    if (e.autoTrimMinutes > 0 && Date.now() - lastTrim >= e.autoTrimMinutes * 60000 && (background || !settings.store.trimOnlyInBackground)) {
        await trimNow();
        return;
    }
    if (e.memoryLimitMB > 0 && Date.now() - lastTrim > 30000) {
        const total = (await Native.getMetrics()).reduce((sum, m) => sum + m.memoryMB, 0);
        if (total > e.memoryLimitMB)
            await trimNow();
    }
}

function setHardwareAcceleration(enabled: boolean) {
    const discordGpu = (window as any).DiscordNative?.gpuSettings;
    const vesktop = (window as any).VesktopNative?.settings;
    try {
        if (discordGpu?.setEnableHardwareAcceleration)
            discordGpu.setEnableHardwareAcceleration(enabled);
        else if (vesktop?.set)
            vesktop.set({ ...vesktop.get(), hardwareAcceleration: enabled });
    } catch (error) {
        logger.error("Could not change hardware acceleration", error);
    }
}

function StatsPanel() {
    const [metrics, setMetrics] = useState<Awaited<ReturnType<typeof Native.getMetrics>>>([]);
    const [message, setMessage] = useState("");

    useEffect(() => {
        let alive = true;
        const load = () => Native.getMetrics().then(m => alive && setMetrics(m)).catch(() => { });
        load();
        const id = setInterval(load, 2000);
        return () => {
            alive = false;
            clearInterval(id);
        };
    }, []);

    const totalMB = metrics.reduce((sum, m) => sum + m.memoryMB, 0);
    const totalCpu = metrics.reduce((sum, m) => sum + m.cpu, 0);
    const byType = new Map<string, { memoryMB: number; cpu: number; count: number; }>();
    for (const m of metrics) {
        const entry = byType.get(m.type) ?? { memoryMB: 0, cpu: 0, count: 0 };
        entry.memoryMB += m.memoryMB;
        entry.cpu += m.cpu;
        entry.count++;
        byType.set(m.type, entry);
    }

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: 12, borderRadius: 8, background: "var(--background-base-lowest, #111)" }}>
            <Paragraph><b>Discord is using {totalMB.toLocaleString()} MB of memory and {totalCpu.toFixed(1)}% CPU</b> across {metrics.length} processes.</Paragraph>
            <div style={{ display: "grid", gridTemplateColumns: "1fr auto auto", gap: "2px 16px", fontSize: 12, opacity: 0.85 }}>
                {[...byType].sort((a, b) => b[1].memoryMB - a[1].memoryMB).map(([type, v]) => (
                    <React.Fragment key={type}>
                        <span>{type}{v.count > 1 ? ` ×${v.count}` : ""}</span>
                        <span>{v.memoryMB} MB</span>
                        <span>{v.cpu.toFixed(1)}%</span>
                    </React.Fragment>
                ))}
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <Button size="small" onClick={() => trimNow().then(freed => setMessage(`Freed about ${freed} MB.`))}>Free memory now</Button>
                <Button size="small" variant="secondary" onClick={() => Native.clearCache().then(() => setMessage("Cache cleared. Images will reload as you browse."))}>Clear cache</Button>
            </div>
            {(message || lastFreed > 0) && <Paragraph>{message || `Last memory trim freed about ${lastFreed} MB.`}</Paragraph>}
        </div>
    );
}

export default definePlugin({
    name: "PerformanceTuner",
    description: "Tune Discord's performance: high performance mode, process priority, memory trimming, GPU choice, and turning off heavy effects and media",
    authors: [],
    tags: ["Utility"],
    enabledByDefault: true,
    settings,

    start() {
        style = document.createElement("style");
        style.id = "vc-performance-tuner";
        document.head.append(style);
        apply();
        // Discord's exe path changes with every update, so the Windows GPU preference is re-applied for the current one.
        if (settings.store.powerSavingGpu)
            void Native.setPowerSavingGpu(true);
        timer = setInterval(() => void tick().catch(error => logger.error(error)), 15000);
        window.addEventListener("blur", pauseVideos);
    },

    async stop() {
        clearInterval(timer);
        window.removeEventListener("blur", pauseVideos);
        await Native.resetCpu();
        style?.remove();
        style = undefined;
        await Native.applyPriority("normal");
        await Native.setBackgroundThrottling(true);
        await Native.setSpellcheck(true);
        await applyDiscordSettings(() => false);
    }
});
