/*
 * Vencord, a Discord client mod
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ChildProcessWithoutNullStreams, execFile, spawn } from "child_process";
import { app, BrowserWindow, type IpcMainInvokeEvent } from "electron";
import { constants, cpus, setPriority } from "os";

export type PriorityLevel = "normal" | "belowNormal" | "idle";

const priorities: Record<PriorityLevel, number> = {
    normal: constants.priority.PRIORITY_NORMAL,
    belowNormal: constants.priority.PRIORITY_BELOW_NORMAL,
    idle: constants.priority.PRIORITY_LOW
};

const isWindows = process.platform === "win32";
const run = (file: string, args: string[]) => new Promise<{ code: number; out: string; }>(resolve =>
    execFile(file, args, { windowsHide: true, timeout: 20000 }, (error, stdout, stderr) =>
        resolve({ code: error ? (typeof error.code === "number" ? error.code : 1) : 0, out: String(stdout || stderr) })));

const pids = () => app.getAppMetrics().map(m => m.pid).filter(pid => Number.isInteger(pid) && pid > 0);
const totalMemoryMB = () => app.getAppMetrics().reduce((sum, m) => sum + (m.memory?.workingSetSize ?? 0), 0) / 1024;

export function getMetrics(_: IpcMainInvokeEvent) {
    return app.getAppMetrics().map(m => ({
        type: m.type === "Utility" && m.serviceName ? m.serviceName : m.type,
        pid: m.pid,
        memoryMB: Math.round((m.memory?.workingSetSize ?? 0) / 1024),
        cpu: Math.round((m.cpu?.percentCPUUsage ?? 0) * 10) / 10
    }));
}

export function cpuCount(_: IpcMainInvokeEvent) {
    return cpus().length;
}

/** Applies to every Discord process (main, GPU, renderers, utilities). Returns how many were changed. */
export function applyPriority(_: IpcMainInvokeEvent, level: PriorityLevel) {
    const value = priorities[level] ?? priorities.normal;
    let changed = 0;
    for (const pid of pids()) {
        try {
            setPriority(pid, value);
            changed++;
        } catch { }
    }
    return changed;
}

export function setBackgroundThrottling(_: IpcMainInvokeEvent, enabled: boolean) {
    for (const window of BrowserWindow.getAllWindows())
        window.webContents.setBackgroundThrottling(enabled);
}

export function setSpellcheck(_: IpcMainInvokeEvent, enabled: boolean) {
    for (const window of BrowserWindow.getAllWindows())
        window.webContents.session.setSpellCheckerEnabled(enabled);
}

export async function clearCache(_: IpcMainInvokeEvent) {
    const sessions = new Set(BrowserWindow.getAllWindows().map(w => w.webContents.session));
    for (const s of sessions) {
        await s.clearCache();
        await s.clearCodeCaches({});
    }
}

// Windows "Graphics settings" per-app preference: 1 = power saving (usually the integrated GPU), leaving the main GPU to games.
const GPU_KEY = "HKCU\\Software\\Microsoft\\DirectX\\UserGpuPreferences";
export async function setPowerSavingGpu(_: IpcMainInvokeEvent, enabled: boolean) {
    if (!isWindows)
        return false;
    const exe = process.execPath;
    const result = enabled
        ? await run("reg.exe", ["add", GPU_KEY, "/v", exe, "/t", "REG_SZ", "/d", "GpuPreference=1;", "/f"])
        : await run("reg.exe", ["delete", GPU_KEY, "/v", exe, "/f"]);
    return result.code === 0 || !enabled;
}

/*
 * A single long-running PowerShell helper owns one Windows job object for the whole session.
 * Re-creating the job on every change would nest Discord inside several jobs, and nested CPU caps stack.
 * Commands arrive on stdin as "verb arg pid,pid,..." and every value is a number built here.
 */
const helperScript = String.raw`
$ErrorActionPreference = 'SilentlyContinue'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class VcTune {
    [DllImport("kernel32.dll")] static extern IntPtr CreateJobObject(IntPtr a, IntPtr name);
    [DllImport("kernel32.dll")] static extern bool SetInformationJobObject(IntPtr job, int cls, ref CpuRate info, int size);
    [DllImport("kernel32.dll")] static extern bool SetInformationJobObject(IntPtr job, int cls, ref BasicLimits info, int size);
    [DllImport("kernel32.dll")] static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
    [DllImport("kernel32.dll")] static extern IntPtr OpenProcess(int access, bool inherit, int pid);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
    [DllImport("kernel32.dll")] static extern bool SetProcessInformation(IntPtr process, int cls, ref Throttle info, int size);
    [DllImport("kernel32.dll")] static extern bool SetProcessAffinityMask(IntPtr process, UIntPtr mask);
    [DllImport("psapi.dll")] static extern bool EmptyWorkingSet(IntPtr process);
    [StructLayout(LayoutKind.Sequential)] struct CpuRate { public uint Flags; public uint Rate; }
    [StructLayout(LayoutKind.Sequential)] struct BasicLimits { public long a; public long b; public uint Flags; public UIntPtr c; public UIntPtr d; public uint e; public UIntPtr f; public uint g; public uint h; }
    [StructLayout(LayoutKind.Sequential)] struct Throttle { public uint Version; public uint ControlMask; public uint StateMask; }

    static IntPtr job = IntPtr.Zero;
    static System.Collections.Generic.HashSet<int> inJob = new System.Collections.Generic.HashSet<int>();

    static IntPtr Open(int access, int pid) { return OpenProcess(access, false, pid); }

    public static string Cap(int percent, int[] pids) {
        if (job == IntPtr.Zero) {
            job = CreateJobObject(IntPtr.Zero, IntPtr.Zero);
            var basic = new BasicLimits { Flags = 0x800 }; // BREAKAWAY_OK keeps Chromium's own sandbox jobs working
            SetInformationJobObject(job, 2, ref basic, Marshal.SizeOf(basic));
        }
        bool capped = percent > 0 && percent < 100;
        // A 100% hard cap means no limit; Windows rejects turning rate control off with flags 0.
        var rate = new CpuRate { Flags = 0x1 | 0x4, Rate = capped ? (uint)(percent * 100) : 10000u };
        bool ok = SetInformationJobObject(job, 15, ref rate, Marshal.SizeOf(rate));
        if (capped) foreach (int pid in pids) {
            if (inJob.Contains(pid)) continue;
            IntPtr h = Open(0x0100 | 0x0001, pid); // SET_QUOTA | TERMINATE are required to join a job
            if (h != IntPtr.Zero) { if (AssignProcessToJobObject(job, h)) inJob.Add(pid); CloseHandle(h); }
        }
        return ok ? "ok" : "cap failed";
    }

    public static string Efficiency(int on, int[] pids) {
        foreach (int pid in pids) {
            IntPtr h = Open(0x0200, pid); // SET_INFORMATION
            if (h == IntPtr.Zero) continue;
            var t = new Throttle { Version = 1, ControlMask = 0x1, StateMask = on == 1 ? 0x1u : 0u };
            SetProcessInformation(h, 4, ref t, Marshal.SizeOf(t));
            CloseHandle(h);
        }
        return "ok";
    }

    public static string Affinity(long mask, int[] pids) {
        foreach (int pid in pids) {
            IntPtr h = Open(0x0200 | 0x0400, pid); // SET_INFORMATION | QUERY_INFORMATION
            if (h == IntPtr.Zero) continue;
            SetProcessAffinityMask(h, new UIntPtr((ulong)mask));
            CloseHandle(h);
        }
        return "ok";
    }

    public static string Trim(int[] pids) {
        foreach (int pid in pids) {
            IntPtr h = Open(0x0100 | 0x0400, pid); // SET_QUOTA | QUERY_INFORMATION
            if (h == IntPtr.Zero) continue;
            EmptyWorkingSet(h);
            CloseHandle(h);
        }
        return "ok";
    }
}
'@
[Console]::Out.WriteLine('ready')
while ($null -ne ($line = [Console]::In.ReadLine())) {
    $parts = $line.Split(' ')
    $ids = [int[]]@($parts[2].Split(',', [StringSplitOptions]::RemoveEmptyEntries) | ForEach-Object { [int]$_ })
    $result = switch ($parts[0]) {
        'cap' { [VcTune]::Cap([int]$parts[1], $ids) }
        'eff' { [VcTune]::Efficiency([int]$parts[1], $ids) }
        'aff' { [VcTune]::Affinity([long]$parts[1], $ids) }
        'trim' { [VcTune]::Trim($ids) }
        default { 'unknown' }
    }
    [Console]::Out.WriteLine($result)
}
`;

let helper: ChildProcessWithoutNullStreams | undefined;
let helperReady: Promise<void> | undefined;
let queue: Promise<unknown> = Promise.resolve();
const waiting: ((line: string) => void)[] = [];

function startHelper() {
    if (helper && !helper.killed && helper.exitCode === null)
        return helperReady!;

    const encoded = Buffer.from(helperScript, "utf16le").toString("base64");
    helper = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded], { windowsHide: true });
    let buffer = "";
    helperReady = new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("CPU helper did not start")), 30000);
        waiting.push(line => {
            clearTimeout(timeout);
            line === "ready" ? resolve() : reject(new Error(line));
        });
    });
    helper.stdout.setEncoding("utf8");
    helper.stdout.on("data", (chunk: string) => {
        buffer += chunk;
        let index: number;
        while ((index = buffer.indexOf("\n")) >= 0) {
            const line = buffer.slice(0, index).trim();
            buffer = buffer.slice(index + 1);
            if (line)
                waiting.shift()?.(line);
        }
    });
    helper.on("exit", () => {
        helper = undefined;
        waiting.splice(0).forEach(resolve => resolve("helper exited"));
    });
    return helperReady;
}

function send(command: string): Promise<string> {
    const job = queue.then(async () => {
        await startHelper();
        return new Promise<string>(resolve => {
            waiting.push(resolve);
            helper!.stdin.write(command + "\n");
        });
    });
    queue = job.catch(() => { });
    return job;
}

/** Asks Windows to page out memory Discord is not actively using. Returns MB freed. */
export async function trimMemory(_: IpcMainInvokeEvent) {
    if (!isWindows)
        return 0;
    const before = totalMemoryMB();
    await send(`trim 0 ${pids().join(",")}`);
    return Math.max(0, Math.round(before - totalMemoryMB()));
}

let lastTune = "";

/**
 * cpuPercent: cap as a share of the whole CPU (all cores), 0 = no cap.
 * cores: how many logical cores Discord may use, 0 = all.
 * Only does work when the settings or Discord's process list change.
 */
export async function tuneCpu(_: IpcMainInvokeEvent, cpuPercent: number, cores: number, efficiency: boolean) {
    if (!isWindows)
        return "Windows only";

    const list = pids().join(",");
    const percent = Math.max(0, Math.min(100, Math.round(cpuPercent)));
    const cpuTotal = Math.max(1, Math.min(63, cpus().length));
    const coreCount = Math.max(0, Math.min(cpuTotal, Math.round(cores)));
    const key = [percent, coreCount, efficiency, list].join("|");
    if (key === lastTune)
        return "unchanged";
    lastTune = key;

    const useCores = coreCount > 0 ? coreCount : cpuTotal;
    const mask = ((1n << BigInt(useCores)) - 1n).toString();
    const results = [
        await send(`cap ${percent} ${list}`),
        await send(`eff ${efficiency ? 1 : 0} ${list}`),
        await send(`aff ${mask} ${list}`)
    ];
    return results.every(r => r === "ok") ? "ok" : results.join(", ");
}

/** Removes every CPU limit and stops the helper. Discord's processes stay in the job, but with no cap. */
export async function resetCpu(_: IpcMainInvokeEvent) {
    if (!isWindows || !helper)
        return;
    lastTune = "";
    const list = pids().join(",");
    await send(`cap 0 ${list}`);
    await send(`eff 0 ${list}`);
    await send(`aff ${((1n << BigInt(Math.max(1, Math.min(63, cpus().length)))) - 1n).toString()} ${list}`);
    helper?.stdin.end();
}
