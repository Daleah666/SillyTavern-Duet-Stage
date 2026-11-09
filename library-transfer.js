/**
 * The Claude artifact library index: who each picture belonged to.
 * The index has no image bytes. Pictures arrive from a file upload or
 * from Drive, and those files are stored unchanged.
 */

import { LIBRARY_CATALOG } from './library-catalog.js';
import { displayName, labelFromName } from './images.js';

export function catalogCastNames() {
    const names = new Map();
    for (const item of LIBRARY_CATALOG) {
        const chars = Array.isArray(item.chars) ? item.chars : [];
        for (const id of chars) {
            const key = String(id || '').trim().toLowerCase();
            if (!key || names.has(key)) continue;
            names.set(key, displayName(id));
        }
    }
    return [...names.values()];
}

export function characterForFile(fileName) {
    const lower = String(fileName || '').toLowerCase();
    const stem = labelFromName(fileName).toLowerCase();
    const hit = LIBRARY_CATALOG.find((item) => {
        const name = String(item.name || '').toLowerCase();
        const label = String(item.label || '').toLowerCase();
        const bare = name.replace(/\.[^.]+$/, '');
        return name === lower || bare === stem || label === stem;
    });
    if (hit && Array.isArray(hit.chars) && hit.chars.length) return displayName(hit.chars[0]);
    return '';
}

export function catalogEntries() {
    return LIBRARY_CATALOG;
}
