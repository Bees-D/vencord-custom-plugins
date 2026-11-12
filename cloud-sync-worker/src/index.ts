interface Env {
    DB: D1Database;
    /** Shared key every client must send. Set with `wrangler secret put SYNC_KEY`. */
    SYNC_KEY?: string;
}

const PLUGINS = new Set(["ThemeStudio", "EverythingMoves", "LongFriendNicknames", "CustomBackground"]);
const MAX_SETTINGS = 512 * 1024;
const MAX_IMAGE = 1_900_000;

const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

function sameKey(a: string, b: string) {
    if (a.length !== b.length)
        return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++)
        diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
}

async function readJson(request: Request, max: number): Promise<any> {
    const text = await request.text();
    if (text.length > max)
        throw new Error("too large");
    return JSON.parse(text);
}

export default {
    async fetch(request: Request, env: Env): Promise<Response> {
        if (env.SYNC_KEY && !sameKey(request.headers.get("X-Sync-Key") ?? "", env.SYNC_KEY))
            return json({ error: "Wrong or missing sync key" }, 401);

        const url = new URL(request.url);
        const parts = url.pathname.split("/").filter(Boolean);
        if (parts[0] !== "v1" || !/^\d{15,25}$/.test(parts[1] ?? ""))
            return json({ error: "Not found" }, 404);
        const userId = parts[1];

        try {
            // GET /v1/:user -> everything except image bytes
            if (parts.length === 2 && request.method === "GET") {
                const settings = await env.DB.prepare("SELECT plugin, data, updated_at FROM settings WHERE user_id = ?").bind(userId).all();
                const images = await env.DB.prepare("SELECT key, hash, updated_at FROM images WHERE user_id = ?").bind(userId).all();
                return json({
                    settings: Object.fromEntries(settings.results.map((r: any) => [r.plugin, { data: JSON.parse(r.data), updatedAt: r.updated_at }])),
                    images: Object.fromEntries(images.results.map((r: any) => [r.key, { hash: r.hash, updatedAt: r.updated_at }]))
                });
            }

            // PUT /v1/:user/settings/:plugin  { data, updatedAt }
            if (parts[2] === "settings" && parts.length === 4 && request.method === "PUT") {
                const plugin = parts[3];
                if (!PLUGINS.has(plugin))
                    return json({ error: "Unknown plugin" }, 400);
                const body = await readJson(request, MAX_SETTINGS);
                const updatedAt = Number(body?.updatedAt);
                if (typeof body?.data !== "object" || body.data === null || !Number.isFinite(updatedAt))
                    return json({ error: "Body must be { data: object, updatedAt: number }" }, 400);

                // Last write wins, but never let an older device overwrite a newer copy.
                await env.DB.prepare(
                    `INSERT INTO settings (user_id, plugin, data, updated_at) VALUES (?, ?, ?, ?)
                     ON CONFLICT (user_id, plugin) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at
                     WHERE excluded.updated_at >= settings.updated_at`
                ).bind(userId, plugin, JSON.stringify(body.data), updatedAt).run();
                return json({ ok: true });
            }

            // /v1/:user/images/:key
            if (parts[2] === "images" && parts.length === 4) {
                const key = parts[3];
                if (!/^[\w-]{1,100}$/.test(key))
                    return json({ error: "Bad image key" }, 400);

                if (request.method === "GET") {
                    const row = await env.DB.prepare("SELECT data, hash, updated_at FROM images WHERE user_id = ? AND key = ?").bind(userId, key).first<any>();
                    return row ? json({ data: row.data, hash: row.hash, updatedAt: row.updated_at }) : json({ error: "Not found" }, 404);
                }
                if (request.method === "PUT") {
                    const body = await readJson(request, MAX_IMAGE + 1000);
                    if (typeof body?.data !== "string" || !/^data:image\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]+$/i.test(body.data) || typeof body.hash !== "string")
                        return json({ error: "Body must be { data: image data URL, hash }" }, 400);
                    if (body.data.length > MAX_IMAGE)
                        return json({ error: "Image too large for cloud sync" }, 413);
                    await env.DB.prepare(
                        `INSERT INTO images (user_id, key, data, hash, updated_at) VALUES (?, ?, ?, ?, ?)
                         ON CONFLICT (user_id, key) DO UPDATE SET data = excluded.data, hash = excluded.hash, updated_at = excluded.updated_at`
                    ).bind(userId, key, body.data, body.hash.slice(0, 128), Date.now()).run();
                    return json({ ok: true });
                }
                if (request.method === "DELETE") {
                    await env.DB.prepare("DELETE FROM images WHERE user_id = ? AND key = ?").bind(userId, key).run();
                    return json({ ok: true });
                }
            }

            return json({ error: "Not found" }, 404);
        } catch (error) {
            const message = String((error as Error)?.message ?? error);
            return json({ error: message === "too large" ? "Request too large" : "Bad request" }, message === "too large" ? 413 : 400);
        }
    }
};
