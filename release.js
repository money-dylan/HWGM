// Build a shippable copy of The Hollow Ledger:  node release.js [outdir]
// Copies the world kit and the runtime — never a campaign, never the .env, never the
// 5 GB voice environment. The result runs with `start.bat` (needs Node) and asks for
// an API key on first open.
const fs = require('fs');
const path = require('path');
const dir = __dirname;
const VERSION = require('./package.json').version;
const VALFLAGS = ['--for', '--key', '--campaign'];
const outArg = process.argv.slice(2).find((a, i, all) => !a.startsWith('--') && !VALFLAGS.includes(all[i - 1]));
// --brief: regenerate ./gm-brief.md, the public copy of the GM brief
if (process.argv.includes('--brief')) { require('child_process').spawnSync(process.execPath, [path.join(dir, 'tools', 'brief.js')], { stdio: 'inherit' }); process.exit(0); }
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
cp(path.join(dir, 'gm-brief.md'), path.join(out, 'gm-brief.md'));   // the public brief (regenerate with node release.js --brief)
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
fs.writeFileSync(path.join(out, 'start.bat'), String.raw`@echo off
setlocal
title The Hollow Ledger
cd /d "%~dp0"
echo [%date% %time%] start.bat launched from "%~dp0" > start.log 2>nul
if not exist "%~dp0server.js" (
  echo [%date% %time%] server.js not found - run from inside the zip >> start.log 2>nul
  echo.
  echo   It looks like the game is still inside the zip file.
  echo   Close this window, RIGHT-CLICK the zip, choose "Extract All...",
  echo   open the extracted folder, and run start.bat from there.
  echo.
  pause
  exit /b 1
)
set "NODE=%~dp0node\node.exe"
if not exist "%NODE%" set "NODE=node"
echo [%date% %time%] using node: %NODE% >> start.log
if "%NODE%"=="node" (
  where node >nul 2>nul
  if not %errorlevel%==0 (
    echo [%date% %time%] node.js not installed and none bundled >> start.log
    echo The Hollow Ledger needs Node.js ^(free^): https://nodejs.org  - install it, then run start.bat again.
    pause
    exit /b 1
  )
)
"%NODE%" -v >> start.log 2>&1
if not %errorlevel%==0 (
  echo [%date% %time%] node.exe would not run - possibly blocked by Windows or antivirus >> start.log
  echo.
  echo   The game's engine was blocked from running - usually Windows marking a
  echo   downloaded file, or an antivirus. Right-click the ZIP you downloaded,
  echo   choose Properties, tick "Unblock", click OK, and extract it again.
  echo.
  pause
  exit /b 1
)
echo [%date% %time%] starting the table server >> start.log
echo The table is opening at http://localhost:7439
echo Keep this window open while you play. Close it to stop.
echo.
start "" http://localhost:7439
"%NODE%" server.js 2>server-error.log
echo [%date% %time%] table server stopped >> start.log
echo.
echo The table server stopped.
if exist server-error.log type server-error.log
echo If that was unexpected, send start.log and server-error.log to whoever gave you the game.
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

// --for <name>: a copy made for one person - their key already set, their campaign already on the table.
// --key mine copies the key (and workspace id) from this install's .env; --key sk-ant-... uses that key.
// --campaign <file.hlcampaign.zip> imports the campaign and leaves it live, so the game opens mid-story.
{
  const av = process.argv;
  const forAt = av.indexOf('--for');
  if (forAt > -1) {
    const who = av[forAt + 1] || 'player';
    const keyAt = av.indexOf('--key'), campAt = av.indexOf('--campaign');
    const devEnv = {}; try { for (const l of fs.readFileSync(path.join(dir, '.env'), 'utf8').split(/\r?\n/)) { const m = l.match(/^([A-Z_]+)=(.*)$/); if (m) devEnv[m[1]] = m[2].trim(); } } catch (e) {}
    let key = keyAt > -1 ? av[keyAt + 1] : 'mine';
    if (key === 'mine') key = devEnv.ANTHROPIC_API_KEY || '';
    if (!key) { console.log('--for needs a key: pass --key sk-ant-... or have one in .env'); process.exit(1); }
    const lines = ['ANTHROPIC_API_KEY=' + key];
    if (key === devEnv.ANTHROPIC_API_KEY && devEnv.ANTHROPIC_WORKSPACE_ID) lines.push('ANTHROPIC_WORKSPACE_ID=' + devEnv.ANTHROPIC_WORKSPACE_ID);
    lines.push('GM_MODEL=' + (devEnv.GM_MODEL || 'claude-sonnet-5'));
    fs.writeFileSync(path.join(out, '.env'), lines.join('\n') + '\n');
    console.log('personalized for ' + who + ': key set' + (lines.length > 2 ? ' (with workspace id)' : ''));
    if (campAt > -1) {
      const camp = path.resolve(av[campAt + 1]);
      const sp = (args) => require('child_process').spawnSync(process.execPath, ['save.js', ...args], { cwd: out, encoding: 'utf8' });
      const imp = sp(['import', camp]);
      const m = (imp.stdout || '').match(/as slot "([^"]+)"/);
      if (!m) { console.log('campaign import failed: ' + (imp.stdout || '') + (imp.stderr || '')); process.exit(1); }
      const ld = sp(['load', m[1]]);
      if (!/is now the live campaign/.test(ld.stdout || '')) { console.log('campaign load failed: ' + (ld.stdout || '') + (ld.stderr || '')); process.exit(1); }
      console.log('campaign "' + m[1] + '" imported and set live - the game opens mid-story');
    }
  }
}

// a build must start with a clean diary: no logs or engine state from testing it here
for (const f of ['engine.log', 'engine-crash.log', 'engine-state.json', 'start.log', 'server-error.log', 'server.log', path.join('voice', 'tts.log')]) { try { fs.unlinkSync(path.join(out, f)); } catch (e) {} }

// --installer: wrap the built folder in a one-file Windows setup (Inno Setup; per-user, no admin).
if (process.argv.includes('--installer')) {
  const iscc = [path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Inno Setup 6', 'ISCC.exe'), 'C:/Program Files (x86)/Inno Setup 6/ISCC.exe'].find(p => fs.existsSync(p));
  if (!iscc) { console.log('--installer needs Inno Setup 6 (jrsoftware.org); ISCC.exe not found'); process.exit(1); }
  const forAt2 = process.argv.indexOf('--for');
  const outName = 'The Hollow Ledger Setup' + (forAt2 > -1 ? ' - ' + process.argv[forAt2 + 1] : '');
  const c = require('child_process').spawnSync(iscc, ['/Qp', '/DSrcDir=' + out, '/DOutName=' + outName, path.join(dir, 'installer.iss')], { cwd: dir, encoding: 'utf8' });
  if (c.status !== 0) { console.log('installer build failed:\n' + (c.stdout || '') + (c.stderr || '')); process.exit(1); }
  const exe = path.join(dir, 'dist', outName + '.exe');
  console.log('installer built: ' + exe + ' (' + (fs.statSync(exe).size / 1048576).toFixed(1) + ' MB)');
}

const size = (function tot(p) { let s = 0; for (const f of fs.readdirSync(p)) { const q = path.join(p, f); s += fs.statSync(q).isDirectory() ? tot(q) : fs.statSync(q).size; } return s; })(out);
console.log('release built: ' + out + ' (' + (size / 1048576).toFixed(1) + ' MB)');
