# Duet Stage for SillyTavern

Install in SillyTavern: Extensions (the blocks icon) → **Install extension** → paste

    https://github.com/Daleah666/SillyTavern-Duet-Stage

`manifest.json` is at the repo root on `main`. Leave the branch field empty, or set it to `main`.

Manual install: copy this folder into `data/<user>/extensions/st-duet-stage/` and reload. SillyTavern serves it at `/scripts/extensions/third-party/st-duet-stage/`.

No build step. Vanilla JS and jQuery, same as SillyTavern's own extensions. No API keys live in this repo. Send, Continue and Reroll use whatever connection SillyTavern already has.

## What you get

A one-on-one visual novel on top of the open SillyTavern chat. Your persona stands on the left, their character on the right, and the dialogue runs between them.

- **Cast** lists SillyTavern characters (right) and personas (left). Create a character, import a PNG or JSON card, or pick a persona. An optional stand-in card can pose on your side; lines still send as the persona.
- **Card** edits the open character (description, personality, scenario, first message, examples, prompts, notes, tags) through SillyTavern's character save.
- **New chat** starts a SillyTavern chat and reopens an older one.
- **Send / Continue / Reroll** call SillyTavern `generate('normal')`, `generate('continue')` and `swipe.right`. The microphone uses the browser's speech recognition when it has one.
- **Memory** is stored in chat metadata (`duet_memory`) and injected with `setExtensionPrompt`. The author's note field is SillyTavern's own note.
- **Library** lists her expression sprites from `GET /api/sprites/get` and can upload or delete one. A `[mood]` tag in a line picks a matching sprite. If she has no sprites, the stage uses her avatar.
- **Subliminals** and **Inner voice** drift lines you write. Inner voice can also ask the connected model, via `generateQuietPrompt`, and store the thought on her last message.
- **Solo Stage** hides your side so she stands alone. The Claude ledger page (gauges, growth) is not part of SillyTavern; More → Experimental says what else stayed behind.
- The SillyTavern chat column still docks middle, left or right, resizes, scales message text with Ctrl+wheel, and stows. It starts stowed so the stage is the chat. **ST chat** brings the column back.
- A right-side panel, `#duet-side-panel`, with a body `#duet-rail-body`. Other extensions attach their tabs there.

## Settings

`extensionSettings['st-duet-stage']`

| key | meaning |
| --- | --- |
| `dock` | `middle`, `left`, or `right` |
| `width` | chat column width in pixels |
| `textScale` | message-text multiplier (Ctrl+wheel) |
| `stowed` | chat column tucked away |
| `panelOpen` | side panel open |
| `panelWidth` | side panel width in pixels |
| `navCollapsed` | sidebar collapsed to icons |
| `solo` | hide the left figure |
| `leftAvatar` | optional character avatar standing on the left |
| `personaKey` | last persona picked in Cast |
| `subl` | subliminal lines, interval, strength |
| `inner` | drifting thoughts, per character avatar |
| `features` | on/off for each feature. Missing keys stay on |
| `drive` | Google client ID and tokens for this user only. Never commit them |

## Features, one switch each

SillyTavern's extension settings, and **More → Settings** on the stage, each have a checkbox:

Stage takeover, Side panel, Chats, Cast, Card, Memory, Library, Stage sprites, Subliminals, Inner voice, Solo Stage, Drive sync, Mirror.

Turning one off hides that part and skips its work. The chat SillyTavern already had keeps working. Saved lines, cards and tokens stay where they were. The side-panel element stays in the page when its switch is off, so another extension looking for `#duet-side-panel` does not crash. Stage takeover off removes the column styling and the visual-novel shell.

## Drive and the library

**More → Drive.** Paste the public OAuth client ID once (not a secret), allow the redirect URI shown on that page, and sign in. The token is kept in SillyTavern extension settings and in this browser. Save writes cast, cards, memory, subliminals and sprite files to a Drive folder named Duet Stage Hub. Load reads that file and any pictures already in Nova Ai Data, then copies the original bytes into SillyTavern. Nothing is resized.

**Library** can add many pictures at once, import card files, and add the cast names from the Claude library index (names only, no drawn pictures). A picture whose file name matches that index is filed on that character. Tiles use `object-fit: contain`.

## For other extensions

`window.DuetStage` (what st-card-creator 0.1.5 calls):

- `toggleSidePanel()` toggles the class `open` on `#duet-side-panel`.
- `stageMode.setActive(false)` removes `duet-stage-collapsed` so the rail can open fully.
- `registerPanel(name, onClick, label)` / `listPanels()`.
- The panel's first child is `.duet-sp-resize`, then `.duet-sp-head`, then `#duet-rail-body`. Put tabs directly before `#duet-rail-body`.

The theater-masks button on the chat bar opens **Show Side Panel**.

## Auto-update and the 📣 board

- **It updates itself.** On every refresh, `autoupdate.js` asks SillyTavern whether this folder is behind GitHub (`/api/extensions/version`). If it is, it runs the same update as Manage extensions → Update (`/api/extensions/update`) and reloads once. `"auto_update": true` in `manifest.json` also lets SillyTavern update it when SillyTavern itself updates.
- **The board.** `board.jsonl` is this repo's message board, in the house format (`{"t","who","to","kind","text"}`, one line each, 200 characters, no keys or private data). New lines addressed to `red`, `all` or nobody show as toasts in SillyTavern after a refresh. Bots: append a line and push to talk to Red here.
- **Mirroring.** Keep `autoupdate.js`, its import at the top of `index.js`, `board.jsonl` and `"auto_update": true` when you mirror this extension from its source branch.
