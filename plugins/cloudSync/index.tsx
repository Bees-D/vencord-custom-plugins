/*
 * Vencord, a Discord client mod
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import * as DataStore from "@api/DataStore";
import { definePluginSettings, Settings, SettingsStore } from "@api/Settings";
import { Button } from "@components/Button";
import { Paragraph } from "@components/Paragraph";
import { Logger } from "@utils/Logger";
import definePlugin, { OptionType, PluginNative } from "@utils/types";
import { React, UserStore, useState } from "@webpack/common";

import { getUploadedImage, setUploadedImage } from "../customBackground";

const Native = VencordNative.pluginHelpers.CloudSync as PluginNative<typeof import("./native")>;
const logger = new Logger("CloudSync");

/** Plugins whose settings follow you between devices. "enabled" and window positions stay per device. */
const SYNCED = ["ThemeStudio", "EverythingMoves", "LongFriendNicknames", "CustomBackground"] as const;
const LOCAL_ONLY = new Set(["enabled", "panelRect"]);
const META_KEY = "CloudSync_meta";
const MAX_IMAGE = 1_900_000;

interface Meta {
    settings: Record<string, { syncedAt: number; localChangedAt: number; }>;
    images: Record<string, string>;
}

const settings = definePluginSettings({
    syncKey: {
        type: OptionType.STRING,
        description: "Sync key (ask whoever runs the sync server). The same key works for everyone in your group.",
        default: ""
    },
    autoSync: {
        type: OptionType.BOOLEAN,
        description: "Sync automatically on start, after changes, and every 5 minutes",
        default: true
    },
    status: {
        type: OptionType.COMPONENT,
        component: StatusPanel
    }
});

let meta: Meta = { settings: {}, images: {} };
let applyingRemote = false;
let syncing: Promise<void> | undefined;
let pushTimer: ReturnType<typeof setTimeout> | undefined;
let interval: ReturnType<typeof setInterval> | undefined;
let status = "Not synced yet";
const statusListeners = new Set<() => void>();

function setStatus(next: string) {
    status = next;
    statusListeners.forEach(listener => listener());
}

async function api(method: "GET" | "PUT" | "DELETE", path: string, body?: unknown) {
    const response = await Native.request(method, path, settings.store.syncKey.trim(), body === undefined ? undefined : JSON.stringify(body));
    const parsed = response.body ? JSON.parse(response.body) : {};
    if (response.status >= 400)
        throw new Error(parsed?.error ?? `Server answered ${response.status}`);
    return parsed;
}

async function sha(text: string) {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return [...new Uint8Array(digest)].slice(0, 16).map(b => b.toString(16).padStart(2, "0")).join("");
}

function localSettings(plugin: string): Record<string, unknown> | undefined {
    const store = Settings.plugins[plugin];
    if (!store)
        return;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(store))
        if (!LOCAL_ONLY.has(key))
            out[key] = JSON.parse(JSON.stringify(store[key] ?? null));
    return out;
}

function applySettings(plugin: string, data: Record<string, unknown>) {
    const store = Settings.plugins[plugin];
    if (!store)
        return;
    applyingRemote = true;
    try {
        for (const [key, value] of Object.entries(data))
            if (!LOCAL_ONLY.has(key))
                store[key] = value;
    } finally {
        applyingRemote = false;
    }
}

/** Remote image key -> how to read and write it on this device. */
function imageSlots(): Record<string, { read(): Promise<string | undefined>; write(data: string): Promise<void>; }> {
    const slots: ReturnType<typeof imageSlots> = {
        bg: {
            read: async () => getUploadedImage() ?? await DataStore.get<string>("CustomBackground_image"),
            write: data => setUploadedImage(data)
        }
    };
    const images = Settings.plugins.ThemeStudio?.images;
    if (Array.isArray(images)) {
        for (const rule of images) {
            if (typeof rule?.key !== "string" || !/^[\w-]{1,90}$/.test(rule.key))
                continue;
            const storeKey = "ThemeStudio_image_" + rule.key;
            slots["ts-" + rule.key] = {
                read: () => DataStore.get<string>(storeKey),
                write: data => DataStore.set(storeKey, data)
            };
        }
    }
    return slots;
}

async function syncImages(userId: string, remote: Record<string, { hash: string; }>) {
    let themeStudioChanged = false;
    let skipped = 0;

    for (const [key, slot] of Object.entries(imageSlots())) {
        const local = await slot.read();
        const localHash = local ? await sha(local) : undefined;
        const remoteHash = remote[key]?.hash;
        const syncedHash = meta.images[key];

        if (local && localHash !== syncedHash && localHash !== remoteHash) {
            if (local.length > MAX_IMAGE) {
                skipped++;
                continue;
            }
            await api("PUT", `/v1/${userId}/images/${key}`, { data: local, hash: localHash });
            meta.images[key] = localHash!;
        } else if (remoteHash && remoteHash !== localHash && (!local || localHash === syncedHash)) {
            const { data } = await api("GET", `/v1/${userId}/images/${key}`);
            await slot.write(data);
            meta.images[key] = remoteHash;
            if (key.startsWith("ts-"))
                themeStudioChanged = true;
        } else if (localHash && localHash === remoteHash) {
            meta.images[key] = localHash;
        }
    }

    // Theme Studio reloads its images when its image list setting changes.
    if (themeStudioChanged && Array.isArray(Settings.plugins.ThemeStudio?.images)) {
        applyingRemote = true;
        Settings.plugins.ThemeStudio.images = [...Settings.plugins.ThemeStudio.images];
        applyingRemote = false;
    }
    return skipped;
}

async function runSync(direction: "both" | "upload" | "download" = "both") {
    const userId = UserStore.getCurrentUser()?.id;
    if (!userId)
        return setStatus("Waiting for Discord to log in...");
    if (!settings.store.syncKey.trim())
        return setStatus("Enter the sync key above to start syncing.");

    setStatus("Syncing...");
    const remote = await api("GET", `/v1/${userId}`);

    for (const plugin of SYNCED) {
        const local = localSettings(plugin);
        if (!local)
            continue;
        const entry = remote.settings?.[plugin] as { data: Record<string, unknown>; updatedAt: number; } | undefined;
        const m = meta.settings[plugin] ??= { syncedAt: 0, localChangedAt: 0 };
        const localDirty = m.localChangedAt > m.syncedAt;
        const remoteNewer = entry && entry.updatedAt > m.syncedAt;

        if (entry && direction !== "upload" && (direction === "download" || (remoteNewer && (!localDirty || entry.updatedAt >= m.localChangedAt)))) {
            applySettings(plugin, entry.data);
            m.syncedAt = m.localChangedAt = entry.updatedAt;
        } else if (direction !== "download" && (direction === "upload" || localDirty || !entry)) {
            const updatedAt = Math.max(Date.now(), (entry?.updatedAt ?? 0) + 1);
            await api("PUT", `/v1/${userId}/settings/${plugin}`, { data: local, updatedAt });
            m.syncedAt = m.localChangedAt = updatedAt;
        }
    }

    if (direction === "download")
        meta.images = {};
    const skipped = await syncImages(userId, remote.images ?? {});
    await DataStore.set(META_KEY, meta);
    setStatus(`Synced at ${new Date().toLocaleTimeString()}` + (skipped ? ` (${skipped} image${skipped === 1 ? "" : "s"} over 1.9 MB kept on this device only)` : ""));
}

function sync(direction: "both" | "upload" | "download" = "both") {
    syncing ??= runSync(direction)
        .catch(error => {
            logger.error(error);
            setStatus("Sync failed: " + ((error as Error)?.message ?? error));
        })
        .finally(() => syncing = undefined);
    return syncing;
}

function onSettingChanged(_: unknown, path: string) {
    if (applyingRemote)
        return;
    const [root, plugin, key] = path.split(".");
    if (root !== "plugins" || !SYNCED.includes(plugin as any) || LOCAL_ONLY.has(key))
        return;

    (meta.settings[plugin] ??= { syncedAt: 0, localChangedAt: 0 }).localChangedAt = Date.now();
    clearTimeout(pushTimer);
    pushTimer = setTimeout(() => {
        DataStore.set(META_KEY, meta);
        if (settings.store.autoSync)
            sync();
    }, 3000);
}

function StatusPanel() {
    const [, rerender] = useState(0);
    React.useEffect(() => {
        const listener = () => rerender(v => v + 1);
        statusListeners.add(listener);
        return () => void statusListeners.delete(listener);
    }, []);

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <Paragraph>{status}</Paragraph>
            <Paragraph>
                Syncs Theme Studio (styles and images), Everything Moves, Custom Background, and local friend nicknames,
                saved under your Discord account ID.
            </Paragraph>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <Button size="small" onClick={() => sync()}>Sync now</Button>
                <Button size="small" variant="secondary" onClick={() => sync("upload")}>Overwrite cloud with this device</Button>
                <Button size="small" variant="secondary" onClick={() => sync("download")}>Overwrite this device with cloud</Button>
            </div>
        </div>
    );
}

export default definePlugin({
    name: "CloudSync",
    description: "Syncs your Theme Studio, Everything Moves, Custom Background, and friend nickname settings across devices",
    authors: [],
    tags: ["Utility"],
    enabledByDefault: true,
    settings,

    flux: {
        CONNECTION_OPEN() {
            if (settings.store.autoSync)
                sync();
        }
    },

    async start() {
        meta = await DataStore.get<Meta>(META_KEY) ?? { settings: {}, images: {} };
        meta.settings ??= {};
        meta.images ??= {};
        SettingsStore.addGlobalChangeListener(onSettingChanged);
        interval = setInterval(() => settings.store.autoSync && sync(), 5 * 60 * 1000);
        if (settings.store.autoSync && UserStore.getCurrentUser())
            sync();
    },

    stop() {
        SettingsStore.removeGlobalChangeListener(onSettingChanged);
        clearInterval(interval);
        clearTimeout(pushTimer);
    }
});
