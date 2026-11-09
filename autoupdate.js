/**
 * Auto-update + 📣 board, for a SillyTavern third-party extension that was installed from GitHub.
 *
 * On every page load (a refresh), a few seconds after SillyTavern starts:
 *  1. Asks SillyTavern's own extension API whether this extension's folder is behind its GitHub repo
 *     (POST /api/extensions/version, which runs `git fetch` on the server).
 *  2. If it is, updates it the same way the Manage extensions → Update button does
 *     (POST /api/extensions/update) and reloads the page once, so the new code runs now.
 *  3. Shows new lines from board.jsonl in this folder (the repo's message board) as toasts.
 *
 * Board lines use the house format (AGENTS.md on the hub):
 *   {"t":"2026-11-09T16:30:00Z","who":"claude","to":"red","kind":"update","text":"One line, plain words."}
 * `to` of "red", "all" or null shows in SillyTavern. Seen lines are remembered per browser.
 *
 * Keep this file and `"auto_update": true` in manifest.json when mirroring the extension.
 */
const HERE = new URL('.', import.meta.url);
const NAME = decodeURIComponent((HERE.pathname.match(/\/third-party\/([^/]+)\/$/) || [])[1] || '');
const KEY = 'autoupdate:' + NAME;
const say = (kind, text, title) => { try { window.toastr && window.toastr[kind](text, title, { timeOut: 9000, extendedTimeOut: 4000 }); } catch (e) { /* no toasts */ } };
const get = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
const put = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* private window */ } };

async function headers() {
    try { const m = await import(new URL('../../../../script.js', import.meta.url).href); return m.getRequestHeaders(); }
    catch (e) { return { 'Content-Type': 'application/json' }; }
}

async function api(path, global) {
    const r = await fetch(path, { method: 'POST', headers: await headers(), body: JSON.stringify({ extensionName: NAME, global }) });
    if (!r.ok) throw new Error(path + ' ' + r.status);
    return r.json();
}

async function selfUpdate() {
    if (!NAME) return false;
    // installed for this user (the default) or for everyone: try both
    for (const global of [false, true]) {
        let v;
        try { v = await api('/api/extensions/version', global); } catch (e) { continue; }
        if (!v || v.isUpToDate !== false) return false;   // up to date, or not a git folder
        const last = +(get(KEY + ':at') || 0);
        if (Date.now() - last < 120000) return false;      // updated a moment ago: never loop
        put(KEY + ':at', String(Date.now()));
        try {
            const u = await api('/api/extensions/update', global);
            say('success', `Updated to ${u && u.shortCommitHash ? u.shortCommitHash : 'the newest version'}. Reloading…`, NAME);
            setTimeout(() => location.reload(), 1800);
            return true;
        } catch (e) {
            say('warning', 'An update is out, but it could not install by itself. Extensions → Manage extensions → Update.', NAME);
            return false;
        }
    }
    return false;
}

async function board() {
    let text = '';
    try { const r = await fetch(new URL('./board.jsonl', HERE), { cache: 'no-store' }); if (!r.ok) return; text = await r.text(); } catch (e) { return; }
    const seen = get(KEY + ':board') || '';
    const lines = text.split('\n').map((l) => { try { return JSON.parse(l); } catch (e) { return null; } })
        .filter((x) => x && x.t && x.text && (x.to == null || x.to === 'all' || x.to === 'red') && String(x.t) > seen)
        .sort((a, b) => String(a.t).localeCompare(String(b.t)));
    if (!lines.length) return;
    for (const x of lines.slice(-3)) say(x.kind === 'ask' ? 'warning' : 'info', String(x.text).slice(0, 300), `📣 ${x.who || 'board'} · ${NAME}`);
    put(KEY + ':board', String(lines[lines.length - 1].t));
}

setTimeout(async () => {
    const reloading = await selfUpdate().catch(() => false);
    if (!reloading) board();
}, 4000);
