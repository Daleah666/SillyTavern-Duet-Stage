/**
 * On/off switches for Duet Stage. Missing keys stay on, so an older
 * settings file keeps the stage the user already had. Turning one off
 * only skips that feature. It does not delete the others' saved data.
 */

export const FEATURES = [
    { id: 'stage', label: 'Stage takeover', blurb: 'The visual-novel shell and the moved chat column.' },
    { id: 'panels', label: 'Side panel', blurb: 'The right-hand panel. The panel element stays in the page so other extensions are not left without it.' },
    { id: 'chats', label: 'Chats', blurb: 'New chat and the list of this character\'s chats.' },
    { id: 'cast', label: 'Cast', blurb: 'Personas on the left and characters on the right.' },
    { id: 'card', label: 'Card', blurb: 'Edit the open character card.' },
    { id: 'memory', label: 'Memory', blurb: 'Duet memory saved on the chat and added to the prompt.' },
    { id: 'library', label: 'Library', blurb: 'Expression sprites, bulk import, and the Claude library index.' },
    { id: 'sprites', label: 'Stage sprites', blurb: 'Show expression sprites on the stage. Off uses the avatar only.' },
    { id: 'subl', label: 'Subliminals', blurb: 'Short lines that drift across the stage.' },
    { id: 'inner', label: 'Inner voice', blurb: 'Asides you write, or one quiet question to the connected model.' },
    { id: 'solo', label: 'Solo Stage', blurb: 'Hide your side of the stage.' },
    { id: 'drive', label: 'Drive sync', blurb: 'Save and load cast, cards, memory, sprites and subliminals on Google Drive.' },
    { id: 'mirror', label: 'Mirror', blurb: 'The mirror page.' },
];

const IDS = new Set(FEATURES.map((feature) => feature.id));

export function knownFeature(id) {
    return IDS.has(id);
}

export function ensureFeatures(settings) {
    if (!settings.features || typeof settings.features !== 'object' || Array.isArray(settings.features)) {
        settings.features = {};
    }
    for (const feature of FEATURES) {
        if (typeof settings.features[feature.id] !== 'boolean') settings.features[feature.id] = true;
    }
    return settings.features;
}

export function featureOn(settings, id) {
    const map = settings?.features;
    if (!map || typeof map[id] !== 'boolean') return true;
    return map[id];
}

export function setFeature(settings, id, on) {
    if (!knownFeature(id)) return false;
    ensureFeatures(settings);
    settings.features[id] = !!on;
    return true;
}
