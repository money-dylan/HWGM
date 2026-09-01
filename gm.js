#!/usr/bin/env node
/* Fast GM turn writer.
   node gm.js "narration text"                    -> append a GM turn
   node gm.js "text" --you "player line" --seq N  -> also record the player message
   optional: --scene "..." --track x.mp3 --amb rain|fire|train|wind|none
             --ask "label|Stat|mod|dc"  --plate castle  --set gold=26,clues=3
             --j promise|threads|clues|marks|people|taken --add "line to append"
*/
const fs = require('fs');
const path = require('path');
const dir = __dirname;
const CHAT = path.join(dir, 'chat.json');
const SHEET = path.join(dir, 'sheet.json');

const argv = process.argv.slice(2);
const text = argv[0];
if (!text) { console.error('usage: node gm.js "text" [--you "..."] [--seq N] ...  (or flags only, e.g. --mem "id|event", to record without posting a turn)'); process.exit(1); }
// A flag where the narration should be is either a deliberate bookkeeping-only call
// (`gm.js --mem "..."`, nothing posted to the table) or a mis-quoted turn. Tell them apart.
const SILENT = /^--/.test(String(text).trim()) && argv.length > 1;
if (/^--/.test(String(text).trim()) && !SILENT) {
  console.error('refused: the turn text is "' + text + '", which is a flag, not narration - the command was mis-quoted. Put the narration first, in quotes: node gm.js "[warm] ..." --mem "nell|..."');
  process.exit(1);
}
if (!String(text).trim() || String(text).trim().length < 3) { console.error('refused: the turn text is empty or too short to be a turn.'); process.exit(1); }
const flag = n => { const i = argv.indexOf('--' + n); return i > -1 ? argv[i + 1] : null; };

const doc = JSON.parse(fs.readFileSync(CHAT, 'utf8'));
const loadedLen = doc.log.length;
let loadedMtime = 0; try { loadedMtime = fs.statSync(CHAT).mtimeMs; } catch (e) {}
if (doc.profile) console.log('LIVE PROFILE: ' + doc.profile.toUpperCase());
const asSlot = flag('as');
if (asSlot && doc.profile && asSlot !== doc.profile) {
  console.error('REFUSED: the live campaign is "' + doc.profile + '" but this turn is for "' + asSlot + '". Nothing written.');
  process.exit(1);
}
let sheet = {};
try { sheet = JSON.parse(fs.readFileSync(SHEET, 'utf8')); } catch (e) {}

/* Any player message sitting unfiled in inbox.log is filed first, in order,
   so a turn can never be recorded above the words that prompted it. */
if (argv.indexOf('--noinbox') < 0) {
  try {
    const filed = new Set(doc.log.filter(e => e.seq).map(e => e.seq));
    const youSeq = Number(flag('seq')) || 0;
    if (youSeq) filed.add(youSeq);
    const lines = fs.readFileSync(path.join(dir, doc.profile ? ('inbox-' + doc.profile + '.log') : 'inbox.log'), 'utf8').trim().split('\n');
    for (const ln of lines) {
      if (!ln.trim()) continue;
      let m; try { m = JSON.parse(ln); } catch (e) { continue; }
      if (!m || !m.seq || filed.has(m.seq) || !m.text) continue;
      filed.add(m.seq);
      const e = { who: 'you', seq: m.seq, text: m.text };
      if (m.meta || /^\s*\(pacing:/.test(m.text)) e.meta = true;   // table-management lines stay out of the story
      doc.log.push(e);
      console.log('  filed player message ' + m.seq);
    }
  } catch (e) {}
}

// --retract N: strike the last N story entries from the record. They stay in the file for the
// player's own history but are never sent to the Game Master again and never shown at the table,
// so a rewind actually rewinds instead of leaving the mistake in play.
const retractN = parseInt(flag('retract') || '0', 10);
if (retractN > 0) {
  let done = 0;
  for (let i = doc.log.length - 1; i >= 0 && done < retractN; i--) {
    const e = doc.log[i];
    if (e.retracted || e.meta) continue;
    e.retracted = true; done++;
  }
  console.log('  retracted ' + done + ' entr' + (done === 1 ? 'y' : 'ies') + ' - struck from the record');
}

let you = flag('you');
const youIsMeta = argv.indexOf('--youmeta') > -1;
if (!you && youIsMeta) { const v = flag('youmeta'); if (v && v.indexOf('--') !== 0) you = v; }
if (you) { const ym = { who: 'you', seq: Number(flag('seq')) || Date.now(), text: you }; if (youIsMeta) ym.meta = true; doc.log.push(ym); }

const turn = { who: 'gm', text };
if (argv.indexOf('--meta') > -1) turn.meta = true;
// scene paintings retired at the player's request (2026-08-29): --plate is accepted and ignored
flag('plate');
const ask = flag('ask');
if (ask) { const [label, stat, mod, dc, edge] = ask.split('|'); turn.ask = { label, stat, mod: Number(mod) || 0, dc: Number(dc) || 10 }; if (edge && /^(edge|burden)$/i.test(edge.trim())) turn.ask.edge = edge.trim().toLowerCase(); }
const chap = flag('chapter');
if (chap && !SILENT) { (doc.chapters = doc.chapters || []).push({ label: chap, start: doc.log.length }); }
if (!SILENT) doc.log.push(turn); else console.log('  bookkeeping only - nothing posted to the table');

const scene = flag('scene'); if (scene) doc.scene = scene;
const track = flag('track'); if (track) doc.track = track;
const amb = flag('amb'); if (amb) doc.amb = (amb === 'none' ? null : amb);
const recap = flag('recap'); if (recap) doc.recap = recap;
const duel = flag('duel');
if (duel) { if (duel === 'none') doc.duel = null; else { const [foe, hits, max, note] = duel.split('|'); doc.duel = { foe, hits: Number(hits), max: Number(max) || 3, note: note || '' }; } }

// sheet changes: --set gold=26,clues=3,bond_Nell=2
const patch = {};
// --set is repeatable. Within one --set, pairs split on ", key=" ; each pair splits on the FIRST '='
// only, so a value may contain '='. A value containing ", word=" must be given in its own --set.
argv.forEach((a, i) => {
  if (a !== '--set' || argv[i + 1] === undefined) return;
  String(argv[i + 1]).split(/,(?=[\w.]+=)/).forEach(kv => {
    const eq = kv.indexOf('='); if (eq <= 0) return;
    const k = kv.slice(0, eq).trim(), v = kv.slice(eq + 1);
    if (k) patch[k] = v;
  });
});

// the same patch lands in sheet.json immediately (sheet.json patch): the server copy must never
// lag the record - bonds and ties are not page form fields and would otherwise be lost.
if (Object.keys(patch).length) {
  try {
    const shp = path.join(dir, 'sheet.json');
    const sh = JSON.parse(fs.readFileSync(shp, 'utf8'));
    Object.assign(sh, patch);
    fs.writeFileSync(shp, JSON.stringify(sh, null, 2));
  } catch (e) {}
}

// character memory: --mem "nell|showed him her mum's letter"  (repeatable)
argv.forEach((a, i) => {
  if (a !== '--mem' || !argv[i + 1]) return;
  const v = argv[i + 1], bar = v.indexOf('|');
  if (bar <= 0) return;
  const who = v.slice(0, bar).trim().toLowerCase().replace(/[^a-z0-9_-]/g, ''), line = v.slice(bar + 1).trim();
  if (!who || !line) return;
  const mdir = path.join(dir, 'charmem'); fs.mkdirSync(mdir, { recursive: true });
  const stampd = (doc.scene ? doc.scene + ' — ' : '') + new Date().toISOString().slice(0, 10);
  fs.appendFileSync(path.join(mdir, who + '.md'), '- [' + stampd + '] ' + line + '\n');
  console.log('  remembered for ' + who);
});

// journal append: --j clues --add "CLUE 16 - ..."
const jmap = { promise: 'jpromise', objective: 'jpromise', threads: 'jthreads', questions: 'jthreads', clues: 'jclues', marks: 'jmarks', people: 'jpeople', taken: 'jtaken', inv: 'inv', satchel: 'inv' };
// --j <key> --add "line" is repeatable: every --j is paired with the --add that follows it
argv.forEach((a, i) => {
  if (a !== '--j' || !argv[i + 1]) return;
  const j = argv[i + 1]; let add = null;
  for (let k = i + 2; k < argv.length; k++) { if (argv[k] === '--add' && argv[k + 1] !== undefined) { add = argv[k + 1]; break; } if (argv[k] === '--j') break; }
  if (!add) return;
  const key = jmap[j] || j;
  const cur = patch[key] !== undefined ? patch[key] : (sheet[key] || '');
  patch[key] = (cur + '\n' + add).trim();
});

// --done "text" / --missed "text": move the first Objectives line containing the text
// into that state (X completed, ~ missed). Repeatable.
['done', 'missed'].forEach(kind => {
  argv.forEach((a, i) => {
    if (a !== '--' + kind || !argv[i + 1]) return;
    const needle = String(argv[i + 1]).toLowerCase();
    const cur = String((patch.jpromise !== undefined ? patch.jpromise : sheet.jpromise) || '');
    let hit = false;
    const lines = cur.split('\n').map(l => {
      if (!hit && l.toLowerCase().indexOf(needle) > -1) { hit = true; return (kind === 'done' ? 'X ' : '~ ') + l.replace(/^[!?X~-]\s*/i, ''); }
      return l;
    });
    if (hit) { patch.jpromise = lines.join('\n'); console.log('  objective ' + kind + ': ' + needle); }
    else console.log('  no objective matched: ' + needle);
  });
});

// the sheet patch is applied by the page on the next seq change, then must NOT linger:
// a stale patch replayed on a later seq bump silently reverts newer edits.
doc.sheet = patch;
if (Object.keys(patch).length) {
  Object.assign(sheet, patch);
  fs.writeFileSync(SHEET, JSON.stringify(sheet, null, 2));
}

// --meet <id>: mark a character met in characters.json
const meet = flag('meet');
if (meet) {
  try {
    const cf = path.join(dir, 'characters.json');
    const cj = JSON.parse(fs.readFileSync(cf, 'utf8'));
    const p = cj.people.find(x => x.id === meet);
    if (p) { p.met = true; fs.writeFileSync(cf, JSON.stringify(cj, null, 2)); }
  } catch (e) {}
}

let target = doc;
try {
  const nowMtime = fs.statSync(CHAT).mtimeMs;
  if (nowMtime !== loadedMtime) {
    // the record changed under us (another session filed a turn): merge, never clobber
    const fresh = JSON.parse(fs.readFileSync(CHAT, 'utf8'));
    const mine = doc.log.slice(loadedLen);
    const seen = new Set(fresh.log.filter(e => e.seq).map(e => e.seq));
    mine.forEach(e => { if (!e.seq || !seen.has(e.seq)) fresh.log.push(e); });
    for (const k of ['scene', 'track', 'amb', 'recap', 'duel', 'chapters']) if (doc[k] !== undefined && flag(k === 'chapters' ? 'chapter' : k) !== null) fresh[k] = doc[k];
    if (Object.keys(patch).length) fresh.sheet = Object.assign({}, fresh.sheet || {}, patch);
    console.log('  merged onto a record another session changed meanwhile');
    target = fresh;
  }
} catch (e) {}
target.seq = (target.seq || 0) + 1;
fs.writeFileSync(CHAT, JSON.stringify(target, null, 2));
doc.seq = target.seq;
console.log('turn ' + doc.seq + (Object.keys(patch).length ? ' | sheet: ' + Object.keys(patch).join(',') : ''));
