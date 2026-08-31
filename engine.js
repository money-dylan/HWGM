// The Hollow Ledger — GM engine.
// Watches the live campaign's wire (inbox-<slot>.log), assembles the scene the way
// a human game master would, asks the model for a structured turn (tool calls), and
// files it through gm.js with the same flags and guards.
//
//   node engine.js            run for the live slot (whatever ⚑ load game chose)
//   node engine.js --dry      answer the last player message without filing (test)
//   node engine.js --once     handle one message and exit
//
// .env: ANTHROPIC_API_KEY, ANTHROPIC_WORKSPACE_ID (if the key is identity-linked),
//       GM_MODEL (default claude-sonnet-5), GM_EFFORT (default medium)
const fs = require('fs');
const path = require('path');
const { spawnSync, spawn } = require('child_process');
const Anthropic = require('@anthropic-ai/sdk');

const dir = __dirname;
for (const l of (fs.existsSync(path.join(dir, '.env')) ? fs.readFileSync(path.join(dir, '.env'), 'utf8') : '').split(/\r?\n/)) {
  const m = l.match(/^([A-Z_]+)=(.*)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}
const MODEL = process.env.GM_MODEL || 'claude-sonnet-5';
const EFFORT = process.env.GM_EFFORT || 'medium';
const CTRL_PORT = parseInt(process.env.GM_PORT || '7442', 10);
const THINKING = /haiku/.test(MODEL) ? undefined : { type: 'adaptive' };   // haiku has no adaptive thinking
const DRY = process.argv.includes('--dry');
const ONCE = process.argv.includes('--once');
const LOG = path.join(dir, 'engine.log');
const STATE = path.join(dir, 'engine-state.json');
function log(...a) { const line = new Date().toISOString().slice(11, 19) + ' ' + a.join(' '); console.log(line); try { fs.appendFileSync(LOG, line + '\n'); } catch (e) {} }
function read(p) { try { return fs.readFileSync(p, 'utf8'); } catch (e) { return ''; } }
function readJson(p, d) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return d; } }

const STATUS = { slot: null, model: MODEL, job: null, hasKey: !!process.env.ANTHROPIC_API_KEY, busy: false, lastPlayer: null, lastCost: 0, lastMs: 0, lastAt: null, error: null };
const client = new Anthropic({ defaultHeaders: Object.assign({ 'anthropic-beta': 'extended-cache-ttl-2025-04-11' }, process.env.ANTHROPIC_WORKSPACE_ID ? { 'anthropic-workspace-id': process.env.ANTHROPIC_WORKSPACE_ID } : {}) });

/* ---------------- the world kit (stable, cached) ---------------- */
function stripHtml(s) { return s.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim(); }
function rulesDigest() {
  const h = read(path.join(dir, 'hollow-ledger.html'));
  const a = h.indexOf('<section id="rules"'), b = h.indexOf('<section id="ch1"');
  if (a < 0 || b < 0) return '';
  return stripHtml(h.slice(a, b));
}
function briefSections() {
  const t = read(path.join(dir, process.env.GM_BRIEF || 'gm-brief.md'));   // GM_BRIEF in .env points a dev install at its working brief
  const pick = (title) => { const m = t.match(new RegExp('## ' + title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[\\s\\S]*?(?=\\n## |$)')); return m ? m[0] : ''; };
  return [pick('The four laws'), pick('Standing commitments'), pick('Objectives, questions, satchel — keeping the Case File honest'), pick('Generating tales (end of session)'), pick('Character creation — the script for a new campaign')].join('\n\n');
}
const ENGINE_RULES = `# HOW YOU FILE A TURN (engine)
You are the Game Master of The Hollow Ledger, a solo Hogwarts tabletop game set in 1932 under Headmaster Dippet — original story, book-accurate world, never overlapping the novels. You answer ONE player message at a time by calling the file_turn tool exactly once (plus, when relevant, write_tales or update_continuity). Never answer in plain text.

Turn text rules: second person, the fireside narrator voice from the voice bible; mood cues [plain] [soft] [warm] [tense] [grand] [excited] [afraid] and speaker cues like [nell] [posy] [idris] [dumbledore] [lady] [rooke] [odette] [mum] [dad] [captain]... before quoted dialogue; ~150–300 words for an ordinary turn; end on the player's move. THE ECHO BAN (a standing player complaint - treat as law): never restate the player's message. Not their actions rephrased ('You lean down and offer Captain your shoulder...'), not their dialogue re-quoted ('"I know what she means, mate," you say...'), not a polished retelling of what they typed. Their message IS the first half of the turn - it is already on the table, in their words. Your turn is ONLY the second half: what answers, what resists, what changes, who replies. BAD: player writes [I take Rooke's hand. "Time to see if I named you right."] and the turn opens [You take Rooke's hand. "Time to see if I named you right," you say...]. GOOD: the turn opens with Rooke's grip, the boat dipping, Captain's claws, the reply. The single exception: resolving a roll, where the manner of the attempt matters. If a turn would begin with 'You', look hard at it. Capitalise mechanic terms only where a rule is genuinely being named.

TABLE PREFERENCES: when the player asks you to change how you run the table - style, pacing, how much you narrate, what you repeat, the voice - obey from that turn on, and in the same turn record it with update_continuity as "TABLE PREFERENCE - <the request, in one line>" so it binds every future session. The continuity file's TABLE PREFERENCE lines are standing orders: re-read and honor them every turn.

THE CAST: when a named character properly enters the story (spoken with, likely to recur) and has no card, add them with update_cast in the same turn - short id, real description in the third person, no invented history. Amend an existing dossier only when the table itself changed a fact (a new title, an injury, a revealed name); quotes only from words actually said at this table. The People tab is the player's view of who they know - keep it true.

SHAPE OF THE TEXT (this matters as much as the words): short paragraphs separated by blank lines - one to four sentences each, never one long block. A single-sentence beat may stand alone as its own paragraph ("Nothing else shifts. Not the book. Not the cloak. Not the tin."). Each character's spoken line gets its own paragraph, with its cue. When a roll resolves, state the result plainly in its own paragraph - what the number earned (a HOUSE POINT, a FLOURISH) and what it costs - then, if a flourish is owed, one paragraph offering concrete ways to spend it here and now, with the player free to name another. Close with the hand-back on its own line: "What do you do, <name>?" (or a variation) whenever the scene is waiting on the player.

Dice: when the three conditions hold, OFFER the roll with the ask field instead of narrating the outcome. When the player's message is a roll result (🎲 …), resolve the last ask: natural 20 = triumph (+1 House Point if witnessed, set hp); beat the DC by 5 = a flourish, named and spent in the same turn; natural 1 = calamity.

Table-management messages ("end session", "generate tales", "(pacing: …)", questions about the rules or the site, corrections to the record) are answered with meta=true and no story advance — except "generate tales", which means: call write_tales with three or four tales from recent play (rules in the brief), then file a meta turn announcing the spines.

Bookkeeping in the same turn, always: mem lines for every character something happened to; set for sheet changes (clues, hp, gold, sick, luckpool, stam, bond_X, tie_a_b, chapnum); journal lines (clues/objective/questions/marks/people/inv) when the story creates them; done/missed when an objective resolves; meet when a new character is introduced; chapter ONLY on the turn that opens a new chapter. Keep continuity honest: if a fact in the continuity file changes (an appointment kept, a day ending), call update_continuity with a short dated note.`;

/* ---------------- the scene (dynamic) ---------------- */
function liveSlot() { return (readJson(path.join(dir, 'chat.json'), {}).profile) || null; }
function contFile(slot) { return 'continuity.md'; }   // continuity travels with the slot
function sheetSummary(sh) {
  const st = ['Magic', 'Wits', 'Nerve', 'Charm', 'Insight', 'Luck'].map(k => k + ' ' + (sh['st_' + k] || 0)).join(' · ');
  const bonds = Object.keys(sh).filter(k => k.startsWith('bond_') && parseInt(sh[k], 10) > 0).map(k => k.slice(5) + ' ♥' + sh[k]).join(', ');
  return `# SHEET NOW
Name: ${sh.name} · House: ${sh.house || 'unsorted'} · Wand: ${sh.wand || '—'}
Stats: ${st} · Stamina ${sh.stam} · Luck pool ${sh.luckpool} · Clues ${sh.clues} · House Points ${sh.hp} · Purse ${sh.gold}G ${sh.sick}s · Chapter ${sh.chapnum}
Bonds: ${bonds || 'none yet'}
Objectives:\n${sh.jpromise || '(none)'}
Open questions:\n${sh.jthreads || '(none)'}
Satchel:\n${sh.inv || '(nothing listed)'}
Milestones (last lines):\n${String(sh.jmarks || '').split('\n').slice(-6).join('\n')}
Clue file (last lines):\n${String(sh.jclues || '').split('\n').slice(-5).join('\n')}`;
}
function memoriesFor(slot, recentText) {
  const mdir = path.join(dir, 'charmem'); if (!fs.existsSync(mdir)) return '';
  const cast = readJson(path.join(dir, 'characters.json'), { people: [] }).people;
  const out = [];
  for (const f of fs.readdirSync(mdir).filter(f => f.endsWith('.md'))) {
    const id = f.replace('.md', '');
    const p = cast.find(x => x.id === id);
    // match on the id or a real name token - never 'The', 'Professor', 'Madam', 'Lady'
    const STOP = /^(the|professor|madam|mr|mrs|miss|lady|sir|of|and)$/i;
    const names = [id].concat(p ? String(p.name).split(/\s+/) : []).map(n => n.replace(/[^\w]/g, '')).filter(n => n.length > 3 && !STOP.test(n));
    if (names.some(n => new RegExp('\\b' + n + '\\b', 'i').test(recentText))) {
      // a memory file can be long: keep its headings/physical notes and the most recent 30 event lines
      const lines = read(path.join(mdir, f)).split(/\r?\n/);
      const events = lines.filter(l => /^- /.test(l)), rest = lines.filter(l => !/^- /.test(l) && l.trim());
      const trimmed = rest.concat(events.length > 30 ? ['- (' + (events.length - 30) + ' earlier events omitted)'].concat(events.slice(-30)) : events).join('\n');
      out.push('### ' + (p ? p.name : id) + ' (' + id + ')' + String.fromCharCode(10) + trimmed);
      memoriesFor.matched = (memoriesFor.matched || []).concat([id]);
    }
  }
  return out.join('\n\n');
}
function buildScene(slot, window) {
  const chat = readJson(path.join(dir, 'chat.json'), { log: [] });
  const sheet = readJson(path.join(dir, 'sheet.json'), {});
  const recent = window ? window.filter(e => !e.meta) : chat.log.filter(e => !e.meta).slice(-30);
  const recentText = recent.slice(-4).map(e => e.text).join(' ');
  const cast = readJson(path.join(dir, 'characters.json'), { people: [] }).people;
  const castList = cast.map(p => p.id + ' = ' + p.name + (p.met ? '' : ' (not yet met)')).join('; ');
  const stable = [ENGINE_RULES, briefSections(), read(path.join(dir, 'voice-bible.md')), read(path.join(dir, 'roll-doctrine.md')), '# THE RULEBOOK (digest)\n' + rulesDigest()].join('\n\n---\n\n');
  const semi = ['# CONTINUITY — this campaign\n' + read(path.join(dir, contFile(slot))), '# CAST ids\n' + castList].join('\n\n---\n\n');
  const volatile = [sheetSummary(sheet), '# CHARACTER MEMORY — people in this scene\n' + (memoriesFor(slot, recentText) || '(none matched)'), '# SCENE\n' + (chat.scene || '')].join('\n\n---\n\n');
  const messages = recent.map(e => ({ role: e.who === 'you' ? 'user' : 'assistant', content: String(e.text) }));
  // the API needs alternating roles starting with user; merge neighbours
  const merged = [];
  for (const m of messages) { const last = merged[merged.length - 1]; if (last && last.role === m.role) last.content += '\n\n' + m.content; else merged.push({ ...m }); }
  while (merged.length && merged[0].role !== 'user') merged.shift();
  return { stable, semi, volatile, messages: merged };
}

/* ---------------- tools ---------------- */
const TOOLS = [
  { name: 'file_turn', description: 'File the Game Master turn for the player message, with all bookkeeping.', strict: true,
    input_schema: { type: 'object', additionalProperties: false, required: ['text', 'meta', 'ask', 'set', 'mem', 'journal', 'done', 'missed', 'meet', 'scene', 'track', 'amb', 'chapter'], properties: {
      text: { type: 'string', description: 'The turn, with cue tags.' },
      meta: { type: 'boolean', description: 'true = table-management reply hidden from the story.' },
      ask: { type: ['object', 'null'], additionalProperties: false, required: ['label', 'stat', 'mod', 'dc', 'edge'], properties: { label: { type: 'string' }, stat: { type: 'string', enum: ['Magic', 'Wits', 'Nerve', 'Charm', 'Insight'] }, mod: { type: 'integer' }, dc: { type: 'integer' }, edge: { type: 'string', enum: ['edge', 'burden', 'none'] } }, description: 'Offer a roll, or null.' },
      set: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['key', 'value'], properties: { key: { type: 'string' }, value: { type: 'string' } } }, description: 'Sheet changes, e.g. {key:"clues",value:"6"}.' },
      mem: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['id', 'line'], properties: { id: { type: 'string' }, line: { type: 'string' } } }, description: 'Character memory lines: what happened to them this turn.' },
      journal: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['key', 'line'], properties: { key: { type: 'string', enum: ['clues', 'objective', 'questions', 'marks', 'people', 'inv', 'taken'] }, line: { type: 'string' } } } },
      done: { type: 'array', items: { type: 'string' }, description: 'Objective text fragments now completed.' },
      missed: { type: 'array', items: { type: 'string' } },
      meet: { type: 'array', items: { type: 'string' }, description: 'Character ids introduced this turn.' },
      scene: { type: ['string', 'null'] }, track: { type: ['string', 'null'] }, amb: { type: 'string', enum: ['rain', 'fire', 'train', 'wind', 'none', 'keep'], description: '"keep" = no change.' },
      chapter: { type: ['string', 'null'], description: 'Only when this turn OPENS a new chapter, e.g. "Chapter III — The Sorting".' }
    } } },
  { name: 'write_tales', description: 'Add new tales to the shelf from recent play (chapter close / "generate tales").', strict: true,
    input_schema: { type: 'object', additionalProperties: false, required: ['tales'], properties: { tales: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['id', 'cat', 'title', 'sub', 'chapter', 'text'], properties: { id: { type: 'string', description: 'unique, lowercase, prefixed for this campaign' }, cat: { type: 'string' }, title: { type: 'string' }, sub: { type: 'string' }, chapter: { type: 'string' }, text: { type: 'string', description: 'the tale with cue tags, 400–700 words' } } } } } } },
  { name: 'update_continuity', description: 'Append a dated note to this campaign\'s continuity file when an established fact changes.', strict: true,
    input_schema: { type: 'object', additionalProperties: false, required: ['note'], properties: { note: { type: 'string' } } } },
  { name: 'update_cast', description: 'Add a person to the cast (their card appears on the People tab) or amend an existing dossier. Only for people who genuinely entered the story at this table; amendments are conservative and never rewrite history.', strict: true,
    input_schema: { type: 'object', additionalProperties: false, required: ['people'], properties: { people: { type: 'array', items: { type: 'object', additionalProperties: false,
      required: ['id', 'name', 'house', 'role', 'desc', 'quote', 'bond', 'met'], properties: {
        id: { type: 'string', description: 'short lowercase id, e.g. "odette"' },
        name: { type: ['string', 'null'], description: 'full name; required when adding someone new' },
        house: { type: ['string', 'null'] },
        role: { type: ['string', 'null'], description: 'one line: what they are in the world, e.g. "Prefect \u00b7 Hufflepuff \u00b7 counts heads"' },
        desc: { type: ['string', 'null'], description: 'the dossier text; third person, present facts only, no shared-past claims the table did not play' },
        quote: { type: ['string', 'null'], description: 'ONLY words actually spoken at this table' },
        bond: { type: ['string', 'null'], description: 'sheet key for their bond hearts, e.g. "bond_Odette"; usually null' },
        met: { type: ['boolean', 'null'] } } } } } } },
];

// haiku cannot compile our strict schemas into a grammar; it gets the same tools unstrict
const TOOLSET = /haiku/.test(MODEL) ? TOOLS.map(t => Object.assign({}, t, { strict: false })) : TOOLS;

/* ---------------- filing ---------------- */
function fileTurn(slot, t) {
  const args = ['gm.js', t.text, '--as', slot];
  if (t.meta) args.push('--meta');
  if (t.ask) args.push('--ask', [t.ask.label, t.ask.stat, t.ask.mod, t.ask.dc, (t.ask.edge && t.ask.edge !== 'none') ? t.ask.edge : ''].join('|'));
  (t.set || []).forEach(s => args.push('--set', s.key + '=' + s.value));
  (t.mem || []).forEach(m => args.push('--mem', m.id + '|' + m.line));
  (t.journal || []).forEach(j => args.push('--j', j.key, '--add', j.line));
  (t.done || []).forEach(d => args.push('--done', d));
  (t.missed || []).forEach(d => args.push('--missed', d));
  (t.meet || []).forEach(m => args.push('--meet', m));
  if (t.scene) args.push('--scene', t.scene);
  if (t.track) args.push('--track', t.track);
  if (t.amb && t.amb !== 'keep') args.push('--amb', t.amb);
  if (t.chapter) args.push('--chapter', t.chapter);
  if (DRY) { log('DRY — would run: node ' + args.map(a => /\s/.test(a) ? JSON.stringify(a.slice(0, 80)) : a).join(' ')); return 'dry'; }
  const r = spawnSync(process.execPath, args, { cwd: dir, encoding: 'utf8' });
  log('gm.js:', (r.stdout || '').trim().replace(/\n/g, ' | '), (r.stderr || '').trim());
  return r.status === 0 ? 'filed' : 'REFUSED: ' + (r.stderr || r.stdout);
}
function writeTales(slot, input) {
  const tj = readJson(path.join(dir, 'tales.json'), { tales: [] });
  const added = [];
  for (const t of input.tales) {
    if (tj.tales.some(x => x.id === t.id)) continue;
    tj.tales.push({ id: t.id, cat: t.cat, title: t.title, sub: t.sube || t.sub, chapter: t.chapter, unlocked: true, text: t.text });
    added.push(t.id);
  }
  if (DRY) { log('DRY — would add tales: ' + added.join(', ')); return 'dry: ' + added.join(', '); }
  fs.writeFileSync(path.join(dir, 'tales.json'), JSON.stringify(tj, null, 2));
  // bake in the background, quietly (skips existing)
  try { const p = spawn(path.join(dir, 'voice/venv/Scripts/python.exe'), ['bake.py'], { cwd: path.join(dir, 'voice'), detached: true, stdio: 'ignore' }); p.on('exit', () => { try { fs.unlinkSync(path.join(dir, 'voice/BAKING')); } catch (e) {} }); p.unref(); } catch (e) { try { fs.unlinkSync(path.join(dir, 'voice/BAKING')); } catch (e2) {} }
  return 'added: ' + added.join(', ') + ' (baking in the background)';
}
function updateContinuity(slot, note) {
  if (DRY) { log('DRY — continuity note: ' + note.slice(0, 120)); return 'dry'; }
  fs.appendFileSync(path.join(dir, contFile(slot)), '\n- [engine ' + new Date().toISOString().slice(0, 10) + '] ' + note + '\n');
  return 'noted';
}


function prevChapterLabel(openedLabel) { const ch = readJson(path.join(dir, 'chat.json'), {}).chapters || []; const i = ch.findIndex(c => c.label === openedLabel); return i > 0 ? ch[i - 1].label : (ch.length >= 2 ? ch[ch.length - 2].label : (ch[0] ? ch[0].label : 'the chapter')); }
function updateCast(slot, input) {
  const cf = path.join(dir, 'characters.json');
  const cj = readJson(cf, { people: [] });
  const done = [];
  for (const p of (input.people || [])) {
    const id = String(p.id || '').toLowerCase().replace(/[^a-z0-9_]/g, '');
    if (!id) continue;
    let ex = cj.people.find(x => x.id === id);
    if (!ex) {
      if (!p.name || !p.desc) { done.push(id + ' REFUSED: a new person needs name and desc'); continue; }
      ex = { id: id, name: p.name, met: true };
      cj.people.push(ex);
      done.push('added ' + id);
    } else done.push('amended ' + id + ' (' + ['name','house','role','desc','quote','bond'].filter(k => typeof p[k] === 'string' && p[k]).join(', ') + ')');
    for (const k of ['name', 'house', 'role', 'desc', 'quote', 'bond']) if (typeof p[k] === 'string' && p[k]) ex[k] = p[k];
    if (typeof p.met === 'boolean') ex.met = p.met;
  }
  if (!done.length) return 'nothing to change';
  if (DRY) { log('DRY cast: ' + done.join('; ')); return 'dry: ' + done.join('; '); }
  fs.writeFileSync(cf, JSON.stringify(cj, null, 2));
  try { fs.appendFileSync(path.join(dir, contFile(slot)), '\n- [engine ' + new Date().toISOString().slice(0, 10) + '] cast: ' + done.join('; ') + '\n'); } catch (err) {}
  return done.join('; ');
}

/* ---------------- one turn ---------------- */
async function answer(slot, playerText) {
  STATUS.busy = true; STATUS.slot = slot; STATUS.lastPlayer = playerText; STATUS.error = null; const t0 = Date.now();
  try { return await answerInner(slot, playerText); } catch (e) { STATUS.error = String(e.message || e).slice(0, 200); throw e; } finally { STATUS.busy = false; STATUS.lastMs = Date.now() - t0; }
}
async function answerInner(slot, playerText) {
  const scene = buildScene(slot);
  const history = scene.messages.slice();
  // the record may already end on the player's own message (gm.js files it first); merge
  if (history.length && history[history.length - 1].role === 'user') { playerText = history.pop().content + '\n\n' + playerText; }
  // cache the history prefix (1h): only the newest message changes between turns, and pauses don't evict it
  if (history.length) { const last = history[history.length - 1]; last.content = [{ type: 'text', text: String(last.content), cache_control: { type: 'ephemeral', ttl: '1h' } }]; }
  const turnState = '[CAMPAIGN STATE — reference for you, not the player speaking]\n\n' + scene.volatile + '\n\n[THE PLAYER, NOW]\n';
  const messages = history.concat([{ role: 'user', content: turnState + playerText }]);
  let filed = false, usage = { in: 0, out: 0, cacheRead: 0, cacheWrite: 0 };
  for (let hop = 0; hop < 4; hop++) {
    const r = await client.messages.create({
      model: MODEL, max_tokens: 6000,
      ...(THINKING ? { thinking: THINKING } : {}),
      ...(THINKING ? { output_config: { effort: EFFORT } } : {}),
      tools: TOOLSET,
      tool_choice: hop === 0 ? { type: 'any' } : { type: 'auto' },
      system: [
        { type: 'text', text: scene.stable, cache_control: { type: 'ephemeral', ttl: '1h' } },
        { type: 'text', text: scene.semi, cache_control: { type: 'ephemeral', ttl: '1h' } },
      ],
      messages,
    });
    usage.in += r.usage.input_tokens || 0; usage.out += r.usage.output_tokens || 0;
    usage.cacheRead += r.usage.cache_read_input_tokens || 0; usage.cacheWrite += r.usage.cache_creation_input_tokens || 0;
    const uses = r.content.filter(b => b.type === 'tool_use');
    if (!uses.length) {
      const text = r.content.filter(b => b.type === 'text').map(b => b.text).join('').trim();
      if (text && !filed) { log('model answered in prose; filing as a plain turn'); fileTurn(slot, { text, meta: false }); filed = true; }
      break;
    }
    messages.push({ role: 'assistant', content: r.content });
    const results = [];
    for (const u of uses) {
      let out = 'ok';
      try {
        if (u.name === 'file_turn' && filed) { out = 'a turn is already filed for this message - do not file another; you are done'; } else if (u.name === 'file_turn') { out = fileTurn(slot, u.input); filed = filed || out === 'filed' || out === 'dry'; if (u.input.chapter && out === 'filed') { const opened = u.input.chapter; setTimeout(() => chapterClose(slot, prevChapterLabel(opened)).catch(() => {}), 1500); log('chapter opened: ' + opened + ' - closing the last one in the background'); } log('turn:', String(u.input.text).replace(/\s+/g, ' ').slice(0, DRY ? 4000 : 160)); if (DRY) log('bookkeeping:', JSON.stringify({ ask: u.input.ask, set: u.input.set, mem: u.input.mem, journal: u.input.journal, done: u.input.done, missed: u.input.missed, meet: u.input.meet, scene: u.input.scene, track: u.input.track, amb: u.input.amb, chapter: u.input.chapter, meta: u.input.meta })); } if (DRY) { const tt = String(u.input.text); log('shape: ' + tt.split(/\n\s*\n/).length + ' paragraphs, ' + tt.length + ' chars'); fs.writeFileSync(path.join(dir, 'engine-dry-turn.txt'), tt); }
        else if (u.name === 'write_tales') out = writeTales(slot, u.input);
        else if (u.name === 'update_continuity') out = updateContinuity(slot, u.input.note);
        else if (u.name === 'update_cast') out = updateCast(slot, u.input);
      } catch (e) { out = 'error: ' + e.message; }
      results.push({ type: 'tool_result', tool_use_id: u.id, content: out });
    }
    messages.push({ role: 'user', content: results });
    if (r.stop_reason === 'end_turn') break;
  }
  const PRICE = /opus/.test(MODEL) ? { in: 5, read: 0.5, write: 10, out: 25 } : /haiku/.test(MODEL) ? { in: 1, read: 0.1, write: 2, out: 5 } : { in: 2, read: 0.2, write: 4, out: 10 };   // write = 1h cache rate
  const cost = (usage.in * PRICE.in + usage.cacheRead * PRICE.read + usage.cacheWrite * PRICE.write + usage.out * PRICE.out) / 1e6;
  STATUS.lastCost = cost; STATUS.lastAt = new Date().toISOString();
  log(`usage in ${usage.in} (cache read ${usage.cacheRead}, write ${usage.cacheWrite}) out ${usage.out} ≈ $${cost.toFixed(3)}`);
  const st = readJson(STATE, {}); st.spent = (st.spent || 0) + cost; st.turns = (st.turns || 0) + 1; if (!DRY) fs.writeFileSync(STATE, JSON.stringify(st, null, 2));
  return filed;
}

/* ---------------- the chapter-close job ---------------- */
// Runs once, after the turn that opened a new chapter has been filed. It reads the closed
// chapter's turns (capped) and asks for tools only: write_tales for that chapter, and an
// update_continuity block of settled facts. Nothing is filed to the table.
function closedChapterWindow(chat, label) {
  const ch = chat.chapters || [];
  // the chapter that closed is the one before the label just opened (or the last one, when called by hand)
  let idx = ch.findIndex(c => c.label === label); if (idx < 0) idx = ch.length - 1;
  const from = idx >= 0 ? ch[idx].start : 0;
  const to = (idx >= 0 && ch[idx + 1]) ? ch[idx + 1].start : chat.log.length;
  const win = chat.log.slice(from, to);
  return { label: idx >= 0 ? ch[idx].label : 'the chapter', entries: win.length > 90 ? win.slice(0, 20).concat(win.slice(-70)) : win };
}
async function chapterClose(slot, closedLabel) {
  STATUS.busy = true; STATUS.job = 'closing ' + closedLabel; const t0 = Date.now();
  try {
    const chat = readJson(path.join(dir, 'chat.json'), { log: [] });
    const w = closedChapterWindow(chat, closedLabel);
    const scene = buildScene(slot, w.entries);
    const ask = '(chapter close: "' + w.label + '" has just closed. This is bookkeeping, not play - use tools only and file nothing to the table. '
      + '1) write_tales: the tales that chapter earned, by the "Generating tales" rules in the brief - two to four, each true to what the player actually did and said, each in one character\'s voice or the narrator\'s, chapter field = "' + w.label + '". Do not retell scenes the player watched; tell what they could not see. '
      + '2) update_continuity: one compact block headed "' + w.label + ' - settled" with: the in-world date and hour at the close; standing appointments still open; facts that must hold from here on; and any earlier note this chapter made stale. Never invent - if the turns above do not say it, leave it out.)';
    const history = scene.messages.slice();
    if (history.length) { const last = history[history.length - 1]; last.content = [{ type: 'text', text: String(last.content), cache_control: { type: 'ephemeral', ttl: '1h' } }]; }
    const messages = history.concat([{ role: 'user', content: '[CAMPAIGN STATE]\n\n' + scene.volatile + '\n\n' + ask }]);
    let usage = { in: 0, out: 0, cacheRead: 0, cacheWrite: 0 }, did = [];
    for (let hop = 0; hop < 3; hop++) {
      const r = await client.messages.create({
        model: MODEL, max_tokens: 8000, ...(THINKING ? { thinking: THINKING } : {}), ...(THINKING ? { output_config: { effort: EFFORT } } : {}),
        tools: TOOLSET.filter(t => t.name !== 'file_turn'), tool_choice: hop === 0 ? { type: 'any' } : { type: 'auto' },
        system: [{ type: 'text', text: scene.stable, cache_control: { type: 'ephemeral', ttl: '1h' } }, { type: 'text', text: scene.semi, cache_control: { type: 'ephemeral', ttl: '1h' } }],
        messages,
      });
      usage.in += r.usage.input_tokens || 0; usage.out += r.usage.output_tokens || 0; usage.cacheRead += r.usage.cache_read_input_tokens || 0; usage.cacheWrite += r.usage.cache_creation_input_tokens || 0;
      const uses = r.content.filter(b => b.type === 'tool_use'); if (!uses.length) break;
      messages.push({ role: 'assistant', content: r.content });
      const results = [];
      for (const u of uses) {
        let o = 'ok';
        try {
          if (u.name === 'write_tales') { o = writeTales(slot, u.input); did.push('tales: ' + u.input.tales.map(t => t.id).join(', ')); if (DRY) log('DRY tales:', JSON.stringify(u.input.tales.map(t => ({ id: t.id, cat: t.cat, title: t.title, chapter: t.chapter, words: String(t.text).split(/\s+/).length })))); }
          else if (u.name === 'update_cast') { o = updateCast(slot, u.input); did.push('cast'); if (DRY) log('DRY cast (job): ' + o); }
          else if (u.name === 'update_continuity') { o = updateContinuity(slot, u.input.note); did.push('continuity'); if (DRY) log('DRY continuity:', u.input.note.slice(0, 1200)); }
          else o = 'not in this job';
        } catch (err) { o = 'error: ' + err.message; }
        results.push({ type: 'tool_result', tool_use_id: u.id, content: o });
      }
      messages.push({ role: 'user', content: results });
      if (r.stop_reason === 'end_turn') break;
    }
    const PRICE = /opus/.test(MODEL) ? { in: 5, read: 0.5, write: 10, out: 25 } : /haiku/.test(MODEL) ? { in: 1, read: 0.1, write: 2, out: 5 } : { in: 2, read: 0.2, write: 4, out: 10 };   // write = 1h cache rate
    const cost = (usage.in * PRICE.in + usage.cacheRead * PRICE.read + usage.cacheWrite * PRICE.write + usage.out * PRICE.out) / 1e6;
    STATUS.lastCost = cost; STATUS.lastAt = new Date().toISOString();
    log('chapter close "' + w.label + '": ' + (did.join('; ') || 'nothing written') + ' - in ' + usage.in + ' (cache read ' + usage.cacheRead + ', write ' + usage.cacheWrite + ') out ' + usage.out + ' ≈ $' + cost.toFixed(3));
    const st = readJson(STATE, {}); st.spent = (st.spent || 0) + cost; st.jobs = (st.jobs || 0) + 1; if (!DRY) fs.writeFileSync(STATE, JSON.stringify(st, null, 2));
  } catch (err) { STATUS.error = 'chapter close: ' + String(err.message || err).slice(0, 160); log('chapter close ERROR', err.status || '', err.message); }
  finally { STATUS.busy = false; STATUS.job = null; STATUS.lastMs = Date.now() - t0; }
}

/* ---------------- the wire ---------------- */
function pendingMessages(slot) {
  const chat = readJson(path.join(dir, 'chat.json'), { log: [] });
  const filed = new Set(chat.log.filter(e => e.seq).map(e => e.seq));
  const st = readJson(STATE, {});
  const handled = new Set(st.handled || []);
  return read(path.join(dir, 'inbox-' + slot + '.log')).split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch (e) { return null; } })
    .filter(m => m && m.seq && m.text && !filed.has(m.seq) && !handled.has(m.seq));
}
function unmarkHandled(seq) { const st = readJson(STATE, {}); st.handled = (st.handled || []).filter(x => x !== seq); fs.writeFileSync(STATE, JSON.stringify(st, null, 2)); }
// transient trouble (rate limit, overload, network) is retried with a growing pause; a refused key or a bad request is not
function retryable(err) { const s = err && err.status; if (s === 429 || s === 529 || (s >= 500 && s < 600)) return true; if (!s && /ECONN|ETIMEDOUT|ENOTFOUND|fetch failed|socket|network/i.test(String(err && err.message))) return true; return false; }
const RETRY = { seq: null, n: 0, at: 0 };
function markHandled(seq) { const st = readJson(STATE, {}); st.handled = (st.handled || []).slice(-200).concat([seq]); fs.writeFileSync(STATE, JSON.stringify(st, null, 2)); }

/* ---------------- control port (the page talks to this through server.js) ---------------- */
function retake(slot) {
  // drop the last story turn the engine filed and answer the same player message again
  const chatPath = path.join(dir, 'chat.json');
  const chat = readJson(chatPath, { log: [] });
  let i = chat.log.length - 1;
  while (i >= 0 && (chat.log[i].who !== 'gm' || chat.log[i].meta)) i--;
  if (i < 0) return { ok: false, error: 'no turn to retake' };
  const dropped = chat.log[i];
  // the player's message that prompted it must stay
  chat.log.splice(i, 1);
  chat.seq = (chat.seq || 0) + 1;
  fs.writeFileSync(chatPath, JSON.stringify(chat));
  const st = readJson(STATE, {}); st.handled = (st.handled || []); fs.writeFileSync(STATE, JSON.stringify(st, null, 2));
  const player = STATUS.lastPlayer || ([...chat.log].reverse().find(e => e.who === 'you' && !e.meta) || {}).text || '';
  log('retake requested; dropped turn:', String(dropped.text).replace(/\s+/g, ' ').slice(0, 80));
  setTimeout(() => answer(slot, String(player)).catch(e => log('retake ERROR', e.message)), 50);
  return { ok: true };
}
function startControl(getSlot) {
  const http = require('http');
  http.createServer((req, res) => {
    const send = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
    if (req.method === 'GET' && req.url === '/status') {
      const st = readJson(STATE, {});
      return send(200, Object.assign({}, STATUS, { slot: getSlot(), spent: st.spent || 0, turns: st.turns || 0, dry: DRY }));
    }
    if (req.method === 'POST' && req.url === '/retake') {
      if (STATUS.busy) return send(409, { ok: false, error: 'a turn is being written' });
      return send(200, retake(getSlot()));
    }
    send(404, { ok: false });
  }).on('error', err => log('control port :' + CTRL_PORT + ' unavailable (' + err.code + ') - running without it')).listen(CTRL_PORT, '127.0.0.1', () => log('control port :' + CTRL_PORT));
}

process.on('uncaughtException', err => { log('CRASH', err && err.stack ? err.stack.split('\n').slice(0, 4).join(' | ') : String(err)); process.exit(1); });
process.on('unhandledRejection', err => { log('CRASH (rejection)', err && err.stack ? err.stack.split('\n').slice(0, 4).join(' | ') : String(err)); process.exit(1); });

async function main() {
  let slot = liveSlot();
  if (!slot && !process.argv.includes('--measure') && !DRY) {
    // a fresh install: no campaign yet. Stay up, answer /status, and start when one appears.
    startControl(() => liveSlot());
    log('no live campaign yet; waiting for one (begin a story from the site)');
    while (!(slot = liveSlot())) await new Promise(r => setTimeout(r, 2000));
    log('campaign appeared: ' + slot);
    STATUS.controlUp = true;
  }
  if (!slot) { log('no live campaign (chat.json has no profile)'); process.exit(1); }
  const jobAt = process.argv.indexOf('--job');
  if (jobAt > -1) { await chapterClose(slot, process.argv[jobAt + 1] || ''); process.exit(0); }
  if (process.argv.includes('--measure')) {
    // free: count_tokens costs nothing. Shows exactly what each block weighs.
    const sc = buildScene(slot);
    const count = async (label, text) => { const r = await client.messages.countTokens({ model: MODEL, messages: [{ role: 'user', content: text || '(empty)' }] }); console.log(label.padEnd(34), String(r.input_tokens).padStart(7), 'tokens'); return r.input_tokens; };
    let total = 0;
    total += await count('engine rules', ENGINE_RULES);
    total += await count('brief sections', briefSections());
    total += await count('voice bible', read(path.join(dir, 'voice-bible.md')));
    total += await count('roll doctrine', read(path.join(dir, 'roll-doctrine.md')));
    total += await count('rulebook digest', rulesDigest());
    total += await count('continuity + cast (1h block)', read(path.join(dir, contFile(slot))));
    const chat = readJson(path.join(dir, 'chat.json'), { log: [] });
    const recentText = chat.log.filter(e => !e.meta).slice(-8).map(e => e.text).join(' ');
    memoriesFor.matched = [];
    total += await count('character memories (matched)', memoriesFor(slot, recentText));
    console.log('  matched files:', (memoriesFor.matched || []).join(', ') || 'none');
    total += await count('sheet summary', sheetSummary(readJson(path.join(dir, 'sheet.json'), {})));
    total += await count('last 30 turns', sc.messages.map(m => m.content).join('\n'));
    console.log('TOTAL per turn (before caching)'.padEnd(34), String(total).padStart(7));
    return;
  }
  log(`engine up · slot ${slot} · model ${MODEL} · effort ${EFFORT}${DRY ? ' · DRY RUN' : ''}`);
  if (DRY) {
    const chat = readJson(path.join(dir, 'chat.json'), { log: [] });
    const lastYou = [...chat.log].reverse().find(e => e.who === 'you' && !e.meta && !/generate tales|end (my )?session|call it|^🎲/i.test(String(e.text)));
    log('answering the last player message again (not filed): ' + String(lastYou.text).slice(0, 120));
    // rewind the scene to just before that message, so the engine answers it fresh
    const idx = chat.log.indexOf(lastYou);
    const rewound = { ...chat, log: chat.log.slice(0, idx) };
    const orig = buildScene; buildScene = (s) => { const sc = orig(s); const recent = rewound.log.filter(e => !e.meta).slice(-30); const msgs = []; for (const e of recent) { const m = { role: e.who === 'you' ? 'user' : 'assistant', content: String(e.text) }; const l = msgs[msgs.length - 1]; if (l && l.role === m.role) l.content += '\n\n' + m.content; else msgs.push(m); } while (msgs.length && msgs[0].role !== 'user') msgs.shift(); sc.messages = msgs; return sc; };
    await answer(slot, String(lastYou.text));
    return;
  }
  if (!STATUS.controlUp) startControl(() => slot);
  let busy = false;
  async function tick() {
    if (busy) return; busy = true;
    try {
      const cur = liveSlot(); if (cur && cur !== slot) { log(`live campaign switched: ${slot} → ${cur}; following it`); slot = cur; }
      for (const m of pendingMessages(slot)) {
        if (RETRY.seq === m.seq && Date.now() < RETRY.at) break;   // still waiting out a backoff
        log('player:', String(m.text).slice(0, 140) + (RETRY.seq === m.seq ? ' (retry ' + RETRY.n + ')' : ''));
        markHandled(m.seq);
        try { await answer(slot, String(m.text)); RETRY.seq = null; RETRY.n = 0; }
        catch (err) {
          const n = RETRY.seq === m.seq ? RETRY.n + 1 : 1;
          if (retryable(err) && n <= 4) { const wait = Math.min(60000, 4000 * Math.pow(2, n - 1)); RETRY.seq = m.seq; RETRY.n = n; RETRY.at = Date.now() + wait; unmarkHandled(m.seq); log('ERROR', err.status || '', err.message, '- retrying in ' + Math.round(wait / 1000) + 's'); break; }
          RETRY.seq = null; RETRY.n = 0; STATUS.error = STATUS.error || String(err.message || err).slice(0, 200);
          log('ERROR', err.status || '', err.message, '- giving up on this message; the player can say it again');
          break;
        }
        if (ONCE) process.exit(0);
      }
    } catch (e) { log('ERROR', e.status || '', e.message); }
    busy = false;
  }
  setInterval(tick, 1500); tick();
}
main().catch(e => { log('FATAL', e.message); process.exit(1); });
