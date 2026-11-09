# st-duet-stage · Duet chat column for SillyTavern

Install in SillyTavern: Extensions (the blocks icon) → **Install extension** → paste

    https://github.com/Daleah666/SillyTavern-Duet-Stage

and, if the dialog has a branch field, use `st-duet-stage`. This branch holds the extension at its root (manifest.json beside this file). The source of truth is `st-duet-stage/extension/` on the main branches; this branch is a mirror for the installer.

Manual install: copy this folder into `data/<user>/extensions/third-party/st-duet-stage/` and reload.

No build step. Vanilla JS and jQuery, same as SillyTavern's own extensions.

## What you get

- The chat column (`#sheld`) docks in the **middle** (1-on-1) or to the **left** or **right** (duet, stage beside the chat). Drag the column's inner edge to resize it.
- **Ctrl + wheel** over the column scales message text only (`.mes_text`). The bar, the input, and the sprite stay put.
- Tooltips inside the column and the side panel open **above the pointer**.
- **Stow** tucks the chat away. A tab brings it back.
- Her expression sprite stands on a dark stage behind the column, or beside it when the chat is docked to a side, with a small idle sway. Sprites are read from `GET /api/sprites/get?name=<folder>` (her avatar file name, then her display name). If that folder is empty, the stage uses her existing avatar at `/characters/<avatar>`. This extension does not generate or ship character art.
- A right-side panel, `#duet-side-panel`, with a body `#duet-rail-body`. Other extensions attach their tabs there.

## Settings

`extensionSettings['st-duet-stage']`

| key | meaning |
| --- | --- |
| `dock` | `middle`, `left`, or `right` |
| `width` | chat column width in pixels |
| `textScale` | message-text multiplier (Ctrl+wheel) |
| `stowed` | chat tucked away |
| `panelOpen` | side panel open |
| `panelWidth` | side panel width in pixels |

## For other extensions

`window.DuetStage` (what st-card-creator 0.1.5 calls):

- `toggleSidePanel()` toggles the class `open` on `#duet-side-panel`.
- `stageMode.setActive(false)` removes `duet-stage-collapsed` so the rail can open fully.
- `registerPanel(name, onClick, label)` / `listPanels()`.
- The panel's first child is `.duet-sp-resize`, then `.duet-sp-head`, then `#duet-rail-body`. Put tabs directly before `#duet-rail-body`.

The theater-masks button on the chat bar opens **Show Side Panel**.
