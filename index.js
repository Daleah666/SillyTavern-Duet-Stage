/**
 * Duet Stage — moveable chat column for SillyTavern.
 *
 * The chat (#sheld) docks middle (1-on-1) or to a side (duet). Drag its edge to
 * resize, Ctrl+wheel scales message text only, Stow tucks it away. Her sprite is
 * read from /api/sprites/get and her avatar from /characters/<file>. Nothing here
 * draws or generates a character.
 *
 * Side panel contract used by st-card-creator 0.1.5 (panel / ensureTab / ensureStage):
 *   #duet-side-panel.open
 *   first child .duet-sp-resize, then .duet-sp-head, then #duet-rail-body
 *   class duet-stage-collapsed, cleared by DuetStage.stageMode.setActive(false)
 *   DuetStage.toggleSidePanel / registerPanel / listPanels
 */

import './autoupdate.js';   // updates itself from GitHub on each refresh, and shows the repo's 📣 board
const MODULE = 'st-duet-stage';
const VERSION = '0.1.1';
const PANEL_ID = 'duet-side-panel';
const NEUTRAL_LABELS = ['neutral', 'normal', 'base', 'default', 'idle', 'standing', 'stand'];
const SPRITE_EVENTS = [
    'CHAT_CHANGED',
    'MESSAGE_RECEIVED',
    'MESSAGE_SWIPED',
    'MESSAGE_DELETED',
    'CHARACTER_MESSAGE_RENDERED',
    'CHARACTER_EDITED',
    'GROUP_UPDATED',
];

const DEFAULTS = {
    dock: 'middle',
    width: 640,
    textScale: 1,
    stowed: false,
    panelOpen: false,
    panelWidth: 340,
};

const ctx = () => SillyTavern.getContext();
const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

function settings() {
    const ext = ctx().extensionSettings;
    const s = (ext[MODULE] = ext[MODULE] && typeof ext[MODULE] === 'object' ? ext[MODULE] : {});
    if (s.dock !== 'left' && s.dock !== 'right' && s.dock !== 'middle') s.dock = DEFAULTS.dock;
    if (typeof s.width !== 'number' || !Number.isFinite(s.width)) s.width = DEFAULTS.width;
    s.width = clamp(Math.round(s.width), 320, 1200);
    if (typeof s.textScale !== 'number' || !Number.isFinite(s.textScale)) s.textScale = DEFAULTS.textScale;
    s.textScale = clamp(Math.round(s.textScale * 100) / 100, 0.7, 1.75);
    if (typeof s.stowed !== 'boolean') s.stowed = DEFAULTS.stowed;
    if (typeof s.panelOpen !== 'boolean') s.panelOpen = DEFAULTS.panelOpen;
    if (typeof s.panelWidth !== 'number' || !Number.isFinite(s.panelWidth)) s.panelWidth = DEFAULTS.panelWidth;
    s.panelWidth = clamp(Math.round(s.panelWidth), 240, 720);
    return s;
}

function saveSettings() {
    try {
        ctx().saveSettingsDebounced?.();
    } catch (e) {
        console.warn(`[${MODULE}] save failed`, e);
    }
}

/* ---------------- dom ---------------- */

function h(tag, attrs) {
    const node = document.createElement(tag);
    if (attrs) {
        for (const [key, value] of Object.entries(attrs)) {
            if (value == null || value === false) continue;
            if (key === 'text') node.textContent = String(value);
            else node.setAttribute(key, value === true ? '' : String(value));
        }
    }
    return node;
}

function iconButton(id, icon, tip, extra) {
    const btn = h('button', {
        type: 'button',
        id: id || null,
        class: 'duet-icon-btn',
        'data-duet-tip': tip,
        'aria-label': tip,
        title: tip,
    });
    if (extra) {
        for (const [key, value] of Object.entries(extra)) btn.setAttribute(key, value);
    }
    const iconEl = h('i', { class: `fa-solid ${icon}`, 'aria-hidden': 'true' });
    btn.append(iconEl);
    return btn;
}

function mount() {
    if (!document.getElementById('duet-stage')) {
        const stage = h('div', { id: 'duet-stage', 'aria-hidden': 'true' });
        const img = h('img', { id: 'duet-sprite', alt: '', hidden: true });
        img.addEventListener('error', onSpriteError);
        stage.append(img);
        document.body.append(stage);
    }

    const sheld = document.getElementById('sheld');
    if (sheld && !document.getElementById('duet-col-bar')) {
        const bar = h('div', { id: 'duet-col-bar' });
        bar.append(
            iconButton(null, 'fa-align-center', '1-on-1, chat in the middle', { 'data-duet-dock-btn': 'middle' }),
            iconButton(null, 'fa-align-left', 'Duet, chat on the left', { 'data-duet-dock-btn': 'left' }),
            iconButton(null, 'fa-align-right', 'Duet, chat on the right', { 'data-duet-dock-btn': 'right' }),
            h('span', { class: 'duet-col-spacer' }),
            iconButton('duet-stow-btn', 'fa-chevron-down', 'Stow the chat'),
            iconButton('duet-theater-btn', 'fa-masks-theater', 'Side panel', { 'data-duet-menu': '1' }),
        );
        const gripL = h('div', {
            id: 'duet-grip-left',
            class: 'duet-grip',
            role: 'separator',
            'aria-orientation': 'vertical',
            'aria-label': 'Drag to resize the chat',
            title: 'Drag to resize the chat',
        });
        const gripR = h('div', {
            id: 'duet-grip-right',
            class: 'duet-grip',
            role: 'separator',
            'aria-orientation': 'vertical',
            'aria-label': 'Drag to resize the chat',
            title: 'Drag to resize the chat',
        });
        const header = document.getElementById('sheldheader');
        const anchor = header ? header.nextSibling : sheld.firstChild;
        sheld.insertBefore(bar, anchor);
        sheld.append(gripL, gripR);
        bar.addEventListener('click', onBarClick);
        gripL.addEventListener('pointerdown', (ev) => startDrag(ev, 'col-left'));
        gripR.addEventListener('pointerdown', (ev) => startDrag(ev, 'col-right'));
    }

    if (!document.getElementById(PANEL_ID)) {
        const panel = h('aside', { id: PANEL_ID, 'aria-label': 'Duet side panel' });
        const resize = h('div', {
            class: 'duet-sp-resize',
            role: 'separator',
            'aria-orientation': 'vertical',
            'aria-label': 'Drag to resize the side panel',
            title: 'Drag to resize the side panel',
        });
        const head = h('header', { class: 'duet-sp-head' });
        head.append(
            h('i', { class: 'fa-solid fa-masks-theater', 'aria-hidden': 'true' }),
            h('b', { text: 'Duet' }),
            h('span', { class: 'duet-sp-spacer' }),
            iconButton('duet-sp-collapse', 'fa-chevron-up', 'Collapse the side panel'),
            iconButton('duet-sp-close', 'fa-xmark', 'Hide side panel'),
        );
        const rail = h('div', { id: 'duet-rail-body' });
        panel.append(resize, head, rail);
        document.body.append(panel);
        resize.addEventListener('pointerdown', (ev) => startDrag(ev, 'panel'));
        document.getElementById('duet-sp-collapse').addEventListener('click', () => {
            stageMode.setActive(!panel.classList.contains('duet-stage-collapsed'));
        });
        document.getElementById('duet-sp-close').addEventListener('click', () => {
            if (settings().panelOpen) toggleSidePanel();
        });
    }

    if (!document.getElementById('duet-stow-tab')) {
        const tab = h('div', { id: 'duet-stow-tab' });
        const bring = h('button', { type: 'button', id: 'duet-stow-bring', 'aria-label': 'Bring the chat back' });
        bring.append(h('span', { id: 'duet-stow-name', text: 'Chat' }));
        const menuBtn = iconButton(null, 'fa-masks-theater', 'Side panel', { 'data-duet-menu': '1' });
        tab.append(bring, menuBtn);
        document.body.append(tab);
        bring.addEventListener('click', () => setStowed(false));
        menuBtn.addEventListener('click', () => toggleMenu(menuBtn));
    }

    if (!document.getElementById('duet-menu')) {
        document.body.append(h('div', { id: 'duet-menu', role: 'menu', hidden: true }));
    }
    if (!document.getElementById('duet-tip')) {
        document.body.append(h('div', { id: 'duet-tip', role: 'tooltip', hidden: true }));
    }
    mountSettings();
}

function mountSettings() {
    if (document.getElementById('st-duet-stage-settings')) return;
    const host = document.getElementById('extensions_settings2') || document.getElementById('extensions_settings');
    if (!host) return;
    const box = h('details', { id: 'st-duet-stage-settings', class: 'duet-settings' });
    const summary = h('summary', { text: 'Duet Stage' });
    const dock = h('label', { class: 'duet-set-row', text: 'Dock ' });
    const dockSel = h('select', { id: 'duet-set-dock' });
    for (const [value, label] of [
        ['middle', 'Middle (1-on-1)'],
        ['left', 'Left (duet)'],
        ['right', 'Right (duet)'],
    ]) {
        dockSel.append(h('option', { value, text: label }));
    }
    dock.append(dockSel);
    const width = h('label', { class: 'duet-set-row', text: 'Width ' });
    width.append(h('input', { id: 'duet-set-width', type: 'range', min: '320', max: '1200', step: '10' }));
    const scale = h('label', { class: 'duet-set-row', text: 'Message text ' });
    scale.append(h('input', { id: 'duet-set-scale', type: 'range', min: '0.7', max: '1.75', step: '0.05' }));
    const stowed = h('label', { class: 'duet-set-row', text: 'Stowed ' });
    stowed.append(h('input', { id: 'duet-set-stowed', type: 'checkbox' }));
    const panel = h('label', { class: 'duet-set-row', text: 'Side panel ' });
    panel.append(h('input', { id: 'duet-set-panel', type: 'checkbox' }));
    box.append(summary, dock, width, scale, stowed, panel);
    host.append(box);

    dockSel.addEventListener('change', () => {
        settings().dock = dockSel.value;
        saveSettings();
        applyLayout();
    });
    width.addEventListener('input', () => {
        settings().width = Number(width.querySelector('input').value);
        saveSettings();
        applyLayout();
    });
    scale.addEventListener('input', () => {
        settings().textScale = Number(scale.querySelector('input').value);
        saveSettings();
        applyLayout();
    });
    stowed.querySelector('input').addEventListener('change', () => setStowed(stowed.querySelector('input').checked));
    panel.querySelector('input').addEventListener('change', () => {
        settings().panelOpen = panel.querySelector('input').checked;
        saveSettings();
        applyLayout();
    });
}

function syncSettingsForm() {
    const s = settings();
    const dock = document.getElementById('duet-set-dock');
    const width = document.getElementById('duet-set-width');
    const scale = document.getElementById('duet-set-scale');
    const stowed = document.getElementById('duet-set-stowed');
    const panel = document.getElementById('duet-set-panel');
    if (dock) dock.value = s.dock;
    if (width) width.value = String(s.width);
    if (scale) scale.value = String(s.textScale);
    if (stowed) stowed.checked = s.stowed;
    if (panel) panel.checked = s.panelOpen;
}

/* ---------------- layout ---------------- */

let wasStowed = false;

function columnWidth(s) {
    const room = Math.max(200, window.innerWidth - (s.panelOpen ? s.panelWidth : 0) - 24);
    return Math.max(200, Math.min(s.width, room));
}

function applyLayout() {
    const s = settings();
    const root = document.documentElement;
    const body = document.body;
    root.style.setProperty('--duet-col-w', `${columnWidth(s)}px`);
    root.style.setProperty('--duet-text-scale', String(s.textScale));
    root.style.setProperty('--duet-panel-w', `${s.panelOpen ? s.panelWidth : 0}px`);
    body.classList.add('st-duet-on');
    body.classList.toggle('duet-stowed', s.stowed);
    body.classList.toggle('duet-panel-open', s.panelOpen);
    body.dataset.duetDock = s.dock;

    const panel = document.getElementById(PANEL_ID);
    if (panel) panel.classList.toggle('open', s.panelOpen);
    document.querySelectorAll('[data-duet-dock-btn]').forEach((btn) => {
        btn.setAttribute('aria-pressed', String(btn.getAttribute('data-duet-dock-btn') === s.dock));
    });
    const collapse = document.getElementById('duet-sp-collapse');
    if (collapse && panel) {
        const collapsed = panel.classList.contains('duet-stage-collapsed');
        const icon = collapse.querySelector('i');
        if (icon) icon.className = collapsed ? 'fa-solid fa-chevron-down' : 'fa-solid fa-chevron-up';
        collapse.setAttribute('data-duet-tip', collapsed ? 'Expand the side panel' : 'Collapse the side panel');
    }
    if (wasStowed && !s.stowed) {
        requestAnimationFrame(() => {
            const chat = document.getElementById('chat');
            if (chat) chat.scrollTop = chat.scrollHeight;
        });
    }
    wasStowed = s.stowed;
    syncSettingsForm();
}

function setDock(dock) {
    settings().dock = dock === 'left' || dock === 'right' ? dock : 'middle';
    saveSettings();
    applyLayout();
}

function setStowed(on) {
    settings().stowed = !!on;
    saveSettings();
    applyLayout();
}

function onBarClick(ev) {
    const dockBtn = ev.target.closest('[data-duet-dock-btn]');
    if (dockBtn) {
        setDock(dockBtn.getAttribute('data-duet-dock-btn'));
        if (settings().stowed) setStowed(false);
        return;
    }
    if (ev.target.closest('#duet-stow-btn')) {
        setStowed(true);
        return;
    }
    const menuBtn = ev.target.closest('[data-duet-menu]');
    if (menuBtn) toggleMenu(menuBtn);
}

function startDrag(ev, which) {
    if (ev.button != null && ev.button !== 0) return;
    ev.preventDefault();
    ev.stopPropagation();
    document.body.classList.add('duet-dragging');
    const s = settings();
    const startX = ev.clientX;
    const startW = which === 'panel' ? s.panelWidth : s.width;
    const move = (e) => {
        const dx = e.clientX - startX;
        if (which === 'panel') {
            s.panelWidth = clamp(startW - dx, 240, Math.min(720, window.innerWidth - 160));
        } else {
            const room = Math.max(320, window.innerWidth - (s.panelOpen ? s.panelWidth : 0) - 24);
            const next = which === 'col-right' ? startW + dx : startW - dx;
            s.width = clamp(next, 320, Math.min(1200, room));
        }
        applyLayout();
    };
    const up = () => {
        document.body.classList.remove('duet-dragging');
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        saveSettings();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
}

function onWheel(ev) {
    if (!ev.ctrlKey) return;
    const sheld = document.getElementById('sheld');
    if (!sheld || !sheld.contains(ev.target)) return;
    ev.preventDefault();
    const s = settings();
    const dir = ev.deltaY < 0 ? 1 : -1;
    s.textScale = clamp(Math.round((s.textScale + dir * 0.05) * 100) / 100, 0.7, 1.75);
    saveSettings();
    applyLayout();
}

/* ---------------- tooltips (above the pointer) ---------------- */

const savedTitle = new WeakMap();
let tipHost = null;

function duetSurface(node) {
    return !!(node && node.closest && node.closest('#sheld, #duet-side-panel, #duet-stow-tab, #duet-menu, #st-duet-stage-settings, #stcc-modal'));
}

function findTipHost(target) {
    if (!target || !target.closest) return null;
    if (target.closest('textarea, input, select')) return null;
    const host = target.closest('[data-duet-tip], [title]');
    if (!host || !duetSurface(host)) return null;
    return host;
}

function placeTip(x, y) {
    const tip = document.getElementById('duet-tip');
    if (!tip || tip.hidden) return;
    tip.style.left = '0px';
    tip.style.top = '0px';
    const rect = tip.getBoundingClientRect();
    const left = clamp(x - rect.width / 2, 8, Math.max(8, window.innerWidth - rect.width - 8));
    const top = Math.max(4, y - rect.height - 14);
    tip.style.left = `${left}px`;
    tip.style.top = `${top}px`;
}

function showTip(host, ev) {
    const tip = document.getElementById('duet-tip');
    if (!tip) return;
    const text = (host.getAttribute('data-duet-tip') || host.getAttribute('title') || savedTitle.get(host) || '').trim();
    if (!text) return;
    if (host.hasAttribute('title')) {
        savedTitle.set(host, host.getAttribute('title'));
        host.removeAttribute('title');
    }
    tipHost = host;
    tip.textContent = text;
    tip.hidden = false;
    placeTip(ev.clientX, ev.clientY);
}

function hideTip() {
    const tip = document.getElementById('duet-tip');
    if (tip) {
        tip.hidden = true;
        tip.textContent = '';
    }
    if (tipHost && savedTitle.has(tipHost) && !tipHost.hasAttribute('title')) {
        tipHost.setAttribute('title', savedTitle.get(tipHost));
    }
    tipHost = null;
}

function bindTips() {
    document.addEventListener('pointerover', (ev) => {
        const host = findTipHost(ev.target);
        if (host) showTip(host, ev);
    });
    document.addEventListener('pointermove', (ev) => {
        if (tipHost) placeTip(ev.clientX, ev.clientY);
    });
    document.addEventListener('pointerout', (ev) => {
        if (!tipHost) return;
        const next = ev.relatedTarget;
        if (next && tipHost.contains(next)) return;
        hideTip();
    });
    document.addEventListener('pointerdown', () => hideTip());
    document.addEventListener('scroll', () => hideTip(), true);
}

/* ---------------- side panel api ---------------- */

const panels = [];

function panelEl() {
    return document.getElementById(PANEL_ID);
}

function toggleSidePanel() {
    const s = settings();
    s.panelOpen = !s.panelOpen;
    saveSettings();
    applyLayout();
    closeMenu();
    return s.panelOpen;
}

const stageMode = {
    setActive(active) {
        const el = panelEl();
        if (!el) return;
        const on = !!active;
        el.classList.toggle('duet-stage-collapsed', on);
        if (on && !settings().panelOpen) {
            settings().panelOpen = true;
            saveSettings();
        }
        applyLayout();
    },
};

function registerPanel(name, onClick, label) {
    if (!name || typeof onClick !== 'function') return false;
    if (panels.some((p) => p.name === name)) return true;
    panels.push({ name: String(name), onClick, label: String(label || name) });
    renderMenu();
    return true;
}

function listPanels() {
    return panels.map((p) => p.name);
}

function closeMenu() {
    const menu = document.getElementById('duet-menu');
    if (menu) menu.hidden = true;
}

function renderMenu() {
    const menu = document.getElementById('duet-menu');
    if (!menu) return;
    menu.replaceChildren();
    const open = !!settings().panelOpen;
    const show = h('button', { type: 'button', role: 'menuitem', text: open ? 'Hide Side Panel' : 'Show Side Panel' });
    show.addEventListener('click', () => toggleSidePanel());
    menu.append(show);
    for (const entry of panels) {
        const btn = h('button', { type: 'button', role: 'menuitem', text: entry.label });
        btn.addEventListener('click', () => {
            closeMenu();
            try {
                entry.onClick();
            } catch (e) {
                console.warn(`[${MODULE}] panel failed`, entry.name, e);
            }
        });
        menu.append(btn);
    }
}

function toggleMenu(anchor) {
    const menu = document.getElementById('duet-menu');
    if (!menu || !anchor) return;
    if (!menu.hidden) {
        closeMenu();
        return;
    }
    renderMenu();
    menu.hidden = false;
    const rect = anchor.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();
    const left = clamp(rect.left, 8, Math.max(8, window.innerWidth - menuRect.width - 8));
    let top = rect.top - menuRect.height - 8;
    if (top < 8) top = Math.min(window.innerHeight - menuRect.height - 8, rect.bottom + 8);
    menu.style.left = `${left}px`;
    menu.style.top = `${Math.max(8, top)}px`;
}

function bindMenuDismiss() {
    document.addEventListener('pointerdown', (ev) => {
        const menu = document.getElementById('duet-menu');
        if (!menu || menu.hidden) return;
        if (menu.contains(ev.target)) return;
        if (ev.target.closest && ev.target.closest('[data-duet-menu]')) return;
        closeMenu();
    });
    document.addEventListener('keydown', (ev) => {
        if (ev.key === 'Escape') closeMenu();
    });
}

/* ---------------- sprites (existing files only) ---------------- */

let spriteGen = 0;
let spriteTimer = 0;
const boundEvents = new Set();

function fileStem(p) {
    const file = String(p || '')
        .split('?')[0]
        .split('/')
        .pop();
    return String(file || '')
        .replace(/\.[^.]+$/, '')
        .toLowerCase();
}

function bestOf(list, label) {
    const want = String(label || '').toLowerCase();
    if (!want || !Array.isArray(list)) return null;
    const matches = list.filter((s) => String(s?.label || '').toLowerCase() === want && s.path);
    if (!matches.length) return null;
    return matches.find((s) => fileStem(s.path) === want) || matches[0];
}

function pathOf(src) {
    try {
        return decodeURIComponent(new URL(src, location.origin).pathname);
    } catch {
        return '';
    }
}

function belongsToFolder(src, folder) {
    if (!src || !folder) return false;
    const path = pathOf(src).toLowerCase();
    const needle = `/characters/${String(folder).toLowerCase()}/`;
    return path.includes(needle);
}

function avatarUrl(avatar) {
    const file = String(avatar || '')
        .replace(/^.*[\\/]/, '')
        .trim();
    return file ? `/characters/${encodeURIComponent(file)}` : '';
}

function spriteFolders(ch) {
    const stem = String(ch?.avatar || '')
        .replace(/^.*[\\/]/, '')
        .replace(/\.[^.]+$/, '')
        .trim();
    const name = String(ch?.name || '').trim();
    const folders = [];
    const overrides = ctx().extensionSettings?.expressionOverrides;
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
    if (!Array.isArray(data)) return [];
    return data.filter((s) => s && s.path && s.label);
}

async function loadSprites(ch) {
    const folders = spriteFolders(ch);
    for (const folder of folders) {
        try {
            const list = await fetchSprites(folder);
            if (list.length) return { folder, list };
        } catch (e) {
            console.warn(`[${MODULE}] sprites fetch failed`, folder, e);
        }
    }
    return { folder: folders[0] || '', list: [] };
}

function currentCharacter() {
    let c;
    try {
        c = ctx();
    } catch {
        return null;
    }
    const chars = Array.isArray(c.characters) ? c.characters : [];
    if (!chars.length) return null;
    if (c.groupId) {
        const chat = Array.isArray(c.chat) ? c.chat : [];
        for (let i = chat.length - 1; i >= 0; i--) {
            const message = chat[i];
            if (!message || message.is_user || message.is_system) continue;
            const raw = message.original_avatar || '';
            const byAvatar = raw && chars.find((ch) => ch && (ch.avatar === raw || String(raw).includes(ch.avatar)));
            if (byAvatar) return byAvatar;
            const byName = message.name && chars.find((ch) => ch && ch.name === message.name);
            if (byName) return byName;
        }
        const group = Array.isArray(c.groups) ? c.groups.find((g) => g && g.id === c.groupId) : null;
        const first = group?.members?.[0];
        return (first && chars.find((ch) => ch && ch.avatar === first)) || null;
    }
    if (c.characterId == null || c.characterId === '') return null;
    return chars[c.characterId] || null;
}

function currentExpression() {
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

function clearSprite(img) {
    img.dataset.want = '';
    img.dataset.avatar = '';
    img.dataset.fallback = 'avatar';
    img.hidden = true;
    img.removeAttribute('src');
    img.alt = '';
}

function showSprite(img, url, alt, avatar) {
    if (!url) {
        clearSprite(img);
        return;
    }
    img.alt = alt || '';
    img.dataset.avatar = avatar || '';
    if (img.dataset.want === url && img.getAttribute('src') && !img.hidden) return;
    img.dataset.want = url;
    img.dataset.fallback = '';
    img.hidden = false;
    img.src = url;
}

function onSpriteError() {
    const img = document.getElementById('duet-sprite');
    if (!img) return;
    const avatar = img.dataset.avatar || '';
    if (img.dataset.fallback !== 'avatar' && avatar && avatar !== img.dataset.want) {
        img.dataset.fallback = 'avatar';
        img.dataset.want = avatar;
        img.src = avatar;
        return;
    }
    img.hidden = true;
}

function watchExpression() {
    const holder = document.getElementById('expression-holder');
    if (!holder || holder.dataset.duetWatch === '1') return;
    holder.dataset.duetWatch = '1';
    const obs = new MutationObserver(() => scheduleSprite());
    obs.observe(holder, { attributes: true, subtree: true, attributeFilter: ['src', 'data-expression'] });
}

function scheduleSprite() {
    clearTimeout(spriteTimer);
    spriteTimer = setTimeout(() => {
        applySprite().catch((e) => console.warn(`[${MODULE}] sprite failed`, e));
    }, 60);
}

async function applySprite() {
    const gen = ++spriteGen;
    watchExpression();
    const ch = currentCharacter();
    const tabName = document.getElementById('duet-stow-name');
    if (tabName) tabName.textContent = ch?.name ? `Chat · ${ch.name}` : 'Chat';
    const img = document.getElementById('duet-sprite');
    if (!img) return;
    if (!ch) {
        clearSprite(img);
        return;
    }
    const pack = await loadSprites(ch);
    if (gen !== spriteGen) return;
    const expression = currentExpression();
    let url = '';
    if (belongsToFolder(expression.src, pack.folder)) url = expression.src;
    if (!url && expression.label) url = bestOf(pack.list, expression.label)?.path || '';
    if (!url) {
        for (const label of NEUTRAL_LABELS) {
            const hit = bestOf(pack.list, label);
            if (hit) {
                url = hit.path;
                break;
            }
        }
    }
    const avatar = avatarUrl(ch.avatar);
    if (!url) {
        showSprite(img, avatar, ch.name || '', '');
        return;
    }
    showSprite(img, url, ch.name || '', url === avatar ? '' : avatar);
}

function bindSpriteEvents() {
    let c;
    try {
        c = ctx();
    } catch {
        return;
    }
    const es = c.eventSource;
    const types = c.event_types || c.eventTypes || {};
    if (!es || typeof es.on !== 'function') return;
    for (const key of SPRITE_EVENTS) {
        const name = types[key];
        if (!name || boundEvents.has(name)) continue;
        boundEvents.add(name);
        es.on(name, () => scheduleSprite());
    }
}

/* ---------------- boot ---------------- */

let booted = false;
let bootTries = 0;

function publishApi() {
    window.DuetStage = {
        version: VERSION,
        toggleSidePanel,
        stageMode,
        registerPanel,
        listPanels,
        refresh() {
            scheduleSprite();
            applyLayout();
        },
    };
}

function boot() {
    if (booted) return;
    if (!window.SillyTavern?.getContext || !document.getElementById('sheld')) {
        if (bootTries++ < 150) setTimeout(boot, 200);
        return;
    }
    let c;
    try {
        c = ctx();
    } catch {
        c = null;
    }
    if (!c?.extensionSettings) {
        if (bootTries++ < 150) setTimeout(boot, 200);
        return;
    }
    booted = true;
    settings();
    saveSettings();
    mount();
    publishApi();
    applyLayout();
    bindTips();
    bindMenuDismiss();
    document.addEventListener('wheel', onWheel, { passive: false, capture: true });
    window.addEventListener('resize', () => applyLayout());
    bindSpriteEvents();
    scheduleSprite();
    let watchTries = 0;
    const watchTimer = setInterval(() => {
        watchExpression();
        bindSpriteEvents();
        if (document.getElementById('expression-holder') || ++watchTries > 20) clearInterval(watchTimer);
    }, 1000);
    console.info(`[${MODULE}] ${VERSION}`);
}

jQuery(() => boot());
