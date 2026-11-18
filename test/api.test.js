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
const FOOD_KEYS = [
  'pizza', 'pasta', 'burger', 'doener', 'chinese', 'indian', 'thai', 'vietnamese',
  'sushi', 'korean', 'mexican', 'greek', 'lebanese', 'bowl', 'dumplings',
];
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

// ---------- Hilfsfunktionen ----------

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

// Ein Admin-Login für alle Tests (der Login ist pro IP begrenzt)
let adminC;
async function adminClient() {
  if (!adminC) {
    adminC = client();
    assert.equal((await adminC('POST', '/api/admin/login', { password: PASSWORD })).status, 200);
  }
  return adminC;
}

async function newRound(body = {}) {
  const admin = await adminClient();
  const r = await admin('POST', '/api/admin/rounds', { title: 'Test', size: 3, ...body });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  return r.data;
}

async function joinAs(round, name) {
  const c = client();
  const r = await c('POST', `/api/r/${round.token}/join`, { pin: round.pin, name });
  assert.equal(r.status, 200, `${name}: ${JSON.stringify(r.data)}`);
  return c;
}

// Swipt das komplette aktuelle Deck: Bock auf alles in `yes`, sonst nö.
async function swipe(c, round, yes, extra = {}) {
  const { deck } = (await c('GET', `/api/r/${round.token}/state`)).data;
  const swipes = Object.fromEntries(deck.map((k) => [k, yes.includes(k)]));
  const r = await c('PUT', `/api/r/${round.token}/swipes`, { swipes, ...extra });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return r.data;
}

// ---------- Tests ----------

test('Seiten und statische Dateien mit Sicherheits-Headern', async () => {
  for (const p of ['/', '/admin', '/r/AAAAAAAAAAAAAAAAAAAAAA', '/style.css', '/common.js', '/round.js', '/admin.js']) {
    const res = await fetch(BASE + p);
    assert.equal(res.status, 200, p);
    assert.match(res.headers.get('content-security-policy'), /script-src 'self'/);
    assert.equal(res.headers.get('x-frame-options'), 'DENY');
    assert.equal(res.headers.get('referrer-policy'), 'no-referrer');
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  }
  for (const key of FOOD_KEYS) {
    const res = await fetch(`${BASE}/img/${key}.jpg`);
    assert.equal(res.status, 200, `Foto für ${key} fehlt`);
    assert.equal(res.headers.get('content-type'), 'image/jpeg');
  }
  for (const p of ['/server.js', '/db.js', '/package.json', '/r/zu-kurz', '/%2e%2e/server.js', '/img/gibtsnicht.jpg', '/img/../server.js']) {
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

test('Gruppengröße wird geprüft', async () => {
  const admin = await adminClient();
  for (const size of [1, 11, 2.5, '3']) {
    assert.equal((await admin('POST', '/api/admin/rounds', { size })).status, 400, String(size));
  }
  const r = await admin('POST', '/api/admin/rounds', {});
  assert.equal(r.data.size, 3);
});

test('Kompletter Ablauf: Swipen, Match, Endrunde mit Veto, Ergebnis', async () => {
  const admin = await adminClient();
  const round = await newRound({ title: 'Sonntag', size: 3 });
  const r = `/api/r/${round.token}`;

  const anna = await joinAs(round, 'Anna');
  const ben = await joinAs(round, 'Ben');
  assert.equal((await client()('POST', `${r}/join`, { pin: round.pin, name: 'anna' })).data.error, 'name_taken');

  let s = (await anna('GET', `${r}/state`)).data;
  assert.equal(s.title, 'Sonntag');
  assert.equal(s.phase, 'swipe');
  assert.equal(s.size, 3);
  assert.deepEqual(s.deck, FOOD_KEYS);
  assert.equal(s.me.swipes, null);
  assert.equal(s.people.length, 2);

  // ungültige Swipes
  for (const swipes of [{ unbekannt: true }, { pizza: 'ja' }, [], 'kaputt', null]) {
    assert.equal((await anna('PUT', `${r}/swipes`, { swipes })).status, 400, JSON.stringify(swipes));
  }
  assert.equal((await anna('PUT', `${r}/ranking`, { ranking: [] })).data.error, 'wrong_phase');

  // Anna swipt und bringt danach eine eigene Idee ein (darauf hat sie automatisch Bock)
  s = await swipe(anna, round, ['thai', 'indian', 'pizza'], { note: '  Keine\u0007 Pilze ' });
  assert.equal(s.phase, 'swipe');
  s = (await anna('POST', `${r}/ideas`, { label: 'Ramen' })).data;
  assert.deepEqual(s.ideas, [{ id: 'c1', label: 'Ramen', by: 'Anna' }]);
  assert.equal(s.me.swipes.c1, 1);
  assert.equal((await ben('POST', `${r}/ideas`, { label: 'ramen' })).data.error, 'duplicate');
  assert.equal((await ben('POST', `${r}/ideas`, { label: 'x'.repeat(41) })).data.error, 'too_long');

  // Ben swipt inklusive Idee; Cem kommt dazu, danach ist die Runde voll
  await swipe(ben, round, ['thai', 'pizza', 'c1', 'sushi']);
  const cem = await joinAs(round, 'Cem');
  assert.equal((await client()('POST', `${r}/join`, { pin: round.pin, name: 'Dora' })).data.error, 'full');
  s = (await anna('GET', `${r}/state`)).data;
  assert.deepEqual(s.people.map((p) => [p.name, p.done]), [['Anna', true], ['Ben', true], ['Cem', false]]);

  // Cem swipt als Letzter → Matches = worauf alle Bock haben
  s = await swipe(cem, round, ['thai', 'pizza', 'c1', 'indian']);
  assert.equal(s.phase, 'rank');
  assert.deepEqual(s.shortlist, ['pizza', 'thai', 'c1']);
  assert.equal((await cem('PUT', `${r}/swipes`, { swipes: { pizza: true } })).data.error, 'wrong_phase');
  assert.equal((await cem('POST', `${r}/ideas`, { label: 'Tacos' })).data.error, 'wrong_phase');

  // ungültige Ranglisten
  for (const body of [
    { ranking: ['pizza', 'thai'] },
    { ranking: ['pizza', 'thai', 'thai'] },
    { ranking: ['pizza', 'thai', 'sushi'] },
    { ranking: ['pizza', 'thai', 'c1'], veto: 'sushi' },
    { ranking: 'pizza' },
  ]) {
    assert.equal((await anna('PUT', `${r}/ranking`, body)).status, 400, JSON.stringify(body));
  }

  await anna('PUT', `${r}/ranking`, { ranking: ['thai', 'c1', 'pizza'], veto: 'pizza' });
  s = (await ben('PUT', `${r}/ranking`, { ranking: ['c1', 'thai', 'pizza'] })).data;
  assert.equal(s.phase, 'rank');
  s = (await cem('PUT', `${r}/ranking`, { ranking: ['thai', 'pizza', 'c1'], veto: 'c1' })).data;
  assert.equal(s.phase, 'done');

  // Thai: 2 + 1 + 2 Punkte, kein Veto → gewinnt. Ramen (3) und Pizza (1) haben je ein Veto.
  assert.deepEqual(
    s.result.order.map((o) => [o.key, o.score, o.vetoes]),
    [['thai', 5, []], ['c1', 3, ['Cem']], ['pizza', 1, ['Anna']]],
  );
  assert.equal(s.result.tie, false);
  assert.equal(s.result.perfect, false);
  assert.deepEqual(s.notes, [{ name: 'Anna', note: 'Keine  Pilze' }]);

  const row = (await admin('GET', '/api/admin/rounds')).data.rounds.find((x) => x.token === round.token);
  assert.equal(row.phase, 'done');
  assert.equal(row.done, 3);
  assert.deepEqual(row.winner, { key: 'thai', label: null });

  // Cookie einer Runde gilt nicht für eine andere
  const other = await newRound();
  assert.equal((await anna('GET', `/api/r/${other.token}/state`)).status, 401);

  // Löschen entfernt alles
  assert.equal((await admin('DELETE', `/api/admin/rounds/${round.id}`)).status, 200);
  assert.equal((await anna('GET', `${r}/state`)).status, 404);
});

test('Kein Match: neue Swipe-Runde, eigene Ideen bleiben, dann Perfect Match', async () => {
  const round = await newRound({ size: 2 });
  const r = `/api/r/${round.token}`;
  const a = await joinAs(round, 'A');
  const b = await joinAs(round, 'B');

  for (const label of ['Ramen', 'Poke', 'Tacos']) assert.equal((await a('POST', `${r}/ideas`, { label })).status, 200);
  assert.equal((await a('POST', `${r}/ideas`, { label: 'Pho' })).data.error, 'idea_limit');

  await swipe(a, round, ['pizza', 'c1', 'c2', 'c3']);
  let s = await swipe(b, round, ['burger']);
  assert.equal(s.phase, 'swipe');
  assert.equal(s.swipeRound, 2);
  assert.equal(s.me.swipes, null);
  assert.equal(s.prev.voters, 2);
  assert.equal(s.prev.tally.pizza, 1);
  assert.equal(s.prev.tally.burger, 1);
  assert.equal(s.prev.tally.pasta, 0);
  assert.deepEqual((await a('GET', `${r}/state`)).data.me.swipes, { c1: 1, c2: 1, c3: 1 });

  await swipe(a, round, ['sushi', 'c1']);
  s = await swipe(b, round, ['sushi']);
  assert.equal(s.phase, 'done');
  assert.equal(s.result.perfect, true);
  assert.equal(s.result.order[0].key, 'sushi');
});

test('Nicht mehr warten: Wer fehlt, wird übersprungen', async () => {
  const round = await newRound({ size: 4 });
  const r = `/api/r/${round.token}`;
  const a = await joinAs(round, 'A');
  const b = await joinAs(round, 'B');
  const c = await joinAs(round, 'C');

  await swipe(a, round, ['pizza', 'thai']);
  assert.equal((await a('POST', `${r}/skip`)).data.error, 'skip'); // erst eine Person fertig
  await swipe(b, round, ['pizza', 'thai', 'sushi']);
  assert.equal((await c('POST', `${r}/skip`)).data.error, 'skip'); // C ist selbst nicht fertig

  const s = (await a('POST', `${r}/skip`)).data;
  assert.equal(s.phase, 'rank');
  assert.equal(s.size, 2);
  assert.deepEqual(s.shortlist, ['pizza', 'thai']);
  assert.deepEqual(s.people.map((p) => [p.name, p.active]), [['A', true], ['B', true], ['C', false]]);

  assert.equal((await c('GET', `${r}/state`)).data.me.active, false);
  assert.equal((await c('PUT', `${r}/ranking`, { ranking: ['pizza', 'thai'] })).data.error, 'excluded');
  assert.equal((await client()('POST', `${r}/join`, { pin: round.pin, name: 'D' })).data.error, 'full');
});

test('Gleichstand wird für alle gleich entschieden', async () => {
  const round = await newRound({ size: 2 });
  const r = `/api/r/${round.token}`;
  const a = await joinAs(round, 'A');
  const b = await joinAs(round, 'B');
  await swipe(a, round, ['pizza', 'thai']);
  await swipe(b, round, ['pizza', 'thai']);
  await a('PUT', `${r}/ranking`, { ranking: ['pizza', 'thai'] });
  const sb = (await b('PUT', `${r}/ranking`, { ranking: ['thai', 'pizza'] })).data;
  const sa = (await a('GET', `${r}/state`)).data;
  assert.equal(sb.result.tie, true);
  assert.deepEqual(sa.result.order.map((o) => o.key), sb.result.order.map((o) => o.key));
});

test('PIN-Sperre hält auch bei parallelen Versuchen', async () => {
  const admin = await adminClient();
  const { id, token, pin } = await newRound({ title: 'Sperre' });
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
