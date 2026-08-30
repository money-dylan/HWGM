// Build a shippable copy of The Hollow Ledger:  node release.js [outdir]
// Copies the world kit and the runtime — never a campaign, never the .env, never the
// 5 GB voice environment. The result runs with `start.bat` (needs Node) and asks for
// an API key on first open.
const fs = require('fs');
const path = require('path');
const dir = __dirname;
const VERSION = require('./package.json').version;
const outArg = process.argv.slice(2).find(a => !a.startsWith('--'));
function briefText() { return fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8').split(/\r?\n/).filter(l => !/claude|anthropic|C:\\Users|\.claude\b/i.test(l)).join('\n'); }
// --brief: only regenerate ./gm-brief.md (the public copy of the GM brief, committed to the repo)
if (process.argv.includes('--brief')) { fs.writeFileSync(path.join(dir, 'gm-brief.md'), briefText()); console.log('gm-brief.md regenerated'); process.exit(0); }
const out = path.resolve(outArg || path.join(dir, 'dist', 'hollow-ledger-' + VERSION));

const FILES = ['server.js', 'engine.js', 'gm.js', 'save.js', 'hollow-ledger.html', 'package.json', 'package-lock.json', 'voice-bible.md', 'roll-doctrine.md'];
const DIRS = ['world', 'character portraits'];   // music is transcoded lighter below
const VOICE = ['app.py', 'bake.py', 'tomp3.py', 'makerefs.py'];   // the voice pack's code; the model + venv are the player's to install

function cp(src, dst) { fs.mkdirSync(path.dirname(dst), { recursive: true }); fs.copyFileSync(src, dst); }
function cpDir(src, dst, filter) {
  if (!fs.existsSync(src)) return 0; let n = 0;
  for (const f of fs.readdirSync(src)) { const p = path.join(src, f); if (fs.statSync(p).isFile() && (!filter || filter(f))) { cp(p, path.join(dst, f)); n++; } }
  return n;
}

fs.rmSync(out, { recursive: true, force: true }); fs.mkdirSync(out, { recursive: true });
for (const f of FILES) cp(path.join(dir, f), path.join(out, f));
// the GM brief ships under its own name; engine.js reads gm-brief.md first
fs.writeFileSync(path.join(out, 'gm-brief.md'), briefText());
for (const d of DIRS) cpDir(path.join(dir, d), path.join(out, d));
// music: the studio's tomp3 re-encodes each track at a lighter VBR (~2.7x smaller, fine under narration); straight copy without it
{
  const md = path.join(dir, 'music'), mo = path.join(out, 'music'); fs.mkdirSync(mo, { recursive: true });
  const py = path.join(dir, 'voice', 'venv', 'Scripts', 'python.exe');
  const tracks = fs.readdirSync(md).filter(f => /\.mp3$/i.test(f));
  for (const f of fs.readdirSync(md)) if (!/\.mp3$/i.test(f)) cp(path.join(md, f), path.join(mo, f));
  const c = fs.existsSync(py) ? require('child_process').spawnSync(py, [path.join(dir, 'voice', 'tomp3.py'), '--level', '0.5', mo, ...tracks.map(f => path.join(md, f))], { encoding: 'utf8' }) : { status: 1 };
  if (c.status !== 0) for (const f of tracks) cp(path.join(md, f), path.join(mo, f));
  else console.log('music re-encoded: ' + tracks.length + ' tracks');
}
for (const f of VOICE) if (fs.existsSync(path.join(dir, 'voice', f))) cp(path.join(dir, 'voice', f), path.join(out, 'voice', f));
cpDir(path.join(dir, 'voice', 'refs'), path.join(out, 'voice', 'refs'), f => /\.wav$/i.test(f) && !/retired|\.bak/i.test(f));
// node_modules travel with the release so the player never runs npm
const nm = path.join(dir, 'node_modules');
function cpTree(src, dst) { for (const f of fs.readdirSync(src)) { const p = path.join(src, f), q = path.join(dst, f); if (fs.statSync(p).isDirectory()) { fs.mkdirSync(q, { recursive: true }); cpTree(p, q); } else cp(p, q); } }
if (fs.existsSync(nm)) { fs.mkdirSync(path.join(out, 'node_modules'), { recursive: true }); cpTree(nm, path.join(out, 'node_modules')); }
// empty homes for what the player makes
for (const d of ['saves', 'exports', 'charmem', 'voice/tales']) fs.mkdirSync(path.join(out, d), { recursive: true });

// --with-node: bundle a portable node.exe (tools/node-win-x64/node.exe, fetched from nodejs.org) so Windows players install nothing
const WITH_NODE = process.argv.includes('--with-node');
const nodeExe = path.join(dir, 'tools', 'node-win-x64', 'node.exe');
if (WITH_NODE) { if (!fs.existsSync(nodeExe)) { console.log('no tools/node-win-x64/node.exe to bundle'); process.exit(1); } cp(nodeExe, path.join(out, 'node', 'node.exe')); console.log('bundled node.exe ' + process.version); }

// the launcher
fs.writeFileSync(path.join(out, 'start.bat'), `@echo off
title The Hollow Ledger
cd /d "%~dp0"
set NODE=node
if exist "%~dp0node\node.exe" set NODE=%~dp0node\node.exe
if "%NODE%"=="node" (
  where node >nul 2>nul
  if not %errorlevel%==0 (
    echo The Hollow Ledger needs Node.js ^(free^): https://nodejs.org  - install it, then run start.bat again.
    pause
    exit /b 1
  )
)
echo Opening The Hollow Ledger...
start "" http://localhost:7439
"%NODE%" server.js
pause
`);
fs.writeFileSync(path.join(out, 'start.sh'), `#!/bin/sh
cd "$(dirname "$0")"
command -v node >/dev/null 2>&1 || { echo "The Hollow Ledger needs Node.js (free): https://nodejs.org"; exit 1; }
(sleep 2; (xdg-open http://localhost:7439 || open http://localhost:7439) >/dev/null 2>&1) &
node server.js
`);

fs.writeFileSync(path.join(out, 'README.md'), `# The Hollow Ledger

A solo tabletop game set at Hogwarts in 1932, under Headmaster Dippet — an original story in a
book-accurate world, told one turn at a time by an AI Game Master that runs on your own API key.

## Playing

1. Install **Node.js** (free, https://nodejs.org) if you don't have it — unless this copy came with a \`node\` folder, in which case nothing to install.
2. Run **start.bat** (Windows) or **start.sh** (Mac/Linux). Your browser opens the book.
3. The first page asks for an **API key** — make one at https://console.anthropic.com
   (API keys → create key) and add a few dollars of credit. A turn costs a few cents; the meter in
   the top bar keeps count. The key is stored only in this folder, in a file called \`.env\`.
4. **Begin a new story**, or **import a campaign file** someone sent you (\`.hlcampaign.zip\`).

Everything you play is saved in \`saves/\`. **⚑ load game** switches campaigns; **⤓ export** packs one
into a single file you can send to someone else; they use **⤒ import** to receive it.

## Voices

The narrator and cast speak. Out of the box, an online neural narrator is used (internet required);
without internet the browser's own voice reads. The optional **studio voice pack** gives every
character their own recorded voice — it needs a graphics card and a few gigabytes; see
\`voice/README.md\` if you want it.

## Credits

Story, world, and design: The Hollow Ledger is an original fan work set in the world of the Harry
Potter novels, which belong to J.K. Rowling and her publishers. This game is unofficial,
non-commercial, and not endorsed by them.

Music by Kevin MacLeod (incompetech.com), licensed under Creative Commons: By Attribution 4.0 —
see \`music/credits.txt\`. Typefaces: IM Fell English (Igino Marini) and EB Garamond (Georg Duffner),
both under the SIL Open Font License, served by Google Fonts.

This game is free to play and to share as-is; please don't sell it.
`);

fs.writeFileSync(path.join(out, 'voice', 'README.md'), `# The studio voice pack (optional)

The cast's own voices come from Chatterbox, an open text-to-speech model. It needs an NVIDIA
graphics card with 8 GB or more and about 6 GB of disk.

1. Install Python 3.11.
2. In this folder: \`python -m venv venv\`, then \`venv\\Scripts\\pip install chatterbox-tts soundfile\`
   (Windows) — on Mac/Linux use \`venv/bin/pip\`.
3. Start the game as usual; the table server finds \`voice/venv\` and starts the studio itself.

Without the pack, the game uses an online narrator, and the browser's voice when offline.
`);

const size = (function tot(p) { let s = 0; for (const f of fs.readdirSync(p)) { const q = path.join(p, f); s += fs.statSync(q).isDirectory() ? tot(q) : fs.statSync(q).size; } return s; })(out);
console.log('release built: ' + out + ' (' + (size / 1048576).toFixed(1) + ' MB)');
