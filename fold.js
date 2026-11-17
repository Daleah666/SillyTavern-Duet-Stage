/**
 * Folding the side panels away: the game panel on the left (vn.js), #duet-side-panel on the right (index.js),
 * and on the Clean stage the two framed figures (vn.js), which tuck into their own edges.
 *
 * A fold is remembered per screen size in settings.panelFold, so folding a panel on the small monitor
 * leaves it open on the big one. Esc folds the panel you are in, else the right one, else the left one,
 * but only when nothing else (a drawer, the menu, a popup) is waiting for that Esc. On a compact window a
 * click on the stage outside an open panel folds it too. Each folded panel leaves a tab at its edge.
 */

/* the widths match the breakpoints in style.css: 1100px is where the stage starts to crowd */
const SIZES = [['compact', 1100], ['regular', 1999], ['wide', Infinity]];

export function screenSize(width = window.innerWidth) {
    return SIZES.find(([, max]) => width <= max)[0];
}

export function ensureFold(s) {
    if (!s.panelFold || typeof s.panelFold !== 'object' || Array.isArray(s.panelFold)) s.panelFold = {};
    return s.panelFold;
}

export function isFolded(s, which) {
    const at = ensureFold(s)[screenSize()];
    return !!(at && at[which]);
}

export function setFolded(s, which, on) {
    const fold = ensureFold(s);
    const key = screenSize();
    fold[key] = { ...(fold[key] && typeof fold[key] === 'object' ? fold[key] : {}), [which]: !!on };
}

const foldables = [];

/* { which, el: () => Element, tab: () => Element, isOpen: () => boolean, fold: () => void, outside?: false }
   outside: false keeps a click elsewhere from folding it (the Clean stage frames sit beside the chat you click into) */
export function registerFoldable(entry) {
    const at = foldables.findIndex((f) => f.which === entry.which);
    if (at >= 0) foldables[at] = entry;
    else foldables.push(entry);
}

const shown = (el) => !!(el && !el.hidden && el.getClientRects().length);

function somethingElseWantsEsc() {
    return ['#duet-menu', '#duet-drawer', '#duet-find', '#stcc-modal'].some((sel) => shown(document.querySelector(sel)))
        || !!document.querySelector('dialog[open]');
}

const inside = (node, el) => !!(el && node && el.contains(node));

function onKey(ev) {
    if (ev.key !== 'Escape' || ev.defaultPrevented || ev.isComposing) return;
    if (somethingElseWantsEsc()) return;
    const open = foldables.filter((f) => f.isOpen());
    if (!open.length) return;
    const own = open.find((f) => inside(ev.target, f.el()));
    if (!own && ev.target?.closest?.('input, textarea, select, [contenteditable="true"]')) return;
    (own || open[0]).fold();
}

function onPointer(ev) {
    if (screenSize() !== 'compact') return;
    const t = ev.target;
    if (!t?.closest || !t.closest('#duet-vn, #sheld, #duet-stage')) return;
    if (t.closest('#duet-menu, [data-duet-menu], #duet-drawer, #duet-find')) return;
    for (const f of foldables) {
        if (f.outside === false || !f.isOpen()) continue;
        if (foldables.some((g) => inside(t, g.el()) || inside(t, g.tab()))) continue;
        f.fold();
    }
}

let bound = false;

export function bindFoldKeys() {
    if (bound) return;
    bound = true;
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('pointerdown', onPointer, true);
}
