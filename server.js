import http from 'node:http';
import crypto from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
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
const MAX_PARTICIPANTS = 20;
const MAX_ROUNDS = 200;
const MAX_CUSTOM = 5;
const DEFAULT_FOODS = ['pizza', 'doener', 'pasta', 'burger', 'chinese'];
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
  const rounds = db.prepare(`
    SELECT r.id, r.token, r.title, r.created_at,
           COUNT(p.id) AS total, COUNT(p.ranking) AS voted
    FROM rounds r LEFT JOIN participants p ON p.round_id = r.id
    GROUP BY r.id ORDER BY r.created_at DESC`).all()
    .map((r) => ({ ...r, expires_at: r.created_at + ROUND_TTL }));
  json(res, 200, { rounds });
}

async function createRound(req, res) {
  const body = await readJson(req);
  const title = cleanLine(body.title, 60);
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM rounds').get();
  if (n >= MAX_ROUNDS) throw new HttpError(409, 'too_many_rounds');
  const token = crypto.randomBytes(16).toString('base64url');
  const pin = newPin();
  const { lastInsertRowid } = db.prepare('INSERT INTO rounds (token, title, pin_hash, created_at) VALUES (?, ?, ?, ?)')
    .run(token, title, await hashPin(pin), Date.now());
  json(res, 201, { id: Number(lastInsertRowid), token, pin, title });
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
function parsedRanking(p) { return p.ranking ? JSON.parse(p.ranking) : null; }

function roundState(req, res, round) {
  const me = currentParticipant(req, round);
  if (!me) throw new HttpError(401, 'need_pin');
  json(res, 200, { title: round.title, me: { name: me.name, ranking: parsedRanking(me), note: me.note } });
}

async function join(req, res, round, ip) {
  if (hit(`join:${ip}`, 20, 15 * MIN)) throw new HttpError(429, 'rate_limited');
  const body = await readJson(req);
  const name = cleanLine(body.name, 30);
  if (!name) throw new HttpError(400, 'name_required');

  // Prüfen + Zählen passiert synchron vor dem (asynchronen) Hash-Vergleich,
  // damit parallele Anfragen die Sperre nicht umgehen können.
  const now = Date.now();
  const r = db.prepare('SELECT fail_count, locked_until, pin_hash FROM rounds WHERE id = ?').get(round.id);
  if (r.locked_until > now) throw new HttpError(429, 'locked');
  if (r.fail_count >= PIN_MAX_FAILS) {
    db.prepare('UPDATE rounds SET fail_count = 0, locked_until = ? WHERE id = ?').run(now + PIN_LOCK, round.id);
    throw new HttpError(429, 'locked');
  }
  db.prepare('UPDATE rounds SET fail_count = fail_count + 1 WHERE id = ?').run(round.id);

  const pin = typeof body.pin === 'string' ? body.pin.trim() : '';
  const ok = /^\d{6}$/.test(pin) && await verifyPin(pin, r.pin_hash);
  if (!ok) {
    const { fail_count } = db.prepare('SELECT fail_count FROM rounds WHERE id = ?').get(round.id) || {};
    if (fail_count >= PIN_MAX_FAILS) {
      db.prepare('UPDATE rounds SET fail_count = 0, locked_until = ? WHERE id = ?').run(Date.now() + PIN_LOCK, round.id);
      throw new HttpError(429, 'locked');
    }
    throw new HttpError(403, 'bad_pin');
  }
  db.prepare('UPDATE rounds SET fail_count = 0 WHERE id = ?').run(round.id);

  const { n } = db.prepare('SELECT COUNT(*) AS n FROM participants WHERE round_id = ?').get(round.id);
  if (n >= MAX_PARTICIPANTS) throw new HttpError(403, 'full');

  let participantId;
  try {
    participantId = Number(db.prepare('INSERT INTO participants (round_id, name) VALUES (?, ?)').run(round.id, name).lastInsertRowid);
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) throw new HttpError(409, 'name_taken');
    throw e;
  }
  const ttl = round.created_at + ROUND_TTL - Date.now();
  const token = createSession('p', round.id, participantId, ttl);
  json(res, 200, { ok: true }, { 'Set-Cookie': cookie(req, participantCookie(round), token, ttl) });
}

async function vote(req, res, round) {
  const me = currentParticipant(req, round);
  if (!me) throw new HttpError(401, 'need_pin');
  const body = await readJson(req);
  const list = body.ranking;
  if (!Array.isArray(list) || list.length > DEFAULT_FOODS.length + MAX_CUSTOM) throw new HttpError(400, 'invalid');

  const seen = new Set();
  const ranking = [];
  let custom = 0;
  for (const item of list) {
    if (item && typeof item.k === 'string' && DEFAULT_FOODS.includes(item.k)) {
      if (seen.has(`k:${item.k}`)) throw new HttpError(400, 'invalid');
      seen.add(`k:${item.k}`);
      ranking.push({ k: item.k });
    } else if (item && typeof item.c === 'string') {
      const c = cleanLine(item.c, 40);
      if (!c || seen.has(`c:${c.toLowerCase()}`)) throw new HttpError(400, 'invalid');
      seen.add(`c:${c.toLowerCase()}`);
      ranking.push({ c });
      custom++;
    } else {
      throw new HttpError(400, 'invalid');
    }
  }
  if (custom > MAX_CUSTOM || DEFAULT_FOODS.some((k) => !seen.has(`k:${k}`))) throw new HttpError(400, 'invalid');

  const note = cleanText(body.note, 500);
  db.prepare('UPDATE participants SET ranking = ?, note = ?, updated_at = ? WHERE id = ?')
    .run(JSON.stringify(ranking), note, Date.now(), me.id);
  json(res, 200, { ok: true });
}

function results(req, res, round) {
  const me = currentParticipant(req, round);
  if (!me) throw new HttpError(401, 'need_pin');
  if (!me.ranking) throw new HttpError(403, 'vote_first');
  const participants = db.prepare('SELECT id, name, ranking, note FROM participants WHERE round_id = ? ORDER BY id')
    .all(round.id)
    .map((p) => ({ name: p.name, me: p.id === me.id, ranking: parsedRanking(p), note: p.note }));
  json(res, 200, { title: round.title, participants });
}

// ---------- API-Routing ----------
async function api(req, res, p) {
  const ip = clientIp(req);
  const m = req.method;
  if (hit(`api:${ip}`, 300, 5 * MIN)) throw new HttpError(429, 'rate_limited');
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

  const g = p.match(/^\/api\/r\/([A-Za-z0-9_-]{22})\/(state|join|vote|results)$/);
  if (g) {
    const round = db.prepare('SELECT * FROM rounds WHERE token = ?').get(g[1]);
    if (!round || round.created_at + ROUND_TTL < Date.now()) {
      if (hit(`miss:${ip}`, 20, 15 * MIN)) throw new HttpError(429, 'rate_limited');
      throw new HttpError(404, 'not_found');
    }
    const action = g[2];
    if (action === 'state' && m === 'GET') return roundState(req, res, round);
    if (action === 'join' && m === 'POST') return join(req, res, round, ip);
    if (action === 'vote' && m === 'PUT') return vote(req, res, round);
    if (action === 'results' && m === 'GET') return results(req, res, round);
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
};
const FILES = new Map(readdirSync(PUBLIC_DIR).map((f) => [
  f, { body: readFileSync(path.join(PUBLIC_DIR, f)), type: TYPES[path.extname(f)] || 'application/octet-stream' },
]));

function serveStatic(req, res, p) {
  let name = null;
  if (p === '/') name = 'index.html';
  else if (p === '/admin') name = 'admin.html';
  else if (p.startsWith('/r/') && TOKEN_RE.test(p.slice(3))) name = 'round.html';
  else if (/^\/[a-z0-9-]+\.(css|js|svg|txt)$/.test(p)) name = p.slice(1);
  const file = name && FILES.get(name);
  if (!file) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Not found');
  }
  res.writeHead(200, { 'Content-Type': file.type, 'Cache-Control': 'no-cache' });
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
