import http from 'node:http';
import crypto from 'node:crypto';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { db } from './db.js';

// ---------- Konfiguration ----------
const PORT = Number(process.env.PORT) || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const TRUST_PROXY =
  process.env.TRUST_PROXY === '1' ||
  Boolean(process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_ENVIRONMENT_NAME || process.env.RAILWAY_PROJECT_ID);

if (ADMIN_PASSWORD.length < 12) {
  console.error('ADMIN_PASSWORD muss gesetzt sein (mindestens 12 Zeichen).');
  process.exit(1);
}

const MIN = 60_000;
const DAY = 24 * 60 * MIN;
const ROUND_TTL = 30 * DAY;            // Runden werden nach 30 Tagen gelöscht
const ADMIN_SESSION_TTL = 12 * 60 * MIN;
const PIN_MAX_FAILS = 5;               // Fehlversuche pro Runde …
const PIN_LOCK = 15 * MIN;             // … danach Sperre
const MIN_SIZE = 2;
const MAX_SIZE = 10;
const MAX_ROUNDS = 200;
const MAX_IDEAS_PER_PERSON = 3;
const MAX_IDEAS = 10;
// Muss zu FOODS in public/common.js passen (wird getestet).
const FOOD_KEYS = [
  'pizza', 'pasta', 'burger', 'doener', 'chinese', 'indian', 'thai', 'vietnamese',
  'sushi', 'korean', 'mexican', 'greek', 'lebanese', 'bowl', 'dumplings',
];
const TOKEN_RE = /^[A-Za-z0-9_-]{22}$/;

const scrypt = promisify(crypto.scrypt);
const sha256 = (s) => crypto.createHash('sha256').update(s).digest();
const sha256hex = (s) => crypto.createHash('sha256').update(s).digest('hex');

class HttpError extends Error {
  constructor(status, code) { super(code); this.status = status; this.code = code; }
}

// ---------- Sicherheits-Header ----------
const SECURITY_HEADERS = {
  'Content-Security-Policy':
    "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; " +
    "base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'X-Robots-Tag': 'noindex, nofollow',
};

const isHttps = (req) => (TRUST_PROXY && req.headers['x-forwarded-proto'] === 'https') || req.socket.encrypted;

function clientIp(req) {
  if (TRUST_PROXY) {
    const xff = req.headers['x-forwarded-for'];
    if (typeof xff === 'string' && xff) return xff.split(',')[0].trim();
  }
  return req.socket.remoteAddress || '';
}

// ---------- Rate-Limiting (im Speicher) ----------
const buckets = new Map();
function hit(key, max, windowMs) {
  const now = Date.now();
  let b = buckets.get(key);
  if (!b || b.reset <= now) {
    if (buckets.size > 50_000) buckets.clear();
    b = { n: 0, reset: now + windowMs };
    buckets.set(key, b);
  }
  b.n++;
  return b.n > max;
}
function over(key, max) {
  const b = buckets.get(key);
  return Boolean(b && b.reset > Date.now() && b.n >= max);
}
setInterval(() => {
  const now = Date.now();
  for (const [k, b] of buckets) if (b.reset <= now) buckets.delete(k);
}, MIN).unref();

// ---------- Hilfsfunktionen ----------
function json(res, status, obj, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...headers });
  res.end(JSON.stringify(obj));
}

function readCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

function cookie(req, name, value, maxAgeMs) {
  const secure = isHttps(req) ? '; Secure' : '';
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${Math.max(0, Math.floor(maxAgeMs / 1000))}${secure}`;
}

function readJson(req, limit = 16 * 1024) {
  return new Promise((resolve, reject) => {
    if (!(req.headers['content-type'] || '').startsWith('application/json')) {
      return reject(new HttpError(415, 'invalid'));
    }
    if (Number(req.headers['content-length'] || 0) > limit) {
      return reject(new HttpError(413, 'too_long'));
    }
    const chunks = [];
    let size = 0;
    let tooBig = false;
    req.on('data', (c) => {
      if (tooBig) return;
      size += c.length;
      if (size > limit) { tooBig = true; chunks.length = 0; reject(new HttpError(413, 'too_long')); }
      else chunks.push(c);
    });
    req.on('end', () => {
      if (tooBig) return;
      try {
        const v = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
        if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error();
        resolve(v);
      } catch { reject(new HttpError(400, 'invalid')); }
    });
    req.on('error', reject);
  });
}

// Entfernt Steuerzeichen und Bidi-Overrides, kürzt Leerraum.
function cleanLine(v, max) {
  if (v == null) return '';
  if (typeof v !== 'string') throw new HttpError(400, 'invalid');
  const s = v.normalize('NFC').replace(/[\u0000-\u001f\u007f‪-‮⁦-⁩]/g, ' ').replace(/\s+/g, ' ').trim();
  if (s.length > max) throw new HttpError(400, 'too_long');
  return s;
}
function cleanText(v, max) {
  if (v == null) return '';
  if (typeof v !== 'string') throw new HttpError(400, 'invalid');
  const s = v.normalize('NFC').replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f‪-‮⁦-⁩]/g, ' ')
    .replace(/\n{3,}/g, '\n\n').trim();
  if (s.length > max) throw new HttpError(400, 'too_long');
  return s;
}

function checkOrigin(req) {
  const origin = req.headers.origin;
  let host;
  try { host = new URL(origin).host; } catch { throw new HttpError(403, 'invalid'); }
  const ok = host === req.headers.host || (TRUST_PROXY && host === req.headers['x-forwarded-host']);
  if (!ok) throw new HttpError(403, 'invalid');
}

async function hashPin(pin) {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(pin, salt, 32);
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}
async function verifyPin(pin, stored) {
  const [salt, hash] = stored.split(':');
  const calc = await scrypt(pin, Buffer.from(salt, 'hex'), 32);
  return crypto.timingSafeEqual(calc, Buffer.from(hash, 'hex'));
}
const newPin = () => String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');

// ---------- Sessions ----------
function createSession(kind, roundId, participantId, ttl) {
  const token = crypto.randomBytes(32).toString('base64url');
  db.prepare('INSERT INTO sessions (token_hash, kind, round_id, participant_id, expires_at) VALUES (?, ?, ?, ?, ?)')
    .run(sha256hex(token), kind, roundId, participantId, Date.now() + ttl);
  return token;
}
function getSession(token, kind) {
  if (!token || token.length > 64) return null;
  return db.prepare('SELECT * FROM sessions WHERE token_hash = ? AND kind = ? AND expires_at > ?')
    .get(sha256hex(token), kind, Date.now()) || null;
}

const participantCookie = (round) => `ff_r${round.id}`;

function currentParticipant(req, round) {
  const s = getSession(readCookies(req)[participantCookie(round)], 'p');
  if (!s || s.round_id !== round.id) return null;
  return db.prepare('SELECT * FROM participants WHERE id = ? AND round_id = ?').get(s.participant_id, round.id) || null;
}

function requireAdmin(req) {
  if (!getSession(readCookies(req).ff_admin, 'admin')) throw new HttpError(401, 'need_login');
}

// ---------- Spiel-Logik ----------
// Ablauf: Swipen (alle) → Matches = worauf alle Bock haben → Endrunde (sortieren + 1 Veto) → Ergebnis.
// Gibt es kein Match, beginnt eine neue Swipe-Runde.

const parse = (s, fallback) => {
  if (s == null) return fallback;
  try { return JSON.parse(s); } catch { return fallback; }
};
const getRound = (id) => db.prepare('SELECT * FROM rounds WHERE id = ?').get(id);
const getPeople = (roundId) => db.prepare('SELECT * FROM participants WHERE round_id = ? ORDER BY id').all(roundId);
const getPerson = (id) => db.prepare('SELECT * FROM participants WHERE id = ?').get(id);
const deckOf = (round) => [...FOOD_KEYS, ...parse(round.ideas, []).map((i) => i.id)];

function hasSwipedAll(p, deck) {
  const s = parse(p.swipes, {});
  return deck.every((k) => Object.hasOwn(s, k));
}
function isDone(p, round, deck) {
  if (round.phase === 'swipe') return hasSwipedAll(p, deck);
  if (round.phase === 'rank') return p.ranking != null;
  return true;
}

function tx(fn) {
  db.exec('BEGIN');
  try { fn(); db.exec('COMMIT'); } catch (e) { db.exec('ROLLBACK'); throw e; }
}

// Schaltet in die nächste Phase, sobald alle (erwarteten) Personen fertig sind.
function advance(roundId) {
  const round = getRound(roundId);
  if (!round || round.phase === 'done') return;
  const active = getPeople(roundId).filter((p) => p.active);
  if (active.length < round.size) return;
  const deck = deckOf(round);
  if (!active.every((p) => isDone(p, round, deck))) return;

  if (round.phase === 'rank') {
    db.prepare("UPDATE rounds SET phase = 'done' WHERE id = ?").run(roundId);
    return;
  }

  const swipes = active.map((p) => parse(p.swipes, {}));
  const matches = deck.filter((k) => swipes.every((s) => s[k] === 1));
  if (matches.length) {
    db.prepare('UPDATE rounds SET phase = ?, shortlist = ? WHERE id = ?')
      .run(matches.length === 1 ? 'done' : 'rank', JSON.stringify(matches), roundId);
    return;
  }

  // Kein Match: neue Swipe-Runde. Wer eine eigene Idee hat, hat darauf weiterhin Bock.
  const tally = Object.fromEntries(deck.map((k) => [k, swipes.filter((s) => s[k] === 1).length]));
  const ideas = parse(round.ideas, []);
  tx(() => {
    db.prepare('UPDATE rounds SET swipe_round = swipe_round + 1, prev_tally = ? WHERE id = ?')
      .run(JSON.stringify({ tally, voters: active.length }), roundId);
    for (const p of getPeople(roundId)) {
      const own = ideas.filter((i) => i.by === p.id).map((i) => [i.id, 1]);
      db.prepare('UPDATE participants SET swipes = ? WHERE id = ?')
        .run(own.length ? JSON.stringify(Object.fromEntries(own)) : null, p.id);
    }
  });
}

// Endergebnis: Vetos schließen aus, dann zählt die Platzierung (Borda).
// Bei Gleichstand entscheidet ein „Würfel“, der für alle gleich ausfällt.
function computeResult(round) {
  const shortlist = parse(round.shortlist, []);
  const rankers = getPeople(round.id).filter((p) => p.active && p.ranking);
  const n = shortlist.length;
  const rows = shortlist.map((key) => {
    const row = { key, score: 0, max: (n - 1) * rankers.length, positions: [], vetoes: [] };
    for (const p of rankers) {
      const i = parse(p.ranking, []).indexOf(key);
      if (i >= 0) {
        row.score += n - 1 - i;
        row.positions.push({ name: p.name, pos: i + 1 });
      }
      if (p.veto === key) row.vetoes.push(p.name);
    }
    return row;
  });
  const dice = (key) => sha256hex(`${round.token}:${key}`);
  rows.sort((a, b) => a.vetoes.length - b.vetoes.length || b.score - a.score || dice(a.key).localeCompare(dice(b.key)));
  const tie = rows.length > 1 && rows[0].vetoes.length === rows[1].vetoes.length && rows[0].score === rows[1].score;
  return { order: rows, tie, perfect: n === 1 };
}

function roundState(round, me) {
  const people = getPeople(round.id);
  const deck = deckOf(round);
  const nameOf = (id) => people.find((p) => p.id === id)?.name ?? '';
  const state = {
    title: round.title,
    size: round.size,
    phase: round.phase,
    swipeRound: round.swipe_round,
    deck,
    ideas: parse(round.ideas, []).map((i) => ({ id: i.id, label: i.label, by: nameOf(i.by) })),
    prev: parse(round.prev_tally, null),
    people: people.map((p) => ({
      name: p.name,
      me: p.id === me.id,
      active: Boolean(p.active),
      done: Boolean(p.active) && isDone(p, round, deck),
    })),
    me: {
      name: me.name,
      active: Boolean(me.active),
      swipes: parse(me.swipes, null),
      ranking: parse(me.ranking, null),
      veto: me.veto,
      note: me.note,
    },
    shortlist: round.phase === 'swipe' ? null : parse(round.shortlist, []),
  };
  if (round.phase === 'done') {
    state.result = computeResult(round);
    state.notes = people.filter((p) => p.active && p.note).map((p) => ({ name: p.name, note: p.note }));
  }
  return state;
}

// Lädt Runde und Person frisch (nach dem Einlesen des Bodys kann sich etwas geändert haben).
function load(req, roundId) {
  const round = getRound(roundId);
  if (!round) throw new HttpError(404, 'not_found');
  const me = currentParticipant(req, round);
  if (!me) throw new HttpError(401, 'need_pin');
  return { round, me };
}
function requireActive(me) {
  if (!me.active) throw new HttpError(403, 'excluded');
}
function sendState(res, roundId, meId) {
  json(res, 200, roundState(getRound(roundId), getPerson(meId)));
}

// ---------- Admin ----------
async function adminLogin(req, res, ip) {
  if (hit(`alogin:${ip}`, 10, 15 * MIN) || over('alogin-fail', 30)) throw new HttpError(429, 'rate_limited');
  const body = await readJson(req);
  const pw = typeof body.password === 'string' ? body.password : '';
  if (!crypto.timingSafeEqual(sha256(pw), sha256(ADMIN_PASSWORD))) {
    hit('alogin-fail', 30, 15 * MIN);
    throw new HttpError(403, 'bad_password');
  }
  const token = createSession('admin', null, null, ADMIN_SESSION_TTL);
  json(res, 200, { ok: true }, { 'Set-Cookie': cookie(req, 'ff_admin', token, ADMIN_SESSION_TTL) });
}

function adminLogout(req, res) {
  const token = readCookies(req).ff_admin;
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256hex(token));
  json(res, 200, { ok: true }, { 'Set-Cookie': cookie(req, 'ff_admin', '', 0) });
}

function listRounds(res) {
  const rounds = db.prepare('SELECT * FROM rounds ORDER BY created_at DESC').all().map((r) => {
    const deck = deckOf(r);
    const people = getPeople(r.id);
    let winner = null;
    if (r.phase === 'done') {
      const key = computeResult(r).order[0]?.key;
      if (key) winner = { key, label: parse(r.ideas, []).find((i) => i.id === key)?.label ?? null };
    }
    return {
      id: r.id,
      token: r.token,
      title: r.title,
      created_at: r.created_at,
      expires_at: r.created_at + ROUND_TTL,
      size: r.size,
      phase: r.phase,
      joined: people.length,
      done: people.filter((p) => p.active && isDone(p, r, deck)).length,
      winner,
    };
  });
  json(res, 200, { rounds });
}

async function createRound(req, res) {
  const body = await readJson(req);
  const title = cleanLine(body.title, 60);
  const size = body.size ?? 3;
  if (!Number.isInteger(size) || size < MIN_SIZE || size > MAX_SIZE) throw new HttpError(400, 'invalid');
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM rounds').get();
  if (n >= MAX_ROUNDS) throw new HttpError(409, 'too_many_rounds');
  const token = crypto.randomBytes(16).toString('base64url');
  const pin = newPin();
  const { lastInsertRowid } = db.prepare('INSERT INTO rounds (token, title, pin_hash, created_at, size) VALUES (?, ?, ?, ?, ?)')
    .run(token, title, await hashPin(pin), Date.now(), size);
  json(res, 201, { id: Number(lastInsertRowid), token, pin, title, size });
}

async function resetPin(res, id) {
  const pin = newPin();
  const { changes } = db.prepare('UPDATE rounds SET pin_hash = ?, fail_count = 0, locked_until = 0 WHERE id = ?')
    .run(await hashPin(pin), id);
  if (!changes) throw new HttpError(404, 'not_found');
  json(res, 200, { pin });
}

function deleteRound(res, id) {
  db.prepare('DELETE FROM rounds WHERE id = ?').run(id);
  json(res, 200, { ok: true });
}

// ---------- Teilnehmer ----------
function getState(req, res, roundId) {
  const { round, me } = load(req, roundId);
  json(res, 200, roundState(round, me));
}

async function join(req, res, roundId, ip) {
  if (hit(`join:${ip}`, 40, 15 * MIN)) throw new HttpError(429, 'rate_limited');
  const body = await readJson(req);
  const name = cleanLine(body.name, 30);
  if (!name) throw new HttpError(400, 'name_required');

  // Prüfen + Zählen passiert synchron vor dem (asynchronen) Hash-Vergleich,
  // damit parallele Anfragen die Sperre nicht umgehen können.
  const now = Date.now();
  const r = getRound(roundId);
  if (!r) throw new HttpError(404, 'not_found');
  if (r.locked_until > now) throw new HttpError(429, 'locked');
  if (r.fail_count >= PIN_MAX_FAILS) {
    db.prepare('UPDATE rounds SET fail_count = 0, locked_until = ? WHERE id = ?').run(now + PIN_LOCK, roundId);
    throw new HttpError(429, 'locked');
  }
  db.prepare('UPDATE rounds SET fail_count = fail_count + 1 WHERE id = ?').run(roundId);

  const pin = typeof body.pin === 'string' ? body.pin.trim() : '';
  const ok = /^\d{6}$/.test(pin) && await verifyPin(pin, r.pin_hash);
  const round = getRound(roundId);
  if (!round) throw new HttpError(404, 'not_found');
  if (!ok) {
    if (round.fail_count >= PIN_MAX_FAILS) {
      db.prepare('UPDATE rounds SET fail_count = 0, locked_until = ? WHERE id = ?').run(Date.now() + PIN_LOCK, roundId);
      throw new HttpError(429, 'locked');
    }
    throw new HttpError(403, 'bad_pin');
  }
  db.prepare('UPDATE rounds SET fail_count = 0 WHERE id = ?').run(roundId);

  const { n } = db.prepare('SELECT COUNT(*) AS n FROM participants WHERE round_id = ?').get(roundId);
  if (n >= round.size) throw new HttpError(403, 'full');

  let participantId;
  try {
    participantId = Number(db.prepare('INSERT INTO participants (round_id, name) VALUES (?, ?)').run(roundId, name).lastInsertRowid);
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) throw new HttpError(409, 'name_taken');
    throw e;
  }
  const ttl = round.created_at + ROUND_TTL - Date.now();
  const token = createSession('p', roundId, participantId, ttl);
  json(res, 200, { ok: true }, { 'Set-Cookie': cookie(req, participantCookie(round), token, ttl) });
}

async function saveSwipes(req, res, roundId) {
  const body = await readJson(req);
  const { round, me } = load(req, roundId);
  requireActive(me);
  if (round.phase !== 'swipe') throw new HttpError(409, 'wrong_phase');

  const deck = new Set(deckOf(round));
  const input = body.swipes;
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length > deck.size) {
    throw new HttpError(400, 'invalid');
  }
  const swipes = parse(me.swipes, {});
  for (const [k, v] of Object.entries(input)) {
    if (!deck.has(k) || typeof v !== 'boolean') throw new HttpError(400, 'invalid');
    swipes[k] = v ? 1 : 0;
  }
  const note = body.note === undefined ? me.note : cleanText(body.note, 300);
  db.prepare('UPDATE participants SET swipes = ?, note = ?, updated_at = ? WHERE id = ?')
    .run(JSON.stringify(swipes), note, Date.now(), me.id);
  advance(roundId);
  sendState(res, roundId, me.id);
}

async function addIdea(req, res, roundId) {
  const body = await readJson(req);
  const { round, me } = load(req, roundId);
  requireActive(me);
  if (round.phase !== 'swipe') throw new HttpError(409, 'wrong_phase');

  const label = cleanLine(body.label, 40);
  if (!label) throw new HttpError(400, 'invalid');
  const ideas = parse(round.ideas, []);
  if (ideas.length >= MAX_IDEAS || ideas.filter((i) => i.by === me.id).length >= MAX_IDEAS_PER_PERSON) {
    throw new HttpError(409, 'idea_limit');
  }
  if (ideas.some((i) => i.label.toLowerCase() === label.toLowerCase())) throw new HttpError(409, 'duplicate');

  const id = `c${ideas.reduce((max, i) => Math.max(max, Number(i.id.slice(1))), 0) + 1}`;
  ideas.push({ id, label, by: me.id });
  const swipes = parse(me.swipes, {});
  swipes[id] = 1; // wer eine Idee einbringt, hat darauf Bock
  tx(() => {
    db.prepare('UPDATE rounds SET ideas = ? WHERE id = ?').run(JSON.stringify(ideas), roundId);
    db.prepare('UPDATE participants SET swipes = ? WHERE id = ?').run(JSON.stringify(swipes), me.id);
  });
  sendState(res, roundId, me.id);
}

async function saveRanking(req, res, roundId) {
  const body = await readJson(req);
  const { round, me } = load(req, roundId);
  requireActive(me);
  if (round.phase !== 'rank') throw new HttpError(409, 'wrong_phase');

  const shortlist = parse(round.shortlist, []);
  const { ranking } = body;
  const veto = body.veto ?? null;
  const valid = Array.isArray(ranking)
    && ranking.length === shortlist.length
    && new Set(ranking).size === ranking.length
    && ranking.every((k) => shortlist.includes(k))
    && (veto === null || shortlist.includes(veto));
  if (!valid) throw new HttpError(400, 'invalid');

  db.prepare('UPDATE participants SET ranking = ?, veto = ?, updated_at = ? WHERE id = ?')
    .run(JSON.stringify(ranking), veto, Date.now(), me.id);
  advance(roundId);
  sendState(res, roundId, me.id);
}

// „Nicht mehr warten“: Wer noch nicht fertig (oder gar nicht da) ist, wird übersprungen.
function skip(req, res, roundId) {
  const { round, me } = load(req, roundId);
  requireActive(me);
  if (round.phase === 'done') throw new HttpError(409, 'wrong_phase');
  const deck = deckOf(round);
  const active = getPeople(roundId).filter((p) => p.active);
  const done = active.filter((p) => isDone(p, round, deck));
  if (done.length < 2 || !done.some((p) => p.id === me.id)) throw new HttpError(409, 'skip');
  tx(() => {
    for (const p of active) {
      if (!done.includes(p)) db.prepare('UPDATE participants SET active = 0 WHERE id = ?').run(p.id);
    }
    db.prepare('UPDATE rounds SET size = ? WHERE id = ?').run(done.length, roundId);
  });
  advance(roundId);
  sendState(res, roundId, me.id);
}

// ---------- API-Routing ----------
const ROUND_ROUTES = {
  'GET state': getState,
  'POST join': join,
  'PUT swipes': saveSwipes,
  'POST ideas': addIdea,
  'PUT ranking': saveRanking,
  'POST skip': skip,
};

async function api(req, res, p) {
  const ip = clientIp(req);
  const m = req.method;
  if (hit(`api:${ip}`, 1200, 5 * MIN)) throw new HttpError(429, 'rate_limited');
  if (m !== 'GET') checkOrigin(req);

  if (p === '/api/admin/login' && m === 'POST') return adminLogin(req, res, ip);
  if (p === '/api/admin/logout' && m === 'POST') return adminLogout(req, res);
  if (p.startsWith('/api/admin/')) {
    requireAdmin(req);
    if (p === '/api/admin/rounds' && m === 'GET') return listRounds(res);
    if (p === '/api/admin/rounds' && m === 'POST') return createRound(req, res);
    const a = p.match(/^\/api\/admin\/rounds\/(\d{1,9})(\/pin)?$/);
    if (a && !a[2] && m === 'DELETE') return deleteRound(res, Number(a[1]));
    if (a && a[2] && m === 'POST') return resetPin(res, Number(a[1]));
    throw new HttpError(404, 'not_found');
  }

  const g = p.match(/^\/api\/r\/([A-Za-z0-9_-]{22})\/([a-z]+)$/);
  if (g) {
    const round = db.prepare('SELECT id, created_at FROM rounds WHERE token = ?').get(g[1]);
    if (!round || round.created_at + ROUND_TTL < Date.now()) {
      if (hit(`miss:${ip}`, 20, 15 * MIN)) throw new HttpError(429, 'rate_limited');
      throw new HttpError(404, 'not_found');
    }
    const handler = ROUND_ROUTES[`${m} ${g[2]}`];
    if (handler) return handler(req, res, round.id, ip);
  }
  throw new HttpError(404, 'not_found');
}

// ---------- Statische Dateien ----------
const PUBLIC_DIR = path.join(import.meta.dirname, 'public');
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.jpg': 'image/jpeg',
};
const FILES = new Map();
function addFiles(dir, prefix) {
  if (!existsSync(dir)) return;
  for (const f of readdirSync(dir, { withFileTypes: true })) {
    if (!f.isFile() || !TYPES[path.extname(f.name)]) continue;
    FILES.set(prefix + f.name, { body: readFileSync(path.join(dir, f.name)), type: TYPES[path.extname(f.name)] });
  }
}
addFiles(PUBLIC_DIR, '');
addFiles(path.join(PUBLIC_DIR, 'img'), 'img/');

function serveStatic(req, res, p) {
  let name = null;
  if (p === '/') name = 'index.html';
  else if (p === '/admin') name = 'admin.html';
  else if (p.startsWith('/r/') && TOKEN_RE.test(p.slice(3))) name = 'round.html';
  else if (/^\/[a-z0-9-]+\.(css|js|svg|txt)$/.test(p) || /^\/img\/[a-z0-9-]+\.jpg$/.test(p)) name = p.slice(1);
  const file = name && FILES.get(name);
  if (!file) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Not found');
  }
  const cache = name.startsWith('img/') ? 'public, max-age=86400' : 'no-cache';
  res.writeHead(200, { 'Content-Type': file.type, 'Cache-Control': cache });
  res.end(req.method === 'HEAD' ? undefined : file.body);
}

// ---------- Server ----------
const server = http.createServer(async (req, res) => {
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
  if (isHttps(req)) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  try {
    const p = new URL(req.url, 'http://localhost').pathname;
    if (p.startsWith('/api/')) {
      res.setHeader('Cache-Control', 'no-store');
      return await api(req, res, p);
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD' });
      return res.end();
    }
    serveStatic(req, res, p);
  } catch (e) {
    if (res.headersSent) return res.destroy();
    if (e instanceof HttpError) return json(res, e.status, { error: e.code });
    console.error(e);
    json(res, 500, { error: 'server' });
  }
});

server.headersTimeout = 10_000;
server.requestTimeout = 15_000;
server.keepAliveTimeout = 5_000;

function cleanup() {
  const now = Date.now();
  db.prepare('DELETE FROM rounds WHERE created_at < ?').run(now - ROUND_TTL);
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now);
}
cleanup();
setInterval(cleanup, 60 * MIN).unref();

server.listen(PORT, () => console.log(`Foodfinder läuft auf http://localhost:${server.address().port}`));

for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => {
    server.close(() => { db.close(); process.exit(0); });
    server.closeIdleConnections();
  });
}
