// Boots the Duet Stage extension inside the stand-in SillyTavern host (host.html + server.mjs) and checks it.
// Needs Node 20+ and Playwright with Chromium (npm i -D playwright && npx playwright install chromium).
// Usage: node test/standin/smoke.js                      checks this repo
//        node test/standin/smoke.js <label>=<dir> ...    the first gets the full checks, the rest only boot
// Screenshots go to $SHOTS, or a folder in the system temp directory.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const out = process.env.SHOTS || path.join(require('os').tmpdir(), 'duet-stage-standin');
fs.mkdirSync(out, { recursive: true });
const args = process.argv.slice(2).length ? process.argv.slice(2) : ['build=' + path.join(__dirname, '..', '..')];
const builds = args.map((a, i) => { const [label, dir] = a.split('='); return { label, dir: path.resolve(dir), port: 8765 + i }; });   // not 8000: a real SillyTavern may be there
const WANT = JSON.parse(fs.readFileSync(path.join(builds[0].dir, 'manifest.json'), 'utf8')).version;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = {};
let failed = 0;
const check = (label, name, ok, detail) => { (results[label] = results[label] || []).push({ name, ok: !!ok, detail }); if (!ok) failed++; };

async function open(browser, b, { width = 1440, height = 900, query = '', seed, keep } = {}) {
    const ctx = keep || await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    const log = { console: [], failed: [] };
    page.on('console', (m) => { if (m.type() === 'error') log.console.push(m.text()); });
    page.on('pageerror', (e) => log.console.push('pageerror: ' + e.message));
    page.on('requestfailed', (r) => log.failed.push(r.url() + ' ' + (r.failure() && r.failure().errorText)));
    page.on('response', (r) => { if (r.status() >= 400 && !/fonts\.g/.test(r.url())) log.failed.push(r.status() + ' ' + r.url()); });
    if (seed) await ctx.addInitScript((s) => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem('mock-ext-settings', JSON.stringify(s)); sessionStorage.setItem('seeded', '1'); } }, seed);
    await page.goto(`http://127.0.0.1:${b.port}/${query}`, { waitUntil: 'load' });
    await page.waitForFunction(() => !!document.getElementById('duet-vn') && !!window.DuetStage, null, { timeout: 15000 });
    await sleep(900);
    return { ctx, page, log };
}
const errorsOf = async (page, log) => ({ page: await page.evaluate(() => window.pageErrors), console: log.console.filter((t) => !/fonts\.googleapis|ERR_|Failed to load resource/.test(t)), failed: log.failed.filter((t) => !/fonts\.g|favicon/.test(t)) });
const vis = (page, sel) => page.evaluate((s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0; }, sel);

(async () => {
    const servers = builds.map((b) => spawn('node', [path.join(__dirname, 'server.mjs'), b.dir, String(b.port)], { stdio: 'ignore' }));
    await sleep(900);
    const browser = await chromium.launch();
    try {
        // ---------- every build: boot, screenshot, errors ----------
        for (const b of builds) {
            const { ctx, page, log } = await open(browser, b, { query: '?fresh=1' });
            const info = await page.evaluate(() => ({ cls: document.body.className, v: window.DuetStage && window.DuetStage.version, sync: !!window.DuetSync, title: document.querySelector('#duet-title, .dv-title b')?.textContent, lines: document.querySelectorAll('#duet-log > *').length }));
            const errs = await errorsOf(page, log);
            check(b.label, 'boots with no errors', info.v && !errs.page.length && !errs.console.length && !errs.failed.length, { info, errs });
            await page.screenshot({ path: path.join(out, `${b.label}-desk.png`) });
            await ctx.close();
        }

        const m = builds[0];
        // ---------- merged build: the full pass ----------
        {
            const { ctx, page, log } = await open(browser, m, { query: '?fresh=1' });
            const L = m.label;
            const ver = await page.evaluate(() => window.DuetStage.version);
            check(L, `the running version matches manifest.json (${WANT})`, ver === WANT, ver);
            check(L, 'the Duet Staging look is on (title, under-bar, 8 reply types)', await page.evaluate(() => document.getElementById('duet-title')?.textContent === 'Bambi' && document.querySelectorAll('#duet-under button').length === 3 && document.querySelectorAll('#duet-sug-type option').length === 8));
            check(L, 'chat lines render on the stage', await page.evaluate(() => /come sit with me/i.test(document.getElementById('duet-vn').innerText)));
            check(L, 'connection status shows the Featherless model', await page.evaluate(() => /Featherless/.test(document.getElementById('duet-sub')?.textContent || '')), await page.evaluate(() => document.getElementById('duet-sub')?.textContent));

            // suggestions
            check(L, 'suggest button and style list are visible', (await vis(page, '#duet-sug-btn')) && (await vis(page, '#duet-sug-type')));
            await page.click('#duet-sug-btn');
            await page.waitForFunction(() => document.querySelectorAll('#duet-sug button').length === 3, null, { timeout: 5000 }).catch(() => {});
            const sug = await page.evaluate(() => [...document.querySelectorAll('#duet-sug button')].map((x) => x.textContent));
            const quiet = await page.evaluate(() => window.calls.filter((c) => c[0] === 'quiet').length);
            const rooms = await page.evaluate(() => window.calls.filter((c) => c[0] === 'quiet').map((c) => c[2]));
            check(L, 'suggest asks the connected model once, with the short allowance, and shows three clean replies', sug.length === 3 && quiet === 1 && rooms[0] === 140 && sug[0] === 'Come here and find out.' && sug[2] === 'Tell me what bored-you wants first.', { sug, quiet });
            await page.screenshot({ path: path.join(out, `${L}-suggest.png`) });
            await page.click('#duet-sug button:nth-child(2)');
            check(L, 'a click puts the suggestion in the box', await page.evaluate(() => document.getElementById('duet-ta').value) === sug[1]);

            // send through SillyTavern's own generate
            await page.click('#duet-send');
            await page.waitForFunction(() => window.calls.some((c) => c[0] === 'generate'), null, { timeout: 5000 }).catch(() => {});
            await sleep(700);
            const afterSend = await page.evaluate(() => ({ gen: window.calls.filter((c) => c[0] === 'generate').map((c) => c[1]), chat: window.mock.state.chat.length, shown: /exactly what I hoped/.test(document.getElementById('duet-vn').innerText), ta: document.getElementById('duet-ta').value }));
            check(L, 'Send goes through SillyTavern generate and her reply lands on the stage', afterSend.gen[0] === 'normal' && afterSend.chat === 4 && afterSend.shown && afterSend.ta === '', afterSend);
            await page.click('#duet-continue'); await sleep(500);
            await page.click('#duet-reroll'); await sleep(500);
            const acts = await page.evaluate(() => window.calls.filter((c) => c[0] === 'generate' || c[0].startsWith('swipe')).map((c) => c.join(':')));
            check(L, 'Continue and Reroll still call SillyTavern', acts.includes('generate:continue') && acts.includes('swipe.right'), acts);

            // 0.3.0 features are still wired in
            await page.click('#duet-under [data-nav="settings"]'); await sleep(400);
            const toggles = await page.evaluate(() => [...document.querySelectorAll('#duet-drawer [data-feature-toggle]')].map((x) => x.getAttribute('data-feature-toggle') + (x.checked ? '+' : '-')));
            check(L, 'Settings lists 16 switches, all on, with suggestions, the link and the talk layout', toggles.length === 16 && toggles.every((t) => t.endsWith('+')) && toggles.includes('suggest+') && toggles.includes('link+') && toggles.includes('habit+'), toggles);
            await page.screenshot({ path: path.join(out, `${L}-settings.png`) });

            await page.click('#duet-drawer [data-feature-toggle="suggest"]'); await sleep(400);
            const sugOff = { btn: await vis(page, '#duet-sug-btn'), type: await vis(page, '#duet-sug-type'), box: await vis(page, '#duet-sug') };
            const q1 = await page.evaluate(() => window.calls.filter((c) => c[0] === 'quiet').length);
            await page.evaluate(() => document.querySelector('[data-act="suggest"]').click()); await sleep(400);
            const q2 = await page.evaluate(() => window.calls.filter((c) => c[0] === 'quiet').length);
            check(L, 'Reply suggestions off hides the button, list and chips and makes no model call', sugOff.btn === false && sugOff.type === false && sugOff.box === false && q1 === q2, { sugOff, q1, q2 });
            await page.click('#duet-drawer [data-feature-toggle="suggest"]'); await sleep(300);
            check(L, 'Reply suggestions back on shows the button again', await vis(page, '#duet-sug-btn'));

            // the link
            await page.evaluate(() => { window.outbox = []; window.addEventListener('message', (e) => { if (e.data && e.data.duet === 'st') window.outbox.push(e.data.op); }); });
            check(L, 'link button sits in the top bar', await vis(page, '#duet-sync-btn'));
            await page.evaluate(() => window.postMessage({ duet: 'sync', op: 'ext', v: '0.2.0' }, '*')); await sleep(300);
            await page.evaluate(() => window.postMessage({ duet: 'sync', op: 'ready', v: '12.31' }, '*')); await sleep(1100);
            const linked = await page.evaluate(() => ({ state: document.getElementById('duet-sync-btn').dataset.state, out: window.outbox.slice(), toast: window.calls.some((c) => c[0] === 'toast' && /Linked to Duet Staging/.test(c[2])) }));
            check(L, 'a companion and a ready stage link up and her card is sent', linked.state === 'on' && linked.out.includes('hello') && linked.out.includes('char') && linked.toast, linked);
            await page.click('#duet-drawer [data-feature-toggle="link"]'); await sleep(400);
            await page.evaluate(() => { window.outbox.length = 0; window.DuetSync.hello(); window.postMessage({ duet: 'sync', op: 'ready', v: '12.31' }, '*'); }); await sleep(500);
            const linkOff = await page.evaluate(() => ({ btn: getComputedStyle(document.getElementById('duet-sync-btn')).display, out: window.outbox.slice(), on: window.DuetSync.status().on }));
            check(L, 'Duet Staging link off hides the button and sends and takes nothing', linkOff.btn === 'none' && linkOff.out.length === 0 && linkOff.on === false, linkOff);
            await page.click('#duet-drawer [data-feature-toggle="link"]'); await sleep(300);
            check(L, 'Duet Staging link back on shows the button again', await vis(page, '#duet-sync-btn'));

            // drive + library drawers from 0.3.0
            await page.evaluate(() => document.querySelector('#duet-nav [data-nav="more"]').click()); await sleep(300);
            await page.evaluate(() => document.querySelector('#duet-drawer [data-nav="drive"]').click()); await sleep(400);
            check(L, 'Drive drawer from 0.3.0 opens with its sign-in form', await page.evaluate(() => !!document.getElementById('duet-drive-client') && !!document.querySelector('[data-act="drive-signin"]')));
            await page.evaluate(() => document.querySelector('#duet-nav [data-nav="library"]').click()); await sleep(500);
            check(L, 'Library drawer from 0.3.0 opens with bulk import', await page.evaluate(() => !!document.getElementById('duet-sprite-files') && !!document.querySelector('[data-act="import-catalog"]')));
            await page.screenshot({ path: path.join(out, `${L}-library.png`) });
            await page.keyboard.press('Escape'); await sleep(200);

            // stage takeover off and on (0.3.0 switch) with the new look
            await page.click('#duet-under [data-nav="settings"]'); await sleep(300);
            await page.click('#duet-drawer [data-feature-toggle="stage"]'); await sleep(500);
            const off = await page.evaluate(() => ({ cls: document.body.className, vn: getComputedStyle(document.getElementById('duet-vn')).display, sheld: getComputedStyle(document.getElementById('sheld')).display }));
            check(L, 'Stage takeover off gives SillyTavern its plain chat back', !/st-duet-on/.test(off.cls) && off.vn === 'none' && off.sheld !== 'none', off);
            await page.screenshot({ path: path.join(out, `${L}-stage-off.png`) });
            await page.evaluate(() => { const s = window.mock.state.extensionSettings['st-duet-stage']; s.features.stage = true; window.DuetStage.refresh(); window.DuetStage.onFeatures && window.DuetStage.onFeatures(); }); await sleep(400);
            check(L, 'Stage takeover back on restores the stage', await page.evaluate(() => /st-duet-on/.test(document.body.className) && getComputedStyle(document.getElementById('duet-vn')).display !== 'none'));

            const errs = await errorsOf(page, log);
            check(L, 'no errors during the whole pass', !errs.page.length && !errs.console.length && !errs.failed.length, errs);

            // reload: settings persist, the one-time solo switch does not come back
            await page.evaluate(() => { const s = window.mock.state.extensionSettings['st-duet-stage']; s.solo = false; window.mock.state.saveSettingsDebounced(); });
            await page.goto(`http://127.0.0.1:${m.port}/`, { waitUntil: 'load' }); await page.waitForFunction(() => !!window.DuetStage); await sleep(900);   /* no ?fresh: the saved settings load */
            const kept = await page.evaluate(() => { const s = window.mock.state.extensionSettings['st-duet-stage']; return { look: s.look022, solo: s.solo, v: window.DuetStage.version, cls: document.getElementById('duet-scene').className }; });
            check(L, 'after a refresh the one-time look switch stays done and your choice is kept', kept.look === true && kept.solo === false && kept.v === WANT && !/is-solo/.test(kept.cls), kept);
            await ctx.close();
        }

        // ---------- upgrade from a 0.3.0 settings file ----------
        {
            const old = { 'st-duet-stage': { dock: 'middle', stowed: true, panelOpen: false, panelWidth: 420, textScale: 1, vnStageInit: true, solo: false, features: { stage: true, panels: true, chats: true, cast: true, card: true, memory: false, library: true, sprites: true, subl: true, inner: true, solo: true, drive: true, mirror: true } } };
            const { ctx, page, log } = await open(browser, m, { seed: old });
            const s = await page.evaluate(() => { const x = window.mock.state.extensionSettings['st-duet-stage']; return { f: x.features, solo: x.solo, look: x.look022, sug: getComputedStyle(document.getElementById('duet-sug-btn')).display, link: getComputedStyle(document.getElementById('duet-sync-btn')).display }; });
            const errs = await errorsOf(page, log);
            check(m.label, 'a 0.3.0 settings file upgrades: old switches kept, new ones default on', s.f.memory === false && s.f.drive === true && s.f.suggest === true && s.f.link === true && s.sug !== 'none' && s.link !== 'none' && !errs.page.length && !errs.console.length, { s, errs });
            await ctx.close();
        }

        // ---------- offline and failing model ----------
        {
            const { ctx, page, log } = await open(browser, m, { query: '?fresh=1&offline=1' });
            await page.click('#duet-sug-btn'); await sleep(400);
            const r = await page.evaluate(() => ({ quiet: window.calls.filter((c) => c[0] === 'quiet').length, toast: window.calls.filter((c) => c[0] === 'toast').map((c) => c[2]), sub: document.getElementById('duet-sub').textContent }));
            check(m.label, 'with no AI connected, suggest explains instead of calling', r.quiet === 0 && r.toast.some((t) => /Connect an API/.test(t)) && /Connect an API/.test(r.sub), r);
            await ctx.close();
            const two = await open(browser, m, { query: '?fresh=1&quietfail=1' });
            await two.page.click('#duet-sug-btn'); await sleep(700);
            const r2 = await two.page.evaluate(() => ({ toast: window.calls.filter((c) => c[0] === 'toast').map((c) => c[2]), btn: document.getElementById('duet-sug-btn').disabled, errs: window.pageErrors }));
            check(m.label, 'a failed suggestion call is reported and the button recovers', r2.toast.some((t) => /could not reach/.test(t)) && r2.btn === false && !r2.errs.length, r2);
            await two.ctx.close();
        }

        // ---------- a thinking model (Qwen 3, GLM): its scratch work must never become a chip ----------
        {
            const a = await open(browser, m, { query: '?fresh=1&think=1' });
            await a.page.click('#duet-sug-btn'); await sleep(900);
            const chips = await a.page.evaluate(() => [...document.querySelectorAll('#duet-sug button')].map((x) => x.textContent));
            check(m.label, 'thinking model: only the three replies after the thinking become chips', chips.length === 3 && chips[0] === 'Come here and find out.' && !chips.some((c) => /<\/?think|user wants|Let me keep/i.test(c)), chips);
            await a.page.evaluate(() => document.querySelector('#duet-nav [data-nav="inner"]').click()); await sleep(400);
            await a.page.evaluate(() => document.querySelector('[data-act="ask-inner"]').click()); await sleep(900);
            const inner = await a.page.evaluate(() => { const c = window.mock.state.chat; return String(c[c.length - 1].extra && c[c.length - 1].extra.duet_inner || ''); });
            check(m.label, 'thinking model: the inner voice saves the answer, not the thinking', inner.length > 0 && !/<\/?think|user wants|Let me keep/i.test(inner), inner);
            await a.ctx.close();
            const b = await open(browser, m, { query: '?fresh=1&thinkopen=1' });
            await b.page.click('#duet-sug-btn'); await sleep(1300);
            const r = await b.page.evaluate(() => ({ chips: [...document.querySelectorAll('#duet-sug button')].map((x) => x.textContent), quiet: window.calls.filter((c) => c[0] === 'quiet').length, toast: window.calls.filter((c) => c[0] === 'toast').map((c) => c[2]) }));
            check(m.label, 'thinking model cut off mid-thought even with room: two asks, no chips, and it says so', r.chips.length === 0 && r.quiet === 2 && r.toast.some((t) => /No suggestions came back/.test(t)), r);
            await b.ctx.close();
        }

        // ---------- a model that always thinks first (GLM): the short ask is empty, the roomy one answers ----------
        for (const mode of ['glm', 'glmraw']) {
            const { ctx, page, log } = await open(browser, m, { query: `?fresh=1&${mode}=1` });
            const rooms = () => page.evaluate(() => window.calls.filter((c) => c[0] === 'quiet').map((c) => c[2]));
            await page.click('#duet-sug-btn'); await sleep(1300);
            const chips = await page.evaluate(() => [...document.querySelectorAll('#duet-sug button')].map((x) => x.textContent));
            const r1 = await rooms();
            check(m.label, `${mode}: an empty short ask is asked again once with room to think, and three replies show`, chips.length === 3 && chips[0] === 'Come here and find out.' && r1.join() === '140,2000', { chips, r1 });
            await page.selectOption('#duet-sug-type', 'soft'); await sleep(1100);
            const r2 = await rooms();
            check(m.label, `${mode}: the next ask goes straight to the roomy one`, r2.join() === '140,2000,2000' && await page.evaluate(() => document.querySelectorAll('#duet-sug button').length === 3), r2);
            await page.evaluate(() => document.querySelector('#duet-nav [data-nav="inner"]').click()); await sleep(400);
            await page.evaluate(() => document.querySelector('[data-act="ask-inner"]').click()); await sleep(1100);
            const inner = await page.evaluate(() => { const c = window.mock.state.chat; return String(c[c.length - 1].extra && c[c.length - 1].extra.duet_inner || ''); });
            check(m.label, `${mode}: the inner voice gets an answer too`, inner.length > 0 && !/<\/?think|user wants/i.test(inner) && (await rooms()).join() === '140,2000,2000,2000', inner);
            await page.evaluate(() => { window.mock.state.onlineStatus = 'Featherless · another model'; });
            await page.selectOption('#duet-sug-type', 'bold'); await sleep(1300);
            const r3 = await rooms();
            check(m.label, `${mode}: a changed connection starts from the short ask again`, r3.slice(-2).join() === '140,2000', r3);
            const errs = await errorsOf(page, log);
            check(m.label, `${mode}: no errors`, !errs.page.length && !errs.console.length && !errs.failed.length, errs);
            await ctx.close();
        }

        // ---------- the makeover's own behaviours ----------
        {
            const { ctx, page, log } = await open(browser, m, { query: '?fresh=1' });
            const quiet = () => page.evaluate(() => window.calls.filter((c) => c[0] === 'quiet').map((c) => c[1]));
            await page.click('#duet-sug-btn'); await sleep(900);
            await page.selectOption('#duet-sug-type', 'romance'); await sleep(900);
            const q1 = await quiet();
            check(m.label, 'changing the reply type asks again in the new style', q1.length === 2 && /tender and relationship-first/.test(q1[1]) && await page.evaluate(() => document.querySelectorAll('#duet-sug button').length === 3), q1.length);
            await page.fill('#duet-ta', 'Tell me more.'); await page.click('#duet-send'); await sleep(900);
            check(m.label, 'chips clear after Send', await page.evaluate(() => document.querySelectorAll('#duet-sug button').length === 0));
            await page.click('#duet-under [data-nav="settings"]'); await sleep(300);
            await page.click('#duet-set-sugauto'); await sleep(200);
            const before = (await quiet()).length;
            await page.fill('#duet-ta', 'And then?'); await page.click('#duet-send'); await sleep(2600);
            const after = (await quiet()).length;
            check(m.label, 'auto mode: one suggestion call per reply, none after its own call', after - before === 1 && await page.evaluate(() => document.querySelectorAll('#duet-sug button').length === 3), { before, after });
            const errs = await errorsOf(page, log);
            check(m.label, 'no errors in the makeover pass', !errs.page.length && !errs.console.length && !errs.failed.length, errs);
            await ctx.close();
        }

        // ---------- the talk layout (0.4.0): her on the right panel with her idle clips, your game panel on the left ----------
        {
            const { ctx, page, log } = await open(browser, m, { query: '?fresh=1&idle=1&hearts=1' });
            const box = (sel) => page.evaluate((s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return { l: Math.round(b.left), t: Math.round(b.top), r: Math.round(b.right), b: Math.round(b.bottom) }; }, sel);
            const g = { game: await box('#duet-game'), her: await box('#duet-her'), fig: await box('#duet-fig-r'), log: await box('#duet-log'), comp: await box('#duet-composer') };
            const st = await page.evaluate(() => ({ cls: document.getElementById('duet-scene').className, figL: getComputedStyle(document.getElementById('duet-fig-l')).display, fig: document.getElementById('duet-fig-r').className, src: document.querySelector('#duet-fig-r img')?.getAttribute('src') || '' }));
            check(m.label, 'talk layout is on by default with a character on stage', /is-habit/.test(st.cls) && (await vis(page, '#duet-game')) && (await vis(page, '#duet-her')) && st.figL === 'none', st);
            check(m.label, 'game panel on the left; her, the lines and the chat box inside the right panel', g.game.r <= g.her.l && g.her.l <= g.log.l && g.her.l <= g.comp.l && g.comp.r <= g.fig.r && g.fig.r <= g.her.r && g.fig.l > g.game.r, g);
            check(m.label, 'her [flirty] line plays her own flirty idle clip', /is-idle/.test(st.fig) && /\/characters\/bambi\/desire-flirty-cycle\.gif$/.test(st.src), st);
            const game = await page.evaluate(() => ({ bars: [...document.querySelectorAll('#duet-game [data-bar]')].map((b) => b.dataset.bar + ':' + (b.querySelector('b')?.textContent || '')), mood: document.getElementById('duet-game-mood')?.textContent, head: document.querySelector('#duet-game .dv-ih')?.innerText }));
            check(m.label, "game panel shows level, Card Creator's six Right now bars, her mood and stage", game.bars.join() === 'xp:,aff:64,trust:52,spark:71,comfort:48,jeal:12,energy:80' && game.mood === 'flirty' && /Bambi/.test(game.head) && /Level 1 · Close friends/i.test(game.head), game);
            const duet = await page.evaluate(() => {
                const r = (e) => { const b = e.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom, w: b.width, h: b.height }; };
                const nav = r(document.getElementById('duet-nav')), scene = r(document.getElementById('duet-scene')), game = r(document.getElementById('duet-game'));
                const her = r(document.getElementById('duet-her')), fig = r(document.getElementById('duet-fig-r')), log = r(document.getElementById('duet-log'));
                const them = document.querySelector('#duet-log .dv-turn.them .bubble'), you = document.querySelector('#duet-log .dv-turn.you .bubble');
                const plate = r(them.querySelector(':scope > b')), tb = r(them), yb = r(you);
                const cs = getComputedStyle(them), meter = r(document.querySelector('#duet-game [data-bar="aff"] > i'));
                return {
                    flush: Math.abs(game.l - nav.r) < 2 && Math.abs(game.t - scene.t) < 2 && Math.abs(game.b - scene.b) < 2, gameW: Math.round(game.w), gameBg: getComputedStyle(document.getElementById('duet-game')).backgroundColor,
                    figShare: +(fig.w / her.w).toFixed(2), figH: +(fig.h / scene.h).toFixed(2), figAtEdge: Math.abs(fig.r - her.r) < 2,
                    logW: Math.round(log.w), logWant: Math.round(Math.min(720, her.w * 0.6)), logPad: Math.round(log.l - her.l), padWant: Math.round(Math.max(28, her.w * 0.04)),
                    herRight: tb.r > yb.r && tb.l > yb.l, plateRight: Math.round(tb.r - plate.r), cornerTR: cs.borderTopRightRadius, cornerTL: getComputedStyle(you).borderTopLeftRadius,
                    hairlines: document.querySelectorAll('#duet-game .dv-isec > h4').length, meterH: Math.round(meter.h),
                };
            });
            check(m.label, 'talk layout follows the Duet panels: flat 300px panel flush to the sidebar, her 46% wide at the stage edge, a min(720px, 60%) chat column, her plate on the right', duet.flush && duet.gameW === 300 && duet.gameBg === 'rgb(18, 21, 28)' && Math.abs(duet.figShare - 0.46) < 0.02 && duet.figH >= 0.94 && duet.figAtEdge && Math.abs(duet.logW - duet.logWant) <= 2 && Math.abs(duet.logPad - duet.padWant) <= 2 && duet.herRight && duet.plateRight >= 12 && duet.plateRight <= 16 && duet.cornerTR === '6px' && duet.cornerTL === '6px' && duet.hairlines === 4 && duet.meterH === 8, duet);
            await page.fill('#duet-quest', 'Get her to admit she missed me'); await page.press('#duet-quest', 'Tab'); await sleep(300);
            const quest = await page.evaluate(() => ({ meta: window.mock.state.chatMetadata.duet_quest, saved: window.calls.some((c) => c[0] === 'saveMetadata') }));
            check(m.label, 'the quest saves on this chat', quest.meta === 'Get her to admit she missed me' && quest.saved, quest);
            await page.screenshot({ path: path.join(out, `${m.label}-talk.png`) });
            await page.fill('#duet-ta', 'I missed you.'); await page.click('#duet-send'); await sleep(1100);
            const after = await page.evaluate(() => ({ src: document.querySelector('#duet-fig-r img')?.getAttribute('src') || '', fig: document.getElementById('duet-fig-r').className, stats: document.querySelector('#duet-game .dv-istage')?.innerText.replace(/\s+/g, ' ') }));
            check(m.label, 'her [happy] reply switches to her happy idle clip, and the stats count it', /joy-happy-breath\.gif$/.test(after.src) && /is-idle/.test(after.fig) && /Your lines 2 Her lines 2/i.test(after.stats), after);
            await page.evaluate(async () => { const c = window.mock.state.chat; const last = c[c.length - 1]; last.mes = 'Mm. Go on.'; last.swipes = [last.mes]; await window.mock.eventSource.emit(window.mock.eventTypes.MESSAGE_UPDATED, c.length - 1); }); await sleep(600);
            const calm = await page.evaluate(() => document.querySelector('#duet-fig-r img')?.getAttribute('src') || '');
            check(m.label, 'a line with no mood plays one of her neutral idle clips, never the still', /\/characters\/bambi\/neutral-(chat-idle|hair-sway)\.gif$/.test(calm), calm);
            await page.evaluate(() => window.mock.state.extensionSettings['st-duet-stage'].features.sprites = false); await page.evaluate(() => window.DuetStage.onFeatures()); await sleep(600);
            const noSprites = await page.evaluate(() => ({ src: document.querySelector('#duet-fig-r img')?.getAttribute('src') || '', fig: document.getElementById('duet-fig-r').className }));
            check(m.label, 'Stage sprites off still means her avatar only, no clips', !/is-idle/.test(noSprites.fig) && /thumbnail/.test(noSprites.src), noSprites);
            await page.evaluate(() => window.mock.state.extensionSettings['st-duet-stage'].features.sprites = true); await page.evaluate(() => window.DuetStage.onFeatures()); await sleep(400);
            await page.click('#duet-under [data-nav="settings"]'); await sleep(300);
            await page.click('#duet-drawer [data-feature-toggle="habit"]'); await sleep(500);
            const off = await page.evaluate(() => ({ cls: document.getElementById('duet-scene').className, game: document.getElementById('duet-game').hidden, her: getComputedStyle(document.getElementById('duet-her')).display }));
            check(m.label, 'Talk layout off goes back to the 0.3 stage', !/is-habit/.test(off.cls) && off.game && off.her === 'none', off);
            const errs = await errorsOf(page, log);
            check(m.label, 'no errors in the talk layout pass', !errs.page.length && !errs.console.length && !errs.failed.length, errs);
            await ctx.close();
            const none = await open(browser, m, { query: '?fresh=1&nochar=1' });
            const n = await none.page.evaluate(() => ({ cls: document.getElementById('duet-scene').className, game: document.getElementById('duet-game').hidden }));
            check(m.label, 'with nobody on stage the talk layout stays out of the way', !/is-habit/.test(n.cls) && n.game, n);
            await none.ctx.close();
        }

        // ---------- sizes ----------
        for (const [name, width, height] of [['laptop', 1280, 680], ['small', 1024, 640], ['phone', 390, 844]]) {
            const { ctx, page, log } = await open(browser, m, { width, height, query: '?fresh=1&idle=1&hearts=1' });
            await page.click('#duet-sug-btn').catch(() => {}); await sleep(600);
            const g = await page.evaluate(() => { const r = (id) => { const e = document.getElementById(id); if (!e) return null; const b = e.getBoundingClientRect(); return [Math.round(b.left), Math.round(b.top), Math.round(b.right), Math.round(b.bottom)]; }; return { w: innerWidth, h: innerHeight, comp: r('duet-composer'), under: r('duet-under'), send: r('duet-send'), scrollW: document.documentElement.scrollWidth }; });
            const fits = g.comp && g.comp[0] >= 0 && g.comp[2] <= g.w + 1 && g.send && g.send[2] <= g.w + 1 && g.send[3] <= g.h + 1 && g.scrollW <= g.w + 1;
            const errs = await errorsOf(page, log);
            check(m.label, `${name} ${width}x${height}: chat box and Send fit on screen`, fits && !errs.page.length && !errs.console.length, { g, errs });
            const t = await page.evaluate(() => { const r = (id) => { const e = document.getElementById(id); const b = e.getBoundingClientRect(); return [Math.round(b.left), Math.round(b.top), Math.round(b.right), Math.round(b.bottom)]; }; return { habit: /is-habit/.test(document.getElementById('duet-scene').className), game: r('duet-game'), her: r('duet-her'), comp: r('duet-composer'), log: r('duet-log'), fig: r('duet-fig-r'), idle: /is-idle/.test(document.getElementById('duet-fig-r').className), w: innerWidth, h: innerHeight }; });
            const apart = (a, b) => a[2] <= b[0] || b[2] <= a[0] || a[3] <= b[1] || b[3] <= a[1];
            const onScreen = (a) => a[0] >= 0 && a[1] >= 0 && a[2] <= t.w + 1 && a[3] <= t.h + 1;
            const sideBySide = name === 'phone' ? t.game[3] <= t.her[1] : t.game[2] <= t.her[0];
            check(m.label, `${name} ${width}x${height}: talk layout keeps the game panel ${name === 'phone' ? 'above' : 'left of'} her panel, clear of the chat box and lines`, t.habit && t.idle && sideBySide && apart(t.game, t.comp) && apart(t.game, t.log) && [t.game, t.her, t.comp].every(onScreen) && t.fig[2] <= t.her[2] + 1, t);
            await page.screenshot({ path: path.join(out, `${m.label}-${name}.png`) });
            await ctx.close();
        }
    } catch (e) {
        check('harness', 'ran to the end', false, String(e && e.stack || e));
    } finally {
        await browser.close();
        servers.forEach((s) => s.kill());
    }
    for (const [label, list] of Object.entries(results)) {
        console.log(`\n== ${label}`);
        for (const r of list) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.ok ? '' : '\n      ' + String(JSON.stringify(r.detail)).slice(0, 900)}`);
    }
    console.log(`\n${failed ? failed + ' FAILED' : 'ALL PASSED'}`);
    process.exit(failed ? 1 : 0);
})();
