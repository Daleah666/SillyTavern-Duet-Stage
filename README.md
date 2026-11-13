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

## The Duet Staging look (0.3.1)

The stage now wears the Duet Staging page's clothes: Unbounded, Instrument Sans, Instrument Serif and IBM Plex Mono (loaded from Google Fonts by `style.css`), the same dark tokens, pink for her and lime for you. Her card's own colour (`extensions.companion_stage.color`) replaces the pink when it is a hex colour.

- Sidebar is 272px with the gradient mark, the Ctrl K chip, and a **Characters** strip of portrait tiles with names.
- Lines are glass bubbles with a coloured name plate. Her newest line glows.
- The chat box is one glass card: Characters, both chips, her name and connection status, New chat, Memory, +. Under it sits the little bar: **ST chat**, **Calm** (stops the idle sway) and **Settings**.
- **✨ suggestions**: three short replies from the connected model through `generateQuietPrompt`, in the style picked beside Reroll (Spicy, Romance, Soft, Even, Bold, Playful, Informative, Controversial). A click puts one in the box. Settings has a switch to ask for them after every line she says; that costs one extra short call per line.
- She stands big on the right with her name behind her, and the chat sits beside her. This is Solo Stage, switched on once by 0.3.1; Solo Stage in the sidebar switches the two-character stage back.
- A narrow box drops chips and wraps its buttons instead of overflowing. Under 820px the sidebar folds to icons.

## The Duet Staging link (sync.js, 0.3.1)

With the **Duet Stage Companion** Chrome extension (0.2.0+, `chrome-companion/` in the desktop-companion repo) installed, a 🔗 button appears in SillyTavern's top bar. Open Duet Staging (the Claude page) in another tab of the same Chrome and the dot turns green. From then on:

- **ST → stage**: her card (as chara_card_v2) and portrait, your persona name, the open chat's last 40 lines, every new line, and her expression as a mood.
- **Stage → ST**: lines written on the stage (`/sendas`, `/send`, `/sys`; no generation here), her moods (`/emote`), her card (fills empty fields and `extensions.companion_stage`; "Replace her card" overwrites), her pictures as sprites, and memories into this chat's Duet memory.
- Loops are stopped by marks: lines from the stage carry `extra.duet_id` here, lines from here are `by:"st"` there.

The Claude page cannot be framed or opened as a linked popup (its `frame-ancestors` and opener policies forbid it), which is why the companion carries the messages: `st-bridge.js` in the SillyTavern tab, `bridge.js` in the stage tab, `background.js` between them. Nothing is stored and nothing leaves the browser.

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

Stage takeover, Side panel, Chats, Cast, Card, Memory, Library, Stage sprites, Subliminals, Inner voice, Solo Stage, Drive sync, Mirror, Reply suggestions, Duet Staging link.

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

## Checks

`test/standin/` is a stand-in SillyTavern: one page, a mock `SillyTavern.getContext()`, and a few `/api` routes. It is enough for the extension to boot, send, suggest, link and open its drawers in a real browser. It is not a SillyTavern install, so it says nothing about SillyTavern's own CSS or a real model.

```bash
node --test test/duet-hub.test.mjs
```

```bash
node test/standin/smoke.js
```

The second needs Playwright with Chromium. It serves this folder on port 8765 (not 8000, where a real SillyTavern may be running), runs the checks at three screen sizes, and exits non-zero if one fails. Add a query flag to `host.html` and a check to `smoke.js` for anything new: `?think=1`, `?glm=1` and `?offline=1` are examples.

Models that think first: a short ask can come back empty. Suggestions (140 tokens) and the inner voice (80) are asked again once with 2000, then go straight to 2000 while the same connection is up.

## How changes land here

Bots: read [`bot-pack.json`](bot-pack.json) first. It is one file with the rules, the checks, the board format and how to hand work back, and `AGENTS.md` points to it.

One door. Anyone building on this extension (Cursor, another Claude session, a person) opens a pull request against `main` and leaves it unmerged. The Claude session named **SillyTavern merge door** checks it against the current `main`, merges both sides if `main` has moved, runs the checks, and merges it. Red can still merge a pull request herself.

Do not upload or paste files over `main`. This extension updates itself in SillyTavern on every refresh, so a copy built on an older version silently undoes whatever landed since. Keep `autoupdate.js` and `"auto_update": true`, and add a line to `board.jsonl` for anything Red will notice.
