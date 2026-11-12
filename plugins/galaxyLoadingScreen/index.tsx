/*
 * Vencord, a Discord client mod
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { Button } from "@components/Button";
import definePlugin, { OptionType, StartAt } from "@utils/types";

const settings = definePluginSettings({
    showText: {
        type: OptionType.BOOLEAN,
        description: "Show \"Loading Discord\" under the spinner",
        default: true
    },
    starDensity: {
        type: OptionType.SLIDER,
        description: "How many stars to draw",
        markers: [0.25, 0.5, 1, 1.5, 2, 3],
        default: 1,
        stickToMarkers: true
    },
    shootingStars: {
        type: OptionType.BOOLEAN,
        description: "Occasional shooting stars",
        default: true
    },
    minimumTime: {
        type: OptionType.SLIDER,
        description: "Keep the galaxy on screen for at least this many milliseconds, so it never just flashes",
        markers: [0, 500, 1000, 1500, 2500],
        default: 800,
        stickToMarkers: false
    },
    preview: {
        type: OptionType.COMPONENT,
        component: () => <Button onClick={() => showGalaxy(4000)}>Preview for 4 seconds</Button>
    }
});

const css = `
#vc-galaxy-loading {
    position: fixed;
    inset: 0;
    z-index: 2147483647;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 22px;
    background:
        radial-gradient(ellipse 60% 50% at 25% 30%, rgb(124 58 237 / 55%), transparent 70%),
        radial-gradient(ellipse 55% 45% at 78% 70%, rgb(37 99 235 / 50%), transparent 70%),
        radial-gradient(ellipse 40% 35% at 60% 20%, rgb(192 38 211 / 30%), transparent 70%),
        radial-gradient(ellipse 45% 40% at 20% 85%, rgb(14 165 233 / 25%), transparent 70%),
        linear-gradient(160deg, #0b0420 0%, #140a3a 40%, #0a1440 75%, #050816 100%);
    transition: opacity 600ms ease, transform 600ms ease;
    font-family: "gg sans", "Noto Sans", system-ui, sans-serif;
    user-select: none;
    /* Clicks and window dragging pass through to Discord's title bar underneath. */
    pointer-events: none;
}
#vc-galaxy-loading.vc-galaxy-hide {
    opacity: 0;
    transform: scale(1.04);
}
#vc-galaxy-loading canvas {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
}
#vc-galaxy-loading .vc-galaxy-nebula {
    position: absolute;
    inset: -20%;
    background:
        radial-gradient(circle at 35% 45%, rgb(139 92 246 / 25%), transparent 40%),
        radial-gradient(circle at 65% 55%, rgb(59 130 246 / 22%), transparent 42%);
    filter: blur(40px);
    animation: vc-galaxy-drift 18s ease-in-out infinite alternate;
}
#vc-galaxy-loading .vc-galaxy-orb {
    position: relative;
    width: 84px;
    height: 84px;
    border-radius: 50%;
    background: radial-gradient(circle at 35% 30%, #c4b5fd, #7c3aed 45%, #1e3a8a 100%);
    box-shadow: 0 0 40px rgb(139 92 246 / 70%), 0 0 90px rgb(59 130 246 / 45%);
    animation: vc-galaxy-pulse 2.4s ease-in-out infinite;
}
#vc-galaxy-loading .vc-galaxy-orb::before,
#vc-galaxy-loading .vc-galaxy-orb::after {
    content: "";
    position: absolute;
    inset: -18px;
    border: 2px solid transparent;
    border-top-color: rgb(196 181 253 / 90%);
    border-right-color: rgb(96 165 250 / 50%);
    border-radius: 50%;
    animation: vc-galaxy-spin 1.6s linear infinite;
}
#vc-galaxy-loading .vc-galaxy-orb::after {
    inset: -32px;
    border-top-color: rgb(96 165 250 / 70%);
    border-right-color: transparent;
    border-bottom-color: rgb(192 132 252 / 45%);
    animation-duration: 2.8s;
    animation-direction: reverse;
}
#vc-galaxy-loading .vc-galaxy-text {
    position: relative;
    margin-top: 26px;
    color: #e0e7ff;
    font-size: 15px;
    font-weight: 600;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    text-shadow: 0 0 12px rgb(139 92 246 / 80%);
    animation: vc-galaxy-fade 2.4s ease-in-out infinite;
}
@keyframes vc-galaxy-spin { to { transform: rotate(360deg); } }
@keyframes vc-galaxy-pulse { 50% { transform: scale(1.08); box-shadow: 0 0 60px rgb(139 92 246 / 85%), 0 0 120px rgb(59 130 246 / 55%); } }
@keyframes vc-galaxy-fade { 50% { opacity: 0.55; } }
@keyframes vc-galaxy-drift { to { transform: translate(4%, -3%) rotate(8deg) scale(1.1); } }
@media (prefers-reduced-motion: reduce) {
    #vc-galaxy-loading *, #vc-galaxy-loading *::before, #vc-galaxy-loading *::after { animation: none !important; }
}
`;

interface Star { x: number; y: number; r: number; phase: number; speed: number; hue: number; depth: number; }
interface Shooting { x: number; y: number; vx: number; vy: number; life: number; }

let overlay: HTMLDivElement | undefined;
let styleEl: HTMLStyleElement | undefined;
let frame = 0;
let readyTimer: ReturnType<typeof setInterval> | undefined;
let hideTimer: ReturnType<typeof setTimeout> | undefined;
let shownAt = 0;

function startStarfield(canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext("2d");
    if (!ctx)
        return;

    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    let stars: Star[] = [];
    const shooting: Shooting[] = [];
    let width = 0, height = 0;

    function resize() {
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        width = canvas.clientWidth || window.innerWidth;
        height = canvas.clientHeight || window.innerHeight;
        canvas.width = width * dpr;
        canvas.height = height * dpr;
        ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);

        const count = Math.round((width * height) / 3500 * settings.store.starDensity);
        stars = Array.from({ length: count }, () => ({
            x: Math.random() * width,
            y: Math.random() * height,
            r: Math.random() ** 3 * 1.8 + 0.25,
            phase: Math.random() * Math.PI * 2,
            speed: 0.6 + Math.random() * 2,
            hue: [230, 260, 280, 200, 0][Math.floor(Math.random() * 5)],
            depth: Math.random()
        }));
    }
    resize();
    window.addEventListener("resize", resize);

    let last = performance.now();
    function draw(now: number) {
        if (!canvas.isConnected) {
            window.removeEventListener("resize", resize);
            return;
        }
        const dt = Math.min(64, now - last) / 1000;
        last = now;
        ctx!.clearRect(0, 0, width, height);

        for (const star of stars) {
            if (!reduced) {
                // Slow parallax drift: nearer stars move faster.
                star.x -= (2 + star.depth * 10) * dt;
                if (star.x < -2)
                    star.x = width + 2;
            }
            const twinkle = reduced ? 0.8 : 0.55 + 0.45 * Math.sin(now / 1000 * star.speed + star.phase);
            ctx!.globalAlpha = twinkle;
            ctx!.fillStyle = star.hue === 0 ? "#ffffff" : `hsl(${star.hue} 90% 85%)`;
            ctx!.beginPath();
            ctx!.arc(star.x, star.y, star.r, 0, Math.PI * 2);
            ctx!.fill();
            if (star.r > 1.4) {
                ctx!.globalAlpha = twinkle * 0.25;
                ctx!.beginPath();
                ctx!.arc(star.x, star.y, star.r * 3.5, 0, Math.PI * 2);
                ctx!.fill();
            }
        }

        if (!reduced && settings.store.shootingStars && Math.random() < dt * 0.6) {
            const angle = Math.PI * (0.15 + Math.random() * 0.2);
            const speed = 700 + Math.random() * 500;
            shooting.push({ x: Math.random() * width, y: Math.random() * height * 0.5, vx: -Math.cos(angle) * speed, vy: Math.sin(angle) * speed, life: 1 });
        }
        for (let i = shooting.length - 1; i >= 0; i--) {
            const s = shooting[i];
            s.x += s.vx * dt;
            s.y += s.vy * dt;
            s.life -= dt * 1.4;
            if (s.life <= 0) {
                shooting.splice(i, 1);
                continue;
            }
            const gradient = ctx!.createLinearGradient(s.x, s.y, s.x - s.vx * 0.12, s.y - s.vy * 0.12);
            gradient.addColorStop(0, `rgb(255 255 255 / ${s.life})`);
            gradient.addColorStop(1, "rgb(139 92 246 / 0)");
            ctx!.globalAlpha = 1;
            ctx!.strokeStyle = gradient;
            ctx!.lineWidth = 1.6;
            ctx!.beginPath();
            ctx!.moveTo(s.x, s.y);
            ctx!.lineTo(s.x - s.vx * 0.12, s.y - s.vy * 0.12);
            ctx!.stroke();
        }

        ctx!.globalAlpha = 1;
        frame = requestAnimationFrame(draw);
    }
    frame = requestAnimationFrame(draw);
}

function mount() {
    if (overlay?.isConnected)
        return;

    styleEl ??= Object.assign(document.createElement("style"), { id: "vc-galaxy-loading-style", textContent: css });
    document.documentElement.append(styleEl);

    overlay = document.createElement("div");
    overlay.id = "vc-galaxy-loading";
    const nebula = document.createElement("div");
    nebula.className = "vc-galaxy-nebula";
    const canvas = document.createElement("canvas");
    const orb = document.createElement("div");
    orb.className = "vc-galaxy-orb";
    overlay.append(nebula, canvas, orb);
    if (settings.store.showText) {
        const text = document.createElement("div");
        text.className = "vc-galaxy-text";
        text.textContent = "Loading Discord";
        overlay.append(text);
    }

    document.documentElement.append(overlay);
    shownAt = performance.now();
    startStarfield(canvas);
}

function unmount() {
    cancelAnimationFrame(frame);
    frame = 0;
    clearInterval(readyTimer);
    clearTimeout(hideTimer);
    readyTimer = hideTimer = undefined;
    overlay?.remove();
    overlay = undefined;
    styleEl?.remove();
    styleEl = undefined;
}

function hide() {
    clearInterval(readyTimer);
    readyTimer = undefined;
    if (!overlay)
        return;

    const wait = Math.max(0, settings.store.minimumTime - (performance.now() - shownAt));
    hideTimer = setTimeout(() => {
        overlay?.classList.add("vc-galaxy-hide");
        hideTimer = setTimeout(unmount, 650);
    }, wait);
}

// Discord is usable once its server list or the main sidebar has rendered.
function discordReady() {
    return Boolean(document.querySelector('nav[class*="guilds_"], [class*="guilds_"] [data-list-item-id], [class*="sidebar_"] [class*="panels_"]'));
}

function showGalaxy(duration?: number) {
    unmount();
    mount();
    if (duration) {
        hideTimer = setTimeout(hide, duration);
        return;
    }

    const started = Date.now();
    readyTimer = setInterval(() => {
        if (discordReady() || Date.now() - started > 60000)
            hide();
    }, 150);
}

export default definePlugin({
    name: "GalaxyLoadingScreen",
    description: "Replaces Discord's loading screen with a purple and blue galaxy full of twinkling stars",
    authors: [],
    tags: ["Appearance", "Customisation"],
    enabledByDefault: true,
    settings,
    startAt: StartAt.Init,

    start() {
        if (discordReady())
            return;
        if (document.documentElement)
            showGalaxy();
        else
            document.addEventListener("DOMContentLoaded", () => showGalaxy(), { once: true });
    },

    stop: unmount
});
