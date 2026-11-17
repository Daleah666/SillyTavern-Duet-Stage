import assert from 'node:assert/strict';
import test from 'node:test';
import {
    DEFAULT_AGENT_URL,
    agentLinkEnabled,
    agentLinkUrl,
    agentSettingsHTML,
    copyContextAndMaybeOpen,
    copyTextToClipboard,
    ensureAgentSettings,
    extractAgentContext,
    formatAgentContext,
    isValidAgentUrl,
    normalizeAgentUrl,
    resetAgentLinkUrl,
    setAgentLinkUrl,
} from '../agent-link.js';

test('default Agent URL matches the expected Cursor agent link', () => {
    assert.equal(
        DEFAULT_AGENT_URL,
        'https://cursor.com/agents/bc-e5571c28-4223-412e-beae-7e7799322c5e',
    );
});

test('URL validation and normalization accept http(s) and reject unsafe or invalid URLs', () => {
    assert.equal(isValidAgentUrl(DEFAULT_AGENT_URL), true);
    assert.equal(isValidAgentUrl('http://localhost:3000/agent'), true);
    assert.equal(isValidAgentUrl('cursor.com/agents/abc'), true);
    assert.equal(isValidAgentUrl('javascript:alert(1)'), false);
    assert.equal(isValidAgentUrl('data:text/html,hi'), false);
    assert.equal(isValidAgentUrl('not a url'), false);
    assert.equal(isValidAgentUrl(''), false);

    assert.equal(
        normalizeAgentUrl('  cursor.com/agents/custom  '),
        'https://cursor.com/agents/custom',
    );
    assert.equal(normalizeAgentUrl('javascript:alert(1)'), DEFAULT_AGENT_URL);
    assert.equal(normalizeAgentUrl(''), DEFAULT_AGENT_URL);
});

test('agent settings initialize, update, toggle, and reset cleanly', () => {
    const settings = {};
    const cfg = ensureAgentSettings(settings);
    assert.equal(cfg.enabled, true);
    assert.equal(cfg.url, DEFAULT_AGENT_URL);
    assert.equal(agentLinkEnabled(settings), true);
    assert.equal(agentLinkUrl(settings), DEFAULT_AGENT_URL);

    cfg.enabled = false;
    assert.equal(agentLinkEnabled(settings), false);

    const updated = setAgentLinkUrl(settings, 'https://cursor.com/agents/bc-custom-123');
    assert.equal(updated.valid, true);
    assert.equal(updated.url, 'https://cursor.com/agents/bc-custom-123');
    assert.equal(agentLinkUrl(settings), 'https://cursor.com/agents/bc-custom-123');

    const invalid = setAgentLinkUrl(settings, 'javascript:evil()');
    assert.equal(invalid.valid, false);
    assert.equal(invalid.url, DEFAULT_AGENT_URL);

    setAgentLinkUrl(settings, 'https://cursor.com/agents/bc-other');
    assert.equal(resetAgentLinkUrl(settings), DEFAULT_AGENT_URL);
    assert.equal(agentLinkUrl(settings), DEFAULT_AGENT_URL);
});

test('extractAgentContext and formatAgentContext build full context from active character, look/mood, chat, and note', () => {
    const ctx = {
        characterId: '0',
        name1: '[Unnamed Persona]',
        name2: 'Bambi',
        chatId: 'Bambi - 2026-11-17',
        characters: [
            { name: 'Bambi', avatar: 'bambi.png' },
        ],
        powerUserSettings: {
            personas: { 'del.png': 'Del' },
        },
        chatMetadata: {
            duet_scene: {
                mood: 'flirty',
                scene: 'Curled up on the couch after a long day',
            },
        },
        extensionSettings: {
            'st-card-creator': {
                hearts: { 'bambi.png': { emo: 'happy' } },
            },
            drive: { accessToken: 'SECRET_DRIVE_TOKEN', clientId: 'public-id' },
            secrets: { openai: 'sk-should-never-appear' },
        },
        chat: [
            { name: 'System', is_system: true, mes: 'Ignore system lines' },
            { name: 'Del', is_user: true, mes: 'Hey   you.\nI missed you.' },
            {
                name: 'Bambi',
                is_user: false,
                mes: 'Old swipe text',
                swipes: ['Old swipe text', '[happy] Come sit right next to me.'],
                swipe_id: 1,
            },
        ],
    };
    const settings = {
        personaKey: 'del.png',
        calm: true,
        features: { stage: true, clean: true, habit: true, solo: true },
    };

    const extracted = extractAgentContext(ctx, {
        settings,
        note: 'Make her sprite slightly larger on ultrawide.',
        domSpriteSrc: '/characters/bambi/desire-flirty-cycle.gif',
    });

    assert.equal(extracted.characterName, 'Bambi');
    assert.equal(extracted.userName, 'Del');
    assert.equal(extracted.mood, 'flirty');
    assert.equal(extracted.look, 'Clean stage, Calm');
    assert.equal(extracted.spriteFile, 'desire-flirty-cycle.gif');
    assert.equal(extracted.recentLines.length, 2);
    assert.equal(extracted.recentLines[0].text, 'Hey you. I missed you.');
    assert.equal(extracted.recentLines[1].text, '[happy] Come sit right next to me.');

    const formatted = formatAgentContext(extracted);
    assert.match(formatted, /\[Duet Stage Context\]/);
    assert.match(formatted, /Character: Bambi/);
    assert.match(formatted, /Look \/ Mood: flirty · Clean stage, Calm · desire-flirty-cycle\.gif/);
    assert.match(formatted, /Chat: Bambi - 2026-11-17/);
    assert.match(formatted, /Scene: Curled up on the couch after a long day/);
    assert.match(formatted, /- Del: Hey you\. I missed you\./);
    assert.match(formatted, /- Bambi: \[happy\] Come sit right next to me\./);
    assert.match(formatted, /Request:\nMake her sprite slightly larger on ultrawide\./);
    assert.equal(formatted.includes('SECRET_DRIVE_TOKEN'), false);
    assert.equal(formatted.includes('sk-should-never-appear'), false);
});

test('extractAgentContext resolves mood fallbacks, group chats, line limits, and empty state', () => {
    const groupCtx = {
        groupId: 'grp-1',
        groups: [{ id: 'grp-1', members: ['sera.png', 'bambi.png'] }],
        characters: [
            { name: 'Seraphina', avatar: 'sera.png' },
            { name: 'Bambi', avatar: 'bambi.png' },
        ],
        chat: [
            { name: 'Del', is_user: true, mes: 'Line 1' },
            { name: 'Bambi', is_user: false, original_avatar: 'bambi.png', mes: '[smug] Line 2' },
            { name: 'Del', is_user: true, mes: 'Line 3' },
            { name: 'Bambi', is_user: false, original_avatar: 'bambi.png', mes: '[smug] Line 4 ' + 'x'.repeat(300) },
        ],
    };

    const ctxObj = extractAgentContext(groupCtx, {
        settings: { features: { stage: true, habit: true } },
        domSpriteSrc: '/thumbnail?type=avatar&file=bambi.png',
        maxLines: 2,
        maxLineLength: 40,
    });
    assert.equal(ctxObj.characterName, 'Bambi');
    assert.equal(ctxObj.mood, 'smug');
    assert.equal(ctxObj.look, 'Talk layout');
    assert.equal(ctxObj.spriteFile, '');
    assert.equal(ctxObj.recentLines.length, 2);
    assert.equal(ctxObj.recentLines[0].text, 'Line 3');
    assert.equal(ctxObj.recentLines[1].text.length, 40);
    assert.ok(ctxObj.recentLines[1].text.endsWith('…'));

    const emptyFormatted = formatAgentContext(extractAgentContext({}));
    assert.equal(emptyFormatted, '[Duet Stage Context]\nCharacter: (none selected)\nLook / Mood: Duet Stage');
});

test('copyTextToClipboard prefers navigator.clipboard and falls back to execCommand', async () => {
    let copied = '';
    const ok = await copyTextToClipboard('hello agent', null, {
        clipboard: {
            async writeText(val) { copied = val; },
        },
    });
    assert.equal(ok, true);
    assert.equal(copied, 'hello agent');

    let removed = false;
    let execCalled = '';
    const fakeTextarea = {
        value: '',
        style: {},
        setAttribute() {},
        select() {},
        setSelectionRange() {},
        remove() { removed = true; },
    };
    const fakeDoc = {
        body: { append() {} },
        createElement() { return fakeTextarea; },
        execCommand(cmd) { execCalled = cmd; return true; },
    };
    const fallbackOk = await copyTextToClipboard('fallback text', fakeDoc, {
        clipboard: {
            async writeText() { throw new Error('blocked'); },
        },
    });
    assert.equal(fallbackOk, true);
    assert.equal(execCalled, 'copy');
    assert.equal(fakeTextarea.value, 'fallback text');
    assert.equal(removed, true);

    const noneOk = await copyTextToClipboard('nope', null, null);
    assert.equal(noneOk, false);
});

test('copyContextAndMaybeOpen handles copy-only, copy-and-open, clipboard failure, and URL sanitization', async () => {
    const opened = [];
    const copied = [];

    const copyOnly = await copyContextAndMaybeOpen({
        contextText: 'ctx text',
        url: 'https://cursor.com/agents/custom',
        openAfter: false,
        copyFn: async (t) => { copied.push(t); return true; },
        openFn: (...args) => opened.push(args),
    });
    assert.deepEqual(copyOnly, {
        copied: true,
        opened: false,
        url: 'https://cursor.com/agents/custom',
        text: 'ctx text',
    });
    assert.deepEqual(copied, ['ctx text']);
    assert.equal(opened.length, 0);

    const copyAndOpen = await copyContextAndMaybeOpen({
        contextText: 'ctx 2',
        url: 'javascript:bad()',
        openAfter: true,
        copyFn: async () => false,
        openFn: (...args) => opened.push(args),
    });
    assert.equal(copyAndOpen.copied, false);
    assert.equal(copyAndOpen.opened, true);
    assert.equal(copyAndOpen.url, DEFAULT_AGENT_URL);
    assert.deepEqual(opened[0], [DEFAULT_AGENT_URL, '_blank', 'noopener,noreferrer']);
});

test('agentSettingsHTML renders escaped settings fields and reset button', () => {
    const html = agentSettingsHTML({
        agentLink: { enabled: false, url: 'https://cursor.com/agents/test?a=1&b="2"' },
    });
    assert.match(html, /id="duet-set-agent-enabled"/);
    assert.equal(/checked/.test(html), false);
    assert.match(html, /id="duet-set-agent-url"/);
    assert.match(html, /value="https:\/\/cursor\.com\/agents\/test\?a=1&amp;b=%222%22"/);
    assert.match(html, /id="duet-set-agent-reset"/);
});
