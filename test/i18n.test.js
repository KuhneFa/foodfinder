// Prüft, dass jede Sprache genau dieselben Texte hat wie Deutsch
// und dieselben Platzhalter ({n}, {link}, …) verwendet.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const code = readFileSync(new URL('../public/common.js', import.meta.url), 'utf8');
const ctx = {
  navigator: { language: 'de' },
  localStorage: { getItem: () => null, setItem: () => {} },
  document: { documentElement: { dataset: {} }, addEventListener: () => {} },
};
vm.runInNewContext(`${code}\nglobalThis.__out = { I18N, LANGS, FOODS };`, ctx);
const { I18N, LANGS, FOODS } = ctx.__out;

const placeholders = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

test('Sprachauswahl und Übersetzungen passen zusammen', () => {
  assert.deepEqual(Object.keys(LANGS).sort(), Object.keys(I18N).sort());
});

test('Küchen in Browser und Server stimmen überein', () => {
  const server = readFileSync(new URL('../server.js', import.meta.url), 'utf8');
  const keys = [...server.match(/const FOOD_KEYS = \[([^\]]*)\]/)[1].matchAll(/'([a-z]+)'/g)].map((m) => m[1]);
  assert.deepEqual(Array.from(FOODS, (f) => f.k), keys); // Array.from: Array aus diesem Kontext, nicht aus der Sandbox
  for (const f of FOODS) assert.ok(I18N.de[`food_${f.k}`], `food_${f.k} fehlt`);
});

for (const lang of Object.keys(I18N)) {
  test(`Sprache „${lang}“ ist vollständig`, () => {
    const ref = I18N.de;
    const cur = I18N[lang];
    assert.deepEqual(Object.keys(cur).sort(), Object.keys(ref).sort());
    for (const key of Object.keys(ref)) {
      assert.ok(cur[key].trim(), `${lang}.${key} ist leer`);
      assert.deepEqual(placeholders(cur[key]), placeholders(ref[key]), `${lang}.${key}: Platzhalter`);
    }
  });
}
