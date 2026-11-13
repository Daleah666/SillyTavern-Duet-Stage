import assert from 'node:assert/strict';
import test from 'node:test';
import { featureOn, setFeature } from '../features.js';
import { originalImage } from '../images.js';
import { buildHubDocument, readHubDocument } from '../drive.js';
import { LIBRARY_CATALOG } from '../library-catalog.js';
import { catalogCastNames, characterForFile } from '../library-transfer.js';

test('feature switches default on and do not clear each other', () => {
    const settings = {};
    assert.equal(featureOn(settings, 'library'), true);
    assert.equal(featureOn(settings, 'drive'), true);
    setFeature(settings, 'library', false);
    assert.equal(featureOn(settings, 'library'), false);
    assert.equal(featureOn(settings, 'drive'), true);
    assert.equal(featureOn(settings, 'stage'), true);
    assert.equal(featureOn(settings, 'subl'), true);
    assert.equal(setFeature(settings, 'not-a-feature', false), false);
});

test('reply suggestions and the Duet Staging link have their own switches', () => {
    const settings = {};
    assert.equal(featureOn(settings, 'suggest'), true);
    assert.equal(featureOn(settings, 'link'), true);
    assert.equal(setFeature(settings, 'suggest', false), true);
    assert.equal(featureOn(settings, 'suggest'), false);
    assert.equal(featureOn(settings, 'link'), true);
    assert.equal(featureOn(settings, 'drive'), true);
});

test('image import keeps the original bytes', async () => {
    const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4, 9, 8]);
    const file = new File([bytes], 'wide-and-tall.png', { type: 'image/png' });
    const same = originalImage(file);
    assert.equal(same, file);
    assert.equal(same.size, bytes.length);
    const wrapped = originalImage(new Blob([bytes], { type: 'image/png' }), 'wide-and-tall.png');
    assert.equal(wrapped.size, bytes.length);
    assert.equal(wrapped.type, 'image/png');
    assert.equal(wrapped.name, 'wide-and-tall.png');
    const copy = new Uint8Array(await wrapped.arrayBuffer());
    assert.deepEqual([...copy], [...bytes]);
});

test('hub file is data only', () => {
    const doc = buildHubDocument({
        cast: { personaKey: 'me', leftAvatar: '', personas: [], characters: [{ name: 'Redz', avatar: 'redz.png' }] },
        cards: [{ spec: 'chara_card_v2', spec_version: '2.0', data: { name: 'Redz', description: 'A card.' } }],
        memory: [{ avatar: 'redz.png', chat: 'chat', duet_memory: 'She remembers.', note_prompt: '' }],
        subliminals: { on: true, phrases: 'hello', everyS: 7, alpha: 0.3 },
        library: [{ character: 'Redz', label: 'happy', fileName: 'happy.png' }],
    });
    const again = readHubDocument(doc);
    assert.equal(again.kind, 'duet-stage-hub');
    assert.equal(again.cards[0].data.name, 'Redz');
    assert.equal(again.memory[0].duet_memory, 'She remembers.');
    assert.equal(JSON.stringify(again).includes('accessToken'), false);
    assert.equal(JSON.stringify(again).includes('client_secret'), false);
    assert.throws(() => readHubDocument({ kind: 'other' }), /not_hub/);
});

test('Claude catalog is names only', () => {
    assert.equal(LIBRARY_CATALOG.length, 106);
    const names = catalogCastNames();
    assert.ok(names.includes('Bambi'));
    assert.ok(names.includes('Redz'));
    for (const item of LIBRARY_CATALOG) {
        assert.equal('prompt' in item, false);
        assert.equal('bytes' in item, false);
        assert.equal('src' in item, false);
    }
    assert.equal(characterForFile('redz.png'), 'Redz');
});
