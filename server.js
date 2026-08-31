// The Hollow Ledger — local table server
// Serves the gamebook and relays Living Table messages via two files:
//   inbox-<slot>.log — one JSON line per player message (the Game Master engine watches this)
//   chat.json  — the full table log (the engine files replies here; the page polls it)
const http = require('http');
const fs = require('fs');
const path = require('path');

const dir = __dirname;
const PORT = parseInt(process.env.PORT || '7439', 10);
const GM_PORT = parseInt(process.env.GM_PORT || '7442', 10);
const { spawn } = require('child_process');

// --- .env (API key, model) — read here so /setup can report and rewrite it
function readEnv() {
  const o = {};
  try { for (const l of fs.readFileSync(path.join(dir, '.env'), 'utf8').split(/\r?\n/)) { const m = l.match(/^([A-Z_]+)=(.*)$/); if (m) o[m[1]] = m[2].trim(); } } catch (e) {}
  return o;
}
function writeEnv(o) {
  fs.writeFileSync(path.join(dir, '.env'), Object.keys(o).filter(k => o[k] !== undefined && o[k] !== '').map(k => k + '=' + o[k]).join('\n') + '\n');
}

// --- the Game Master engine runs as a child of the table server (one process to start).
// A separately started engine.js (dev) is left alone: we only spawn if nothing answers on GM_PORT.
let gmProc = null;
function gmAlive() {
  return new Promise(res => { const q = http.get({ host: '127.0.0.1', port: GM_PORT, path: '/status', timeout: 800 }, r => { r.resume(); res(true); }); q.on('error', () => res(false)); q.on('timeout', () => { q.destroy(); res(false); }); });
}
async function startGm(reason) {
  if ((readEnv().GM_ENGINE || '').toLowerCase() === 'off') { console.log('GM engine is off (GM_ENGINE=off in .env) - a Claude session runs this table'); return; }
  if (gmProc) { try { gmProc.kill(); } catch (e) {} gmProc = null; await new Promise(r => setTimeout(r, 600)); }
  else if (await gmAlive()) { console.log('GM engine already running on :' + GM_PORT + ' (not spawning)'); return; }
  const env = Object.assign({}, process.env, readEnv(), { GM_PORT: String(GM_PORT) });
  if (!env.ANTHROPIC_API_KEY) { console.log('GM engine not started: no API key yet (open the site to set one)'); return; }
  const crashLog = path.join(dir, 'engine-crash.log');
  try { fs.writeFileSync(crashLog, ''); } catch (e) {}
  gmProc = spawn(process.execPath, [path.join(dir, 'engine.js')], { cwd: dir, env, stdio: ['ignore', 'ignore', 'pipe'] });
  gmProc.stderr.on('data', d => { try { fs.appendFileSync(crashLog, d); } catch (e) {} });
  gmProc.on('exit', c => {
    console.log('GM engine exited (' + c + ')');
    if (c) { try { const all = fs.readFileSync(crashLog, 'utf8').trim().split(/\r?\n/).filter(Boolean); const tail = (all.length > 14 ? all.slice(0, 9).concat(['   ...'], all.slice(-4)) : all).join('\n'); if (tail) console.log('--- why (engine-crash.log) ---\n' + tail + '\n------------------------------'); } catch (e) {} }
    gmProc = null;
  });
  console.log('GM engine started' + (reason ? ' (' + reason + ')' : ''));
}
// --- the voice sidecar (optional voice pack: voice/venv + voice/app.py). Skipped if absent or already up.
let voiceProc = null;
function startVoice() {
  const py = path.join(dir, 'voice', 'venv', 'Scripts', 'python.exe'), app = path.join(dir, 'voice', 'app.py');
  if (!fs.existsSync(py) || !fs.existsSync(app)) return;
  const q = http.get({ host: '127.0.0.1', port: 7440, path: '/', timeout: 800 }, r => { r.resume(); });
  q.on('error', () => {
    voiceProc = spawn(py, [app], { cwd: dir, stdio: ['ignore', 'ignore', 'ignore'] });
    voiceProc.on('exit', () => { voiceProc = null; });
    console.log('voice sidecar started');
  });
  q.on('timeout', () => q.destroy());
}
process.on('exit', () => { try { if (gmProc) gmProc.kill(); } catch (e) {} try { if (voiceProc) voiceProc.kill(); } catch (e) {} });
process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));

// --- neural narration (Edge TTS endpoint via msedge-tts; falls back client-side if this fails)
let MsEdgeTTS = null, OUTPUT_FORMAT = null;
try { ({ MsEdgeTTS, OUTPUT_FORMAT } = require('msedge-tts')); } catch (e) { console.log('msedge-tts not available:', e.message); }
const { execFile } = require('child_process');
function liveProfile() { try { return JSON.parse(fs.readFileSync(path.join(dir, 'chat.json'), 'utf8')).profile || null; } catch (e) { return null; } }
function runSave(args) { return new Promise((res, rej) => execFile(process.execPath, ['save.js', ...args], { cwd: dir }, (err, so, se) => err ? rej(new Error((so || '') + (se || '') || err.message)) : res(so))); }

const MOODS = {
  soft:    { rate: -12, pitch: -8 },
  tense:   { rate: -16, pitch: -16 },
  warm:    { rate: -4,  pitch: 8 },
  grand:   { rate: -14, pitch: -5 },
  excited: { rate: 14,  pitch: 18 },
  afraid:  { rate: -6,  pitch: 12 },
  plain:   { rate: -3,  pitch: 0 },
};

// The company of voices. Cue with [name] in GM text; [narrator] returns to Sonia.
const SPEAKERS = {
  narrator:   { voice: 'en-GB-SoniaNeural',  rate: 0,   pitch: 0 },
  mum:        { voice: 'en-GB-LibbyNeural',  rate: -2,  pitch: 0 },
  ollivander: { voice: 'en-GB-RyanNeural',   rate: -16, pitch: -14 },
  vekk:       { voice: 'en-GB-RyanNeural',   rate: -10, pitch: -30 },
  posy:       { voice: 'en-IE-EmilyNeural',  rate: 10,  pitch: 10 },  // bright and quick
  nell:       { voice: 'en-GB-LibbyNeural',  rate: -14, pitch: 8 },   // soft, unhurried, lighter than mum
  idris:      { voice: 'en-GB-ThomasNeural', rate: -14, pitch: 4 },   // quiet, measured
  rooke:      { voice: 'en-GB-SoniaNeural',  rate: -8,  pitch: 5 },   // precise, finishing-school clip
  fen:        { voice: 'en-GB-ThomasNeural', rate: 6,   pitch: 10 },  // nervous, quick
  dumbledore: { voice: 'en-GB-RyanNeural',   rate: -8,  pitch: -4 },  // ~51 in 1932, warm not ancient
  whisp:      { voice: 'en-GB-LibbyNeural',  rate: -12, pitch: -10 },
  burke:      { voice: 'en-GB-ThomasNeural', rate: -10, pitch: -12 },
  sedge:      { voice: 'en-IE-EmilyNeural',  rate: -8,  pitch: -2 },  // 16, cooler register than Posy
  lady:       { voice: 'en-GB-SoniaNeural',  rate: -20, pitch: 4 },
  peeves:     { voice: 'en-GB-MaisieNeural', rate: 22,  pitch: 28 },  // annoying on purpose
  man:        { voice: 'en-GB-ThomasNeural', rate: 0,   pitch: 0 },
  woman:      { voice: 'en-GB-LibbyNeural',  rate: 0,   pitch: 0 },
  boy:        { voice: 'en-GB-ThomasNeural', rate: 4,   pitch: 8 },
  girl:       { voice: 'en-GB-LibbyNeural',  rate: 6,   pitch: 12 },
};

// CUE_RE is defined after NAME2SPEAKER so character-name cues resolve too

function speakable(t) {
  t = String(t);
  t = t.replace(/Mm/g, 'Hmm');
  t = t.replace(/Mm-?hm/gi, 'mm-hmm');
  t = t.replace(/([A-Z]{2,})/g, function (m) { return m[0] + m.slice(1).toLowerCase(); });
  return t;
}

// name -> speaker aliases for cue-less dialogue ("...," said Posy)
const NAME2SPEAKER = {
  posy:'posy', nell:'nell', idris:'idris', rooke:'rooke', lucinda:'rooke', fen:'fen',
  ollivander:'ollivander', vekk:'vekk', dumbledore:'dumbledore', whisp:'whisp', elowen:'whisp',
  burke:'burke', caradoc:'burke', sedge:'sedge', aurelia:'sedge', peeves:'peeves',
  vera:'mum', mum:'mum', mother:'mum', tom:'man', dad:'man', maisie:'girl', ogg:'man',
  odette:'woman', marsh:'woman', malkin:'woman', lady:'lady', elias:'boy', remus:'boy',
};
const CUE_RE = new RegExp('(\\[(?:' + Object.keys(MOODS).concat(Object.keys(SPEAKERS), Object.keys(NAME2SPEAKER)).join('|') + ')\\])', 'i');
const SAY_VERBS = '(?:said|says|saying|asked|asks|whisper(?:ed|s)?|murmur(?:ed|s)?|announc(?:ed|es)|shout(?:ed|s)|call(?:ed|s)|mouth(?:ed|s)|repl(?:ied|ies)|told|tells|added|adds|offer(?:ed|s))';

// serialized, cached Chatterbox generation: one GPU job at a time,
// repeated segments (replays, reconnects) come back instantly, timing logged
// a bake in progress owns the GPU; a flag nobody has touched for two hours is a stranded one and is ignored
function bakingNow() { try { const st = fs.statSync(path.join(dir, 'voice/BAKING')); if (Date.now() - st.mtimeMs > 2 * 3600 * 1000) { try { fs.unlinkSync(path.join(dir, 'voice/BAKING')); } catch (e) {} console.log('stale voice/BAKING flag removed'); return false; } return true; } catch (e) { return false; } }
function ttsLog(line) { try { fs.appendFileSync(path.join(dir, 'voice/tts.log'), new Date().toISOString() + ' ' + line + '\n'); } catch (e) {} }
const CB_CACHE = new Map(); let CB_CHAIN = Promise.resolve();
function chatterboxCached(seg) {
  const k = seg.speaker + '|' + seg.mood + '|' + seg.text;
  if (!CB_CACHE.has(k)) {
    const p = CB_CHAIN.catch(() => {}).then(async () => {
      const t0 = Date.now();
      const b = await chatterbox(seg);
      try { fs.appendFileSync(path.join(dir, 'voice/tts.log'),
        new Date().toISOString() + ' ' + (Date.now() - t0) + 'ms ' + b.length + 'B ' +
        seg.speaker + '/' + seg.mood + ' ' + seg.text.length + 'ch\n'); } catch (e) {}
      return b;
    });
    CB_CHAIN = p.catch(() => {});
    CB_CACHE.set(k, p);
    p.catch(() => { CB_CACHE.delete(k); });
    if (CB_CACHE.size > 400) CB_CACHE.delete(CB_CACHE.keys().next().value);
  }
  return CB_CACHE.get(k);
}

function splitCues(text) {
  // pass 1: cue-delimited parts with mood/speaker state
  const parts = []; let mood = 'plain', speaker = 'narrator';
  for (const part of String(text).split(CUE_RE)) {
    const m = part.match(/^\[(\w+)\]$/);
    if (m) {
      const k = m[1].toLowerCase();
      if (MOODS[k]) mood = k;
      else { const sk = SPEAKERS[k] ? k : NAME2SPEAKER[k]; if (sk) { speaker = sk; mood = 'plain'; } }
      continue;
    }
    const t = part.replace(/\[\w+\]/g, '').trim();
    if (t) parts.push({ text: t, mood, speaker });
    // a speaker's cue governs only its own part; narration resumes unless re-cued
    if (speaker !== 'narrator') speaker = 'narrator';
  }

  // pass 2: quote-aware refinement
  const spans = [];
  const QUOTE = /[\u201c"]([^\u201d"]+)[\u201d"]/g;
  for (const p of parts) {
    if (p.speaker !== 'narrator') {
      if (QUOTE.test(p.text)) {
        // inside a character cue, only the quoted speech is theirs
        QUOTE.lastIndex = 0;
        let last = 0, mm;
        while ((mm = QUOTE.exec(p.text)) !== null) {
          const before = p.text.slice(last, mm.index).trim();
          if (before) spans.push({ text: before, mood: p.mood, speaker: 'narrator' });
          spans.push({ text: mm[1].trim(), mood: p.mood, speaker: p.speaker });
          last = QUOTE.lastIndex;
        }
        const tail = p.text.slice(last).trim();
        if (tail) spans.push({ text: tail, mood: p.mood, speaker: 'narrator' });
      } else {
        spans.push(p); // pure speech line, no quotes: all theirs
      }
      QUOTE.lastIndex = 0;
      continue;
    }
    // narrator part: auto-voice quotes with clear attribution
    QUOTE.lastIndex = 0;
    let last = 0, mm2, any = false;
    while ((mm2 = QUOTE.exec(p.text)) !== null) {
      const before = p.text.slice(last, mm2.index);
      const after = p.text.slice(QUOTE.lastIndex, QUOTE.lastIndex + 60);
      let who = null;
      const fwd = after.match(new RegExp('^[\\s,]*' + SAY_VERBS + '\\s+([A-Z][a-z]+)'));
      const bwd = before.match(new RegExp('([A-Z][a-z]+)[\\s,]*(?:' + SAY_VERBS + ')?[,:\\s]*$'));
      if (fwd && NAME2SPEAKER[fwd[1].toLowerCase()]) who = NAME2SPEAKER[fwd[1].toLowerCase()];
      else if (bwd && NAME2SPEAKER[bwd[1].toLowerCase()] && new RegExp(SAY_VERBS + '|\\bsa(?:id|ys)\\b|[:,]\\s*$').test(before.slice(-30))) who = NAME2SPEAKER[bwd[1].toLowerCase()];
      if (who) {
        any = true;
        const b = before.trim(); if (b) spans.push({ text: b, mood: p.mood, speaker: 'narrator' });
        spans.push({ text: mm2[1].trim(), mood: p.mood, speaker: who });
        last = QUOTE.lastIndex;
      }
    }
    const tail2 = p.text.slice(last).trim();
    if (any) { if (tail2) spans.push({ text: tail2, mood: p.mood, speaker: 'narrator' }); }
    else spans.push(p);
  }

  // pass 3: chunk long spans at line breaks, then sentence boundaries.
  // NOTHING may be dropped here: text after the last full stop is still text.
  const segs = [];
  const SENT = /[^.!?]+[.!?]+["'\u2019\u201d)]*\s*/g;
  for (const sp of spans) {
    for (const block of String(sp.text).split(/\n+/)) {
      if (!block.trim()) continue;
      SENT.lastIndex = 0;
      const sents = []; let mS, end = 0;
      while ((mS = SENT.exec(block)) !== null) { sents.push(mS[0]); end = SENT.lastIndex; }
      const rest = block.slice(end);
      if (rest.trim()) sents.push(rest);
      if (!sents.length) sents.push(block);
      let buf = '';
      for (const sn of sents) {
        buf += sn;
        if (buf.length > 150) { segs.push({ text: buf.trim(), mood: sp.mood, speaker: sp.speaker }); buf = ''; }
      }
      if (buf.trim()) segs.push({ text: buf.trim(), mood: sp.mood, speaker: sp.speaker });
    }
  }
  return segs.length ? segs : [{ text: String(text), mood: 'plain', speaker: 'narrator' }];
}

// mood -> Chatterbox expressiveness (exaggeration = emotion, cfg = pacing; lower cfg = more deliberate)
const CB_MOOD = {
  plain:   { ex: 0.45, cfg: 0.50 },
  soft:    { ex: 0.35, cfg: 0.38 },
  warm:    { ex: 0.55, cfg: 0.45 },
  tense:   { ex: 0.60, cfg: 0.35 },
  grand:   { ex: 0.55, cfg: 0.35 },
  excited: { ex: 0.85, cfg: 0.50 },
  afraid:  { ex: 0.70, cfg: 0.40 },
};

function chatterbox(seg) {
  return new Promise((resolve, reject) => {
    const md = CB_MOOD[seg.mood] || CB_MOOD.plain;
    const body = JSON.stringify({ text: speakable(seg.text), speaker: seg.speaker, exaggeration: md.ex, cfg: md.cfg });
    const req = http.request({ host: '127.0.0.1', port: 7440, path: '/synth', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }, timeout: 60000 },
      res => {
        if (res.statusCode !== 200) { res.resume(); return reject(new Error('cb ' + res.statusCode)); }
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks)));
      });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(new Error('cb timeout')); });
    req.end(body);
  });
}

function streamToBuffer(s) {
  return new Promise((res, rej) => {
    const chunks = [];
    s.on('data', c => chunks.push(c));
    s.on('end', () => res(Buffer.concat(chunks)));
    s.on('error', rej);
  });
}

async function synthesize(text) {
  const out = [];
  for (const seg of splitCues(text)) {
    const sp = SPEAKERS[seg.speaker] || SPEAKERS.narrator;
    const md = MOODS[seg.mood] || MOODS.plain;
    const rate = (sp.rate + md.rate) + '%';
    const pitch = (sp.pitch + md.pitch) + 'Hz';
    const tts = new MsEdgeTTS();
    await tts.setMetadata(sp.voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
    let r = await tts.toStream(speakable(seg.text), { rate: (sp.rate + md.rate >= 0 ? '+' : '') + rate, pitch: (sp.pitch + md.pitch >= 0 ? '+' : '') + pitch });
    if (r && r.audioStream) r = r.audioStream;
    out.push(await streamToBuffer(r));
    try { tts.close && tts.close(); } catch (e) {}
  }
  return Buffer.concat(out);
}

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.zip': 'application/zip',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.txt': 'text/plain; charset=utf-8',
};

http.createServer((req, res) => {
  // the GM engine's control port, proxied so the page never talks to it directly
  if ((req.method === 'GET' && req.url === '/gm/status') || (req.method === 'POST' && req.url === '/gm/retake')) {
    const http = require('http');
    const up = http.request({ host: '127.0.0.1', port: GM_PORT, path: req.url.replace('/gm', ''), method: req.method }, (r2) => {
      let b = ''; r2.on('data', c => b += c); r2.on('end', () => { res.writeHead(r2.statusCode, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(b); });
    });
    up.on('error', () => { res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify({ engine: 'off' })); });
    up.end();
    return;
  }
  if (req.method === 'POST' && req.url === '/export') {
    let body = ''; req.on('data', c => { body += c; if (body.length > 4000) req.destroy(); });
    req.on('end', async () => {
      try {
        const j = JSON.parse(body || '{}'); const slot = String(j.slot || '').replace(/[^a-z0-9_-]/gi, '');
        if (!slot) throw new Error('no slot');
        const so = await runSave(['export', slot]);
        const m = so.match(/-> (.+?\.zip)/); const file = m ? path.basename(m[1]) : null;
        res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: true, file, url: file ? '/exports/' + encodeURIComponent(file) : null, note: so.trim() }));
      } catch (e) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: false, error: String(e.message || e) })); }
    });
    return;
  }
  if (req.method === 'PUT' && req.url === '/import') {
    // raw zip bytes in the body; the page sends the chosen file directly
    const tmp = path.join(dir, 'saves', '_import-upload.zip');
    fs.mkdirSync(path.join(dir, 'saves'), { recursive: true });
    const ws = fs.createWriteStream(tmp); let size = 0;
    req.on('data', c => { size += c.length; if (size > 2 * 1024 * 1024 * 1024) req.destroy(); });
    req.pipe(ws);
    ws.on('finish', async () => {
      try {
        const so = await runSave(['import', tmp]);
        try { fs.unlinkSync(tmp); } catch (e) {}
        const m = so.match(/as slot "([^"]+)"/);
        res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: true, slot: m ? m[1] : null, note: so.trim() }));
      } catch (e) { try { fs.unlinkSync(tmp); } catch (e2) {} res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: false, error: String(e.message || e) })); }
    });
    return;
  }
  if (req.method === 'GET' && req.url === '/setup') {
    const env = readEnv();
    const voicePack = fs.existsSync(path.join(dir, 'voice', 'venv', 'Scripts', 'python.exe'));
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ hasKey: !!env.ANTHROPIC_API_KEY, keyTail: env.ANTHROPIC_API_KEY ? env.ANTHROPIC_API_KEY.slice(-4) : '', workspace: !!env.ANTHROPIC_WORKSPACE_ID, model: env.GM_MODEL || 'claude-sonnet-5', effort: env.GM_EFFORT || 'medium', voicePack, edgeVoices: !!MsEdgeTTS, live: liveProfile() }));
    return;
  }
  if (req.method === 'POST' && req.url === '/setup') {
    let body = ''; req.on('data', c => { body += c; if (body.length > 8000) req.destroy(); });
    req.on('end', async () => {
      try {
        const j = JSON.parse(body || '{}'); const env = readEnv();
        if (typeof j.key === 'string' && j.key.trim()) { if (!/^sk-ant-/.test(j.key.trim())) throw new Error('that does not look like an Anthropic API key (they start with sk-ant-)'); env.ANTHROPIC_API_KEY = j.key.trim(); }
        if (typeof j.workspace === 'string') env.ANTHROPIC_WORKSPACE_ID = j.workspace.trim();
        if (typeof j.model === 'string' && /^claude-[a-z0-9-]+$/.test(j.model)) env.GM_MODEL = j.model;
        if (typeof j.effort === 'string' && /^(low|medium|high)$/.test(j.effort)) env.GM_EFFORT = j.effort;
        if (!env.ANTHROPIC_API_KEY) throw new Error('an API key is needed for the Game Master');
        writeEnv(env);
        await startGm('settings changed');
        res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: true }));
      } catch (e) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: false, error: String(e.message || e) })); }
    });
    return;
  }
  if (req.method === 'GET' && req.url === '/profiles') {
    const live = liveProfile();
    const saves = path.join(dir, 'saves');
    const list = [];
    try {
      for (const sname of fs.readdirSync(saves)) {
        if (sname.startsWith('_')) continue;
        try {
          const ch = JSON.parse(fs.readFileSync(path.join(saves, sname, 'chat.json'), 'utf8'));
          if (!ch.profile) continue;                       // only stamped campaigns
          const sh = JSON.parse(fs.readFileSync(path.join(saves, sname, 'sheet.json'), 'utf8'));
          list.push({ slot: sname, name: sh.name || '(unnamed)', house: sh.house || '', scene: ch.scene || '', entries: ch.log.length, live: sname === live });
        } catch (e) {}
      }
    } catch (e) {}
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ live, campaigns: list }));
    return;
  }
  if (req.method === 'POST' && (req.url === '/profile' || req.url === '/newgame')) {
    let body = '';
    req.on('data', c => { body += c; if (body.length > 4000) req.destroy(); });
    req.on('end', async () => {
      try {
        const j = JSON.parse(body || '{}');
        const live = liveProfile();
        if (live) await runSave(['save', live]);          // never lose the outgoing campaign
        let target;
        if (req.url === '/profile') {
          target = String(j.slot || '').replace(/[^a-z0-9_-]/gi, '');
          if (!target) throw new Error('no slot');
          await runSave(['load', target]);
        } else {
          const name = String(j.name || '').trim().slice(0, 40);
          if (!name) throw new Error('a name is needed');
          let slug = name.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 16) || 'game';
          let n = 1, base = slug;
          while (fs.existsSync(path.join(dir, 'saves', slug))) slug = base + (++n);
          // the creation wizard's answers travel to save.js as a profile file
          let profPath = null;
          if (j.profile && typeof j.profile === 'object') {
            profPath = path.join(dir, 'saves', '_newgame-' + slug + '.json');
            fs.writeFileSync(profPath, JSON.stringify(j.profile));
          }
          await runSave(profPath ? ['new', slug, name, profPath] : ['new', slug, name]);
          if (profPath) { try { fs.unlinkSync(profPath); } catch (e) {} }
          try { fs.writeFileSync(path.join(dir, 'inbox-' + slug + '.log'), '', { flag: 'a' }); } catch (e) {}
          target = slug;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, profile: target }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: String(e.message || e) }));
      }
    });
    return;
  }
  if (req.method === 'POST' && req.url === '/say') {
    let body = '';
    req.on('data', c => { body += c; if (body.length > 20000) req.destroy(); });
    req.on('end', () => {
      try {
        const m = JSON.parse(body);
        if (typeof m.text !== 'string' || !m.text.trim()) throw new Error('empty');
        const line = JSON.stringify({ seq: m.seq || Date.now(), text: m.text.slice(0, 4000) });
        // one wire per campaign: only the live campaign's GM hears the player
        const lp = liveProfile();
        fs.appendFileSync(path.join(dir, lp ? ('inbox-' + lp + '.log') : 'inbox.log'), line + '\n');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{"ok":true}');
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end('{"ok":false}');
      }
    });
    return;
  }

  if (req.method === 'GET' && req.url === '/portraits.json') {
    let files = [];
    try { files = fs.readdirSync(path.join(dir, 'character portraits')).filter(f => /.(png|jpe?g|webp|gif)$/i.test(f)); } catch (e) {}
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(files));
    return;
  }

  if (req.method === 'GET' && req.url === '/music.json') {
    let files = [];
    try { files = fs.readdirSync(path.join(dir, 'music')).filter(f => /\.(mp3|ogg|wav)$/i.test(f)); } catch (e) {}
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(files));
    return;
  }

  if (req.method === 'POST' && req.url === '/archive') {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      try {
        const name = (JSON.parse(body).name || 'campaign').replace(/[^\w\- ]/g, '').trim() || 'campaign';
        const stamp = name + '-' + Date.now();
        const dest = path.join(dir, 'saves', stamp);
        fs.mkdirSync(dest, { recursive: true });
        for (const f of ['chat.json', 'sheet.json', 'inbox.log']) {
          const src = path.join(dir, f);
          if (fs.existsSync(src)) fs.copyFileSync(src, path.join(dest, f));
        }
        fs.writeFileSync(path.join(dir, 'chat.json'), '{"seq":0,"log":[]}');
        fs.writeFileSync(path.join(dir, 'sheet.json'), '{}');
        fs.writeFileSync(path.join(dir, 'inbox.log'), '');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, saved: stamp }));
      } catch (e) { res.writeHead(500); res.end('{"ok":false}'); }
    });
    return;
  }

  if (req.method === 'GET' && req.url === '/chronicle') {
    try {
      const doc = JSON.parse(fs.readFileSync(path.join(dir, 'chat.json'), 'utf8'));
      const sheet = (() => { try { return JSON.parse(fs.readFileSync(path.join(dir, 'sheet.json'), 'utf8')); } catch (e) { return {}; } })();
      const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\[[a-z]+\]\s*/gi, '');
      let body2 = '';
      for (const m of doc.log || []) {
        if (m.meta || /^\(pacing:/.test(m.text || "")) continue;
        const t = esc(m.text);
        if (m.who === 'you') {
          if (/^🎲/.test(m.text)) body2 += '<p class="roll">' + t + '</p>\n';
          else body2 += '<p class="said">— ' + t + '</p>\n';
        } else {
          if (/CHAPTER (ONE|TWO|THREE|FOUR|FIVE|SIX|SEVEN|EIGHT|NINE)/i.test(m.text)) body2 += '<hr class="chap">\n';
          body2 += '<p class="tale">' + t + '</p>\n';
        }
      }
      const name = esc(sheet.name || 'an unnamed first-year');
      const html = '<!doctype html><html><head><meta charset="utf-8"><title>The Chronicle</title>' +
        '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IM+Fell+English:ital@0;1&family=EB+Garamond:ital@0;1&display=swap">' +
        '<style>body{background:#EDE2C6;color:#2A1F14;font-family:"EB Garamond",Georgia,serif;font-size:19px;line-height:1.7;max-width:70ch;margin:0 auto;padding:3rem 1.5rem 5rem}' +
        'h1{font-family:"IM Fell English",serif;font-weight:400;text-align:center;font-size:2.8rem;margin:.2em 0 0}' +
        '.sub{text-align:center;font-style:italic;color:#6E5C42;margin-bottom:3rem}' +
        '.tale{margin:.8em 0;text-align:justify}' +
        '.said{margin:.8em 0 .8em 2em;font-style:italic;color:#4A3F7A}' +
        '.roll{margin:.4em 0 .4em 2em;font-size:.85em;color:#8C2F2A;font-family:"IM Fell English",serif}' +
        'hr.chap{border:0;text-align:center;margin:3rem 0}hr.chap:after{content:"❦ ❦ ❦";color:#8A6B25;letter-spacing:.8em}' +
        '@media print{body{background:#fff}}</style></head><body>' +
        '<h1>The Hollow Ledger</h1><p class="sub">being the true chronicle of the first year of ' + name + '<br>Hogwarts School of Witchcraft and Wizardry, 1932–33<br><br>Press Ctrl+P to keep it forever.</p>' +
        body2 + '</body></html>';
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(html);
    } catch (e) { res.writeHead(500); res.end('chronicle error: ' + e.message); }
    return;
  }

  if (req.method === 'POST' && req.url === '/sheet') {
    let body = '';
    req.on('data', c => { body += c; if (body.length > 100000) req.destroy(); });
    req.on('end', () => {
      try {
        JSON.parse(body);
        fs.writeFileSync(path.join(dir, 'sheet.json'), body);
        res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"ok":true}');
      } catch (e) { res.writeHead(400); res.end('{"ok":false}'); }
    });
    return;
  }

  if (req.method === 'POST' && req.url === '/segments') {
    let body = '';
    req.on('data', c => { body += c; if (body.length > 200000) req.destroy(); });
    req.on('end', () => {
      try {
        const { text } = JSON.parse(body);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(splitCues(String(text)).map(g => ({ text: speakable(g.text), mood: g.mood, speaker: g.speaker }))));
      } catch (e) { res.writeHead(400); res.end('[]'); }
    });
    return;
  }

  if (req.method === 'POST' && req.url === '/tts') {
    let body = '';
    req.on('data', c => { body += c; if (body.length > 40000) req.destroy(); });
    req.on('end', async () => {
      try {
        if (!MsEdgeTTS) throw new Error('tts unavailable');
        const { text, first, skip, count, rate: userRate } = JSON.parse(body);
        const segs = splitCues(String(text).slice(0, 12000));
        if (count) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ segments: segs.length, chars: segs.map(x => x.text.length) }));
          return;
        }
        // "first" plays the opening at once; "skip" fetches the remainder in parallel
        let list = segs;
        if (skip) list = list.slice(Number(skip) || 0);
        if (first) list = list.slice(0, Number(first) || 1);
        if (!list.length) { res.writeHead(204); res.end(); return; }
        const extra = Math.max(-40, Math.min(60, Number(userRate) || 0));
        // prefer the local Chatterbox engine when it is up; fall back to edge voices
        let useCB = false;
        try {
          if (bakingNow()) throw new Error('baking');
          const first0 = list[0]; const probe = await chatterboxCached(first0); useCB = true;
          res.writeHead(200, { 'Content-Type': 'audio/wav', 'Cache-Control': 'no-store' });
          res.write(probe);
          list = list.slice(1);
        } catch (e) {
          ttsLog('FALLBACK online voices - studio unavailable: ' + (e && e.message));
          res.writeHead(200, { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'no-store' });
        }
        for (const seg of list) {
          if (useCB) {
            try { res.write(await chatterboxCached(seg)); continue; } catch (e) { /* segment fallback below */ }
          }
          const sp = SPEAKERS[seg.speaker] || SPEAKERS.narrator;
          const md = MOODS[seg.mood] || MOODS.plain;
          const r = (sp.rate + md.rate + extra), p = (sp.pitch + md.pitch);
          const tts = new MsEdgeTTS();
          await tts.setMetadata(sp.voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
          let st = await tts.toStream(speakable(seg.text), { rate: (r >= 0 ? '+' : '') + r + '%', pitch: (p >= 0 ? '+' : '') + p + 'Hz' });
          if (st && st.audioStream) st = st.audioStream;
          res.write(await streamToBuffer(st));
          try { tts.close && tts.close(); } catch (e) {}
        }
        res.end();
      } catch (e) {
        console.log('tts error:', e.message);
        if (!res.headersSent) { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end('{"ok":false}'); }
        else res.end();
      }
    });
    return;
  }

  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/hollow-ledger.html';
  const file = path.join(dir, path.normalize(p).replace(/^([\\/.])+/, ''));
  if (!file.startsWith(dir)) { res.writeHead(403); res.end(); return; }

  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, { 'Content-Type': TYPES[ext] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    if (ext === '.html') {
      res.end('<!doctype html>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n' + data);
    } else {
      res.end(data);
    }
  });
}).on('error', e => {
  if (e.code === 'EADDRINUSE') { console.log('The Hollow Ledger is already running - find its window, or just open http://localhost:' + PORT + ' in your browser.'); process.exit(0); }
  throw e;
}).listen(PORT, () => {
  console.log('The Hollow Ledger is open at http://localhost:' + PORT); startVoice(); startGm();
  // keep the Game Master alive: if nothing answers on GM_PORT and a key exists, start it again
  setInterval(async () => { if (gmProc) return; const env2 = readEnv(); if (!env2.ANTHROPIC_API_KEY || (env2.GM_ENGINE || '').toLowerCase() === 'off') return; if (!(await gmAlive())) startGm('engine was not answering'); }, 30000);
});
