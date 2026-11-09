/**
 * Google Drive for My Hub.
 *
 * No client secret and no token is stored in this repo. The OAuth client
 * ID and the user's tokens live in SillyTavern extension settings, with a
 * copy in this browser's localStorage so sign-in survives a reload.
 *
 * The folder ids below are the existing "Nova Ai Data › Hub shared data"
 * folders already named in her stage. They are not credentials. If the
 * signed-in account cannot see them, import continues with Duet Stage Hub.
 */

import { isImageName } from './images.js';

const AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const DRIVE = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
const SCOPE = 'https://www.googleapis.com/auth/drive';
const LS = 'st-duet-stage.drive';
const CODE_KEY = 'st-duet-stage.drive-code';
const PKCE_KEY = 'duet-drive-pkce';
const HUB_FOLDER = 'Duet Stage Hub';
const HUB_FILE = 'duet-stage-hub.json';

export const KNOWN_DRIVE = {
    root: '1hd3_TyaiDYg-VNXXpXjzht2pzW8D77HW',
    pics: '185Bcw_SYkTNg-QrQcOf3JfhXtPYA3rE_',
    backups: '1x-ZY87JLjMTnIT8Leso_Bbxe_XDQxz2Q',
};

function b64url(bytes) {
    let text = '';
    for (const byte of bytes) text += String.fromCharCode(byte);
    return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function randomBytes(size) {
    const bytes = new Uint8Array(size);
    crypto.getRandomValues(bytes);
    return bytes;
}

function readJson(key) {
    try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : null;
    } catch {
        return null;
    }
}

function writeJson(key, value) {
    try {
        localStorage.setItem(key, JSON.stringify(value));
    } catch {
        /* private window or a full disk */
    }
}

export function redirectUri() {
    if (typeof location === 'undefined') return '';
    const url = new URL(location.href);
    url.search = '';
    url.hash = '';
    return url.origin + url.pathname;
}

export function hydrateDrive(settings) {
    if (!settings.drive || typeof settings.drive !== 'object' || Array.isArray(settings.drive)) settings.drive = {};
    const bag = settings.drive;
    const local = readJson(LS);
    if (local && typeof local === 'object') {
        if (!bag.clientId && local.clientId) bag.clientId = String(local.clientId);
        const localExp = Number(local.expiresAt) || 0;
        const bagExp = Number(bag.expiresAt) || 0;
        if (local.accessToken && localExp > bagExp) {
            bag.accessToken = String(local.accessToken);
            bag.expiresAt = localExp;
        }
        if (!bag.refreshToken && local.refreshToken) bag.refreshToken = String(local.refreshToken);
        if (!bag.folderId && local.folderId) bag.folderId = String(local.folderId);
    }
    if (bag.clientId || bag.refreshToken || bag.accessToken) writeJson(LS, publicBag(bag));
    return bag;
}

function publicBag(bag) {
    return {
        clientId: String(bag.clientId || ''),
        accessToken: String(bag.accessToken || ''),
        refreshToken: String(bag.refreshToken || ''),
        expiresAt: Number(bag.expiresAt) || 0,
        folderId: String(bag.folderId || ''),
    };
}

export function driveSignedIn(bag) {
    if (!bag) return false;
    if (bag.refreshToken) return true;
    return !!(bag.accessToken && Number(bag.expiresAt) > Date.now());
}

export function signOutDrive(bag) {
    bag.accessToken = '';
    bag.refreshToken = '';
    bag.expiresAt = 0;
    bag.folderId = '';
    writeJson(LS, publicBag(bag));
}

export function buildHubDocument(snapshot) {
    const source = snapshot && typeof snapshot === 'object' ? snapshot : {};
    return {
        kind: 'duet-stage-hub',
        version: 1,
        savedAt: source.savedAt || new Date().toISOString(),
        cast: source.cast || { personaKey: '', leftAvatar: '', personas: [], characters: [] },
        cards: Array.isArray(source.cards) ? source.cards : [],
        memory: Array.isArray(source.memory) ? source.memory : [],
        subliminals: source.subliminals || { on: false, phrases: '', everyS: 7, alpha: 0.34 },
        inner: source.inner || { on: false, byAvatar: {} },
        library: Array.isArray(source.library) ? source.library : [],
    };
}

export function readHubDocument(value) {
    if (!value || value.kind !== 'duet-stage-hub') {
        const error = new Error('not_hub');
        error.code = 'not_hub';
        throw error;
    }
    return buildHubDocument(value);
}

function fail(code, message) {
    const error = new Error(message || code);
    error.code = code;
    return error;
}

export function driveErrorText(error) {
    const code = error?.code || error?.message || '';
    if (code === 'need_client') return 'Paste your Google OAuth client ID, then press Sign in. It is a public ID, not a secret, and it stays in SillyTavern settings.';
    if (code === 'popup_blocked') return 'The browser blocked the Google window. Allow pop-ups, or use Sign in here.';
    if (code === 'closed') return 'The Google window closed before sign-in finished.';
    if (code === 'need_signin') return 'Sign in to Google Drive.';
    if (code === 'state') return 'That sign-in did not match this page. Press Sign in again.';
    if (code === 'invalid_client' || code === 'unauthorized_client') return 'Google rejected that client ID. Use a Desktop or Web client whose redirect URI is the one shown here. Do not paste a client secret.';
    if (code === 'access_denied') return 'Google Drive was not allowed.';
    if (code === 'not_hub') return 'That Drive file is not a Duet Stage hub.';
    return 'Google Drive did not answer. Try again in a moment.';
}

/**
 * If this window is the Google redirect, either finish sign-in here
 * (same window) or hand the code to the window that opened the pop-up.
 * Returns 'popup' when Duet should not boot in that pop-up.
 */
export function takeOauthReturn() {
    if (typeof location === 'undefined') return null;
    const params = new URLSearchParams(location.search);
    const code = params.get('code');
    const state = params.get('state');
    if (!code || !state) return null;
    const pending = readSession();
    if (pending && pending.state === state) {
        const clean = location.pathname + location.hash;
        history.replaceState(null, '', clean || '/');
        return { mode: 'redirect', code, state, pending };
    }
    if (window.name !== 'duet-drive-auth') return null;
    writeJson(CODE_KEY, { code, state, at: Date.now() });
    try {
        if (window.opener) window.opener.postMessage({ source: 'st-duet-stage-drive', code, state }, location.origin);
    } catch {
        /* the sandbox may hide window.opener; localStorage still carries the code */
    }
    try { window.close(); } catch { /* the page can stay open */ }
    return { mode: 'popup' };
}

function readSession() {
    try {
        return JSON.parse(sessionStorage.getItem(PKCE_KEY) || 'null');
    } catch {
        return null;
    }
}

async function challengeFor(verifier) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
    return b64url(new Uint8Array(digest));
}

function authUrl(clientId, redirect, challenge, state) {
    const url = new URL(AUTH);
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('redirect_uri', redirect);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', SCOPE);
    url.searchParams.set('code_challenge', challenge);
    url.searchParams.set('code_challenge_method', 'S256');
    url.searchParams.set('access_type', 'offline');
    url.searchParams.set('prompt', 'consent');
    url.searchParams.set('include_granted_scopes', 'true');
    url.searchParams.set('state', state);
    return url.toString();
}

async function startPkce(bag) {
    const clientId = String(bag.clientId || '').trim();
    if (!clientId) throw fail('need_client');
    bag.clientId = clientId;
    const verifier = b64url(randomBytes(32));
    const state = b64url(randomBytes(16));
    const redirect = redirectUri();
    const challenge = await challengeFor(verifier);
    const pending = { verifier, state, redirect };
    try { sessionStorage.setItem(PKCE_KEY, JSON.stringify(pending)); } catch { /* continue */ }
    return { url: authUrl(clientId, redirect, challenge, state), state, pending };
}

export async function beginSignIn(bag) {
    const { url, state } = await startPkce(bag);
    const popup = window.open(url, 'duet-drive-auth', 'width=520,height=700');
    if (!popup) throw fail('popup_blocked');
    return waitForCode(popup, state).then((code) => completeSignIn(bag, code, state));
}

export async function beginSignInHere(bag) {
    const { url } = await startPkce(bag);
    location.assign(url);
}

export async function completeSignIn(bag, code, state, pending) {
    const saved = pending || readSession();
    if (!saved || saved.state !== state || !saved.verifier) throw fail('state');
    try { sessionStorage.removeItem(PKCE_KEY); } catch { /* ignore */ }
    const body = new URLSearchParams({
        client_id: bag.clientId,
        code,
        code_verifier: saved.verifier,
        grant_type: 'authorization_code',
        redirect_uri: saved.redirect || redirectUri(),
    });
    const res = await fetch(TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw fail(data.error || 'token');
    bag.accessToken = data.access_token || '';
    if (data.refresh_token) bag.refreshToken = data.refresh_token;
    bag.expiresAt = Date.now() + (Number(data.expires_in) || 3600) * 1000 - 15000;
    writeJson(LS, publicBag(bag));
    return bag;
}

function waitForCode(popup, state) {
    const started = Date.now();
    return new Promise((resolve, reject) => {
        let done = false;
        const finish = (fn, value) => {
            if (done) return;
            done = true;
            clearInterval(timer);
            window.removeEventListener('message', onMsg);
            fn(value);
        };
        const take = () => {
            const payload = readJson(CODE_KEY);
            if (!payload || payload.state !== state || Number(payload.at) < started - 2000) return null;
            try { localStorage.removeItem(CODE_KEY); } catch { /* ignore */ }
            return payload.code;
        };
        const onMsg = (ev) => {
            if (ev.origin !== location.origin) return;
            const data = ev.data;
            if (!data || data.source !== 'st-duet-stage-drive' || data.state !== state) return;
            finish(resolve, data.code);
        };
        window.addEventListener('message', onMsg);
        const timer = setInterval(() => {
            const code = take();
            if (code) {
                try { popup.close(); } catch { /* ignore */ }
                finish(resolve, code);
                return;
            }
            if (popup.closed && Date.now() - started > 1200) finish(reject, fail('closed'));
        }, 300);
    });
}

async function ensureAccess(bag) {
    if (bag.accessToken && Number(bag.expiresAt) > Date.now() + 5000) return bag.accessToken;
    if (!bag.refreshToken || !bag.clientId) throw fail('need_signin');
    const body = new URLSearchParams({
        client_id: bag.clientId,
        refresh_token: bag.refreshToken,
        grant_type: 'refresh_token',
    });
    const res = await fetch(TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        bag.accessToken = '';
        bag.expiresAt = 0;
        writeJson(LS, publicBag(bag));
        throw fail(data.error || 'need_signin');
    }
    bag.accessToken = data.access_token || '';
    bag.expiresAt = Date.now() + (Number(data.expires_in) || 3600) * 1000 - 15000;
    if (data.refresh_token) bag.refreshToken = data.refresh_token;
    writeJson(LS, publicBag(bag));
    return bag.accessToken;
}

async function api(bag, path, options = {}) {
    const token = await ensureAccess(bag);
    const headers = { Authorization: `Bearer ${token}`, ...(options.headers || {}) };
    return fetch(DRIVE + path, { method: options.method || 'GET', headers, body: options.body });
}

function qEscape(value) {
    return String(value || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

async function driveJson(res) {
    if (res.status === 401) throw fail('need_signin');
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw fail(data.error?.status || data.error?.message || 'drive');
    return data;
}

async function findFiles(bag, query, pageSize) {
    const params = new URLSearchParams({
        q: query,
        fields: 'files(id,name,mimeType)',
        pageSize: String(pageSize || 10),
        supportsAllDrives: 'true',
        includeItemsFromAllDrives: 'true',
        spaces: 'drive',
    });
    const res = await api(bag, `/files?${params.toString()}`);
    if (res.status === 404) return [];
    const data = await driveJson(res);
    return Array.isArray(data.files) ? data.files : [];
}

async function createFolder(bag, name, parentId) {
    const meta = { name, mimeType: 'application/vnd.google-apps.folder' };
    if (parentId) meta.parents = [parentId];
    const res = await api(bag, '/files?supportsAllDrives=true', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(meta),
    });
    return driveJson(res);
}

export async function ensureHubFolder(bag) {
    if (bag.folderId) return bag.folderId;
    const found = await findFiles(bag, `name = '${qEscape(HUB_FOLDER)}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`, 5);
    const folder = found[0] || await createFolder(bag, HUB_FOLDER);
    bag.folderId = folder.id;
    writeJson(LS, publicBag(bag));
    return folder.id;
}

async function ensureChild(bag, parentId, name) {
    const found = await findFiles(
        bag,
        `name = '${qEscape(name)}' and mimeType = 'application/vnd.google-apps.folder' and '${parentId}' in parents and trashed = false`,
        5,
    );
    if (found[0]) return found[0].id;
    const created = await createFolder(bag, name, parentId);
    return created.id;
}

function safeFolder(name) {
    const clean = String(name || 'cast').replace(/[\\/]+/g, '-').replace(/[\u0000-\u001f]/g, '').trim();
    return clean.slice(0, 80) || 'cast';
}

async function uploadMultipart(bag, fileId, meta, blob, mime) {
    const boundary = `duet${Math.random().toString(16).slice(2)}`;
    const head = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${boundary}\r\nContent-Type: ${mime}\r\n\r\n`;
    const tail = `\r\n--${boundary}--`;
    const body = new Blob([head, blob, tail]);
    const token = await ensureAccess(bag);
    const url = fileId
        ? `${UPLOAD}/${encodeURIComponent(fileId)}?uploadType=multipart&supportsAllDrives=true`
        : `${UPLOAD}?uploadType=multipart&supportsAllDrives=true`;
    const res = await fetch(url, {
        method: fileId ? 'PATCH' : 'POST',
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': `multipart/related; boundary=${boundary}`,
        },
        body,
    });
    return driveJson(res);
}

export async function downloadOriginal(bag, fileId) {
    const token = await ensureAccess(bag);
    const res = await fetch(`${DRIVE}/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`, {
        headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 401) throw fail('need_signin');
    if (!res.ok) throw fail('download');
    return res.blob();
}

export async function saveHub(bag, doc, files) {
    const folderId = await ensureHubFolder(bag);
    const spritesId = await ensureChild(bag, folderId, 'sprites');
    const library = [];
    for (const file of files || []) {
        try {
            const parent = await ensureChild(bag, spritesId, safeFolder(file.character));
            const blob = file.blob;
            const mime = blob.type || 'application/octet-stream';
            const uploaded = await uploadMultipart(bag, '', { name: file.name, parents: [parent] }, blob, mime);
            library.push({
                character: file.character,
                label: file.label,
                fileName: file.name,
                driveFileId: uploaded.id,
                mime,
            });
        } catch (error) {
            console.warn('[st-duet-stage] drive sprite', file?.name, error);
        }
    }
    const body = buildHubDocument({ ...doc, library: library.length ? library : doc.library });
    const existing = await findFiles(
        bag,
        `name = '${qEscape(HUB_FILE)}' and '${folderId}' in parents and trashed = false`,
        5,
    );
    const jsonBlob = new Blob([JSON.stringify(body)], { type: 'application/json' });
    const meta = existing[0] ? { name: HUB_FILE } : { name: HUB_FILE, parents: [folderId] };
    await uploadMultipart(bag, existing[0]?.id || '', meta, jsonBlob, 'application/json');
    writeJson(LS, publicBag(bag));
    return { folderId, library: body.library, count: library.length };
}

export async function loadHub(bag) {
    const folderId = bag.folderId || (await findFiles(
        bag,
        `name = '${qEscape(HUB_FOLDER)}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
        5,
    ))[0]?.id || '';
    if (folderId) bag.folderId = folderId;
    if (!folderId) return { doc: null, folderId: '' };
    const file = (await findFiles(
        bag,
        `name = '${qEscape(HUB_FILE)}' and '${folderId}' in parents and trashed = false`,
        5,
    ))[0];
    if (!file) return { doc: null, folderId };
    const blob = await downloadOriginal(bag, file.id);
    const doc = readHubDocument(JSON.parse(await blob.text()));
    writeJson(LS, publicBag(bag));
    return { doc, folderId };
}

async function listImages(bag, folderId) {
    const out = [];
    let page = '';
    const query = `'${folderId}' in parents and trashed = false and mimeType contains 'image/'`;
    do {
        const params = new URLSearchParams({
            q: query,
            fields: 'nextPageToken,files(id,name,mimeType,size)',
            pageSize: '100',
            supportsAllDrives: 'true',
            includeItemsFromAllDrives: 'true',
        });
        if (page) params.set('pageToken', page);
        const res = await api(bag, `/files?${params.toString()}`);
        if (res.status === 404) return out;
        const data = await driveJson(res);
        for (const file of data.files || []) {
            if (!file) continue;
            if (isImageName(file.name) || String(file.mimeType || '').startsWith('image/')) out.push(file);
        }
        page = data.nextPageToken || '';
    } while (page && out.length < 400);
    return out;
}

async function listFolders(bag, folderId) {
    return findFiles(
        bag,
        `'${folderId}' in parents and trashed = false and mimeType = 'application/vnd.google-apps.folder'`,
        50,
    );
}

async function walkImages(bag, folderId, depth, out) {
    if (depth > 2 || out.length >= 400) return;
    const images = await listImages(bag, folderId);
    for (const file of images) {
        if (out.length >= 400) return;
        if (!out.some((row) => row.id === file.id)) out.push(file);
    }
    if (depth === 2) return;
    const folders = await listFolders(bag, folderId);
    for (const folder of folders) {
        await walkImages(bag, folder.id, depth + 1, out);
    }
}

export async function listHubPictures(bag, folderId) {
    const out = [];
    const roots = [];
    if (KNOWN_DRIVE.pics) roots.push(KNOWN_DRIVE.pics);
    const hub = folderId || bag.folderId;
    if (hub) {
        const sprites = (await findFiles(
            bag,
            `name = 'sprites' and mimeType = 'application/vnd.google-apps.folder' and '${hub}' in parents and trashed = false`,
            5,
        ))[0];
        if (sprites?.id) roots.push(sprites.id);
    }
    for (const root of roots) {
        try {
            await walkImages(bag, root, 0, out);
        } catch (error) {
            console.warn('[st-duet-stage] drive list', error);
        }
    }
    return out;
}
