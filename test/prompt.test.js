// Gruppenprofil und Masterprompt ohne Server testen.
// Hier lassen sich neue Prompt-Varianten schnell absichern.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aggregate, buildPrompt } from '../prompt.js';

const v = (x = {}) => ({ wish: '', tastes: {}, spice: null, temp: null, diet: 'alles', budget: 20, nogo: [], nogoCustom: [], ...x });
const person = (name, x) => ({ name, vote: v(x) });

test('Wer einen Wunsch hat, zählt nicht beim Geschmack', () => {
  const p = aggregate([
    person('A', { wish: 'Pizza' }),
    person('B', { tastes: { frisch: 1 } }),
  ]);
  assert.deepEqual(p.wishes, [{ text: 'Pizza', name: 'A' }]);
  assert.deepEqual(p.top, [['frisch', 1]]);
});

test('Schärfe: alle scharf, alle mild, gemischt', () => {
  assert.equal(aggregate([person('A', { spice: 'scharf' }), person('B', {})]).spice, 'scharf');
  assert.equal(aggregate([person('A', { spice: 'mild' })]).spice, 'mild');
  assert.equal(aggregate([person('A', { spice: 'scharf' }), person('B', { spice: 'mild' })]).spice, 'wahl');
  assert.equal(aggregate([person('A', {})]).spice, null);
});

test('Temperatur: Mehrheit, Gleichstand heißt egal', () => {
  assert.equal(aggregate([person('A', { temp: 'heiss' }), person('B', { temp: 'heiss' }), person('C', { temp: 'kalt' })]).temp, 'heiss');
  assert.equal(aggregate([person('A', { temp: 'heiss' }), person('B', { temp: 'kalt' })]).temp, null);
});

test('Budget: das niedrigste gilt; noch keine Stimmen heißt egal', () => {
  assert.equal(aggregate([person('A', { budget: 30 }), person('B', { budget: 12 })]).budget, 12);
  assert.equal(aggregate([{ name: 'A', vote: null }]).budget, 40);
});

test('No-Gos: Reihenfolge fest, eigene ohne Dubletten', () => {
  const p = aggregate([
    person('A', { nogo: ['zwiebeln', 'pilze'], nogoCustom: ['Sushi'] }),
    person('B', { nogo: ['pilze'], nogoCustom: ['sushi', 'Oliven'] }),
  ]);
  assert.deepEqual(p.nogo, ['pilze', 'zwiebeln']);
  assert.deepEqual(p.nogoCustom, ['Sushi', 'Oliven']);
});

test('Prompt: Ort fehlt, Budget egal, Freitext gequotet', () => {
  const profile = aggregate([person('A "B"', { wish: 'Ra"men', budget: 40 }), person('C', { budget: 40 })]);
  const prompt = buildPrompt({ profile, location: '', now: 'Sonntag, 19:40 Uhr', lang: 'en' });
  assert.ok(prompt.includes('in [Ort einfügen]'));
  assert.ok(prompt.includes('jetzt (Sonntag, 19:40 Uhr)'));
  assert.ok(prompt.includes(`"Ra'men" (A 'B')`));
  assert.ok(prompt.includes('kein festes Limit'));
  assert.ok(prompt.includes('Schreibe alle Texte auf Englisch'));
  assert.ok(prompt.trim().endsWith('}]}]}'));
});
