// API-Tests ohne Abhängigkeiten (node:test).
//
// Standard: startet server.js mit einer temporären Datenbank.
// Mit BASE_URL (z. B. http://localhost:3000) laufen die Tests gegen einen
// bereits laufenden Server, etwa den Docker-Container in der CI.
// ADMIN_PASSWORD muss dann zum laufenden Server passen.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';

const PASSWORD = process.env.ADMIN_PASSWORD || 'test-password-123';
let BASE = process.env.BASE_URL;
let proc;
let dataDir;

const freePort = () => new Promise((resolve) => {
  const s = createServer().listen(0, () => { const { port } = s.address(); s.close(() => resolve(port)); });
});

async function waitUp() {
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(BASE)).ok) return; } catch { /* noch nicht da */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Server unter ${BASE} nicht erreichbar`);
}

before(async () => {
  if (!BASE) {
    dataDir = mkdtempSync(path.join(tmpdir(), 'foodfinder-'));
    const port = await freePort();
    BASE = `http://localhost:${port}`;
    proc = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server.js'], {
      env: { ...process.env, PORT: String(port), DATA_DIR: dataDir, ADMIN_PASSWORD: PASSWORD },
      stdio: ['ignore', 'ignore', 'inherit'],
    });
  }
  await waitUp();
});

after(() => {
  proc?.kill();
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
});

// Minimaler Client mit Cookie-Speicher
function client() {
  const jar = new Map();
  return async function request(method, p, body, { origin = BASE } = {}) {
    const headers = {};
    if (jar.size) headers.Cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
    if (origin) headers.Origin = origin;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await fetch(BASE + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(';');
      const i = pair.indexOf('=');
      const v = pair.slice(i + 1);
      if (v) jar.set(pair.slice(0, i), v); else jar.delete(pair.slice(0, i));
    }
    const text = await res.text();
    let data = null;
    try { data = JSON.parse(text); } catch { /* kein JSON */ }
    return { status: res.status, data, headers: res.headers };
  };
}

async function adminClient() {
  const admin = client();
  const r = await admin('POST', '/api/admin/login', { password: PASSWORD });
  assert.equal(r.status, 200);
  return admin;
}

const FULL = [{ k: 'pizza' }, { k: 'doener' }, { k: 'pasta' }, { k: 'burger' }, { k: 'chinese' }];

test('Seiten und statische Dateien mit Sicherheits-Headern', async () => {
  for (const p of ['/', '/admin', '/r/AAAAAAAAAAAAAAAAAAAAAA', '/style.css', '/common.js', '/round.js', '/admin.js']) {
    const res = await fetch(BASE + p);
    assert.equal(res.status, 200, p);
    assert.match(res.headers.get('content-security-policy'), /script-src 'self'/);
    assert.equal(res.headers.get('x-frame-options'), 'DENY');
    assert.equal(res.headers.get('referrer-policy'), 'no-referrer');
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  }
  for (const p of ['/server.js', '/db.js', '/package.json', '/r/zu-kurz', '/%2e%2e/server.js']) {
    assert.equal((await fetch(BASE + p)).status, 404, p);
  }
});

test('Admin-Login: falsches Passwort, fremder Origin, Logout', async () => {
  const c = client();
  assert.equal((await c('GET', '/api/admin/rounds')).status, 401);
  assert.equal((await c('POST', '/api/admin/login', { password: 'falsch' })).data.error, 'bad_password');
  assert.equal((await c('POST', '/api/admin/login', { password: PASSWORD }, { origin: null })).status, 403);
  assert.equal((await c('POST', '/api/admin/login', { password: PASSWORD }, { origin: 'https://evil.example' })).status, 403);

  const login = await c('POST', '/api/admin/login', { password: PASSWORD });
  assert.equal(login.status, 200);
  assert.match(login.headers.get('set-cookie'), /HttpOnly; SameSite=Strict/);
  assert.equal((await c('GET', '/api/admin/rounds')).status, 200);

  await c('POST', '/api/admin/logout');
  assert.equal((await c('GET', '/api/admin/rounds')).status, 401);
});

test('Kompletter Ablauf: Runde, Beitreten, Abstimmen, Auswertung', async () => {
  const admin = await adminClient();
  const created = await admin('POST', '/api/admin/rounds', { title: 'Freitag' });
  assert.equal(created.status, 201);
  const { token, pin } = created.data;
  assert.match(token, /^[A-Za-z0-9_-]{22}$/);
  assert.match(pin, /^\d{6}$/);
  const r = `/api/r/${token}`;

  const anna = client();
  const ben = client();
  assert.equal((await anna('GET', `${r}/state`)).status, 401);
  assert.equal((await anna('POST', `${r}/join`, { pin: pin === '000000' ? '111111' : '000000', name: 'Anna' })).data.error, 'bad_pin');
  assert.equal((await anna('POST', `${r}/join`, { pin, name: 'Anna' })).status, 200);
  assert.equal((await ben('POST', `${r}/join`, { pin, name: 'anna' })).data.error, 'name_taken');
  assert.equal((await ben('POST', `${r}/join`, { pin, name: 'Ben' })).status, 200);

  const state = await anna('GET', `${r}/state`);
  assert.deepEqual(state.data, { title: 'Freitag', me: { name: 'Anna', ranking: null, note: '' } });
  assert.equal((await anna('GET', `${r}/results`)).data.error, 'vote_first');

  // ungültige Ranglisten
  for (const ranking of [
    [{ k: 'pizza' }],                                  // Essen fehlen
    [...FULL, { k: 'pizza' }],                         // doppelt
    [...FULL, { k: 'sushi' }],                         // unbekannter Schlüssel
    [...FULL, { c: '' }],                              // leer
    [...FULL, { c: 'Sushi' }, { c: 'sushi' }],         // doppelt (Groß/klein)
    [...FULL, ...['a', 'b', 'c', 'd', 'e', 'f'].map((c) => ({ c }))], // zu viele eigene
    'kaputt',
  ]) {
    assert.equal((await anna('PUT', `${r}/vote`, { ranking })).status, 400, JSON.stringify(ranking));
  }
  assert.equal((await anna('PUT', `${r}/vote`, { ranking: FULL, note: 'x'.repeat(501) })).data.error, 'too_long');

  const annaRanking = [{ k: 'pasta' }, { c: 'Sushi' }, { k: 'pizza' }, { k: 'doener' }, { k: 'chinese' }, { k: 'burger' }];
  assert.equal((await anna('PUT', `${r}/vote`, { ranking: annaRanking, note: '  Keine\u0007 Pilze  ' })).status, 200);
  assert.equal((await ben('PUT', `${r}/vote`, { ranking: FULL })).status, 200);

  const res = await anna('GET', `${r}/results`);
  assert.equal(res.status, 200);
  assert.equal(res.data.participants.length, 2);
  const [a, b] = res.data.participants;
  assert.deepEqual(a, { name: 'Anna', me: true, ranking: annaRanking, note: 'Keine  Pilze' });
  assert.deepEqual(b, { name: 'Ben', me: false, ranking: FULL, note: '' });

  const list = await admin('GET', '/api/admin/rounds');
  const row = list.data.rounds.find((x) => x.token === token);
  assert.equal(row.total, 2);
  assert.equal(row.voted, 2);

  // Cookie einer Runde gilt nicht für eine andere
  const other = await admin('POST', '/api/admin/rounds', {});
  assert.equal((await anna('GET', `/api/r/${other.data.token}/state`)).status, 401);

  // Löschen entfernt alles
  assert.equal((await admin('DELETE', `/api/admin/rounds/${created.data.id}`)).status, 200);
  assert.equal((await anna('GET', `${r}/state`)).status, 404);
});

test('PIN-Sperre hält auch bei parallelen Versuchen', async () => {
  const admin = await adminClient();
  const { id, token, pin } = (await admin('POST', '/api/admin/rounds', { title: 'Sperre' })).data;
  const r = `/api/r/${token}`;
  const wrong = (i) => String((Number(pin) + i) % 1_000_000).padStart(6, '0');

  const attempts = await Promise.all(
    Array.from({ length: 8 }, (_, i) => client()('POST', `${r}/join`, { pin: wrong(i + 1), name: `Bot${i}` })),
  );
  const errors = attempts.map((x) => x.data.error);
  assert.ok(errors.filter((e) => e === 'bad_pin').length <= 5, errors.join());
  assert.ok(errors.includes('locked'), errors.join());

  // Selbst die richtige PIN wird während der Sperre abgelehnt
  assert.equal((await client()('POST', `${r}/join`, { pin, name: 'Echt' })).data.error, 'locked');

  // Eine neue PIN hebt die Sperre auf
  const reset = await admin('POST', `/api/admin/rounds/${id}/pin`);
  assert.match(reset.data.pin, /^\d{6}$/);
  assert.equal((await client()('POST', `${r}/join`, { pin: reset.data.pin, name: 'Echt' })).status, 200);
});

test('Unbekannte Links und kaputte Anfragen', async () => {
  const c = client();
  assert.equal((await c('GET', '/api/r/AAAAAAAAAAAAAAAAAAAAAA/state')).status, 404);
  assert.equal((await c('GET', '/api/r/kurz/state')).status, 404);
  const raw = await fetch(`${BASE}/api/admin/login`, {
    method: 'POST', headers: { Origin: BASE, 'Content-Type': 'application/json' }, body: '{kaputt',
  });
  assert.equal(raw.status, 400);
  const big = await fetch(`${BASE}/api/admin/login`, {
    method: 'POST', headers: { Origin: BASE, 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'x'.repeat(20_000) }),
  });
  assert.equal(big.status, 413);
});
