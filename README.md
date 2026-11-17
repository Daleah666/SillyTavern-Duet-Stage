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

## The talk layout (0.4.0)

On by default whenever a character is on stage (Settings → **Talk layout** switches it off; with nobody on stage the 0.3 stage shows as before).

- **Set up like the Duet artifact.** A flat 300px panel sits flush against the sidebar. It is the Duet's right-hand info panel, mirrored to your side, with the same header line, hairline section headers, glass boxes, stat grid and 8px meters. The rest is a full-bleed stage. She stands at its right edge, 46% wide and 95% high, behind a `min(720px, 60%)` chat column. Her lines sit on the right with her name plate on the right and your lines on the left, and her newest line lifts with a shadow in her colour. At 1100px and under she dims behind the chat and the panel narrows to 260px. Above 1100px, an open drawer makes the chat column narrow so Send stays clear.
- **Right: her side of the stage.** Her figure plays her own idle clips: sprite files in her SillyTavern sprite folder that are a `.gif` or have idle, breath, cycle, bounce, sway, flourish or wave in the name (the same rule Card Creator uses), plus the `/characters/…` idle clips Card Creator wired into `companion_stage.media`. The clip follows her mood from the file name: a `[flirty]` line plays `desire-flirty-cycle.gif`, `[happy]` plays `joy-happy-breath.gif`, and a line with no mood plays one of her `neutral-…` clips, stepping to the next one each line. A non-neutral SillyTavern expression still wins. With no clip for the mood her still for it is used, and with no clips at all the neutral still and then her avatar. Stage sprites off still means avatar only. Calm still stops the sway. Nothing new is drawn or generated.
- **Left: your game panel.** Her name with where you two stand, the scene notes (below), Card Creator's 💗 Right now bars (Affection, Trust, Spark, Comfort, Jealousy, Energy), and line and token counts. The bars are read from `extensionSettings['st-card-creator'].hearts` and never written here; until Card Creator has scored her, the panel says so.

## The scene notes (0.5.0)

The game panel follows the chat. Four notes: **Scene** (where you are and what is happening), **Mood** (hers), **Quest** (what you are after) and **Bond** (where you two stand).

- **The AI fills them.** After each of her replies, the extension asks the AI SillyTavern is connected to once, through `generateQuietPrompt` (the same quiet call ✨ suggestions use, with the same handling for thinking models). The model gets the chat SillyTavern already sends plus the notes so far, and answers four `Scene: / Mood: / Quest: / Bond:` lines. Nothing is added to her prompt and her replies are not changed. It costs one short extra call per reply. ↻ **Read the scene now** asks straight away.
- **You can always edit.** Type in any note and it is marked *yours*: the AI is told it and never replaces it. Empty it and the AI takes it back on the next read. Notes the AI wrote are marked *AI*.
- **Before the first read**, mood shows greyed out from her line's tag (or Card Creator) and bond from Card Creator's bars.
- An answer that is not in the four-line format fills nothing (↻ says so). With no AI connected, nothing is asked.
- Settings → **Scene notes by AI** switches the asking off; the notes stay and stay editable.
- Saved on the chat as `chatMetadata.duet_scene` (`scene`, `mood`, `quest`, `bond`, plus which are `mine` and which `ai`). A 0.4.0 quest (`duet_quest`) carries over as yours.
- 0.4.0's placeholder level (one per 20 lines) is gone.
- Under 820px the game panel becomes a short strip above the stage (the Duet slides its panel off screen there instead).

## The Clean stage (0.6.0, on by default)

The stage from the Duet Staging artifact (claude.ai/artifact/XgdMmbrxNYG2WhC9Pt2oEd, captured 2026-11-17): just the two of you and the chat.

- **You on the left, her on the right, the dialogue between.** Your persona picture stands on your side in the artifact's frame (rounded top, fading into the floor). Her sprite or idle clip fills her side. Whoever did not say the last line steps back a little.
- **It follows the window.** The chat column is `clamp(520px, 28vw + 140px, 1000px)`: about 520px on a 1366px laptop, 680px at 1920 (the artifact's width), 860px at 2560, 1000px on a 5120px ultrawide. Each figure hugs the column and is never wider than the stage is tall, so on an ultrawide the spare room goes to the far edges instead of a gap in the middle. Under 820px she stands behind the chat and you sit small at the bottom left, as on the artifact.
- **Tucking away.** Each side has a ✕. **Esc** tucks her first, then you, and does nothing while you type. A tucked side slides out past its edge and leaves a tab with the name on it (her tab on the right edge); click it to bring her back. Tucked or not is remembered per screen size, like the panels below. Clicks in the chat never tuck anyone.
- **What waits.** While it is on, the game panel, the right side panel and other extensions' side HUDs (Soft Soft's notes panel, COM-69's side bars and meters chip) are hidden, the talk layout's AI scene notes stop asking, and a saved left-side character (`leftAvatar`) and Solo Stage wait. Nothing is deleted: switch **Clean stage** off in Settings and all of it comes back as it was.

## Side panels that fit the screen and fold away (0.6.0, with the Clean stage off)

- **They follow the window.** The game panel is `clamp(248px, 14vw + 40px, 420px)`: 248px on a 1366px laptop, about 310px at 1920, 400px at 2560 and up. The chat column is `min(clamp(720px, 34vw, 980px), 60% of the stage)`. Her sprite now fills her side of the stage (it used to stop at the picture's own pixel size, so a 1024px sprite stayed small on a big screen). The right side panel, untouched, is 17% of the window between 300 and 520px; a width you drag is kept, up to 45% of the window.
- **Closing.** Each panel has a 36px ✕ in its header. **Esc** closes the panel you are in, else the right one, else the game panel; it leaves a drawer, the menu or a popup to close first, and does nothing while you type in the chat box. Under 1100px wide a click on the stage outside an open panel closes it.
- **Bringing it back.** A closed panel leaves a tab at its edge (**Game** on the left, **Panel** on the right), above other extensions' docks. Click it to open the panel again. The chat column stays where it was when the game panel closes, so it never slides under another extension's left panel.
- **The right panel's ✕ is pinned to its top corner**, under SillyTavern's top bar. Card Creator's docks sit above the panel's header, and that used to push the ✕ down under COM-69's side bars.
- **Per screen size.** Closed or open is remembered separately for compact (1100px and under), regular (up to 1999px) and wide windows, so closing it on the small monitor leaves it open on the big one.

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
| `panelWidth` | side panel width in pixels, used once you drag it (`panelSized`) |
| `panelFold` | closed panels and tucked Clean stage sides per screen size: `{ compact, regular, wide }`, each `{ game, side, you, them }` |
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

Stage takeover, Side panel, Chats, Cast, Card, Memory, Library, Stage sprites, Subliminals, Inner voice, Solo Stage, Talk layout, Drive sync, Mirror, Reply suggestions, Duet Staging link.

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

The second needs Playwright with Chromium. It serves this folder on port 8765 (not 8000, where a real SillyTavern may be running), runs the checks at three screen sizes, and exits non-zero if one fails. Add a query flag to `host.html` and a check to `smoke.js` for anything new: `?think=1`, `?glm=1` and `?offline=1` are examples. `?idle=1` gives Bambi a sprite folder with two idle GIFs and `?hearts=1` seeds Card Creator's Right now bars, for the talk layout.

Models that think first: a short ask can come back empty. Suggestions (140 tokens) and the inner voice (80) are asked again once with 2000, then go straight to 2000 while the same connection is up.

## How changes land here

Bots: read [`bot-pack.json`](bot-pack.json) first. It is one file with the rules, the checks, the board format and how to hand work back, and `AGENTS.md` points to it.

One door. Anyone building on this extension (Cursor, another Claude session, a person) opens a pull request against `main` and leaves it unmerged. The Claude session named **SillyTavern merge door** checks it against the current `main`, merges both sides if `main` has moved, runs the checks, and merges it. Red can still merge a pull request herself.

Do not upload or paste files over `main`. This extension updates itself in SillyTavern on every refresh, so a copy built on an older version silently undoes whatever landed since. Keep `autoupdate.js` and `"auto_update": true`, and add a line to `board.jsonl` for anything Red will notice.
