/**
 * st-duet-stage · sync.js — the live link between SillyTavern and Duet Staging (the Claude page).
 *
 * Transport: the Duet Stage Companion Chrome extension (0.2.0+). This module posts {duet:"st", op, ...} into its own
 * window; the extension carries it to the Duet Staging tab and brings {duet:"sync", op, ...} back. No server, no keys.
 *
 * What flows:
 *   ST → Duet   her card (as chara_card_v2) + portrait, your persona, the open chat's lines, new lines as they land,
 *               her expression as a mood.
 *   Duet → ST   lines written on the stage (as /sendas, /send, /sys: no generation here), her moods (/emote),
 *               her card (Duet's richer sheet fills empty fields + extensions.companion_stage), her pictures (as sprites),
 *               memories (into this chat's Duet memory).
 * Loops are stopped by marks: lines from the stage carry extra.duet_id here, lines from here are by:"st" there.
 */
const MODULE = 'st-duet-stage';
const SYNC_VERSION = '0.1.0';
const STAGE_URL = 'https://claude.ai/artifact/XgdMmbrxNYG2WhC9Pt2oEd';
const ctx = () => SillyTavern.getContext();
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const toast = (kind, text) => { try { window.toastr?.[kind]?.(text, 'Duet Staging', { timeOut: 6000 }); } catch (e) { /* no toastr */ } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const L = { ext: false, extV: '', on: false, stageV: '', state: null, pending: new Map(), lastChatKey: '', lastMood: '', snapT: 0, hbT: 0, helloT: 0, log: [] };

function prefs() {
    const all = ctx().extensionSettings;
    all[MODULE] = all[MODULE] || {};
    const s = all[MODULE];
    if (!s.sync || typeof s.sync !== 'object') s.sync = {};
    const d = { on: true, lines: true, moods: true, card: true, pictures: false, memories: true };
    for (const k of Object.keys(d)) if (typeof s.sync[k] !== 'boolean') s.sync[k] = d[k];
    return s.sync;
}
const save = () => { try { ctx().saveSettingsDebounced?.(); } catch (e) { /* ignore */ } };

/* The 'link' feature switch (features.js). A missing key counts as on, like every other switch. */
function linkOn() { try { const f = ctx().extensionSettings?.[MODULE]?.features; return !f || f.link !== false; } catch (e) { return true; } }
function post(m) { if (!linkOn()) return; try { window.postMessage({ duet: 'st', v: SYNC_VERSION, ...m }, '*'); } catch (e) { /* ignore */ } }
function note(text) { L.log.unshift({ t: Date.now(), text: String(text).slice(0, 160) }); L.log = L.log.slice(0, 30); paint(); }

/* ---------------- what SillyTavern has ---------------- */
function activeChar() {
    const c = ctx();
    const id = c.characterId;
    if (id == null || id === '' || !c.characters?.[id]) return null;
    return c.characters[Number(id)];
}
function cardOf(ch) {
    const d = ch.data && typeof ch.data === 'object' ? ch.data : {};
    const pick = (k) => (d[k] != null && d[k] !== '' ? d[k] : (ch[k] ?? ''));
    const data = {
        name: ch.name, description: pick('description'), personality: pick('personality'), scenario: pick('scenario'),
        first_mes: pick('first_mes'), mes_example: pick('mes_example'), creator_notes: pick('creator_notes') || pick('creatorcomment'),
        system_prompt: d.system_prompt || '', post_history_instructions: d.post_history_instructions || '',
        alternate_greetings: Array.isArray(d.alternate_greetings) ? d.alternate_greetings : [],
        tags: Array.isArray(d.tags) ? d.tags : (Array.isArray(ch.tags) ? ch.tags : []),
        creator: d.creator || '', character_version: d.character_version || '',
        extensions: d.extensions && typeof d.extensions === 'object' ? d.extensions : {},
    };
    if (d.character_book) data.character_book = d.character_book;
    return { spec: 'chara_card_v2', spec_version: '2.0', data };
}
const colorOf = (ch) => ch?.data?.extensions?.companion_stage?.color || '';
function moodIn(text) { const m = String(text || '').match(/^\s*\[([a-z][a-z -]{1,24})\]/i) || String(text || '').match(/\[([a-z][a-z -]{1,24})\]\s*$/i); return m ? m[1].toLowerCase() : ''; }
function mesText(m) { return Array.isArray(m?.swipes) && typeof m.swipe_id === 'number' && typeof m.swipes[m.swipe_id] === 'string' ? m.swipes[m.swipe_id] : String(m?.mes || ''); }
function stId(i, m) { const c = ctx(); let h = 0; const s = mesText(m).slice(0, 120); for (let k = 0; k < s.length; k++) h = (h * 31 + s.charCodeAt(k)) >>> 0; return `${c.chatId || 'chat'}:${i}:${h.toString(36)}`; }
function turnOf(i, m) {
    if (!m || m.is_system && !m.mes) return null;
    const text = mesText(m).trim(); if (!text) return null;
    return { stId: stId(i, m), r: m.is_user ? 'me' : (m.is_system ? 'sys' : 'her'), who: m.name || '', text, mood: m.is_user ? '' : (m.extra?.duet_mood || moodIn(text)), t: m.send_date ? new Date(m.send_date).toISOString?.() || '' : '' };
}
function recentTurns(n) {
    const chat = Array.isArray(ctx().chat) ? ctx().chat : [];
    const out = [];
    for (let i = Math.max(0, chat.length - n); i < chat.length; i++) { const m = chat[i]; if (m?.extra?.duet_id) continue; const t = turnOf(i, m); if (t) out.push(t); }
    return out;
}
async function dataUrlOf(url, max = 2.5e6) {
    try { const r = await fetch(url); if (!r.ok) return ''; const b = await r.blob(); if (b.size > max) return ''; return await new Promise((ok) => { const fr = new FileReader(); fr.onload = () => ok(String(fr.result)); fr.onerror = () => ok(''); fr.readAsDataURL(b); }); } catch (e) { return ''; }
}
function expressionNow() { const img = document.getElementById('expression-image'); const src = img?.getAttribute('src') || ''; const m = src.match(/\/([^/?.]+)\.(?:png|webp|gif|apng)/i); return m ? decodeURIComponent(m[1]).toLowerCase() : ''; }

/* ---------------- ST → Duet ---------------- */
async function sendChar(withTurns) {
    const ch = activeChar(); if (!ch) return;
    const p = prefs();
    const portrait = await dataUrlOf(`/characters/${encodeURIComponent(ch.avatar)}`);
    post({ op: 'char', card: cardOf(ch), avatar: ch.avatar, color: colorOf(ch), portrait, portraitName: ch.avatar, chat: ctx().chatId || '', turns: withTurns && p.lines ? recentTurns(40) : undefined });
    post({ op: 'persona', name: ctx().name1 || '' });
    note(`Sent ${ch.name}'s card${withTurns ? ' and the open chat' : ''} to Duet Staging`);
}
function sendTurn(i) {
    const p = prefs(); if (!L.on || !p.lines) return;
    const chat = ctx().chat || []; const m = chat[i ?? chat.length - 1]; if (!m) return;
    const text = mesText(m).trim();
    if (m.extra?.duet_id) return;
    const pend = L.pending.get(text); if (pend) { m.extra = m.extra || {}; m.extra.duet_id = pend; L.pending.delete(text); try { ctx().saveChat?.(); } catch (e) { /* ignore */ } return; }
    const t = turnOf(i ?? chat.length - 1, m); if (!t) return;
    post({ op: 'turn', turn: t, chat: ctx().chatId || '' });
}
function sendMood() {
    const p = prefs(); if (!L.on || !p.moods) return;
    const m = expressionNow(); if (!m || m === L.lastMood) return;
    L.lastMood = m; post({ op: 'mood', mood: m });
}
function chatKey() { const c = ctx(); return `${c.characterId}|${c.chatId}`; }
function onChatChanged() {
    const k = chatKey(); if (k === L.lastChatKey) return; L.lastChatKey = k;
    clearTimeout(L.snapT); L.snapT = setTimeout(() => { if (L.on && prefs().card) sendChar(true); }, 600);
}

/* ---------------- Duet → ST ---------------- */
function slashSafe(text) { return String(text).replace(/\|/g, '\\|').replace(/\r?\n/g, '\n'); }
async function slash(cmd) {
    const c = ctx();
    if (typeof c.executeSlashCommandsWithOptions === 'function') return c.executeSlashCommandsWithOptions(cmd, { handleParserErrors: true, handleExecutionErrors: true });
    if (typeof c.executeSlashCommands === 'function') return c.executeSlashCommands(cmd);
    throw new Error('no slash commands');
}
async function takeTurn(turn) {
    const p = prefs(); if (!p.lines || !turn || !turn.text) return;
    const text = String(turn.text).trim(); if (!text) return;
    const chat = ctx().chat || [];
    if (chat.some((m) => m?.extra?.duet_id === turn.id)) return;
    if (chat.slice(-8).some((m) => mesText(m).trim() === text)) return;
    L.pending.set(text, turn.id); setTimeout(() => L.pending.delete(text), 20000);
    const body = slashSafe(text);
    if (turn.r === 'her') await slash(`/sendas name="${String(turn.who || ctx().name2 || 'Them').replace(/"/g, '')}" ${body}`);
    else if (turn.r === 'me') await slash(`/send ${body}`);
    else await slash(`/sys ${body}`);
    const after = ctx().chat || []; const m = [...after].reverse().find((x) => mesText(x).trim() === text);
    if (m) { m.extra = m.extra || {}; m.extra.duet_id = turn.id; if (turn.mood) m.extra.duet_mood = turn.mood; L.pending.delete(text); try { ctx().saveChat?.(); } catch (e) { /* ignore */ } }
    if (turn.r === 'her' && turn.mood && p.moods) { try { await slash(`/emote ${turn.mood}`); } catch (e) { /* no expressions */ } }
}
async function takeMood(mood) { const p = prefs(); if (!p.moods || !mood) return; try { await slash(`/emote ${String(mood).replace(/[^a-z -]/gi, '')}`); } catch (e) { /* no expressions */ } }
function findChar(name) { const n = String(name || '').trim().toLowerCase(); return (ctx().characters || []).find((c) => c && String(c.name).trim().toLowerCase() === n) || null; }
async function api(path, body, form) {
    const h = ctx().getRequestHeaders(); if (form) delete h['Content-Type'];
    const r = await fetch(path, { method: 'POST', headers: h, body: form ? body : JSON.stringify(body || {}) });
    if (!r.ok) throw new Error(`${path} → ${r.status}`);
    const t = await r.text(); try { return JSON.parse(t); } catch (e) { return t; }
}
/* chara_card_v2 into a PNG so a new character arrives with her portrait as the avatar */
function crc32(bytes) { let c, crc = 0xffffffff; for (let n = 0; n < bytes.length; n++) { c = (crc ^ bytes[n]) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; } return (crc ^ 0xffffffff) >>> 0; }
function pngWithChara(pngBuf, json) {
    const src = new Uint8Array(pngBuf); const text = 'chara\0' + btoa(unescape(encodeURIComponent(JSON.stringify(json))));
    const data = new Uint8Array(text.length); for (let i = 0; i < text.length; i++) data[i] = text.charCodeAt(i);
    const type = new Uint8Array([116, 69, 88, 116]); const chunk = new Uint8Array(12 + data.length); const dv = new DataView(chunk.buffer);
    dv.setUint32(0, data.length); chunk.set(type, 4); chunk.set(data, 8); const crcBuf = new Uint8Array(4 + data.length); crcBuf.set(type, 0); crcBuf.set(data, 4); dv.setUint32(8 + data.length, crc32(crcBuf));
    const out = []; let p = 8; out.push(src.slice(0, 8));
    while (p < src.length) { const len = new DataView(src.buffer, src.byteOffset + p).getUint32(0); const t = String.fromCharCode(...src.slice(p + 4, p + 8)); const end = p + 12 + len; if (t === 'tEXt' && String.fromCharCode(...src.slice(p + 8, p + 14)) === 'chara\0') { p = end; continue; } if (t === 'IEND') out.push(chunk); out.push(src.slice(p, end)); p = end; }
    const total = out.reduce((a, b) => a + b.length, 0); const buf = new Uint8Array(total); let o = 0; for (const b of out) { buf.set(b, o); o += b.length; }
    return new Blob([buf], { type: 'image/png' });
}
async function toPng(dataUrl) {
    const img = await new Promise((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = bad; i.src = dataUrl; });
    const cv = document.createElement('canvas'); const w = Math.min(1024, img.naturalWidth || 512); cv.width = w; cv.height = Math.round(w * (img.naturalHeight || 768) / (img.naturalWidth || 512));
    cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
    const blob = await new Promise((ok) => cv.toBlob(ok, 'image/png')); return blob.arrayBuffer();
}
async function blankPng() { const cv = document.createElement('canvas'); cv.width = 512; cv.height = 768; const x = cv.getContext('2d'); x.fillStyle = '#1b1020'; x.fillRect(0, 0, 512, 768); const b = await new Promise((ok) => cv.toBlob(ok, 'image/png')); return b.arrayBuffer(); }
async function takeCard(d, overwrite) {
    const p = prefs(); if (!p.card && !overwrite) return;
    const card = d.card && d.card.data ? d.card : null; if (!card) return;
    const name = String(card.data.name || d.name || '').trim(); if (!name) return;
    const data = card.data; const ex = data.extensions || {};
    let ch = findChar(name);
    if (ch) {
        const have = cardOf(ch).data; const upd = { avatar: ch.avatar, data: { extensions: { companion_stage: { ...(have.extensions?.companion_stage || {}), ...(ex.companion_stage || {}), ...(d.color ? { color: d.color } : {}) } } } };
        for (const k of ['description', 'personality', 'scenario', 'first_mes', 'mes_example', 'creator_notes', 'system_prompt', 'post_history_instructions']) {
            if (data[k] && (overwrite || !String(have[k] || '').trim())) { upd.data[k] = data[k]; if (['description', 'personality', 'scenario', 'first_mes', 'mes_example'].includes(k)) upd[k] = data[k]; }
        }
        if (Array.isArray(data.tags) && data.tags.length) upd.data.tags = [...new Set([...(have.tags || []), ...data.tags])];
        if (Array.isArray(data.alternate_greetings) && data.alternate_greetings.length && (overwrite || !(have.alternate_greetings || []).length)) upd.data.alternate_greetings = data.alternate_greetings;
        await api('/api/characters/merge-attributes', upd);
        note(`${name}: card ${overwrite ? 'replaced' : 'filled'} from Duet Staging`);
    } else {
        const png = d.portrait ? await toPng(d.portrait).catch(() => blankPng()) : await blankPng();
        const file = new File([pngWithChara(png, { ...card, name, description: data.description, personality: data.personality, scenario: data.scenario, first_mes: data.first_mes, mes_example: data.mes_example })], `${name.replace(/[^\w ,.-]+/g, '_')}.png`, { type: 'image/png' });
        const fd = new FormData(); fd.set('avatar', file); fd.set('file_type', 'png');
        await api('/api/characters/import', fd, true);
        note(`${name} arrived from Duet Staging as a new character`);
    }
    try { await ctx().getCharacters?.(); } catch (e) { /* ignore */ }
    ch = findChar(name);
    if (ch && Array.isArray(d.memories) && d.memories.length && p.memories) takeMemories(d.memories, name);
    toast('success', `${name}'s card is in SillyTavern.`);
}
function takeMemories(items, who) {
    const c = ctx(); if (!c.chatMetadata) return;
    const lines = (Array.isArray(items) ? items : []).map((m) => typeof m === 'string' ? m : m?.text).filter(Boolean);
    if (!lines.length) return;
    const have = String(c.chatMetadata.duet_memory || '').split('\n').map((x) => x.trim()).filter(Boolean);
    const add = lines.map((x) => String(x).trim()).filter((x) => x && !have.includes(x));
    if (!add.length) return;
    c.chatMetadata.duet_memory = [...have, ...add].join('\n');
    try { c.setExtensionPrompt?.('st-duet-stage-memory', `[Duet memory]\n${c.chatMetadata.duet_memory}`, 0, 0, false, 0); } catch (e) { /* ignore */ }
    try { c.saveMetadata?.(); } catch (e) { /* ignore */ }
    note(`${add.length} memor${add.length === 1 ? 'y' : 'ies'} about ${who || 'her'} added to this chat`);
}
async function takePictures(d) {
    const ch = findChar(d.name) || activeChar(); if (!ch) return;
    const items = Array.isArray(d.items) ? d.items : []; let n = 0;
    const h = ctx().getRequestHeaders(); delete h['Content-Type'];
    for (const it of items) {
        try {
            const r = await fetch(it.dataUrl); const b = await r.blob(); const ext = (b.type.split('/')[1] || 'png').replace('jpeg', 'jpg');
            const label = String(it.mood || it.label || `duet-${n + 1}`).toLowerCase().replace(/[^a-z0-9 _-]+/g, '').trim() || `duet-${n + 1}`;
            const fd = new FormData(); fd.set('name', ch.name); fd.set('label', label); fd.set('spriteName', label); fd.set('avatar', new File([b], `${label}.${ext}`, { type: b.type || 'image/png' }));
            const res = await fetch('/api/sprites/upload', { method: 'POST', headers: h, body: fd }); if (res.ok) n++;
        } catch (e) { /* skip one */ }
    }
    note(`${n} of ${items.length} pictures became sprites for ${ch.name}`); toast(n ? 'success' : 'warning', `${n} picture${n === 1 ? '' : 's'} added to ${ch.name}'s sprites.`);
    try { await slash('/emote neutral'); } catch (e) { /* no expressions */ }
}

/* ---------------- inbound ---------------- */
function hello() { post({ op: 'hello', wantCard: prefs().card }); }
window.addEventListener('message', (e) => {
    if (e.source !== window) return;
    if (!linkOn()) return;
    const d = e.data; if (!d || d.duet !== 'sync' || typeof d.op !== 'string') return;
    if (d.op === 'ext') { L.ext = true; L.extV = String(d.v || ''); paint(); if (prefs().on) hello(); return; }
    if (d.op === 'here') { L.ext = true; if (d.ready) L.on = false; if (prefs().on) hello(); return; }
    if (d.op === 'no-stage') { if (L.on) note('Duet Staging tab closed'); L.on = false; paint(); return; }
    if (d.op === 'ready') { const first = !L.on; L.on = true; L.stageV = String(d.v || ''); paint(); if (first) { note(`Linked to Duet Staging ${L.stageV}`); toast('success', 'Linked to Duet Staging.'); } L.lastChatKey = ''; onChatChanged(); return; }   // every ready re-sends her card and the open chat: the stage dedupes, and a stage that was still booting gets them now
    if (!L.on && d.op !== 'card') return;
    (async () => {
        try {
            if (d.op === 'state') { L.state = d; paint(); }
            else if (d.op === 'turn') await takeTurn(d.turn);
            else if (d.op === 'mood') await takeMood(d.mood);
            else if (d.op === 'card') { const ow = !!L.overwriteNext; L.overwriteNext = false; await takeCard(d, ow); }
            else if (d.op === 'pictures') await takePictures(d);
            else if (d.op === 'memories') takeMemories(d.items, d.who);
            else if (d.op === 'imported') note(d.ok ? 'Duet Staging took the picture' : 'Duet Staging could not take that picture');
            else if (d.op === 'error') note(`Duet Staging: ${d.of} failed · ${d.message || ''}`);
            else if (d.op === 'pong') paint();
        } catch (err) { console.warn(`[${MODULE}] sync`, d.op, err); note(`${d.op} failed here: ${err && err.message || err}`); }
    })();
});

/* ---------------- events from SillyTavern ---------------- */
function bindEvents() {
    const c = ctx(); const es = c.eventSource; const T = c.eventTypes || c.event_types || {};
    if (!es || typeof es.on !== 'function') return false;
    if (T.MESSAGE_SENT) es.on(T.MESSAGE_SENT, (i) => sendTurn(i));
    if (T.MESSAGE_RECEIVED) es.on(T.MESSAGE_RECEIVED, (i) => setTimeout(() => { sendTurn(i); sendMood(); }, 150));
    if (T.CHAT_CHANGED) es.on(T.CHAT_CHANGED, onChatChanged);
    if (T.CHAT_LOADED) es.on(T.CHAT_LOADED, onChatChanged);
    if (T.MESSAGE_SWIPED) es.on(T.MESSAGE_SWIPED, (i) => setTimeout(() => sendTurn(i), 150));
    const img = document.getElementById('expression-image');
    if (img) new MutationObserver(() => sendMood()).observe(img, { attributes: true, attributeFilter: ['src'] });
    return true;
}

/* ---------------- the little link button in the top bar ---------------- */
function paint() {
    const b = document.getElementById('duet-sync-btn'); if (!b) return;
    const off = !linkOn(); b.hidden = off;
    if (off) { L.on = false; const shut = document.getElementById('duet-sync-pop'); if (shut) shut.hidden = true; }
    const st = L.on ? 'on' : (L.ext ? 'ext' : 'off');
    b.dataset.state = st; b.title = L.on ? `Linked to Duet Staging${L.state?.right ? ' · ' + L.state.right.name : ''}` : (L.ext ? 'Companion found · open Duet Staging to link' : 'Duet Staging link · needs the Duet Stage Companion extension');
    const pop = document.getElementById('duet-sync-pop'); if (pop && !pop.hidden) pop.innerHTML = popHTML();
}
function popHTML() {
    const p = prefs(); const s = L.state || {};
    const row = (k, label) => `<label class="dsy-tg"><input type="checkbox" data-dsy-set="${k}" ${p[k] ? 'checked' : ''}> ${label}</label>`;
    return `<header><b>Duet Staging</b><span class="dsy-dot ${L.on ? 'on' : L.ext ? 'ext' : ''}"></span><small>${L.on ? `linked · stage ${esc(L.stageV)}` : L.ext ? 'companion ready · open the stage' : 'no companion'}</small></header>
    ${L.on ? `<div class="dsy-now">On stage: <b>${esc(s.left?.name || s.you || 'You')}</b> &amp; <b>${esc(s.right?.name || '—')}</b>${s.readOnly ? ' <i>(read-only there)</i>' : ''}</div>` : `<p class="dsy-help">${L.ext ? 'The companion is installed. Open Duet Staging in a tab and the link comes up by itself.' : 'Install the Duet Stage Companion (chrome-companion in desktop-companion) and reload this page. It carries lines, moods, cards and pictures between the two.'}</p>`}
    <div class="dsy-row">${row('lines', 'Lines')}${row('moods', 'Moods')}${row('card', 'Cards')}${row('memories', 'Memories')}</div>
    <div class="dsy-acts">
      <button type="button" data-dsy="open">Open Duet Staging</button>
      <button type="button" data-dsy="push" ${L.on ? '' : 'disabled'}>Send her card + chat →</button>
      <button type="button" data-dsy="pull" ${L.on ? '' : 'disabled'}>← Fill her card from Duet</button>
      <button type="button" data-dsy="pullall" ${L.on ? '' : 'disabled'} title="Every field, Duet's version wins">← Replace her card</button>
      <button type="button" data-dsy="pics" ${L.on ? '' : 'disabled'}>← Her pictures as sprites</button>
      <button type="button" data-dsy="mems" ${L.on ? '' : 'disabled'}>← Her memories</button>
      <button type="button" data-dsy="relink">Relink</button>
    </div>
    <ul class="dsy-log">${L.log.slice(0, 6).map((x) => `<li>${esc(x.text)}</li>`).join('') || '<li>Nothing yet.</li>'}</ul>
    <small class="dsy-ver">sync ${SYNC_VERSION}${L.extV ? ` · companion ${esc(L.extV)}` : ''}</small>`;
}
function mount() {
    if (document.getElementById('duet-sync-btn')) return;
    const holder = document.getElementById('top-settings-holder') || document.getElementById('top-bar') || document.body;
    const b = document.createElement('button'); b.type = 'button'; b.id = 'duet-sync-btn'; b.className = 'drawer-icon fa-solid fa-link interactable'; b.setAttribute('aria-label', 'Duet Staging link'); b.dataset.state = 'off';
    holder.appendChild(b);
    const pop = document.createElement('div'); pop.id = 'duet-sync-pop'; pop.hidden = true; document.body.appendChild(pop);
    b.addEventListener('click', () => { pop.hidden = !pop.hidden; if (!pop.hidden) { pop.innerHTML = popHTML(); const r = b.getBoundingClientRect(); pop.style.right = Math.max(8, window.innerWidth - r.right) + 'px'; pop.style.top = (r.bottom + 6) + 'px'; } });
    document.addEventListener('pointerdown', (ev) => { if (!pop.hidden && !pop.contains(ev.target) && ev.target !== b) pop.hidden = true; });
    pop.addEventListener('change', (ev) => { const k = ev.target?.dataset?.dsySet; if (!k) return; prefs()[k] = !!ev.target.checked; save(); });
    pop.addEventListener('click', async (ev) => {
        const a = ev.target.closest('[data-dsy]')?.dataset.dsy; if (!a) return;
        if (a === 'open') window.open(STAGE_URL, 'duet-staging');
        else if (a === 'push') sendChar(true);
        else if (a === 'pull') { L.overwriteNext = false; post({ op: 'card' }); }
        else if (a === 'pullall') { L.overwriteNext = true; post({ op: 'card' }); }
        else if (a === 'pics') post({ op: 'pictures', max: 24 });
        else if (a === 'mems') post({ op: 'memories' });
        else if (a === 'relink') { L.on = false; hello(); }
        paint();
    });
    paint();
}

export function bootSync() {
    try { prefs(); } catch (e) { setTimeout(bootSync, 800); return; }
    mount();
    if (!bindEvents()) setTimeout(bindEvents, 2000);
    hello();                                      // a companion already on the page answers; otherwise it says hello when it loads
    L.hbT = setInterval(() => { if (L.on) post({ op: 'ping' }); else if (L.ext && prefs().on) hello(); }, 25000);
    window.DuetSync = { version: SYNC_VERSION, status: () => ({ ext: L.ext, on: L.on, state: L.state }), send: sendChar, hello, refresh: paint };
    console.log(`[${MODULE}] sync ${SYNC_VERSION}`);
}
