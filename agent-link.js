/**
 * Ask Agent quick-link helper for Duet Stage.
 *
 * Builds a concise, secret-free context summary from the active SillyTavern
 * character, mood/look, recent chat lines, and an optional user note, copies it
 * to the clipboard, and opens the configured Cursor agent URL in a new tab.
 */

export const DEFAULT_AGENT_URL = 'https://cursor.com/agents/bc-e5571c28-4223-412e-beae-7e7799322c5e';

const MOOD_WORDS = [
    'neutral', 'happy', 'flirty', 'smug', 'shy', 'flustered',
    'sad', 'angry', 'surprised', 'curious', 'thinking', 'tired',
];

const MOOD_ALIASES = {
    idle: 'neutral', calm: 'neutral', serious: 'neutral', joy: 'happy', joyful: 'happy',
    excited: 'happy', playful: 'smug', teasing: 'smug', love: 'flirty', loving: 'flirty',
    embarrassed: 'flustered', blushing: 'flustered', nervous: 'shy', hurt: 'sad',
    anger: 'angry', annoyed: 'angry', surprise: 'surprised', confused: 'curious',
    thoughtful: 'thinking', sleepy: 'tired',
};

function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
    }[ch]));
}

function clamp(n, min, max) {
    return Math.min(max, Math.max(min, n));
}

function toast(kind, text) {
    try {
        const fn = window.toastr && window.toastr[kind];
        if (typeof fn === 'function') fn.call(window.toastr, text, 'Duet Stage');
    } catch {
        /* ignore missing toastr */
    }
}

export function isValidAgentUrl(raw) {
    const text = String(raw ?? '').trim();
    if (!text) return false;
    const candidate = /^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`;
    try {
        const parsed = new URL(candidate);
        if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
        const host = parsed.hostname || '';
        return host === 'localhost' || host.includes('.');
    } catch {
        return false;
    }
}

export function normalizeAgentUrl(raw, fallback = DEFAULT_AGENT_URL) {
    const text = String(raw ?? '').trim();
    if (!text) return fallback;
    const candidate = /^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`;
    try {
        const parsed = new URL(candidate);
        if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return fallback;
        const host = parsed.hostname || '';
        if (host !== 'localhost' && !host.includes('.')) return fallback;
        return parsed.toString();
    } catch {
        return fallback;
    }
}

export function ensureAgentSettings(settings) {
    if (!settings || typeof settings !== 'object') {
        return { enabled: true, url: DEFAULT_AGENT_URL };
    }
    if (!settings.agentLink || typeof settings.agentLink !== 'object' || Array.isArray(settings.agentLink)) {
        settings.agentLink = {};
    }
    const cfg = settings.agentLink;
    if (typeof cfg.enabled !== 'boolean') cfg.enabled = true;
    cfg.url = normalizeAgentUrl(cfg.url, DEFAULT_AGENT_URL);
    return cfg;
}

export function agentLinkEnabled(settings) {
    if (!settings || typeof settings !== 'object') return true;
    if (settings.agentLink && typeof settings.agentLink.enabled === 'boolean') {
        return settings.agentLink.enabled;
    }
    return true;
}

export function agentLinkUrl(settings) {
    return normalizeAgentUrl(settings?.agentLink?.url, DEFAULT_AGENT_URL);
}

export function setAgentLinkUrl(settings, rawUrl) {
    const cfg = ensureAgentSettings(settings);
    const trimmed = String(rawUrl ?? '').trim();
    const valid = !trimmed || isValidAgentUrl(trimmed);
    cfg.url = normalizeAgentUrl(trimmed, DEFAULT_AGENT_URL);
    return { url: cfg.url, valid };
}

export function resetAgentLinkUrl(settings) {
    const cfg = ensureAgentSettings(settings);
    cfg.url = DEFAULT_AGENT_URL;
    return cfg.url;
}

function messageText(message) {
    if (!message) return '';
    if (Array.isArray(message.swipes) && typeof message.swipe_id === 'number' && typeof message.swipes[message.swipe_id] === 'string') {
        return message.swipes[message.swipe_id];
    }
    return String(message.mes || '');
}

function moodTagIn(text) {
    const match = String(text || '').match(/\[([a-z][a-z -]{1,24})\]/i);
    if (!match) return '';
    const raw = match[1].toLowerCase().trim();
    if (MOOD_WORDS.includes(raw)) return raw;
    return MOOD_ALIASES[raw] || '';
}

function resolveCharacter(ctx) {
    const chars = Array.isArray(ctx?.characters) ? ctx.characters : [];
    if (ctx?.groupId) {
        const chat = Array.isArray(ctx.chat) ? ctx.chat : [];
        for (let i = chat.length - 1; i >= 0; i--) {
            const msg = chat[i];
            if (!msg || msg.is_user || msg.is_system) continue;
            const raw = msg.original_avatar || '';
            const byAvatar = raw && chars.find((ch) => ch && (ch.avatar === raw || String(raw).includes(ch.avatar)));
            if (byAvatar) return byAvatar;
            const byName = msg.name && chars.find((ch) => ch && ch.name === msg.name);
            if (byName) return byName;
        }
        const group = Array.isArray(ctx.groups) ? ctx.groups.find((g) => g && g.id === ctx.groupId) : null;
        const first = group?.members?.[0];
        return (first && chars.find((ch) => ch && ch.avatar === first)) || null;
    }
    const id = ctx?.characterId;
    if (id == null || id === '' || !chars[Number(id)]) return null;
    return chars[Number(id)] || null;
}

function resolveUserName(ctx, settings) {
    const map = ctx?.powerUserSettings?.personas;
    const key = settings?.personaKey;
    const real = (name) => {
        const trimmed = String(name || '').trim();
        return trimmed && !/^\[.*\]$/.test(trimmed) ? trimmed : '';
    };
    const fromKey = key && map && typeof map === 'object' ? real(map[key]) : '';
    return fromKey || real(ctx?.name1) || 'You';
}

function spriteFileFromSrc(src) {
    const raw = String(src || '').trim();
    if (!raw || /\/thumbnail(?:\?|$)/i.test(raw)) return '';
    try {
        const path = raw.split('?')[0].split('#')[0];
        const file = decodeURIComponent(path.split('/').pop() || '').trim();
        return file || '';
    } catch {
        return '';
    }
}

function truncateLine(text, maxLen) {
    const flat = String(text || '').replace(/\s+/g, ' ').trim();
    if (!flat) return '';
    if (flat.length <= maxLen) return flat;
    return `${flat.slice(0, Math.max(1, maxLen - 1)).trimEnd()}…`;
}

export function extractAgentContext(ctx, options = {}) {
    const settings = options.settings || {};
    const maxLines = Number.isFinite(Number(options.maxLines)) && Number(options.maxLines) > 0 ? Math.floor(Number(options.maxLines)) : 6;
    const maxLineLength = Number.isFinite(Number(options.maxLineLength)) && Number(options.maxLineLength) > 20 ? Math.floor(Number(options.maxLineLength)) : 280;

    const ch = resolveCharacter(ctx);
    const characterName = String(ch?.name || (ctx?.groupId ? (ctx?.name2 || 'Group') : (ctx?.name2 || ''))).trim();
    const userName = resolveUserName(ctx, settings);

    const chat = Array.isArray(ctx?.chat) ? ctx.chat : [];
    const lastThem = [...chat].reverse().find((m) => m && !m.is_user && !m.is_system);

    const sceneMood = String(ctx?.chatMetadata?.duet_scene?.mood || '').trim();
    const cardEmo = ch?.avatar ? String(ctx?.extensionSettings?.['st-card-creator']?.hearts?.[ch.avatar]?.emo || '').trim() : '';
    const lineMood = moodTagIn(messageText(lastThem));
    const domExprLabel = String(options.domExpression?.label || '').trim().toLowerCase();
    const mood = sceneMood || cardEmo || lineMood || domExprLabel || '';

    const features = settings?.features && typeof settings.features === 'object' ? settings.features : {};
    const lookParts = [];
    if (features.stage === false) {
        lookParts.push('SillyTavern chat');
    } else if (features.clean === true) {
        lookParts.push('Clean stage');
    } else if (features.habit !== false && (ch || ctx?.groupId)) {
        lookParts.push('Talk layout');
    } else {
        lookParts.push('Duet Stage');
    }
    if (settings?.solo && features.solo !== false && features.clean !== true) lookParts.push('Solo');
    if (settings?.calm) lookParts.push('Calm');
    const look = lookParts.join(', ');

    const spriteFile = spriteFileFromSrc(options.domSpriteSrc) || spriteFileFromSrc(options.domExpression?.src);
    const scene = String(ctx?.chatMetadata?.duet_scene?.scene || '').trim();
    const chatId = String(ctx?.chatId || '').trim();

    const spoken = [];
    for (const msg of chat) {
        if (!msg || msg.is_system) continue;
        const text = truncateLine(messageText(msg), maxLineLength);
        if (!text) continue;
        const speaker = String(msg.name || (msg.is_user ? userName : (characterName || 'Character'))).trim();
        spoken.push({ speaker, isUser: !!msg.is_user, text });
    }
    const recentLines = spoken.slice(-maxLines);

    return {
        characterName,
        userName,
        mood,
        look,
        spriteFile,
        chatId,
        scene,
        recentLines,
        note: String(options.note || '').trim(),
    };
}

export function formatAgentContext(context) {
    const c = context || {};
    const lines = ['[Duet Stage Context]'];
    lines.push(`Character: ${c.characterName || '(none selected)'}`);
    const lookParts = [c.mood, c.look, c.spriteFile].filter(Boolean);
    if (lookParts.length) {
        lines.push(`Look / Mood: ${lookParts.join(' · ')}`);
    }
    if (c.chatId) lines.push(`Chat: ${c.chatId}`);
    if (c.scene) lines.push(`Scene: ${c.scene}`);
    if (Array.isArray(c.recentLines) && c.recentLines.length) {
        lines.push('', 'Recent chat:');
        for (const item of c.recentLines) {
            lines.push(`- ${item.speaker}: ${item.text}`);
        }
    }
    if (c.note) {
        lines.push('', 'Request:', c.note);
    }
    return lines.join('\n');
}

export async function copyTextToClipboard(
    text,
    doc = typeof document !== 'undefined' ? document : null,
    nav = typeof navigator !== 'undefined' ? navigator : null,
) {
    const value = String(text ?? '');
    if (nav?.clipboard && typeof nav.clipboard.writeText === 'function') {
        try {
            await nav.clipboard.writeText(value);
            return true;
        } catch {
            /* fall back to execCommand below */
        }
    }
    if (doc?.body && typeof doc.createElement === 'function') {
        const ta = doc.createElement('textarea');
        ta.value = value;
        ta.setAttribute?.('readonly', '');
        if (ta.style) {
            ta.style.position = 'fixed';
            ta.style.left = '-9999px';
            ta.style.top = '0';
        }
        doc.body.append(ta);
        try {
            ta.select?.();
            ta.setSelectionRange?.(0, value.length);
            return Boolean(doc.execCommand?.('copy'));
        } catch {
            return false;
        } finally {
            ta.remove?.();
        }
    }
    return false;
}

export async function copyContextAndMaybeOpen({
    contextText,
    url,
    openAfter = false,
    copyFn = copyTextToClipboard,
    openFn = (target, name, features) => (typeof window !== 'undefined' ? window.open(target, name, features) : null),
} = {}) {
    const text = String(contextText ?? '');
    let copied = false;
    try {
        copied = Boolean(await copyFn(text));
    } catch {
        copied = false;
    }

    const targetUrl = normalizeAgentUrl(url, DEFAULT_AGENT_URL);
    let opened = false;
    if (openAfter && typeof openFn === 'function') {
        try {
            openFn(targetUrl, '_blank', 'noopener,noreferrer');
            opened = true;
        } catch {
            opened = false;
        }
    }

    return { copied, opened, url: targetUrl, text };
}

export function agentSettingsHTML(settings) {
    const cfg = ensureAgentSettings(settings);
    return `<div class="duet-agent-settings">
  <label class="check"><input id="duet-set-agent-enabled" type="checkbox" ${cfg.enabled ? 'checked' : ''}> Ask Agent quick-link</label>
  <label>Agent URL
    <div class="duet-agent-url-row">
      <input id="duet-set-agent-url" type="url" autocomplete="off" spellcheck="false" value="${esc(cfg.url)}" placeholder="${esc(DEFAULT_AGENT_URL)}">
      <button type="button" id="duet-set-agent-reset" data-act="agent-reset-url">Reset</button>
    </div>
  </label>
  <p class="dv-note">Copies the active character, look/mood, recent chat lines, and your note, then opens your Cursor agent.</p>
</div>`;
}

export function syncAgentExtensionSettings(settings) {
    if (typeof document === 'undefined') return;
    const cfg = ensureAgentSettings(settings);
    const enabledEl = document.getElementById('duet-ext-agent-enabled');
    const urlEl = document.getElementById('duet-ext-agent-url');
    if (enabledEl) enabledEl.checked = cfg.enabled;
    if (urlEl && document.activeElement !== urlEl) urlEl.value = cfg.url;
}

export function mountAgentExtensionSettings(box, getSettings, saveSettings, onChange) {
    if (typeof document === 'undefined' || !box) return;
    if (document.getElementById('duet-ext-agent-url')) return;

    const wrap = document.createElement('div');
    wrap.className = 'duet-agent-ext-settings';

    const toggleLabel = document.createElement('label');
    toggleLabel.className = 'duet-set-row';
    const enabledInput = document.createElement('input');
    enabledInput.id = 'duet-ext-agent-enabled';
    enabledInput.type = 'checkbox';
    const toggleText = document.createElement('span');
    toggleText.textContent = 'Ask Agent quick-link';
    toggleLabel.append(enabledInput, toggleText);

    const urlWrap = document.createElement('div');
    urlWrap.className = 'duet-agent-ext-url';
    const urlLabel = document.createElement('label');
    urlLabel.setAttribute('for', 'duet-ext-agent-url');
    urlLabel.textContent = 'Agent URL';
    const urlRow = document.createElement('div');
    urlRow.className = 'duet-agent-url-row';
    const urlInput = document.createElement('input');
    urlInput.id = 'duet-ext-agent-url';
    urlInput.type = 'url';
    urlInput.autocomplete = 'off';
    urlInput.spellcheck = false;
    urlInput.placeholder = DEFAULT_AGENT_URL;
    const resetBtn = document.createElement('button');
    resetBtn.type = 'button';
    resetBtn.id = 'duet-ext-agent-reset';
    resetBtn.textContent = 'Reset';
    urlRow.append(urlInput, resetBtn);
    urlWrap.append(urlLabel, urlRow);

    wrap.append(toggleLabel, urlWrap);
    box.append(wrap);

    enabledInput.addEventListener('change', () => {
        const cfg = ensureAgentSettings(getSettings());
        cfg.enabled = !!enabledInput.checked;
        saveSettings();
        onChange?.();
    });

    urlInput.addEventListener('change', () => {
        const res = setAgentLinkUrl(getSettings(), urlInput.value);
        urlInput.value = res.url;
        saveSettings();
        onChange?.();
        if (!res.valid) toast('info', 'Invalid Agent URL; restored default.');
    });

    resetBtn.addEventListener('click', () => {
        const url = resetAgentLinkUrl(getSettings());
        urlInput.value = url;
        saveSettings();
        onChange?.();
        toast('info', 'Agent URL reset to default.');
    });

    syncAgentExtensionSettings(getSettings());
}

function readDomExpression() {
    if (typeof document === 'undefined') return null;
    const holder = document.getElementById('expression-holder');
    if (!holder) return null;
    const imgs = [...holder.querySelectorAll('img.expression')].filter((img) => img.getAttribute('src'));
    const img = imgs[imgs.length - 1];
    if (!img) return null;
    return {
        src: img.getAttribute('src') || '',
        label: (img.getAttribute('data-expression') || '').toLowerCase(),
    };
}

function readDomSpriteSrc() {
    if (typeof document === 'undefined') return '';
    const vnImg = document.querySelector('#duet-fig-r img');
    if (vnImg?.getAttribute('src')) return vnImg.getAttribute('src') || '';
    const legacy = document.getElementById('duet-sprite');
    if (legacy && !legacy.hidden && legacy.getAttribute('src')) return legacy.getAttribute('src') || '';
    return '';
}

export function bootAgentLink(hooks = {}) {
    if (typeof document === 'undefined') return null;

    const getSettings = typeof hooks.settings === 'function' ? hooks.settings : () => ({});
    const getCtx = typeof hooks.getCtx === 'function' ? hooks.getCtx : () => (typeof SillyTavern !== 'undefined' ? SillyTavern.getContext() : {});
    let activeAnchor = null;

    function buildContext(note) {
        let ctx = {};
        try {
            ctx = getCtx() || {};
        } catch {
            ctx = {};
        }
        return extractAgentContext(ctx, {
            settings: getSettings(),
            note,
            domExpression: readDomExpression(),
            domSpriteSrc: readDomSpriteSrc(),
        });
    }

    function updateSummary() {
        const summaryEl = document.getElementById('duet-agent-ctx');
        if (!summaryEl) return;
        const c = buildContext('');
        const bits = [c.characterName || 'No character'];
        if (c.mood) bits.push(c.mood);
        bits.push(`${c.recentLines.length} line${c.recentLines.length === 1 ? '' : 's'}`);
        summaryEl.textContent = bits.join(' · ');
    }

    function setStatus(text, isWarn = false) {
        const el = document.getElementById('duet-agent-status');
        if (!el) return;
        el.textContent = text || '';
        el.classList.toggle('is-warn', !!isWarn);
        el.hidden = !text;
    }

    function placePopover(anchor) {
        const pop = document.getElementById('duet-agent-pop');
        if (!pop || pop.hidden) return;
        pop.style.left = '8px';
        pop.style.top = '8px';
        const popRect = pop.getBoundingClientRect();
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        let left = Math.round((vw - popRect.width) / 2);
        let top = Math.round((vh - popRect.height) / 2);
        if (anchor && typeof anchor.getBoundingClientRect === 'function') {
            const rect = anchor.getBoundingClientRect();
            if (rect.width > 0 || rect.height > 0) {
                left = clamp(Math.round(rect.left), 8, Math.max(8, vw - popRect.width - 8));
                top = rect.bottom + 8;
                if (top + popRect.height > vh - 8) {
                    top = Math.max(8, rect.top - popRect.height - 8);
                }
            }
        }
        pop.style.left = `${left}px`;
        pop.style.top = `${top}px`;
    }

    function close() {
        const pop = document.getElementById('duet-agent-pop');
        if (pop) pop.hidden = true;
        activeAnchor = null;
    }

    function open(anchor) {
        if (!agentLinkEnabled(getSettings())) {
            close();
            return false;
        }
        const pop = mountPopover();
        activeAnchor = anchor || null;
        updateSummary();
        setStatus('');
        pop.hidden = false;
        placePopover(activeAnchor);
        document.getElementById('duet-agent-note')?.focus();
        return true;
    }

    function toggle(anchor) {
        const pop = document.getElementById('duet-agent-pop');
        if (pop && !pop.hidden && (!anchor || activeAnchor === anchor)) {
            close();
            return false;
        }
        return open(anchor);
    }

    async function handleAction(openAfter) {
        const noteEl = document.getElementById('duet-agent-note');
        const note = noteEl ? noteEl.value : '';
        const text = formatAgentContext(buildContext(note));
        const url = agentLinkUrl(getSettings());
        const res = await copyContextAndMaybeOpen({
            contextText: text,
            url,
            openAfter,
        });
        if (openAfter) {
            if (res.copied) {
                setStatus('Copied context & opened Agent.');
                toast('success', 'Context copied. Opening Cursor agent…');
            } else {
                setStatus('Opened Agent (clipboard unavailable).', true);
                toast('warning', 'Opened Agent, but clipboard copy was blocked.');
            }
        } else if (res.copied) {
            setStatus('Context copied to clipboard.');
            toast('success', 'Context copied to clipboard.');
        } else {
            setStatus('Clipboard copy was blocked by the browser.', true);
            toast('warning', 'Could not copy to clipboard.');
        }
        return res;
    }

    function mountPopover() {
        let pop = document.getElementById('duet-agent-pop');
        if (pop) return pop;
        pop = document.createElement('div');
        pop.id = 'duet-agent-pop';
        pop.className = 'duet-agent-pop';
        pop.setAttribute('role', 'dialog');
        pop.setAttribute('aria-label', 'Ask Agent');
        pop.hidden = true;
        pop.innerHTML = `<header class="duet-agent-head">
  <div class="duet-agent-title"><b>Ask Agent</b><span id="duet-agent-ctx" class="duet-agent-ctx"></span></div>
  <button type="button" class="duet-agent-close" data-agent-act="close" aria-label="Close">✕</button>
</header>
<label class="duet-agent-lbl" for="duet-agent-note">What do you want the agent to do?</label>
<textarea id="duet-agent-note" rows="3" placeholder="Optional note (e.g. tweak layout, fix sprite mood, adjust CSS)…"></textarea>
<div class="duet-agent-acts">
  <button type="button" id="duet-agent-open" class="primary" data-agent-act="copy-open">Copy context &amp; open Agent</button>
  <button type="button" id="duet-agent-copy" data-agent-act="copy-only">Copy context only</button>
</div>
<p id="duet-agent-status" class="duet-agent-status" hidden></p>`;
        document.body.append(pop);

        pop.addEventListener('click', (ev) => {
            const btn = ev.target.closest('[data-agent-act]');
            if (!btn) return;
            const act = btn.getAttribute('data-agent-act');
            if (act === 'close') close();
            else if (act === 'copy-open') handleAction(true);
            else if (act === 'copy-only') handleAction(false);
        });

        document.addEventListener('pointerdown', (ev) => {
            if (pop.hidden) return;
            if (pop.contains(ev.target)) return;
            if (ev.target.closest?.('[data-act="ask-agent"], #duet-agent-menu-btn')) return;
            close();
        });

        document.addEventListener('keydown', (ev) => {
            if (ev.key === 'Escape' && !pop.hidden) {
                ev.preventDefault();
                ev.stopPropagation();
                close();
            }
        }, true);

        window.addEventListener('resize', () => {
            if (!pop.hidden) placePopover(activeAnchor);
        });

        return pop;
    }

    function refresh() {
        const on = agentLinkEnabled(getSettings());
        if (!on) close();
        const pop = document.getElementById('duet-agent-pop');
        if (pop && !pop.hidden) updateSummary();
        syncAgentExtensionSettings(getSettings());
    }

    mountPopover();

    return {
        open,
        close,
        toggle,
        refresh,
        readContext: (note = '') => formatAgentContext(buildContext(note)),
    };
}
