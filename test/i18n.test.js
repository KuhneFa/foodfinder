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
vm.runInNewContext(`${code}\nglobalThis.__out = { I18N, LANGS };`, ctx);
const { I18N, LANGS } = ctx.__out;

const placeholders = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

test('Sprachauswahl und Übersetzungen passen zusammen', () => {
  assert.deepEqual(Object.keys(LANGS).sort(), Object.keys(I18N).sort());
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
