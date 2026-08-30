// Save slots for The Hollow Ledger.
//   node save.js list                 - show all slots
//   node save.js save <slot>          - snapshot the live campaign into its slot
//   node save.js load <slot>          - make a slot the live campaign (auto-backs-up current)
//   node save.js new <slot> "<name>"  - fresh first-year campaign in a new slot, then load it
// A slot is a folder in saves/ holding the campaign files plus charmem/.
const fs = require('fs');
const path = require('path');
const dir = __dirname;
const SAVES = path.join(dir, 'saves');
const FILES = ['chat.json', 'sheet.json', 'characters.json', 'tales.json', 'inbox.log', 'continuity.md'];
const DIRS = ['charmem'];
fs.mkdirSync(SAVES, { recursive: true });

const [, , cmd, slot, pname, extra] = process.argv;
const sdir = s => path.join(SAVES, s);

function liveProfile() {
  try { return JSON.parse(fs.readFileSync(path.join(dir, 'chat.json'), 'utf8')).profile || null; }
  catch (e) { return null; }
}
function copyDirFlat(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  if (!fs.existsSync(src)) return;
  for (const f of fs.readdirSync(src)) {
    const s = path.join(src, f);
    if (fs.statSync(s).isFile()) fs.copyFileSync(s, path.join(dest, f));
  }
}
function clearDirFlat(d) {
  if (!fs.existsSync(d)) { fs.mkdirSync(d, { recursive: true }); return; }
  for (const f of fs.readdirSync(d)) {
    const p = path.join(d, f);
    if (fs.statSync(p).isFile()) fs.unlinkSync(p);
  }
}
function copyInto(dest) { /* fresh install */ if (!fs.existsSync(path.join(dir, 'chat.json'))) return;
  fs.mkdirSync(dest, { recursive: true });
  for (const f of FILES) {
    const src = path.join(dir, f);
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(dest, f));
  }
  for (const d of DIRS) copyDirFlat(path.join(dir, d), path.join(dest, d));
}
// Turn the site's creation wizard answers into a first-year sheet, per the
// rulebook's "Who You Are": stats array +3/+2/+1/+1/0/-1, upbringing perk +
// keepsake, two trunk keepsakes, hooks, family. Wand, pet and house are NOT
// here - they belong to play (Ollivanders, the Menagerie, the Hat).
function applyProfile(sh, prof) {
  const st = prof.stats || {};
  for (const k of ['Magic', 'Wits', 'Nerve', 'Charm', 'Insight', 'Luck']) {
    if (st[k] !== undefined && st[k] !== '') sh['st_' + k] = String(parseInt(st[k], 10) || 0);
  }
  sh.stam = String(8 + (parseInt(sh.st_Nerve, 10) || 0));
  sh.luckpool = String(2 + (parseInt(sh.st_Luck, 10) || 0));
  const taken = [];
  taken.push('STANDARD TRUNK - school trunk, hand-me-down day clothes, quills & ink & parchment, and the letter (never to be thrown away). School fund: 80 Galleons, at Gringotts.');
  if (prof.upbringing && prof.upbringing.label) {
    taken.push('UPBRINGING - ' + prof.upbringing.label + '. PERK: ' + (prof.upbringing.perk || '') + ' KEEPSAKE: ' + (prof.upbringing.keepsake || ''));
  }
  (prof.keepsakes || []).forEach(k => { if (k && k.text) taken.push('IN THE TRUNK - ' + k.text + (k.meaning ? ' (' + k.meaning + ')' : '')); });
  sh.inv = taken.join('\n');
  if (prof.hooks) sh.jpromise = 'WHAT I WANT THIS YEAR - ' + String(prof.hooks).trim();
  const fam = [];
  if (prof.home) fam.push('HOME - ' + String(prof.home).trim());
  if (prof.family) fam.push('FAMILY - ' + String(prof.family).trim());
  if (fam.length) sh.jpeople = fam.join('\n');
}

function stamp(profile) {
  const c = JSON.parse(fs.readFileSync(path.join(dir, 'chat.json'), 'utf8'));
  c.profile = profile;
  try { c.sheet = JSON.parse(fs.readFileSync(path.join(dir, 'sheet.json'), 'utf8')); } catch (e) {}
  c.seq = (c.seq || 0) + 1;
  fs.writeFileSync(path.join(dir, 'chat.json'), JSON.stringify(c));
}

function blankSheet(src) {
  const sh = JSON.parse(JSON.stringify(src));
  for (const k of Object.keys(sh)) {
    if (/^(st_|study_)/.test(k)) sh[k] = '0';
    else if (/^spell_/.test(k)) sh[k] = false;
    else if (/^(bond_|tie_)/.test(k)) sh[k] = '0';
    else if (/^(map_|heard_|tienote_)/.test(k)) delete sh[k];
    else if (/^j[a-z]+$/.test(k)) sh[k] = '';
    else sh[k] = '';
  }
  Object.assign(sh, { name: '', gold: '0', sick: '0', clues: '0', hp: '0', stam: '8', luckpool: '2', chapnum: '1' });
  return sh;
}
function neutralCast(src) {
  // Seed the cast NEUTRALLY: a dossier from another campaign carries that
  // playthrough's quotes and earned mechanics (e.g. "Edge with every goblin").
  // Quotes go; sentences that encode a rules benefit or a played event go; the
  // GM is told what to audit. Nobody starts met.
  const cj = JSON.parse(JSON.stringify(src));
  // Rule tokens are case-SENSITIVE with word boundaries: "Edge" the mechanic, never
  // "ledger", "hedge" or "the edge of the table". Every cut sentence is printed.
  const MECH_CS = /\bEdge\b|\bBurden\b/;
  const MECH_CI = /\+1|\bonce (a|in a|per)\b|flourish|\byou (gave|asked|bought|promised|slipped|walked|chose)\b|\byour (first|second) (owl|night|letter)\b/i;
  // Second rule (from the sister GM's audit): a fresh cast may PREVIEW a person in
  // the third person, but may not assert a shared past with the player. Any
  // sentence or role segment in the second person is inherited history - cut it.
  const YOU = /\byou\b|\byour\b|\byours\b/i;
  const isMech = sn => MECH_CS.test(sn) || MECH_CI.test(sn);
  const cuts = [];
  cj.people.forEach(p => {
    p.met = false;
    if (p.quote) p.quote = '';
    if (p.role) {
      const segs = String(p.role).split(/\s*\u00b7\s*/);
      const keptR = segs.filter(sg => { const bad = YOU.test(sg); if (bad) cuts.push(p.id + ' (role): "' + sg + '"'); return !bad; });
      p.role = keptR.join(' \u00b7 ');
    }
    if (p.desc) {
      const parts = p.desc.split(/(?<=[.!?])\s+/);
      const kept = parts.filter(sn => { const m = isMech(sn) || YOU.test(sn); if (m) cuts.push(p.id + ': "' + sn.trim() + '"'); return !m; });
      p.desc = kept.join(' ').trim();
    }
  });
  if (cuts.length) console.log('seeded cast - sentences removed as playthrough mechanics (audit these):\n  ' + cuts.join('\n  '));
  return cj;
}
// The world kit: world/sheet.json (blank sheet) and world/cast.json (nobody met, no
// playthrough quotes or mechanics). `node save.js worldkit` builds them from the live
// campaign; a fresh install ships them and has no live campaign to derive from.
const WORLD = path.join(dir, 'world');
function worldSheet() {
  if (fs.existsSync(path.join(WORLD, 'sheet.json'))) return JSON.parse(fs.readFileSync(path.join(WORLD, 'sheet.json'), 'utf8'));
  return blankSheet(JSON.parse(fs.readFileSync(path.join(dir, 'sheet.json'), 'utf8')));
}
function worldCast() {
  if (fs.existsSync(path.join(WORLD, 'cast.json'))) return JSON.parse(fs.readFileSync(path.join(WORLD, 'cast.json'), 'utf8'));
  return neutralCast(JSON.parse(fs.readFileSync(path.join(dir, 'characters.json'), 'utf8')));
}

if (cmd === 'list') {
  const slots = fs.existsSync(SAVES) ? fs.readdirSync(SAVES).filter(s => fs.statSync(sdir(s)).isDirectory()) : [];
  console.log('live campaign:', liveProfile() || '(unstamped)');
  for (const s of slots) {
    let who = '?', turns = '?';
    try {
      const sh = JSON.parse(fs.readFileSync(path.join(sdir(s), 'sheet.json'), 'utf8')); who = sh.name || '(no name yet)';
      const ch = JSON.parse(fs.readFileSync(path.join(sdir(s), 'chat.json'), 'utf8')); turns = ch.log.length;
    } catch (e) {}
    console.log('  ' + s.padEnd(12) + String(who).padEnd(20) + turns + ' entries');
  }
  if (!slots.length) console.log('  (no slots yet)');

} else if (cmd === 'save' && slot) {
  const live = liveProfile();
  if (live && live !== slot && pname !== '--force') {
    console.log('REFUSED: the live campaign is "' + live + '", not "' + slot + '".');
    console.log('Saving now would overwrite slot "' + slot + '" with the wrong campaign.');
    process.exit(1);
  }
  copyInto(sdir(slot));
  console.log('saved live campaign into slot "' + slot + '"');

} else if (cmd === 'load' && slot) {
  if (!fs.existsSync(sdir(slot))) { console.log('no such slot: ' + slot); process.exit(1); }
  copyInto(sdir('_autobackup'));
  for (const f of FILES) {
    const src = path.join(sdir(slot), f);
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(dir, f));
  }
  for (const d of DIRS) { clearDirFlat(path.join(dir, d)); copyDirFlat(path.join(sdir(slot), d), path.join(dir, d)); }
  stamp(slot);
  console.log('slot "' + slot + '" is now the live campaign (previous state in saves/_autobackup)');

} else if (cmd === 'new' && slot) {
  if (fs.existsSync(sdir(slot))) { console.log('slot already exists: ' + slot); process.exit(1); }
  copyInto(sdir('_autobackup'));
  const name = pname || '';
  let prof = null;
  if (extra && fs.existsSync(extra)) { try { prof = JSON.parse(fs.readFileSync(extra, 'utf8')); } catch (e) { prof = null; } }
  const sh = worldSheet();
  sh.name = name;
  if (prof) applyProfile(sh, prof);
  const cj = worldCast();
  const tj = { tales: [] };
  const chat = {
    seq: 1, profile: slot, scene: 'Chapter I — a letter arrives', recap: '', track: null, amb: null,
    sheet: sh,
    log: [{ who: 'gm', text: prof
      ? ('[warm] Welcome to the table, ' + name + '. Your sheet is written' + (prof.upbringing && prof.upbringing.label ? ' - ' + prof.upbringing.label.toLowerCase() : '') + (prof.home ? ', of ' + String(prof.home).trim() : '') + ' - and the rest of you is still to be found: your wand will choose you at Ollivanders, your companion will choose you in Diagon Alley, and a Hat will have its say in September. [plain] Here is how it works: I narrate, you decide, and when something truly hangs in the balance, we roll for it. [soft] Before the letter comes, tell me one thing your sheet cannot: what does the kitchen at home sound like in the morning? Then say the word, and the owl arrives.')
      : ('[warm] Welcome to the table' + (name ? ', ' + name : '') + '. A fresh year, a fresh ledger, and a story that has never been told before, because it is yours. Here is how it works: I narrate, you decide, and when an outcome truly hangs in the balance, we roll for it. Start wherever you like — tell me who you are, or simply say: the letter came this morning. What do you do?') }]
  };
  const tmp = sdir(slot); fs.mkdirSync(tmp, { recursive: true });
  fs.writeFileSync(path.join(tmp, 'sheet.json'), JSON.stringify(sh, null, 2));
  fs.writeFileSync(path.join(tmp, 'characters.json'), JSON.stringify(cj, null, 2));
  fs.writeFileSync(path.join(tmp, 'tales.json'), JSON.stringify(tj, null, 2));
  fs.writeFileSync(path.join(tmp, 'chat.json'), JSON.stringify(chat));
  fs.writeFileSync(path.join(tmp, 'inbox.log'), '');
  fs.writeFileSync(path.join(tmp, 'continuity.md'), '# ' + (name || slot) + ' — Continuity Ledger (slot ' + slot + ')\n\nCheck this file and charmem/ before asserting anything about the past; when they are silent, search chat.json. Never write history from memory.\n\n## Timeline\n\n- (the letter has not yet arrived)\n\n## Standing appointments\n\n## Facts that must hold\n\n' + (prof && prof.upbringing ? '- Upbringing: ' + prof.upbringing.label + ' — perk: ' + prof.upbringing.perk + '\n' : '') + (prof && prof.home ? '- Home: ' + prof.home + '\n' : '') + (prof && prof.family ? '- Family: ' + prof.family + '\n' : '') + '- Wand, companion and house are the player\'s to choose, in play.\n');
  fs.mkdirSync(path.join(tmp, 'charmem'), { recursive: true });
  for (const f of FILES) fs.copyFileSync(path.join(tmp, f), path.join(dir, f));
  for (const d of DIRS) { clearDirFlat(path.join(dir, d)); }
  stamp(slot);
  console.log('fresh campaign "' + slot + '" created and loaded (previous state in saves/_autobackup)');

} else if (cmd === 'worldkit') {
  // build world/sheet.json + world/cast.json from the live campaign (what a fresh install ships)
  fs.mkdirSync(WORLD, { recursive: true });
  const sh = blankSheet(JSON.parse(fs.readFileSync(path.join(dir, 'sheet.json'), 'utf8')));
  const cj = neutralCast(JSON.parse(fs.readFileSync(path.join(dir, 'characters.json'), 'utf8')));
  fs.writeFileSync(path.join(WORLD, 'sheet.json'), JSON.stringify(sh, null, 2));
  fs.writeFileSync(path.join(WORLD, 'cast.json'), JSON.stringify(cj, null, 2));
  console.log('world kit written: world/sheet.json (' + Object.keys(sh).length + ' keys), world/cast.json (' + cj.people.length + ' people)');

} else if (cmd === 'export' && slot) {
  // one campaign -> one file: saves/<slot> + its tale recordings + portraits + a manifest
  if (!fs.existsSync(sdir(slot))) { console.log('no such slot: ' + slot); process.exit(1); }
  if (liveProfile() === slot) copyInto(sdir(slot));           // export what is on the table right now
  const stage = path.join(SAVES, '_export', slot);
  fs.rmSync(stage, { recursive: true, force: true }); fs.mkdirSync(path.join(stage, 'campaign'), { recursive: true });
  for (const f of fs.readdirSync(sdir(slot))) { const p = path.join(sdir(slot), f); if (fs.statSync(p).isFile() && !/.bak$/i.test(f)) fs.copyFileSync(p, path.join(stage, 'campaign', f)); }
  copyDirFlat(path.join(sdir(slot), 'charmem'), path.join(stage, 'campaign', 'charmem'));
  let tales = []; try { tales = JSON.parse(fs.readFileSync(path.join(sdir(slot), 'tales.json'), 'utf8')).tales.map(t => t.id); } catch (e) {}
  fs.mkdirSync(path.join(stage, 'tales-audio'), { recursive: true });
  // recordings ship as MP3 (a tale is ~20 MB as WAV, ~1.5 MB as MP3); already-MP3 tales copy straight across
  let audio = 0; const toConv = [];
  for (const id of tales) { const m = path.join(dir, 'voice', 'tales', id + '.mp3'), w = path.join(dir, 'voice', 'tales', id + '.wav'); if (fs.existsSync(m)) { fs.copyFileSync(m, path.join(stage, 'tales-audio', id + '.mp3')); audio++; } else if (fs.existsSync(w)) toConv.push(w); }
  if (toConv.length) {
    const py = path.join(dir, 'voice', 'venv', 'Scripts', 'python.exe');
    const c = require('child_process').spawnSync(fs.existsSync(py) ? py : 'python', [path.join(dir, 'voice', 'tomp3.py'), path.join(stage, 'tales-audio'), ...toConv], { encoding: 'utf8' });
    if (c.status === 0) audio += toConv.length;
    else for (const w of toConv) { fs.copyFileSync(w, path.join(stage, 'tales-audio', path.basename(w))); audio++; }   // no encoder: ship the WAVs
  }
  // portraits: only the ones the recipient's install will not already have (world/portraits.txt = shipped set)
  { let base = []; try { base = fs.readFileSync(path.join(WORLD, 'portraits.txt'), 'utf8').split(/\r?\n/).map(x => x.trim().toLowerCase()).filter(Boolean); } catch (e) {}
    fs.mkdirSync(path.join(stage, 'portraits'), { recursive: true });
    const pd = path.join(dir, 'character portraits');
    if (fs.existsSync(pd)) for (const f of fs.readdirSync(pd)) { if (base.includes(f.toLowerCase())) continue; const p = path.join(pd, f); if (fs.statSync(p).isFile()) fs.copyFileSync(p, path.join(stage, 'portraits', f)); } }
  let who = slot; try { who = JSON.parse(fs.readFileSync(path.join(sdir(slot), 'sheet.json'), 'utf8')).name || slot; } catch (e) {}
  fs.writeFileSync(path.join(stage, 'manifest.json'), JSON.stringify({ format: 'hollow-ledger-campaign', version: 1, slot, name: who, exported: new Date().toISOString(), tales: tales.length, audio }, null, 2));
  fs.mkdirSync(path.join(dir, 'exports'), { recursive: true });
  const outFile = path.join(dir, 'exports', slot + '-' + new Date().toISOString().slice(0, 10) + '.hlcampaign.zip');
  try { fs.unlinkSync(outFile); } catch (e) {}
  // bsdtar reads 'E:\...' as a remote host, so work with paths relative to the staging folder
  const r = require('child_process').spawnSync('tar', ['-a', '-c', '-f', path.relative(stage, outFile).split(path.sep).join('/'), '.'], { cwd: stage, encoding: 'utf8' });
  if (r.status !== 0) { console.log('zip failed: ' + (r.stderr || r.stdout)); process.exit(1); }
  fs.rmSync(stage, { recursive: true, force: true });
  console.log('exported ' + who + ' -> ' + outFile + ' (' + tales.length + ' tales, ' + audio + ' recordings)');

} else if (cmd === 'import' && slot) {
  // slot here is the zip path; the manifest names the slot (renamed if taken)
  const zip = slot;
  if (!fs.existsSync(zip)) { console.log('no such file: ' + zip); process.exit(1); }
  const stage = path.join(SAVES, '_import'); fs.rmSync(stage, { recursive: true, force: true }); fs.mkdirSync(stage, { recursive: true });
  const r = require('child_process').spawnSync('tar', ['-x', '-f', path.relative(stage, path.resolve(zip)).split(path.sep).join('/')], { cwd: stage, encoding: 'utf8' });
  if (r.status !== 0) { console.log('unzip failed: ' + (r.stderr || r.stdout)); process.exit(1); }
  let man; try { man = JSON.parse(fs.readFileSync(path.join(stage, 'manifest.json'), 'utf8')); } catch (e) { console.log('not a campaign file (no manifest)'); process.exit(1); }
  if (man.format !== 'hollow-ledger-campaign') { console.log('not a campaign file'); process.exit(1); }
  let target = String(man.slot || 'campaign').replace(/[^a-z0-9_-]/gi, '').toLowerCase() || 'campaign';
  let n = 1, base = target; while (fs.existsSync(sdir(target))) target = base + (++n);
  fs.mkdirSync(sdir(target), { recursive: true });
  for (const f of fs.readdirSync(path.join(stage, 'campaign'))) { const p = path.join(stage, 'campaign', f); if (fs.statSync(p).isFile()) fs.copyFileSync(p, path.join(sdir(target), f)); }
  copyDirFlat(path.join(stage, 'campaign', 'charmem'), path.join(sdir(target), 'charmem'));
  // the record must carry the slot it now lives in
  try { const c = JSON.parse(fs.readFileSync(path.join(sdir(target), 'chat.json'), 'utf8')); c.profile = target; fs.writeFileSync(path.join(sdir(target), 'chat.json'), JSON.stringify(c)); } catch (e) {}
  fs.mkdirSync(path.join(dir, 'voice', 'tales'), { recursive: true });
  let audio = 0; if (fs.existsSync(path.join(stage, 'tales-audio'))) for (const f of fs.readdirSync(path.join(stage, 'tales-audio'))) { const d = path.join(dir, 'voice', 'tales', f), stem = f.replace(/.(mp3|wav)$/i, ''); if (!fs.existsSync(d) && !fs.existsSync(path.join(dir, 'voice', 'tales', stem + '.wav')) && !fs.existsSync(path.join(dir, 'voice', 'tales', stem + '.mp3'))) { fs.copyFileSync(path.join(stage, 'tales-audio', f), d); audio++; } }
  let pics = 0; if (fs.existsSync(path.join(stage, 'portraits'))) for (const f of fs.readdirSync(path.join(stage, 'portraits'))) { const d = path.join(dir, 'character portraits', f); if (!fs.existsSync(d)) { fs.copyFileSync(path.join(stage, 'portraits', f), d); pics++; } }
  try { fs.writeFileSync(path.join(dir, 'inbox-' + target + '.log'), '', { flag: 'a' }); } catch (e) {}
  fs.rmSync(stage, { recursive: true, force: true });
  console.log('imported ' + (man.name || target) + ' as slot "' + target + '" (' + audio + ' recordings, ' + pics + ' portraits added). Load it from the site.');

} else {
  console.log('usage: node save.js list | save <slot> [--force] | load <slot> | new <slot> "<player name>" [profile.json] | export <slot> | import <file.zip> | worldkit');
}
