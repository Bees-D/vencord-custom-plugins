/*
 * Vencord, a Discord client mod
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { IpcMainInvokeEvent } from "electron";

const SYNC_ORIGIN = "https://vencord-cloud-sync.cdn-edge-7f3a.workers.dev";

// Runs in the main process because Discord's content security policy blocks unknown domains in the page.
export async function request(_: IpcMainInvokeEvent, method: "GET" | "PUT" | "DELETE", path: string, body?: string) {
    if (!/^\/v1\/\d{15,25}(\/(settings|images)\/[\w-]{1,100})?$/.test(path))
        throw new Error("Invalid sync path");
    if (!["GET", "PUT", "DELETE"].includes(method))
        throw new Error("Invalid method");

    const response = await fetch(SYNC_ORIGIN + path, {
        method,
        headers: { "Content-Type": "application/json" },
        body,
        signal: AbortSignal.timeout(30000)
    });
    return { status: response.status, body: await response.text() };
}
