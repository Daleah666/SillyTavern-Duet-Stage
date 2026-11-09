/**
 * Duet Stage visual-novel shell.
 *
 * Your persona stands on the left, the SillyTavern character on the right,
 * and the open chat runs between them. Send, Continue and Reroll call
 * SillyTavern's own generate / swipe path, so the connected API is the one
 * already configured in SillyTavern. Nothing here stores an API key.
 *
 * The column, dock, stow and #duet-side-panel contract stay in index.js.
 * Card Creator can still insert tabs in front of #duet-rail-body.
 */

const MOODS = ['neutral', 'happy', 'flirty', 'smug', 'shy', 'flustered', 'sad', 'angry', 'surprised', 'curious', 'thinking', 'tired'];
const MOOD_ALIAS = {
    idle: 'neutral', calm: 'neutral', serious: 'neutral', joy: 'happy', joyful: 'happy', excited: 'happy',
    playful: 'smug', teasing: 'smug', love: 'flirty', loving: 'flirty', embarrassed: 'flustered', blushing: 'flustered',
    nervous: 'shy', hurt: 'sad', anger: 'angry', annoyed: 'angry', surprise: 'surprised', confused: 'curious',
    thoughtful: 'thinking', sleepy: 'tired',
};
const NEUTRAL = ['neutral', 'normal', 'base', 'default', 'idle', 'standing', 'stand'];

const hooks = {
    setDock: () => {},
    setStowed: () => {},
    settings: () => ({}),
    saveSettings: () => {},
    applyLayout: () => {},
    refreshStage: () => {},
};

const S = {
    drawer: '',
    drawerDirty: true,
    castSide: 'r',
    castQ: '',
    findQ: '',
    busy: false,
    quiet: false,
    listening: false,
    showAll: false,
    timer: 0,
    overlayTimer: 0,
    bound: false,
    logSig: '',
};

let recognition = null;

function getCtx() {
    return SillyTavern.getContext();
}

function prefs() {
    const s = hooks.settings();
    if (!s.subl || typeof s.subl !== 'object') s.subl = { on: false, phrases: '', everyS: 7, alpha: 0.34 };
    if (typeof s.subl.on !== 'boolean') s.subl.on = false;
    if (typeof s.subl.phrases !== 'string') s.subl.phrases = '';
    if (typeof s.subl.everyS !== 'number' || !Number.isFinite(s.subl.everyS)) s.subl.everyS = 7;
    s.subl.everyS = Math.min(60, Math.max(2, Math.round(s.subl.everyS)));
    if (typeof s.subl.alpha !== 'number' || !Number.isFinite(s.subl.alpha)) s.subl.alpha = 0.34;
    s.subl.alpha = Math.min(0.85, Math.max(0.12, s.subl.alpha));
    if (!s.inner || typeof s.inner !== 'object') s.inner = { on: false, byAvatar: {} };
    if (typeof s.inner.on !== 'boolean') s.inner.on = false;
    if (!s.inner.byAvatar || typeof s.inner.byAvatar !== 'object') s.inner.byAvatar = {};
    if (typeof s.leftAvatar !== 'string') s.leftAvatar = '';
    if (typeof s.personaKey !== 'string') s.personaKey = '';
    if (typeof s.solo !== 'boolean') s.solo = false;
    if (typeof s.navCollapsed !== 'boolean') s.navCollapsed = false;
    if (s.vnStageInit !== true) s.vnStageInit = false;
    return s;
}

function savePrefs() {
    hooks.saveSettings();
}

function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
    }[ch]));
}

function toast(kind, text) {
    try {
        const fn = window.toastr && window.toastr[kind];
        if (typeof fn === 'function') fn.call(window.toastr, text, 'Duet Stage');
        else console.info('[st-duet-stage]', text);
    } catch (e) {
        console.info('[st-duet-stage]', text);
    }
}

function formHeaders() {
    const headers = getCtx().getRequestHeaders?.({ omitContentType: true }) || {};
    delete headers['Content-Type'];
    delete headers['content-type'];
    return headers;
}

function jsonHeaders() {
    return getCtx().getRequestHeaders?.() || { 'Content-Type': 'application/json' };
}

function activeIndex(ctx) {
    const id = ctx.characterId;
    if (id == null || id === '' || ctx.characters?.[id] == null) return -1;
    return Number(id);
}

function activeChar(ctx) {
    if (ctx.groupId) {
        const chars = Array.isArray(ctx.characters) ? ctx.characters : [];
        const chat = Array.isArray(ctx.chat) ? ctx.chat : [];
        for (let i = chat.length - 1; i >= 0; i--) {
            const message = chat[i];
            if (!message || message.is_user || message.is_system) continue;
            const raw = message.original_avatar || '';
            const byAvatar = raw && chars.find((ch) => ch && (ch.avatar === raw || String(raw).includes(ch.avatar)));
            if (byAvatar) return byAvatar;
            const byName = message.name && chars.find((ch) => ch && ch.name === message.name);
            if (byName) return byName;
        }
        const group = Array.isArray(ctx.groups) ? ctx.groups.find((g) => g && g.id === ctx.groupId) : null;
        const first = group?.members?.[0];
        return (first && chars.find((ch) => ch && ch.avatar === first)) || null;
    }
    const index = activeIndex(ctx);
    return index >= 0 ? ctx.characters[index] : null;
}

function charByAvatar(ctx, avatar) {
    if (!avatar) return null;
    return (ctx.characters || []).find((ch) => ch && ch.avatar === avatar) || null;
}

function field(ch, key) {
    if (!ch) return '';
    const data = ch.data && typeof ch.data === 'object' ? ch.data : null;
    const fromData = data && data[key];
    if (fromData != null && fromData !== '') return fromData;
    const top = ch[key];
    return top == null ? '' : top;
}

function hueOf(name) {
    let h = 0;
    const text = String(name || 'stage');
    for (let i = 0; i < text.length; i++) h = (h * 33 + text.charCodeAt(i)) >>> 0;
    return h % 360;
}

function personaMap(ctx) {
    const map = ctx.powerUserSettings?.personas;
    return map && typeof map === 'object' ? map : {};
}

function currentPersonaKey(ctx) {
    const s = prefs();
    const map = personaMap(ctx);
    if (s.personaKey && map[s.personaKey]) return s.personaKey;
    const name = ctx.name1 || '';
    const found = Object.entries(map).find(([, label]) => label === name);
    return found ? found[0] : '';
}

function personaName(ctx) {
    const key = currentPersonaKey(ctx);
    const map = personaMap(ctx);
    return (key && map[key]) || ctx.name1 || 'You';
}

function thumb(type, file) {
    if (!file || typeof getCtx().getThumbnailUrl !== 'function') return '';
    try {
        return getCtx().getThumbnailUrl(type, file);
    } catch {
        return '';
    }
}

function fileStem(p) {
    return fileBase(p).toLowerCase();
}

function fileBase(p) {
    const file = String(p || '').split('?')[0].split('/').pop();
    return String(file || '').replace(/\.[^.]+$/, '');
}

function bestSprite(list, label) {
    const want = String(label || '').toLowerCase();
    if (!want || !Array.isArray(list)) return '';
    const matches = list.filter((s) => String(s?.label || '').toLowerCase() === want && s.path);
    if (!matches.length) return '';
    return (matches.find((s) => fileStem(s.path) === want) || matches[0]).path;
}

function spriteFolders(ch) {
    const stem = String(ch?.avatar || '').replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '').trim();
    const name = String(ch?.name || '').trim();
    const folders = [];
    const overrides = getCtx().extensionSettings?.expressionOverrides;
    if (Array.isArray(overrides) && stem) {
        const hit = overrides.find((e) => e && e.name === stem && e.path);
        if (hit?.path) folders.push(String(hit.path));
    }
    if (stem) folders.push(stem);
    if (name && !folders.includes(name)) folders.push(name);
    return folders;
}

async function fetchSprites(folder) {
    const res = await fetch(`/api/sprites/get?name=${encodeURIComponent(folder)}`);
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data) ? data.filter((s) => s && s.path && s.label) : [];
}

async function loadSprites(ch) {
    const folders = spriteFolders(ch);
    for (const folder of folders) {
        try {
            const list = await fetchSprites(folder);
            if (list.length) return { folder, list };
        } catch (e) {
            console.warn('[st-duet-stage] sprites', folder, e);
        }
    }
    return { folder: folders[0] || '', list: [] };
}

function moodIn(text) {
    const match = String(text || '').match(/\[([a-z][a-z -]{1,24})\]/i);
    if (!match) return '';
    const raw = match[1].toLowerCase().trim();
    if (MOODS.includes(raw)) return raw;
    return MOOD_ALIAS[raw] || '';
}

function expressionNow() {
    const holder = document.getElementById('expression-holder');
    if (!holder) return { src: '', label: '' };
    const imgs = [...holder.querySelectorAll('img.expression')].filter((img) => img.getAttribute('src'));
    const img = imgs[imgs.length - 1];
    if (!img) return { src: '', label: '' };
    return {
        src: img.getAttribute('src') || '',
        label: (img.getAttribute('data-expression') || '').toLowerCase(),
    };
}

function mesText(message) {
    if (!message) return '';
    if (Array.isArray(message.swipes) && typeof message.swipe_id === 'number' && typeof message.swipes[message.swipe_id] === 'string') {
        return message.swipes[message.swipe_id];
    }
    return String(message.mes || '');
}

function formatMes(text, message, id) {
    const ctx = getCtx();
    let body = String(text || '');
    try {
        if (typeof ctx.substituteParams === 'function') body = ctx.substituteParams(body);
    } catch { /* leave raw */ }
    try {
        if (typeof ctx.messageFormatting === 'function') {
            return ctx.messageFormatting(body, message?.name || '', !!message?.is_system, !!message?.is_user, id);
        }
    } catch (e) {
        console.warn('[st-duet-stage] format', e);
    }
    return esc(body).replace(/\n/g, '<br>');
}

function connected(ctx) {
    return ctx.onlineStatus && ctx.onlineStatus !== 'no_connection';
}

function lastSpeakerIsChar(ctx) {
    const chat = Array.isArray(ctx.chat) ? ctx.chat : [];
    for (let i = chat.length - 1; i >= 0; i--) {
        const message = chat[i];
        if (!message || message.is_system) continue;
        return !message.is_user;
    }
    return false;
}

/* ---------------- mount ---------------- */

function icon(name) {
    const paths = {
        pen: '<path d="M4 20l4-1 11-11-3-3L5 16z"/>',
        cast: '<rect x="8.5" y="4" width="7" height="13" rx="2"/><path d="M5.5 6.5v8M18.5 6.5v8M3 9v3M21 9v3"/>',
        card: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="11" r="2.2"/><path d="M5.8 16.5c.6-1.6 1.8-2.5 3.2-2.5s2.6.9 3.2 2.5M14.5 10h4"/>',
        brain: '<path d="M9 4a3 3 0 0 0-3 3 3 3 0 0 0-2 5 3 3 0 0 0 2 5 3 3 0 0 0 6 1V5a2 2 0 0 0-3-1zM15 4a3 3 0 0 1 3 3 3 3 0 0 1 2 5 3 3 0 0 1-2 5 3 3 0 0 1-6 1"/>',
        panel: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M9 4v16"/>',
        dots: '<circle cx="6" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="18" cy="12" r="1.2"/>',
        search: '<circle cx="11" cy="11" r="6"/><path d="M20 20l-4.2-4.2"/>',
        spark: '<path d="M12 3l1.6 4.8L18.5 9.5 13.6 11 12 16l-1.6-5L5.5 9.5 10.4 7.8z"/>',
    };
    return `<svg class="sic" viewBox="0 0 24 24" aria-hidden="true">${paths[name] || paths.spark}</svg>`;
}

function mount() {
    if (document.getElementById('duet-vn')) return;
    const root = document.createElement('div');
    root.id = 'duet-vn';
    root.innerHTML = `
<aside id="duet-nav" aria-label="Duet Stage">
  <div class="dv-brandrow">
    <button type="button" class="dv-brand" data-act="nav" data-nav="">${icon('spark')}<b class="lbl">Duet Stage</b></button>
    <button type="button" class="dv-icon" data-act="focus-find" data-duet-tip="Find characters and panels (Ctrl+K)" aria-label="Find">${icon('search')}</button>
    <button type="button" class="dv-icon" id="duet-nav-collapse" data-act="collapse-nav" data-duet-tip="Collapse sidebar" aria-label="Collapse sidebar">${icon('panel')}</button>
  </div>
  <div class="dv-search lbl">
    <input id="duet-search" type="search" placeholder="Find…" aria-label="Find characters, chats and panels" autocomplete="off">
    <kbd>Ctrl K</kbd>
    <div id="duet-find" hidden role="listbox"></div>
  </div>
  <nav class="dv-nav" aria-label="Sections">
    <button type="button" data-act="nav" data-nav="chats">${icon('pen')}<span class="lbl">New chat</span></button>
    <button type="button" data-act="nav" data-nav="cast">${icon('cast')}<span class="lbl">Cast</span></button>
    <button type="button" data-act="nav" data-nav="card">${icon('card')}<span class="lbl">Card</span></button>
    <button type="button" data-act="nav" data-nav="memory">${icon('brain')}<span class="lbl">Memory</span></button>
    <button type="button" data-act="nav" data-nav="library">${icon('panel')}<span class="lbl">Library</span></button>
    <button type="button" data-act="nav" data-nav="subl">${icon('brain')}<span class="lbl">Subliminals</span></button>
    <button type="button" data-act="nav" data-nav="inner">${icon('pen')}<span class="lbl">Inner voice</span></button>
    <button type="button" data-act="nav" data-nav="solo">${icon('panel')}<span class="lbl">Solo Stage</span></button>
    <button type="button" data-act="nav" data-nav="more">${icon('dots')}<span class="lbl">More</span></button>
  </nav>
  <div id="duet-recent" class="dv-recent lbl" aria-label="Recent characters"></div>
  <button type="button" class="dv-you" id="duet-you" data-act="nav" data-nav="cast" data-side="l">
    <span class="av" id="duet-you-av">?</span>
    <span class="lbl"><b id="duet-you-name">You</b><small id="duet-you-sub">Pick someone to talk to</small></span>
  </button>
</aside>
<div id="duet-scene">
  <figure class="dv-fig l" id="duet-fig-l"></figure>
  <figure class="dv-fig r" id="duet-fig-r"></figure>
  <div id="duet-subl" hidden></div>
  <div id="duet-drift" hidden></div>
  <div id="duet-banner" class="dv-banner" hidden></div>
  <section id="duet-log" class="dv-log" aria-live="polite" aria-label="Conversation"></section>
  <form id="duet-composer" class="dv-composer" autocomplete="off">
    <header class="dv-bar">
      <button type="button" class="dv-chars" data-act="nav" data-nav="cast" data-duet-tip="Characters: choose who you're talking to">
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="currentColor" opacity=".16"/><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="9" cy="10.5" r="1.2" fill="currentColor"/><circle cx="15" cy="10.5" r="1.2" fill="currentColor"/><path d="M8.6 14.2c.9 1.3 2.1 2 3.4 2s2.5-.7 3.4-2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
        <b>Characters</b>
      </button>
      <button type="button" class="dv-who" data-act="nav" data-nav="cast" data-side="l" data-duet-tip="Your side"><span class="av" id="duet-chip-l">?</span><b id="duet-chip-l-name">You</b></button>
      <button type="button" class="dv-who r" data-act="nav" data-nav="cast" data-side="r" data-duet-tip="Their side"><span class="av" id="duet-chip-r">?</span><b id="duet-chip-r-name">Them</b></button>
      <div class="dv-title"><b>Duet Stage</b><span id="duet-sub">SillyTavern</span></div>
      <button type="button" class="dv-text" data-act="nav" data-nav="chats" data-duet-tip="New chat and past chats">New chat</button>
      <button type="button" class="dv-text" data-act="nav" data-nav="memory" data-duet-tip="What she remembers">Memory</button>
      <button type="button" class="dv-text" data-act="show-column" data-duet-tip="Show the SillyTavern chat column">ST chat</button>
    </header>
    <textarea id="duet-ta" rows="2" placeholder="Pick a character to talk to" aria-label="Message"></textarea>
    <footer class="dv-row">
      <span class="dv-hint">Enter sends · Shift+Enter new line · [mood] sets a face</span>
      <button type="button" id="duet-continue" data-act="continue">Continue</button>
      <button type="button" id="duet-reroll" data-act="reroll">Reroll</button>
      <button type="button" id="duet-stop" data-act="stop" hidden>Stop</button>
      <button type="submit" id="duet-send" class="primary">Send</button>
      <button type="button" id="duet-mic" class="dv-mic" data-act="mic" data-duet-tip="Speak the message" aria-label="Microphone">
        <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M6 11a6 6 0 0 0 12 0M12 17v4"/></svg>
      </button>
    </footer>
  </form>
  <button type="button" id="duet-muse" data-act="muse" aria-label="Muse, the stage dragon" data-duet-tip="Muse">
    <svg viewBox="0 0 64 64" aria-hidden="true">
      <ellipse cx="34" cy="40" rx="16" ry="12" fill="#c084fc"/>
      <ellipse cx="18" cy="36" rx="10" ry="9" fill="#d8b4fe"/>
      <path d="M10 28l4 8M14 24l2 8M22 22l-1 8" stroke="#f5d0fe" stroke-width="2" stroke-linecap="round"/>
      <circle cx="14" cy="34" r="1.4" fill="#2e1064"/>
      <circle cx="20" cy="33" r="1.4" fill="#2e1064"/>
      <path d="M12 39c2 2 6 2 8 0" stroke="#6b21a8" stroke-width="1.4" fill="none" stroke-linecap="round"/>
      <path d="M46 34c8 2 12 10 8 16" stroke="#a855f7" stroke-width="4" fill="none" stroke-linecap="round"/>
      <path d="M28 28c2-10 12-12 14-4" fill="#e9d5ff"/>
    </svg>
    <span id="duet-muse-say" hidden></span>
  </button>
  <div id="duet-drawer" class="dv-drawer" hidden></div>
</div>`;
    document.body.append(root);
    root.addEventListener('click', onClick);
    root.addEventListener('change', onChange);
    root.addEventListener('input', onInput);
    root.addEventListener('submit', (ev) => {
        ev.preventDefault();
        send().catch((e) => console.warn('[st-duet-stage] send', e));
    });
    const ta = document.getElementById('duet-ta');
    ta.addEventListener('keydown', (ev) => {
        if (ev.key !== 'Enter' || ev.shiftKey || ev.isComposing) return;
        let sendOnEnter = true;
        try {
            if (typeof getCtx().shouldSendOnEnter === 'function') sendOnEnter = getCtx().shouldSendOnEnter() !== false;
        } catch { /* default enter sends */ }
        if (!sendOnEnter) return;
        ev.preventDefault();
        send().catch((e) => console.warn('[st-duet-stage] send', e));
    });
    document.getElementById('duet-search').addEventListener('keydown', (ev) => {
        if (ev.key === 'Escape') {
            ev.stopPropagation();
            closeFind();
        }
    });
}

/* ---------------- render ---------------- */

function scheduleRender() {
    clearTimeout(S.timer);
    S.timer = setTimeout(() => {
        renderChrome();
        renderLog();
        renderSprites().catch((e) => console.warn('[st-duet-stage] sprite', e));
        if (!S.busy && (S.drawer === 'cast' || S.drawer === 'chats')) {
            S.drawerDirty = true;
            renderDrawer();
        }
    }, 70);
}

function renderChrome() {
    const ctx = getCtx();
    const you = personaName(ctx);
    const them = activeChar(ctx);
    const youName = document.getElementById('duet-you-name');
    const chipL = document.getElementById('duet-chip-l-name');
    const chipR = document.getElementById('duet-chip-r-name');
    const sub = document.getElementById('duet-sub');
    if (youName) youName.textContent = you;
    const youSub = document.getElementById('duet-you-sub');
    if (youSub) youSub.textContent = them?.name ? `Talking to ${them.name}` : 'Pick someone to talk to';
    if (chipL) chipL.textContent = you;
    if (chipR) chipR.textContent = them?.name || (ctx.groupId ? (ctx.name2 || 'Group') : 'Them');
    if (sub) {
        if (!them && !ctx.groupId) sub.textContent = 'Pick someone from Cast';
        else if (!connected(ctx)) sub.textContent = `${them?.name || ctx.name2 || 'Chat'} · connect an API to reply`;
        else sub.textContent = `${them?.name || ctx.name2 || 'Chat'} · ${ctx.onlineStatus}`;
    }
    const youAv = document.getElementById('duet-you-av');
    const chipLAv = document.getElementById('duet-chip-l');
    const key = currentPersonaKey(ctx);
    const url = key ? thumb('persona', key) : '';
    paintAv(youAv, url, you);
    paintAv(chipLAv, url, you);
    const chipRAv = document.getElementById('duet-chip-r');
    paintAv(chipRAv, them ? thumb('avatar', them.avatar) : '', them?.name || '?');
    const ta = document.getElementById('duet-ta');
    if (ta && document.activeElement !== ta) {
        ta.placeholder = them ? `Message ${them.name}` : 'Pick a character to talk to';
    }
    const banner = document.getElementById('duet-banner');
    if (banner) {
        const show = !them && !ctx.groupId;
        banner.hidden = !show;
        banner.textContent = show
            ? 'SillyTavern keeps the characters, chats and the AI connection. Pick someone in Cast to bring them on stage.'
            : '';
    }
    document.getElementById('duet-scene')?.classList.toggle('is-solo', !!prefs().solo);
    document.querySelectorAll('#duet-nav [data-nav]').forEach((btn) => {
        btn.setAttribute('aria-pressed', String(btn.getAttribute('data-nav') === S.drawer && S.drawer !== ''));
    });
    renderRecent();
    renderComposerState();
    const scene = document.getElementById('duet-scene');
    if (scene) {
        const youHue = hueOf(you);
        const themHue = hueOf(them?.name || 'them');
        scene.style.setProperty('--lc', `hsl(${youHue} 70% 72%)`);
        scene.style.setProperty('--rc', `hsl(${themHue} 78% 72%)`);
    }
}

function paintAv(node, url, label) {
    if (!node) return;
    if (url) {
        node.textContent = '';
        node.style.backgroundImage = `url("${url.replace(/"/g, '')}")`;
    } else {
        node.style.backgroundImage = '';
        node.textContent = String(label || '?').slice(0, 1).toUpperCase();
    }
}

function renderRecent() {
    const host = document.getElementById('duet-recent');
    if (!host) return;
    const ctx = getCtx();
    const list = [...(ctx.characters || [])].filter(Boolean).sort((a, b) => (b.date_last_chat || 0) - (a.date_last_chat || 0)).slice(0, 4);
    host.replaceChildren();
    for (const ch of list) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'dv-recent-btn';
        btn.dataset.act = 'pick-char';
        btn.dataset.avatar = ch.avatar || '';
        btn.dataset.duetTip = ch.name || 'Character';
        btn.setAttribute('aria-label', ch.name || 'Character');
        const img = document.createElement('img');
        img.alt = '';
        img.src = thumb('avatar', ch.avatar);
        btn.append(img);
        host.append(btn);
    }
}

function renderComposerState() {
    const ctx = getCtx();
    const busy = S.busy && !S.quiet;
    const send = document.getElementById('duet-send');
    const stop = document.getElementById('duet-stop');
    const cont = document.getElementById('duet-continue');
    const reroll = document.getElementById('duet-reroll');
    const mic = document.getElementById('duet-mic');
    if (send) send.hidden = busy;
    if (stop) stop.hidden = !busy;
    if (cont) cont.disabled = busy || S.innerBusy;
    if (reroll) reroll.disabled = busy || !lastSpeakerIsChar(ctx);
    if (mic) mic.classList.toggle('is-on', S.listening);
    document.getElementById('duet-composer')?.classList.toggle('is-busy', busy);
}

function logHTML() {
    const ctx = getCtx();
    const chat = Array.isArray(ctx.chat) ? ctx.chat : [];
    const them = activeChar(ctx);
    if (!them && !ctx.groupId) {
        return `<div class="dv-empty"><b>Duet Stage</b><p>A one-on-one visual novel chat. Your character stands on the left, theirs on the right, and the dialogue runs between them. Open Cast and pick a SillyTavern character to load the stage.</p></div>`;
    }
    if (!chat.length) {
        return `<div class="dv-empty"><b>${esc(them?.name || ctx.name2 || 'Chat')}</b><p>No lines yet. Say something, or press Continue and SillyTavern will ask the connected model to begin.</p></div>`;
    }
    const start = S.showAll || chat.length <= 120 ? 0 : chat.length - 120;
    const parts = [];
    if (start > 0) {
        parts.push(`<button type="button" class="dv-earlier" data-act="earlier">Show earlier lines (${start})</button>`);
    }
    for (let i = start; i < chat.length; i++) {
        parts.push(turnHTML(chat[i], i, i === chat.length - 1));
    }
    if (S.busy && !S.quiet) {
        const last = chat[chat.length - 1];
        const waiting = !last || last.is_user;
        if (waiting) parts.push(`<article class="dv-turn them pending"><div class="bubble"><b>${esc(them?.name || ctx.name2 || 'Them')}</b><p class="wait">…</p></div></article>`);
    }
    return parts.join('');
}

function turnHTML(message, index, isLast) {
    if (!message) return '';
    const kind = message.is_system ? 'sys' : (message.is_user ? 'you' : 'them');
    const name = message.name || (kind === 'you' ? personaName(getCtx()) : (getCtx().name2 || 'Them'));
    const text = mesText(message);
    const inner = message.extra?.duet_inner ? `<i class="inner">${esc(message.extra.duet_inner)}</i>` : '';
    let swipe = '';
    if (isLast && kind === 'them' && Array.isArray(message.swipes) && message.swipes.length > 1) {
        const at = (typeof message.swipe_id === 'number' ? message.swipe_id : 0) + 1;
        swipe = `<span class="swipes"><button type="button" data-act="swipe-left" data-duet-tip="Previous reply">‹</button><span>${at}/${message.swipes.length}</span><button type="button" data-act="swipe-right" data-duet-tip="Next reply">›</button></span>`;
    }
    const live = isLast ? ' data-live="1"' : '';
    return `<article class="dv-turn ${kind}"${live}><div class="bubble"><b>${esc(name)}</b><div class="body">${formatMes(text, message, index)}</div>${inner}${swipe}</div></article>`;
}

function renderLog() {
    const log = document.getElementById('duet-log');
    if (!log) return;
    const html = logHTML();
    if (html === S.logSig) return;
    const nearBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 120;
    S.logSig = html;
    log.innerHTML = html;
    if (nearBottom) log.scrollTop = log.scrollHeight;
}

let spriteToken = 0;

async function renderSprites() {
    const token = ++spriteToken;
    const ctx = getCtx();
    const s = prefs();
    const right = activeChar(ctx);
    const leftChar = s.leftAvatar ? charByAvatar(ctx, s.leftAvatar) : null;
    const chat = Array.isArray(ctx.chat) ? ctx.chat : [];
    const lastYou = [...chat].reverse().find((m) => m && m.is_user);
    const lastThem = [...chat].reverse().find((m) => m && !m.is_user && !m.is_system);
    await paintFigure('duet-fig-l', leftChar, {
        fallbackName: personaName(ctx),
        fallbackUrl: thumb('persona', currentPersonaKey(ctx)),
        mood: moodIn(mesText(lastYou)),
        expression: null,
    }, token);
    const expression = expressionNow();
    await paintFigure('duet-fig-r', right, {
        fallbackName: right?.name || '',
        fallbackUrl: right ? thumb('avatar', right.avatar) : '',
        mood: moodIn(mesText(lastThem)),
        expression,
    }, token);
}

async function paintFigure(id, ch, opts, token) {
    const fig = document.getElementById(id);
    if (!fig || token !== spriteToken) return;
    const name = ch?.name || opts.fallbackName || '';
    let url = '';
    let sprite = false;
    if (ch) {
        const pack = await loadSprites(ch);
        if (token !== spriteToken) return;
        if (opts.expression?.src && pack.folder && opts.expression.src.toLowerCase().includes(`/characters/${pack.folder.toLowerCase()}/`)) {
            url = opts.expression.src;
            sprite = true;
        }
        if (!url && opts.expression?.label) {
            url = bestSprite(pack.list, opts.expression.label);
            sprite = !!url;
        }
        if (!url && opts.mood) {
            url = bestSprite(pack.list, opts.mood);
            sprite = !!url;
        }
        if (!url) {
            for (const label of NEUTRAL) {
                url = bestSprite(pack.list, label);
                if (url) { sprite = true; break; }
            }
        }
    }
    if (!url) url = opts.fallbackUrl || (ch ? thumb('avatar', ch.avatar) : '');
    fig.classList.toggle('is-sprite', sprite);
    fig.classList.toggle('is-empty', !url);
    fig.innerHTML = '';
    if (url) {
        const img = document.createElement('img');
        img.alt = name;
        img.src = url;
        img.addEventListener('error', () => {
            const fallback = opts.fallbackUrl || '';
            if (fallback && img.src !== fallback && !img.dataset.fell) {
                img.dataset.fell = '1';
                img.src = fallback;
                fig.classList.remove('is-sprite');
            } else {
                fig.classList.add('is-empty');
                img.remove();
            }
        });
        fig.append(img);
    }
    const cap = document.createElement('figcaption');
    cap.textContent = name;
    fig.append(cap);
}

/* ---------------- chat actions ---------------- */

async function send() {
    const ctx = getCtx();
    if (S.busy) return;
    if (!activeChar(ctx) && !ctx.groupId) {
        toast('info', 'Pick a character in Cast first.');
        openDrawer('cast');
        return;
    }
    const ta = document.getElementById('duet-ta');
    const text = String(ta?.value || '');
    if (!text.trim()) {
        toast('info', 'Write a line, or press Continue.');
        return;
    }
    const box = document.getElementById('send_textarea');
    if (box) {
        box.value = text;
        box.dispatchEvent(new Event('input', { bubbles: true }));
    }
    if (ta) ta.value = '';
    try {
        await ctx.generate('normal');
    } catch (e) {
        console.warn('[st-duet-stage] generate', e);
        toast('error', 'Send did not finish. Check the API connection in SillyTavern.');
        if (ta && !ta.value) ta.value = text;
    }
    scheduleRender();
}

async function continueChat() {
    const ctx = getCtx();
    if (S.busy) return;
    if (!activeChar(ctx) && !ctx.groupId) {
        toast('info', 'Pick a character in Cast first.');
        return;
    }
    try {
        if (lastSpeakerIsChar(ctx)) await ctx.generate('continue');
        else await ctx.generate('normal');
    } catch (e) {
        console.warn('[st-duet-stage] continue', e);
        toast('error', 'Continue did not finish. Check the API connection in SillyTavern.');
    }
}

async function reroll() {
    const ctx = getCtx();
    if (S.busy) return;
    if (!lastSpeakerIsChar(ctx)) {
        toast('info', 'Reroll needs her last line. Continue asks her to speak.');
        return;
    }
    try {
        if (typeof ctx.swipe?.right === 'function') await ctx.swipe.right();
        else await ctx.generate('swipe');
    } catch (e) {
        console.warn('[st-duet-stage] reroll', e);
        toast('error', 'Reroll did not finish. Check the API connection in SillyTavern.');
    }
}

function stop() {
    try {
        getCtx().stopGeneration?.();
    } catch (e) {
        console.warn('[st-duet-stage] stop', e);
    }
}

async function swipe(dir) {
    const ctx = getCtx();
    try {
        if (dir === 'left' && typeof ctx.swipe?.left === 'function') await ctx.swipe.left();
        else if (typeof ctx.swipe?.right === 'function') await ctx.swipe.right();
    } catch (e) {
        console.warn('[st-duet-stage] swipe', e);
    }
    scheduleRender();
}

/* ---------------- drawers ---------------- */

function openDrawer(name, side) {
    if (side === 'l' || side === 'r') S.castSide = side;
    if (S.drawer === name) {
        closeDrawer();
        return;
    }
    S.drawer = name || '';
    S.drawerDirty = true;
    renderDrawer();
    renderChrome();
}

function closeDrawer() {
    S.drawer = '';
    const drawer = document.getElementById('duet-drawer');
    if (drawer) {
        drawer.hidden = true;
        drawer.innerHTML = '';
    }
    renderChrome();
}

function renderDrawer() {
    const drawer = document.getElementById('duet-drawer');
    if (!drawer) return;
    if (!S.drawer) {
        drawer.hidden = true;
        return;
    }
    if (!S.drawerDirty) return;
    const active = document.activeElement;
    const restore = active && drawer.contains(active) && active.id
        ? { id: active.id, start: active.selectionStart, end: active.selectionEnd }
        : null;
    drawer.hidden = false;
    drawer.innerHTML = `<div class="dv-drawer-head"><b>${esc(drawerTitle(S.drawer))}</b><button type="button" data-act="close-drawer" aria-label="Close">✕</button></div><div class="dv-drawer-body">${drawerBody(S.drawer)}</div>`;
    S.drawerDirty = false;
    if (restore?.id) {
        const el = document.getElementById(restore.id);
        if (el) {
            el.focus();
            try { el.setSelectionRange(restore.start, restore.end); } catch { /* not text */ }
        }
    }
}

function drawerTitle(kind) {
    switch (kind) {
        case 'chats': return 'Chats';
        case 'cast': return 'Cast';
        case 'card': return 'Card';
        case 'memory': return 'Memory';
        case 'library': return 'Library';
        case 'subl': return 'Subliminals';
        case 'inner': return 'Inner voice';
        case 'solo': return 'Solo Stage';
        case 'more': return 'More';
        case 'settings': return 'Settings';
        case 'experimental': return 'Experimental';
        case 'updates': return 'Updates';
        case 'drive': return 'Drive';
        case 'mirror': return 'Mirror';
        default: return 'Duet';
    }
}

function drawerBody(kind) {
    switch (kind) {
        case 'chats': return chatsHTML();
        case 'cast': return castHTML();
        case 'card': return cardHTML();
        case 'memory': return memoryHTML();
        case 'library': return libraryHTML();
        case 'subl': return sublHTML();
        case 'inner': return innerHTML();
        case 'solo': return soloHTML();
        case 'more': return moreHTML();
        case 'settings': return settingsHTML();
        case 'experimental': return experimentalHTML();
        case 'updates': return updatesHTML();
        case 'drive': return driveHTML();
        case 'mirror': return mirrorHTML();
        default: return '';
    }
}

function chatsHTML() {
    const ctx = getCtx();
    const ch = activeChar(ctx);
    if (!ch) return '<p class="dv-note">Pick a character first. A new chat is theirs.</p>';
    return `<p class="dv-note">Chats are SillyTavern's own files for ${esc(ch.name)}.</p>
<button type="button" class="primary" data-act="new-chat">Start a new chat</button>
<div id="duet-chat-list" class="dv-list"><p class="dv-note">Loading chats…</p></div>`;
}

async function fillChatList() {
    const host = document.getElementById('duet-chat-list');
    if (!host || S.drawer !== 'chats') return;
    const ctx = getCtx();
    const ch = activeChar(ctx);
    if (!ch?.avatar) return;
    try {
        const res = await fetch('/api/characters/chats', {
            method: 'POST',
            headers: jsonHeaders(),
            body: JSON.stringify({ avatar_url: ch.avatar, simple: true }),
        });
        const data = await res.json();
        const files = Array.isArray(data) ? data : [];
        if (!files.length) {
            host.innerHTML = '<p class="dv-note">No saved chats yet.</p>';
            return;
        }
        const current = ch.chat || '';
        host.innerHTML = files.slice().reverse().map((f) => {
            const name = f.file_name || '';
            const on = name === current ? ' aria-pressed="true"' : '';
            return `<button type="button" data-act="open-chat" data-file="${esc(name)}"${on}>${esc(name.replace(/\.jsonl$/, ''))}</button>`;
        }).join('');
    } catch (e) {
        console.warn('[st-duet-stage] chats', e);
        host.innerHTML = '<p class="dv-note">Could not read the chat list.</p>';
    }
}

function castHTML() {
    const ctx = getCtx();
    const side = S.castSide === 'l' ? 'l' : 'r';
    const q = S.castQ.trim().toLowerCase();
    const youOn = side === 'l' ? ' aria-pressed="true"' : '';
    const themOn = side === 'r' ? ' aria-pressed="true"' : '';
    let grid = '';
    if (side === 'l') {
        const map = personaMap(ctx);
        const personas = Object.entries(map).filter(([key, name]) => !q || String(name).toLowerCase().includes(q) || key.toLowerCase().includes(q));
        const current = currentPersonaKey(ctx);
        grid = personas.map(([key, name]) => {
            const on = key === current ? ' aria-pressed="true"' : '';
            return `<button type="button" class="dv-tile" data-act="pick-persona" data-key="${esc(key)}"${on}><img alt="" src="${esc(thumb('persona', key))}"><b>${esc(name)}</b><small>persona</small></button>`;
        }).join('') || '<p class="dv-note">No personas yet. Create one below, or make one in SillyTavern\'s persona panel.</p>';
        const stand = prefs().leftAvatar;
        const cards = (ctx.characters || []).filter((ch) => ch && (!q || String(ch.name || '').toLowerCase().includes(q)));
        grid += `<h4>Stand-in card</h4><p class="dv-note">Optional. A character card can stand on the left. Lines still send as your persona.</p>`;
        grid += `<button type="button" class="dv-tile" data-act="pick-left" data-avatar="" ${stand ? '' : 'aria-pressed="true"'}><b>Persona only</b><small>no stand-in</small></button>`;
        grid += cards.slice(0, 60).map((ch) => {
            const on = ch.avatar === stand ? ' aria-pressed="true"' : '';
            return `<button type="button" class="dv-tile" data-act="pick-left" data-avatar="${esc(ch.avatar)}"${on}><img alt="" src="${esc(thumb('avatar', ch.avatar))}"><b>${esc(ch.name)}</b></button>`;
        }).join('');
    } else {
        const cards = (ctx.characters || []).filter((ch) => ch && (!q || String(ch.name || '').toLowerCase().includes(q)));
        const current = activeChar(ctx)?.avatar || '';
        grid = cards.slice(0, 80).map((ch) => {
            const on = ch.avatar === current ? ' aria-pressed="true"' : '';
            return `<button type="button" class="dv-tile" data-act="pick-char" data-avatar="${esc(ch.avatar)}"${on}><img alt="" src="${esc(thumb('avatar', ch.avatar))}"><b>${esc(ch.name)}</b></button>`;
        }).join('') || '<p class="dv-note">No characters yet. Create or import one below.</p>';
        if (ctx.groupId) grid = `<p class="dv-note">This is a group chat. Choosing a character opens their one-on-one chat. The stage currently shows the last speaker.</p>${grid}`;
    }
    return `<div class="dv-seg">
      <button type="button" data-act="cast-side" data-side="l"${youOn}>You · left</button>
      <button type="button" data-act="cast-side" data-side="r"${themOn}>Them · right</button>
    </div>
    <input id="duet-cast-q" type="search" placeholder="Search" value="${esc(S.castQ)}" aria-label="Search the cast">
    <div class="dv-grid">${grid}</div>
    <form class="dv-create" data-act-form="create-char">
      <input id="duet-new-name" type="text" placeholder="New character name" aria-label="New character name">
      <button type="button" class="primary" data-act="create-char">Create character</button>
    </form>
    <form class="dv-create">
      <input id="duet-new-persona" type="text" placeholder="New persona name" aria-label="New persona name">
      <button type="button" data-act="create-persona">Create persona</button>
    </form>
    <label class="dv-file">Import a card (PNG or JSON)
      <input id="duet-import" type="file" accept=".png,.json,.yaml,.yml,.charx,.byaf,image/png,application/json">
    </label>`;
}

function cardHTML() {
    const ch = activeChar(getCtx());
    if (!ch) return '<p class="dv-note">Pick their character in Cast. The card editor writes that SillyTavern character.</p>';
    const tags = Array.isArray(ch.tags) ? ch.tags.join(', ') : (ch.data?.tags || []).join?.(', ') || '';
    const world = ch.data?.extensions?.world || '';
    return `<p class="dv-note">Editing ${esc(ch.name)}. Save writes the SillyTavern card. Lorebooks still open from SillyTavern.</p>
<label>Name<input id="duet-card-name" type="text" value="${esc(ch.name || '')}"></label>
<label>Description<textarea id="duet-card-description" rows="5">${esc(field(ch, 'description'))}</textarea></label>
<label>Personality<textarea id="duet-card-personality" rows="4">${esc(field(ch, 'personality'))}</textarea></label>
<label>Scenario<textarea id="duet-card-scenario" rows="3">${esc(field(ch, 'scenario'))}</textarea></label>
<label>First message<textarea id="duet-card-first" rows="4">${esc(field(ch, 'first_mes'))}</textarea></label>
<label>Example dialogue<textarea id="duet-card-example" rows="4">${esc(field(ch, 'mes_example'))}</textarea></label>
<label>System prompt<textarea id="duet-card-system" rows="3">${esc(field(ch, 'system_prompt'))}</textarea></label>
<label>Post-history instructions<textarea id="duet-card-post" rows="3">${esc(field(ch, 'post_history_instructions'))}</textarea></label>
<label>Creator notes<textarea id="duet-card-notes" rows="3">${esc(field(ch, 'creator_notes'))}</textarea></label>
<label>Tags<input id="duet-card-tags" type="text" value="${esc(tags)}"></label>
<p class="dv-note">${world ? `Lorebook: ${esc(world)}. ` : ''}Character books and world info stay in SillyTavern's own editors.</p>
<button type="button" class="primary" data-act="save-card">Save card</button>`;
}

function memoryHTML() {
    const ctx = getCtx();
    if (!activeChar(ctx) && !ctx.groupId) return '<p class="dv-note">Open a chat first. Memory is stored in that chat.</p>';
    const mem = ctx.chatMetadata?.duet_memory || '';
    const note = ctx.chatMetadata?.note_prompt || '';
    return `<p class="dv-note">Duet memory is saved in this chat and added to the prompt SillyTavern sends. The author's note is SillyTavern's own note.</p>
<label>What she remembers<textarea id="duet-mem" rows="6">${esc(mem)}</textarea></label>
<label>Author's note<textarea id="duet-note" rows="4">${esc(note)}</textarea></label>
<button type="button" class="primary" data-act="save-memory">Save memory</button>`;
}

function libraryHTML() {
    const ch = activeChar(getCtx());
    if (!ch) return '<p class="dv-note">Pick their character. The library lists expression sprites SillyTavern already has for them.</p>';
    return `<p class="dv-note">Sprites for ${esc(ch.name)}, from <code>/api/sprites/get</code>. The stage uses these for her face. Uploading writes into her sprites folder. Picture-making from the Claude artifact is not available here.</p>
<div id="duet-lib" class="dv-grid"><p class="dv-note">Loading sprites…</p></div>
<label class="dv-file">Upload a sprite
  <input id="duet-sprite-file" type="file" accept="image/*">
</label>
<input id="duet-sprite-label" type="text" placeholder="Expression label, e.g. happy" aria-label="Sprite label">
<button type="button" data-act="upload-sprite">Add sprite</button>`;
}

async function fillLibrary() {
    const host = document.getElementById('duet-lib');
    if (!host || S.drawer !== 'library') return;
    const ch = activeChar(getCtx());
    if (!ch) return;
    const pack = await loadSprites(ch);
    if (!pack.list.length) {
        host.innerHTML = '<p class="dv-note">No expression sprites yet. Add one, or drop images in her sprites folder in SillyTavern.</p>';
        return;
    }
    host.innerHTML = pack.list.map((s) => `<figure class="dv-tile static"><img alt="" src="${esc(s.path)}"><b>${esc(s.label)}</b><button type="button" data-act="delete-sprite" data-label="${esc(s.label)}" data-file="${esc(fileBase(s.path))}">Delete</button></figure>`).join('');
}

function sublHTML() {
    const s = prefs().subl;
    return `<p class="dv-note">Short lines drift across the stage. They stay in this browser, in the extension's SillyTavern settings. Off until you turn them on.</p>
<label class="check"><input id="duet-subl-on" type="checkbox" ${s.on ? 'checked' : ''}> On</label>
<label>Lines, one per line<textarea id="duet-subl-phrases" rows="5">${esc(s.sublPhrases || s.phrases || '')}</textarea></label>
<label>Every <output id="duet-subl-every-out">${s.everyS}</output>s
  <input id="duet-subl-every" type="range" min="2" max="30" step="1" value="${s.everyS}">
</label>
<label>Strength
  <input id="duet-subl-alpha" type="range" min="0.12" max="0.8" step="0.02" value="${s.alpha}">
</label>
<button type="button" class="primary" data-act="save-subl">Save subliminals</button>`;
}

function innerHTML() {
    const ctx = getCtx();
    const ch = activeChar(ctx);
    if (!ch) return '<p class="dv-note">Pick someone to talk to first.</p>';
    const rec = prefs().inner.byAvatar[ch.avatar] || { now: '', thoughts: '' };
    return `<p class="dv-note">${esc(ch.name)}'s asides. Lines you write drift behind her. Ask the model uses SillyTavern's quiet prompt on the connected AI and stores the thought on her last line. It does not spend anything by itself.</p>
<label class="check"><input id="duet-inner-on" type="checkbox" ${prefs().inner.on ? 'checked' : ''}> Drift thoughts on the stage</label>
<label>What's happening<input id="duet-inner-now" type="text" value="${esc(rec.now || '')}"></label>
<label>Thoughts, one per line<textarea id="duet-inner-thoughts" rows="5">${esc(rec.thoughts || '')}</textarea></label>
<button type="button" class="primary" data-act="save-inner">Save lines</button>
<button type="button" data-act="ask-inner" ${S.innerBusy ? 'disabled' : ''}>Ask the model what she's thinking</button>`;
}

function soloHTML() {
    const on = prefs().solo;
    return `<p class="dv-note">Solo Stage in the Claude artifact was a separate ledger page (mood, gauges, growth) that lived in that page's own storage. That page is not part of SillyTavern.</p>
<p class="dv-note">Here, Solo Stage hides your side and leaves her alone with this same chat.</p>
<label class="check"><input id="duet-solo" type="checkbox" ${on ? 'checked' : ''}> Solo view</label>`;
}

function moreHTML() {
    return `<div class="dv-list">
<button type="button" data-act="nav" data-nav="settings">Settings</button>
<button type="button" data-act="nav" data-nav="experimental">Experimental</button>
<button type="button" data-act="nav" data-nav="updates">Updates</button>
<button type="button" data-act="nav" data-nav="drive">Drive</button>
<button type="button" data-act="nav" data-nav="mirror">Mirror</button>
<a href="https://github.com/Daleah666/SillyTavern-Card-Creator" target="_blank" rel="noopener">Character card extension</a>
</div>
<p class="dv-note">The masks button on the SillyTavern column still opens the side panel other extensions use.</p>`;
}

function settingsHTML() {
    const s = prefs();
    const dock = s.dock || 'middle';
    return `<label>SillyTavern column dock
      <select id="duet-set-dock2">
        <option value="middle" ${dock === 'middle' ? 'selected' : ''}>Middle</option>
        <option value="left" ${dock === 'left' ? 'selected' : ''}>Left</option>
        <option value="right" ${dock === 'right' ? 'selected' : ''}>Right</option>
      </select>
    </label>
<label class="check"><input id="duet-set-column" type="checkbox" ${s.stowed ? '' : 'checked'}> Show the SillyTavern chat column</label>
<p class="dv-note">Ctrl+wheel over the column, or over the stage log, scales message text. Drag the column edge to resize it. Stow still tucks it away.</p>
<p class="dv-note">Text scale ${esc(s.textScale || 1)}. Column width ${esc(s.width || 640)}px.</p>`;
}

function experimentalHTML() {
    return `<p class="dv-note">These Claude-artifact pieces are not wired up, because they talked to Claude, Drive, or a private hub:</p>
<ul class="dv-note">
<li>Picture and clip maker, Grok handoff, cut-outs</li>
<li>My Hub sync and the agent ladder</li>
<li>The Solo Stage ledger (mood gauges and growth charts)</li>
<li>Desktop notifications and the muse visit physics</li>
</ul>
<p class="dv-note">Sprites, cards, chats, memory and generation use SillyTavern instead.</p>`;
}

function updatesHTML() {
    return `<p class="dv-note"><b>0.2.0</b> — Duet Stage inside SillyTavern. Two-character stage, Cast, Card, chats, memory, sprite library, subliminals, inner voice, solo view. Send, Continue and Reroll use the connection you already set in SillyTavern.</p>
<p class="dv-note"><b>0.1.1</b> — Chat column, dock, stow, text scale, expression sprite, side panel for other extensions.</p>`;
}

function driveHTML() {
    return `<p class="dv-note">Claude Drive and My Hub sync are not available in this extension. Characters, chats and sprites are the files SillyTavern already keeps. Export a card from SillyTavern if you want a copy.</p>`;
}

function mirrorHTML() {
    return `<p class="dv-note">Mirroring another Duet Stage browser session needed the Claude hub. It is not available here. This stage always shows the chat SillyTavern has open.</p>`;
}

/* ---------------- persistence actions ---------------- */

function syncForm(ch) {
    if (!ch) return;
    const set = (id, value) => {
        const el = document.getElementById(id);
        if (el && 'value' in el) el.value = value == null ? '' : String(value);
    };
    set('character_name_pole', ch.name);
    set('description_textarea', field(ch, 'description'));
    set('personality_textarea', field(ch, 'personality'));
    set('scenario_pole', field(ch, 'scenario'));
    set('firstmessage_textarea', field(ch, 'first_mes'));
    set('mes_example_textarea', field(ch, 'mes_example'));
    set('creator_notes_textarea', field(ch, 'creator_notes') || ch.creatorcomment || '');
    set('system_prompt_textarea', field(ch, 'system_prompt'));
    set('post_history_instructions_textarea', field(ch, 'post_history_instructions'));
    set('creator_textarea', field(ch, 'creator'));
    set('character_version_textarea', field(ch, 'character_version'));
    const tags = Array.isArray(ch.tags) ? ch.tags.join(', ') : '';
    set('tags_textarea', tags);
    set('avatar_url_pole', ch.avatar || '');
    set('selected_chat_pole', ch.chat || '');
    set('create_date_pole', ch.create_date || '');
    set('character_world', ch.data?.extensions?.world || '');
    set('depth_prompt_prompt', ch.data?.extensions?.depth_prompt?.prompt || '');
    set('depth_prompt_depth', ch.data?.extensions?.depth_prompt?.depth ?? 4);
    set('depth_prompt_role', ch.data?.extensions?.depth_prompt?.role || 'system');
    const talk = document.getElementById('talkativeness_slider');
    if (talk) talk.value = String(ch.talkativeness ?? ch.data?.extensions?.talkativeness ?? 0.5);
    const jsonEl = document.getElementById('character_json_data');
    if (jsonEl) {
        try { jsonEl.value = JSON.stringify(ch); } catch { jsonEl.value = ''; }
    }
}

async function pickCharacter(avatar) {
    const ctx = getCtx();
    const index = (ctx.characters || []).findIndex((ch) => ch && ch.avatar === avatar);
    if (index < 0) {
        toast('warning', 'That character is not in SillyTavern\'s list.');
        return;
    }
    syncForm(ctx.characters[index]);
    await ctx.selectCharacterById(index);
    scheduleRender();
}

async function createCharacter() {
    const input = document.getElementById('duet-new-name');
    const name = String(input?.value || '').trim();
    if (!name) {
        toast('info', 'Type a name for the new character.');
        return;
    }
    const fd = new FormData();
    fd.set('ch_name', name);
    fd.set('description', '');
    fd.set('personality', '');
    fd.set('scenario', '');
    fd.set('first_mes', `*${name} steps into the light.*`);
    fd.set('mes_example', '');
    fd.set('fav', 'false');
    fd.set('talkativeness', '0.5');
    const res = await fetch('/api/characters/create', { method: 'POST', headers: formHeaders(), body: fd });
    if (!res.ok) {
        toast('error', 'SillyTavern did not create that character.');
        return;
    }
    const avatar = `${(await res.text()).trim()}.png`.replace(/\.png\.png$/, '.png');
    await getCtx().getCharacters?.();
    if (S.castSide === 'l') {
        prefs().leftAvatar = avatar;
        savePrefs();
        toast('success', `${name} is standing on your side.`);
    } else {
        await pickCharacter(avatar);
        toast('success', `${name} is on stage.`);
    }
    S.drawerDirty = true;
    renderDrawer();
    scheduleRender();
}

async function importCard(file) {
    if (!file) return;
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    const fd = new FormData();
    fd.set('avatar', file);
    fd.set('file_type', ext);
    fd.set('user_name', getCtx().name1 || 'User');
    const res = await fetch('/api/characters/import', { method: 'POST', headers: formHeaders(), body: fd });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.error || !data.file_name) {
        toast('error', 'That card did not import.');
        return;
    }
    const avatar = data.file_name.endsWith('.png') ? data.file_name : `${data.file_name}.png`;
    await getCtx().getCharacters?.();
    if (S.castSide === 'l') {
        prefs().leftAvatar = avatar;
        savePrefs();
    } else {
        await pickCharacter(avatar);
    }
    toast('success', 'Card imported.');
    S.drawerDirty = true;
    renderDrawer();
}

async function createPersona() {
    const name = String(document.getElementById('duet-new-persona')?.value || '').replace(/"/g, '').trim();
    if (!name) {
        toast('info', 'Type a persona name.');
        return;
    }
    const ctx = getCtx();
    try {
        const result = await ctx.executeSlashCommandsWithOptions?.(`/persona-create name="${name}" select=true`);
        const pipe = result && (result.pipe || result.pipeText);
        if (pipe) prefs().personaKey = String(pipe).trim();
        savePrefs();
        toast('success', `${name} is your persona now.`);
    } catch (e) {
        console.warn('[st-duet-stage] persona', e);
        toast('error', 'Could not create that persona.');
    }
    S.drawerDirty = true;
    renderDrawer();
    scheduleRender();
}

async function pickPersona(key) {
    const ctx = getCtx();
    const name = personaMap(ctx)[key] || key;
    prefs().personaKey = key;
    savePrefs();
    try {
        await ctx.executeSlashCommandsWithOptions?.(`/persona-set mode=lookup "${String(name).replace(/"/g, '')}"`);
    } catch (e) {
        console.warn('[st-duet-stage] persona-set', e);
        toast('warning', 'The persona was remembered here, but SillyTavern did not switch to it.');
    }
    scheduleRender();
    S.drawerDirty = true;
    renderDrawer();
}

async function saveCard() {
    const ctx = getCtx();
    const ch = activeChar(ctx);
    if (!ch?.avatar) return;
    const read = (id) => document.getElementById(id)?.value ?? '';
    const name = read('duet-card-name').trim();
    if (!name) {
        toast('info', 'The card needs a name.');
        return;
    }
    const tags = read('duet-card-tags').split(',').map((t) => t.trim()).filter(Boolean);
    const fd = new FormData();
    fd.set('ch_name', name);
    fd.set('description', read('duet-card-description'));
    fd.set('personality', read('duet-card-personality'));
    fd.set('scenario', read('duet-card-scenario'));
    fd.set('first_mes', read('duet-card-first'));
    fd.set('mes_example', read('duet-card-example'));
    fd.set('system_prompt', read('duet-card-system'));
    fd.set('post_history_instructions', read('duet-card-post'));
    fd.set('creator_notes', read('duet-card-notes'));
    fd.set('tags', tags.join(', '));
    fd.set('creator', String(field(ch, 'creator') || ''));
    fd.set('character_version', String(field(ch, 'character_version') || ''));
    fd.set('talkativeness', String(ch.talkativeness ?? ch.data?.extensions?.talkativeness ?? 0.5));
    fd.set('fav', (ch.fav || ch.data?.extensions?.fav) ? 'true' : 'false');
    fd.set('avatar_url', ch.avatar);
    fd.set('chat', ch.chat || '');
    fd.set('create_date', ch.create_date || '');
    fd.set('world', ch.data?.extensions?.world || '');
    fd.set('depth_prompt_prompt', ch.data?.extensions?.depth_prompt?.prompt || '');
    fd.set('depth_prompt_depth', String(ch.data?.extensions?.depth_prompt?.depth ?? 4));
    fd.set('depth_prompt_role', ch.data?.extensions?.depth_prompt?.role || 'system');
    try { fd.set('json_data', JSON.stringify(ch)); } catch { /* card still saves the fields above */ }
    try { if (ch.data?.extensions) fd.set('extensions', JSON.stringify(ch.data.extensions)); } catch { /* skip */ }
    const greetings = Array.isArray(ch.data?.alternate_greetings) ? ch.data.alternate_greetings : [];
    for (const greeting of greetings) fd.append('alternate_greetings', greeting);
    const res = await fetch('/api/characters/edit', { method: 'POST', headers: formHeaders(), body: fd });
    if (!res.ok) {
        toast('error', 'The card did not save.');
        return;
    }
    await ctx.getOneCharacter?.(ch.avatar);
    const fresh = charByAvatar(getCtx(), ch.avatar) || ch;
    fresh.name = name;
    syncForm(fresh);
    toast('success', 'Card saved.');
    scheduleRender();
}

function saveMemory() {
    const ctx = getCtx();
    if (!ctx.chatMetadata) {
        toast('info', 'Open a chat first.');
        return;
    }
    const mem = document.getElementById('duet-mem');
    const note = document.getElementById('duet-note');
    if (mem) ctx.chatMetadata.duet_memory = mem.value;
    if (note) ctx.chatMetadata.note_prompt = note.value;
    applyMemory();
    ctx.saveMetadata?.();
    toast('success', 'Memory saved in this chat.');
}

function applyMemory() {
    const ctx = getCtx();
    if (typeof ctx.setExtensionPrompt !== 'function') return;
    const mem = String(ctx.chatMetadata?.duet_memory || '').trim();
    ctx.setExtensionPrompt('st-duet-stage-memory', mem ? `[Duet memory]\n${mem}` : '', 0, 0, false, 0);
}

function saveSubl() {
    const s = prefs().subl;
    s.on = !!document.getElementById('duet-subl-on')?.checked;
    s.phrases = document.getElementById('duet-subl-phrases')?.value || '';
    s.everyS = Number(document.getElementById('duet-subl-every')?.value || s.everyS);
    s.alpha = Number(document.getElementById('duet-subl-alpha')?.value || s.alpha);
    prefs();
    savePrefs();
    toast('success', s.on ? 'Subliminals are on.' : 'Subliminals saved.');
}

function saveInner() {
    const ch = activeChar(getCtx());
    if (!ch?.avatar) return;
    const bucket = prefs().inner;
    bucket.on = !!document.getElementById('duet-inner-on')?.checked;
    bucket.byAvatar[ch.avatar] = {
        now: document.getElementById('duet-inner-now')?.value || '',
        thoughts: document.getElementById('duet-inner-thoughts')?.value || '',
    };
    savePrefs();
    toast('success', 'Inner voice saved for her.');
}

async function askInner() {
    const ctx = getCtx();
    const chat = Array.isArray(ctx.chat) ? ctx.chat : [];
    let idx = -1;
    for (let i = chat.length - 1; i >= 0; i--) {
        if (chat[i] && !chat[i].is_user && !chat[i].is_system) { idx = i; break; }
    }
    if (idx < 0) {
        toast('info', 'She has not spoken yet.');
        return;
    }
    if (typeof ctx.generateQuietPrompt !== 'function') {
        toast('warning', 'This SillyTavern build has no quiet prompt. Inner thoughts you type still drift.');
        return;
    }
    if (!connected(ctx)) {
        toast('info', 'Connect an API in SillyTavern first. Ask the model uses that connection.');
        return;
    }
    const name = chat[idx].name || ctx.name2 || 'She';
    S.innerBusy = true;
    renderComposerState();
    try {
        const thought = await ctx.generateQuietPrompt({
            quietPrompt: `Write ${name}'s private inner thought about what just happened. One or two sentences, first person, no quotes, no asterisks.\n\nLatest line:\n${mesText(chat[idx]).slice(0, 1200)}`,
            skipWIAN: true,
            responseLength: 80,
        });
        const clean = String(thought || '').trim();
        if (!clean) {
            toast('warning', 'No inner thought came back.');
            return;
        }
        chat[idx].extra = { ...(chat[idx].extra || {}), duet_inner: clean };
        const ch = activeChar(ctx);
        if (ch?.avatar) {
            const rec = prefs().inner.byAvatar[ch.avatar] || { now: '', thoughts: '' };
            rec.thoughts = [clean, rec.thoughts].filter(Boolean).join('\n');
            prefs().inner.byAvatar[ch.avatar] = rec;
            savePrefs();
        }
        await ctx.saveChat?.();
        toast('success', 'Inner thought saved on her last line.');
        S.drawerDirty = true;
        S.logSig = '';
        scheduleRender();
        renderDrawer();
    } catch (e) {
        console.warn('[st-duet-stage] inner', e);
        toast('error', 'Inner voice could not reach the AI connection.');
    } finally {
        S.innerBusy = false;
        renderComposerState();
    }
}

async function uploadSprite() {
    const ch = activeChar(getCtx());
    const file = document.getElementById('duet-sprite-file')?.files?.[0];
    if (!ch || !file) {
        toast('info', 'Choose an image first.');
        return;
    }
    const folders = spriteFolders(ch);
    const folder = folders[0];
    if (!folder) return;
    const label = String(document.getElementById('duet-sprite-label')?.value || fileStem(file.name) || 'neutral').trim();
    const fd = new FormData();
    fd.set('avatar', file);
    fd.set('label', label);
    fd.set('name', folder);
    fd.set('spriteName', label);
    const res = await fetch('/api/sprites/upload', { method: 'POST', headers: formHeaders(), body: fd });
    if (!res.ok) {
        toast('error', 'The sprite did not upload.');
        return;
    }
    toast('success', `Added ${label}.`);
    fillLibrary().catch((e) => console.warn('[st-duet-stage] library', e));
    scheduleRender();
}

async function deleteSprite(label, spriteName) {
    const ch = activeChar(getCtx());
    const folder = spriteFolders(ch)[0];
    if (!folder || !label) return;
    const res = await fetch('/api/sprites/delete', {
        method: 'POST',
        headers: jsonHeaders(),
        body: JSON.stringify({ name: folder, label, spriteName: spriteName || label }),
    });
    if (!res.ok) {
        toast('error', 'Could not delete that sprite.');
        return;
    }
    fillLibrary().catch(() => {});
    scheduleRender();
}

async function newChat() {
    const ctx = getCtx();
    if (!activeChar(ctx)) {
        toast('info', 'Pick a character first.');
        return;
    }
    syncForm(activeChar(ctx));
    try {
        await ctx.executeSlashCommandsWithOptions?.('/newchat');
        toast('success', 'New chat.');
    } catch (e) {
        console.warn('[st-duet-stage] newchat', e);
        toast('error', 'Could not start a new chat.');
    }
    scheduleRender();
    setTimeout(() => fillChatList(), 400);
}

async function openChat(file) {
    const ctx = getCtx();
    const ch = activeChar(ctx);
    if (!ch || !file || typeof ctx.openCharacterChat !== 'function') return;
    syncForm(ch);
    try {
        await ctx.openCharacterChat(file);
    } catch (e) {
        console.warn('[st-duet-stage] open chat', e);
        toast('error', 'Could not open that chat.');
    }
    applyMemory();
    scheduleRender();
}

function showColumn(on) {
    hooks.setStowed(!on);
}

function toggleMic() {
    const Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Rec) {
        toast('info', 'This browser has no speech recognition. Type the line instead. Reading her lines aloud stays in SillyTavern\'s own voice extensions.');
        return;
    }
    if (S.listening && recognition) {
        recognition.stop();
        return;
    }
    recognition = new Rec();
    recognition.lang = document.documentElement.lang || 'en-US';
    recognition.interimResults = true;
    recognition.continuous = false;
    const ta = document.getElementById('duet-ta');
    const base = ta ? ta.value : '';
    recognition.onstart = () => { S.listening = true; renderComposerState(); };
    recognition.onend = () => { S.listening = false; renderComposerState(); };
    recognition.onerror = () => {
        S.listening = false;
        renderComposerState();
        toast('warning', 'The microphone did not start.');
    };
    recognition.onresult = (ev) => {
        let said = '';
        for (let i = ev.resultIndex; i < ev.results.length; i++) said += ev.results[i][0].transcript;
        if (ta) ta.value = `${base}${base && said ? ' ' : ''}${said}`;
    };
    try {
        recognition.start();
    } catch (e) {
        console.warn('[st-duet-stage] mic', e);
        toast('warning', 'The microphone did not start.');
    }
}

function museSay() {
    const say = document.getElementById('duet-muse-say');
    if (!say) return;
    say.hidden = false;
    say.textContent = 'Picture making lived on Claude. I just keep you company here.';
    clearTimeout(museSay._t);
    museSay._t = setTimeout(() => { say.hidden = true; }, 4200);
}

function linesOf(text) {
    return String(text || '').split(/\n+/).map((l) => l.trim()).filter(Boolean);
}

function tickOverlays() {
    const s = prefs();
    const subl = document.getElementById('duet-subl');
    const drift = document.getElementById('duet-drift');
    const now = Date.now();
    if (subl) {
        const lines = linesOf(s.subl.phrases);
        if (s.subl.on && lines.length && now - (tickOverlays.sublAt || 0) > s.subl.everyS * 1000) {
            tickOverlays.sublAt = now;
            subl.hidden = false;
            subl.style.opacity = String(s.subl.alpha);
            subl.textContent = lines[Math.floor(Math.random() * lines.length)];
            clearTimeout(tickOverlays.sublHide);
            tickOverlays.sublHide = setTimeout(() => { subl.hidden = true; }, Math.min(2200, s.subl.everyS * 400));
        }
        if (!s.subl.on) subl.hidden = true;
    }
    if (drift) {
        const ch = activeChar(getCtx());
        const rec = ch?.avatar ? s.inner.byAvatar[ch.avatar] : null;
        const lines = linesOf([rec?.now, rec?.thoughts].filter(Boolean).join('\n'));
        if (s.inner.on && lines.length && now - (tickOverlays.driftAt || 0) > 9000) {
            tickOverlays.driftAt = now;
            drift.hidden = false;
            drift.textContent = lines[Math.floor(Math.random() * lines.length)];
            clearTimeout(tickOverlays.driftHide);
            tickOverlays.driftHide = setTimeout(() => { drift.hidden = true; }, 3200);
        }
        if (!s.inner.on) drift.hidden = true;
    }
}

function closeFind() {
    S.findQ = '';
    const input = document.getElementById('duet-search');
    const box = document.getElementById('duet-find');
    if (input) input.value = '';
    if (box) { box.hidden = true; box.innerHTML = ''; }
}

function renderFind(q) {
    const box = document.getElementById('duet-find');
    if (!box) return;
    const query = q.trim().toLowerCase();
    if (!query) { box.hidden = true; box.innerHTML = ''; return; }
    const ctx = getCtx();
    const panels = [
        ['chats', 'New chat'], ['cast', 'Cast'], ['card', 'Card'], ['memory', 'Memory'],
        ['library', 'Library'], ['subl', 'Subliminals'], ['inner', 'Inner voice'], ['solo', 'Solo Stage'],
        ['settings', 'Settings'],
    ].filter(([, label]) => label.toLowerCase().includes(query));
    const chars = (ctx.characters || []).filter((ch) => ch && String(ch.name || '').toLowerCase().includes(query)).slice(0, 8);
    const personas = Object.entries(personaMap(ctx)).filter(([, name]) => String(name).toLowerCase().includes(query)).slice(0, 6);
    const bits = [];
    for (const [id, label] of panels) bits.push(`<button type="button" data-act="nav" data-nav="${id}">${esc(label)}</button>`);
    for (const ch of chars) bits.push(`<button type="button" data-act="pick-char" data-avatar="${esc(ch.avatar)}">${esc(ch.name)}</button>`);
    for (const [key, name] of personas) bits.push(`<button type="button" data-act="pick-persona" data-key="${esc(key)}">${esc(name)} · persona</button>`);
    box.hidden = bits.length === 0;
    box.innerHTML = bits.join('') || '';
}

/* ---------------- events ---------------- */

const actions = {
    nav: (el) => openDrawer(el.dataset.nav || '', el.dataset.side),
    'close-drawer': () => closeDrawer(),
    'focus-find': () => document.getElementById('duet-search')?.focus(),
    'collapse-nav': () => {
        prefs().navCollapsed = !prefs().navCollapsed;
        savePrefs();
        hooks.applyLayout();
    },
    'show-column': () => showColumn(true),
    continue: () => continueChat(),
    reroll: () => reroll(),
    stop: () => stop(),
    mic: () => toggleMic(),
    muse: () => museSay(),
    earlier: () => { S.showAll = true; S.logSig = ''; renderLog(); },
    'swipe-left': () => swipe('left'),
    'swipe-right': () => swipe('right'),
    'cast-side': (el) => { S.castSide = el.dataset.side === 'l' ? 'l' : 'r'; S.drawerDirty = true; renderDrawer(); },
    'pick-char': async (el) => { closeFind(); await pickCharacter(el.dataset.avatar || ''); },
    'pick-left': (el) => {
        prefs().leftAvatar = el.dataset.avatar || '';
        savePrefs();
        S.drawerDirty = true;
        renderDrawer();
        scheduleRender();
    },
    'pick-persona': async (el) => { closeFind(); await pickPersona(el.dataset.key || ''); },
    'create-char': () => createCharacter(),
    'create-persona': () => createPersona(),
    'save-card': () => saveCard(),
    'save-memory': () => saveMemory(),
    'save-subl': () => saveSubl(),
    'save-inner': () => saveInner(),
    'ask-inner': () => askInner(),
    'upload-sprite': () => uploadSprite(),
    'delete-sprite': (el) => deleteSprite(el.dataset.label || '', el.dataset.file || ''),
    'new-chat': () => newChat(),
    'open-chat': (el) => openChat(el.dataset.file || ''),
};

function onClick(ev) {
    const el = ev.target.closest('[data-act]');
    if (!el || !document.getElementById('duet-vn')?.contains(el)) return;
    if (el.dataset.act === 'nav' && el.closest('#duet-find')) closeFind();
    const fn = actions[el.dataset.act];
    if (!fn) return;
    if (el.dataset.act !== 'mic') ev.preventDefault();
    Promise.resolve(fn(el, ev)).catch((e) => console.warn('[st-duet-stage] action', el.dataset.act, e));
}

function onChange(ev) {
    const id = ev.target?.id;
    if (id === 'duet-solo') {
        prefs().solo = !!ev.target.checked;
        savePrefs();
        renderChrome();
    } else if (id === 'duet-set-column') {
        showColumn(!!ev.target.checked);
    } else if (id === 'duet-set-dock2') {
        hooks.setDock(ev.target.value);
    } else if (id === 'duet-import') {
        const file = ev.target.files?.[0];
        importCard(file).catch((e) => console.warn('[st-duet-stage] import', e));
        ev.target.value = '';
    } else if (id === 'duet-subl-on' || id === 'duet-inner-on') {
        /* saved with the Save button; preview the toggle immediately */
        if (id === 'duet-subl-on') prefs().subl.on = !!ev.target.checked;
        if (id === 'duet-inner-on') prefs().inner.on = !!ev.target.checked;
        savePrefs();
    }
}

function onInput(ev) {
    const id = ev.target?.id;
    if (id === 'duet-search') renderFind(ev.target.value);
    else if (id === 'duet-cast-q') {
        S.castQ = ev.target.value;
        S.drawerDirty = true;
        renderDrawer();
    } else if (id === 'duet-subl-every') {
        const out = document.getElementById('duet-subl-every-out');
        if (out) out.textContent = ev.target.value;
    }
}

const EVENT_KEYS = [
    'CHAT_CHANGED',
    'CHAT_LOADED',
    'MESSAGE_SENT',
    'MESSAGE_RECEIVED',
    'MESSAGE_SWIPED',
    'MESSAGE_UPDATED',
    'MESSAGE_DELETED',
    'MESSAGE_EDITED',
    'CHARACTER_EDITED',
    'CHARACTER_MESSAGE_RENDERED',
    'USER_MESSAGE_RENDERED',
    'GROUP_UPDATED',
    'GENERATION_STARTED',
    'GENERATION_ENDED',
    'GENERATION_STOPPED',
    'STREAM_TOKEN_RECEIVED',
];

function bindEvents() {
    if (S.bound) return;
    const ctx = getCtx();
    const es = ctx.eventSource;
    const types = ctx.eventTypes || ctx.event_types || {};
    if (!es || typeof es.on !== 'function') return;
    S.bound = true;
    for (const key of EVENT_KEYS) {
        const name = types[key];
        if (!name) continue;
        es.on(name, (...args) => onStageEvent(key, args));
    }
    document.addEventListener('keydown', (ev) => {
        if ((ev.ctrlKey || ev.metaKey) && (ev.key === 'k' || ev.key === 'K')) {
            ev.preventDefault();
            document.getElementById('duet-search')?.focus();
            return;
        }
        if (ev.key === 'Escape') {
            if (S.drawer) closeDrawer();
            else closeFind();
        }
    });
    document.getElementById('duet-log')?.addEventListener('wheel', (ev) => {
        if (!ev.ctrlKey) return;
        ev.preventDefault();
        const s = hooks.settings();
        const dir = ev.deltaY < 0 ? 1 : -1;
        const next = Math.round((Number(s.textScale) + dir * 0.05) * 100) / 100;
        s.textScale = Math.min(1.75, Math.max(0.7, next));
        hooks.saveSettings();
        hooks.applyLayout();
    }, { passive: false });
}

function stGenerating() {
    const stop = document.getElementById('mes_stop');
    return !!(stop && getComputedStyle(stop).display !== 'none');
}

function watchBusy() {
    clearTimeout(S.busyWatch);
    S.busyWatch = setTimeout(function look() {
        if (!stGenerating()) {
            S.busy = false;
            S.quiet = false;
            renderComposerState();
            scheduleRender();
            return;
        }
        S.busyWatch = setTimeout(look, 400);
    }, 700);
}

function onStageEvent(key, args) {
    if (key === 'GENERATION_STARTED') {
        const type = args[0];
        if (type === 'quiet') {
            S.quiet = true;
            return;
        }
        S.busy = true;
        S.quiet = false;
        renderComposerState();
        scheduleRender();
        watchBusy();
        return;
    }
    if (key === 'GENERATION_ENDED' || key === 'GENERATION_STOPPED') {
        clearTimeout(S.busyWatch);
        S.busy = false;
        S.quiet = false;
        scheduleRender();
        return;
    }
    if (key === 'CHAT_CHANGED' || key === 'CHAT_LOADED') {
        S.showAll = false;
        S.logSig = '';
        applyMemory();
    }
    scheduleRender();
}

function registerMenu() {
    const api = window.DuetStage;
    if (!api || api._vnMenu || typeof api.registerPanel !== 'function') return;
    api._vnMenu = true;
    const prev = api.refresh;
    api.refresh = () => {
        try { prev?.(); } catch (e) { console.warn('[st-duet-stage] refresh', e); }
        scheduleRender();
    };
    const items = [
        ['vn-chats', 'Chats', 'chats'],
        ['vn-cast', 'Cast', 'cast'],
        ['vn-card', 'Card', 'card'],
        ['vn-memory', 'Memory', 'memory'],
        ['vn-library', 'Library', 'library'],
    ];
    for (const [name, label, drawer] of items) {
        api.registerPanel(name, () => openDrawer(drawer), label);
    }
}

function migrateColumn() {
    const s = prefs();
    if (s.vnStageInit) return;
    s.vnStageInit = true;
    s.stowed = true;
    savePrefs();
    hooks.applyLayout();
}

export function bootVn(api) {
    Object.assign(hooks, api || {});
    mount();
    migrateColumn();
    registerMenu();
    bindEvents();
    applyMemory();
    renderChrome();
    renderLog();
    renderSprites().catch((e) => console.warn('[st-duet-stage] sprite', e));
    clearInterval(S.overlayTimer);
    S.overlayTimer = setInterval(tickOverlays, 1000);
    const drawer = document.getElementById('duet-drawer');
    const obs = new MutationObserver(() => {
        if (S.drawer === 'chats') fillChatList();
        if (S.drawer === 'library') fillLibrary().catch((e) => console.warn('[st-duet-stage] library', e));
    });
    if (drawer) obs.observe(drawer, { childList: true });
}
