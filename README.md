# The Hollow Ledger

A solo tabletop game set at Hogwarts in 1932, under Headmaster Dippet — an original story in a
book-accurate world, told one turn at a time by an AI Game Master that runs on your own API key.

## Running it from this repo

1. Install Node.js (https://nodejs.org), then in this folder: `npm install`
2. `node server.js` — opens the table at http://localhost:7439. The server starts the Game Master
   engine itself once a key is set, and the studio voice sidecar if `voice/venv` exists.
3. The first page asks for an API key (console.anthropic.com → API keys → create key). It is stored
   only in `.env`, in this folder. Each turn costs a few cents; the meter in the top bar keeps count.
4. **Begin a new story**, or **import a campaign file** (`.hlcampaign.zip`) someone sent you.

`start-table.bat` does step 2 and opens the site in an app window.

## Playing

Everything you play lives in `saves/<slot>/`. **⚑ load game** switches campaigns; **⤓ export** packs a
campaign into one file to send to someone else; **⤒ import** receives one. The Case File keeps
objectives, questions, clues, milestones, people and what the Ledger took; click any card for its
full text and the moments in the record where it came up.

## Building a release for someone else

`node release.js` builds `dist/hollow-ledger-<version>/` — the runtime, the world kit
(`world/`), music, portraits and voice-pack code, with no campaign, no key and no Python environment.
Add `--with-node` to bundle a portable `node.exe` (put one at `tools/node-win-x64/node.exe` first)
so Windows players install nothing. `node release.js --brief` regenerates `gm-brief.md`, the public
copy of the Game Master's brief.

## Voices

Out of the box an online neural narrator reads (internet required); offline, the browser's own voice.
The optional **studio voice pack** gives every character their own recorded voice — see
`voice/README.md` in a built release. The table's voice chip shows which source is speaking.

## Credits

The Hollow Ledger is an original, unofficial, non-commercial fan work set in the world of the Harry
Potter novels, which belong to J.K. Rowling and her publishers.

Music by Kevin MacLeod (incompetech.com), Creative Commons: By Attribution 4.0 — see
`music/credits.txt`. Typefaces: IM Fell English (Igino Marini) and EB Garamond (Georg Duffner),
SIL Open Font License, via Google Fonts.

Free to play and to share as-is; please don't sell it.
