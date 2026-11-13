# For bots

Read [`bot-pack.json`](bot-pack.json) before you change anything. It has the rules, the checks, the board format and how to hand work back.

The short version:

- Both extensions update themselves in Red's SillyTavern on every refresh. Whatever lands on `main` is live.
- Start a branch from the **current** `main`. Open a pull request. Leave it unmerged.
- Never upload or paste files over `main`. Never build on an old copy.
- Keep `autoupdate.js` and `"auto_update": true`.
- Never touch Red's AI connection, keys or SillyTavern settings.
- Run `node --test test/duet-hub.test.mjs` and `node test/standin/smoke.js` in SillyTavern-Duet-Stage.
- The Claude session titled **SillyTavern merge door** merges. Red can too.
