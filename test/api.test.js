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
  const r = await admin('POST', '/api/admin/rounds', { title: 'Test', location: 'Kreuzberg', size: 3, ...body });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  return r.data;
}

async function joinAs(round, name) {
  const c = client();
  const r = await c('POST', `/api/r/${round.token}/join`, { pin: round.pin, name });
  assert.equal(r.status, 200, `${name}: ${JSON.stringify(r.data)}`);
  return c;
}

const vote = (v = {}) => ({ wish: '', tastes: {}, spice: null, temp: null, diet: 'alles', budget: 20, nogo: [], nogoCustom: [], ...v });

async function castVote(c, round, v, lang = 'de') {
  const r = await c('PUT', `/api/r/${round.token}/vote?lang=${lang}`, { vote: vote(v) });
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
  for (const p of ['/server.js', '/db.js', '/prompt.js', '/llm.js', '/package.json', '/r/zu-kurz', '/%2e%2e/server.js']) {
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

test('Runde anlegen: Ort ist Pflicht, Gruppengröße wird geprüft', async () => {
  const admin = await adminClient();
  assert.equal((await admin('POST', '/api/admin/rounds', { size: 3 })).data.error, 'location_required');
  assert.equal((await admin('POST', '/api/admin/rounds', { location: ' ', size: 3 })).data.error, 'location_required');
  for (const size of [1, 11, 2.5, '3']) {
    assert.equal((await admin('POST', '/api/admin/rounds', { location: 'Mitte', size })).status, 400, String(size));
  }
  const r = await admin('POST', '/api/admin/rounds', { location: 'Mitte' });
  assert.equal(r.data.size, 3);
  assert.equal(r.data.location, 'Mitte');
});

test('Kompletter Ablauf: Wunsch, Geschmack, Gruppenprofil, Masterprompt', async () => {
  const admin = await adminClient();
  const round = await newRound({ title: 'Sonntag', location: 'Kreuzberg, Oranienstraße', size: 3 });
  const r = `/api/r/${round.token}`;

  const anna = await joinAs(round, 'Anna');
  const ben = await joinAs(round, 'Ben');
  assert.equal((await client()('POST', `${r}/join`, { pin: round.pin, name: 'anna' })).data.error, 'name_taken');

  let s = (await anna('GET', `${r}/state`)).data;
  assert.equal(s.phase, 'vote');
  assert.equal(s.location, 'Kreuzberg, Oranienstraße');
  assert.equal(s.me.vote, null);
  assert.equal(s.ai.default, 'claude');
  assert.equal(s.ai.connected, false);
  assert.equal(s.result, undefined);

  // ungültige Stimmen
  for (const v of [
    { tastes: { scharf: 1 } },          // Schärfe ist eine eigene Frage
    { tastes: { frisch: 3 } },
    { spice: 'sehr' },
    { temp: 'lauwarm' },
    { diet: 'paleo' },
    { budget: 7 }, { budget: 41 }, { budget: '20' }, { budget: 12.5 },
    { nogo: ['pilze', 'pilze'] }, { nogo: ['brokkoli'] },
    { nogoCustom: ['a', 'b', 'c', 'd', 'e', 'f'] }, { nogoCustom: [''] }, { nogoCustom: ['x'.repeat(31)] },
    { wish: 'x'.repeat(41) },
  ]) {
    const res = await anna('PUT', `${r}/vote`, { vote: vote(v) });
    assert.equal(res.status, 400, JSON.stringify(v));
  }
  assert.equal((await anna('PUT', `${r}/vote`, { vote: 'kaputt' })).status, 400);

  // Mit Wunsch werden Geschmack, Schärfe und Temperatur ignoriert
  s = await castVote(anna, round, { wish: 'Pizza "Diavola"', tastes: { cremig: 2 }, spice: 'scharf', temp: 'kalt', budget: 25 });
  assert.deepEqual(s.me.vote, vote({ wish: 'Pizza "Diavola"', budget: 25 }));
  assert.equal(s.phase, 'vote');
  assert.deepEqual(s.people.map((p) => [p.name, p.done]), [['Anna', true], ['Ben', false]]);

  // Stimme ändern geht, solange abgestimmt wird
  s = await castVote(anna, round, { wish: 'Pizza', budget: 25, nogoCustom: ['Sushi', 'sushi'] });
  assert.deepEqual(s.me.vote.nogoCustom, ['Sushi']);

  await castVote(ben, round, {
    tastes: { frisch: 2, cremig: 1 }, spice: 'mild', temp: 'heiss', diet: 'vegetarisch', budget: 15, nogo: ['pilze'],
  });
  const cem = await joinAs(round, 'Cem');
  assert.equal((await client()('POST', `${r}/join`, { pin: round.pin, name: 'Dora' })).data.error, 'full');
  s = await castVote(cem, round, { tastes: { frisch: 1, herzhaft: 1 }, spice: 'scharf', temp: 'heiss', budget: 40 });

  assert.equal(s.phase, 'done');
  const p = s.result.profile;
  assert.equal(p.n, 3);
  assert.deepEqual(p.wishes, [{ text: 'Pizza', name: 'Anna' }]);
  assert.deepEqual(p.top, [['frisch', 3], ['cremig', 1], ['herzhaft', 1]]);
  assert.deepEqual(p.must, [{ key: 'frisch', name: 'Ben' }]);
  assert.equal(p.spice, 'wahl');
  assert.equal(p.temp, 'heiss');
  assert.equal(p.vegetarian, 1);
  assert.equal(p.budget, 15);
  assert.deepEqual(p.nogo, ['pilze']);
  assert.deepEqual(p.nogoCustom, ['Sushi']);

  const prompt = s.result.prompt;
  for (const part of [
    'in Kreuzberg, Oranienstraße', '"Pizza" (Anna)', 'Frisch 3, Cremig 1, Herzhaft 1', 'Frisch (Ben)',
    'mindestens eine milde Variante', 'Temperatur: heiß', '1 von 3 essen vegetarisch', 'Pilze, "Sushi"',
    'höchstens 15 €', 'genau 3 Restaurants', 'genau 3 Gerichte', 'No-Gos sind tabu', 'Schreibe alle Texte auf Deutsch',
  ]) assert.ok(prompt.includes(part), `fehlt im Prompt: ${part}`);

  // Sprache der Antwort folgt der Oberfläche
  const es = (await ben('GET', `${r}/state?lang=es`)).data.result.prompt;
  assert.ok(es.includes('Schreibe alle Texte auf Spanisch'));
  assert.ok((await ben('GET', `${r}/state?lang=xx`)).data.result.prompt.includes('auf Deutsch'));

  assert.equal((await cem('PUT', `${r}/vote`, { vote: vote() })).data.error, 'wrong_phase');

  const row = (await admin('GET', '/api/admin/rounds')).data.rounds.find((x) => x.token === round.token);
  assert.equal(row.phase, 'done');
  assert.equal(row.done, 3);
  assert.equal(row.location, 'Kreuzberg, Oranienstraße');

  // Cookie einer Runde gilt nicht für eine andere
  const other = await newRound();
  assert.equal((await anna('GET', `/api/r/${other.token}/state`)).status, 401);

  // Löschen entfernt alles
  assert.equal((await admin('DELETE', `/api/admin/rounds/${round.id}`)).status, 200);
  assert.equal((await anna('GET', `${r}/state`)).status, 404);
});

test('Nicht mehr warten: Wer fehlt, wird übersprungen', async () => {
  const round = await newRound({ size: 4 });
  const r = `/api/r/${round.token}`;
  const a = await joinAs(round, 'A');
  const b = await joinAs(round, 'B');
  const c = await joinAs(round, 'C');

  await castVote(a, round, { wish: 'Ramen' });
  assert.equal((await a('POST', `${r}/skip`)).data.error, 'skip'); // erst eine Person fertig
  await castVote(b, round, { tastes: { frisch: 1 } });
  assert.equal((await c('POST', `${r}/skip`)).data.error, 'skip'); // C ist selbst nicht fertig

  const s = (await a('POST', `${r}/skip`)).data;
  assert.equal(s.phase, 'done');
  assert.equal(s.size, 2);
  assert.equal(s.result.profile.n, 2);
  assert.deepEqual(s.people.map((p) => [p.name, p.active]), [['A', true], ['B', true], ['C', false]]);

  assert.equal((await c('GET', `${r}/state`)).data.me.active, false);
  assert.equal((await c('PUT', `${r}/vote`, { vote: vote() })).data.error, 'excluded');
  assert.equal((await client()('POST', `${r}/join`, { pin: round.pin, name: 'D' })).data.error, 'full');
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
