'use strict';

const token = location.pathname.split('/')[2];
const base = `/api/r/${token}`;
const POLL_MS = 3000;
const SKIP_AFTER_MS = 20_000;
const DRAFT_KEY = `ff_v_${token}`;

// Duelle: je zwei Gegensätze in ihren Geschmacksfarben
const PAIRS = [['heiss', 'kalt'], ['scharf', 'mild'], ['frisch', 'deftig'], ['fruchtig', 'herzhaft'], ['knusprig', 'cremig'], ['veggie', 'fleisch']];
const COLORS = {
  heiss: '--t-heiss', kalt: '--t-kalt', scharf: '--t-scharf', mild: '--t-mild', frisch: '--t-frisch', deftig: '--t-deftig',
  fruchtig: '--t-frucht', herzhaft: '--t-herzhaft', knusprig: '--t-knusprig', cremig: '--t-cremig', veggie: '--t-veggie', fleisch: '--t-fleisch',
};
const LIGHT_TEXT = new Set(['deftig', 'fleisch']); // heller Text auf dunkler Farbe
const DIETS = ['alles', 'vegetarisch', 'vegan'];
const tasteColor = (k) => TASTES.find((x) => x.k === k)?.c;

let S = null;          // letzter Stand vom Server
let view = null;
let lastError = null;
let pollTimer = null;
let polling = false;
let waitSince = 0;
let editing = false;   // Stimme wird nachträglich geändert
let V = null;          // Stimme im Entstehen, übersteht Neuladen
let busy = false;
let provider = null;
let flashed = false;

const newVote = () => ({
  step: 'start', i: 0, wish: '', tastes: {}, spice: null, temp: null,
  diet: DIETS.includes(store.get('ff_diet')) ? store.get('ff_diet') : 'alles',
  budget: 18, nogo: [], nogoCustom: [],
});
function saveDraft() { store.set(DRAFT_KEY, JSON.stringify(V)); }
function loadDraft() {
  try {
    const v = JSON.parse(store.get(DRAFT_KEY) || 'null');
    return v && typeof v === 'object' ? { ...newVote(), ...v } : null;
  } catch { return null; }
}

// ---------- Ansichten ----------
function show(id) {
  if (view !== id) window.scrollTo(0, 0);
  view = id;
  document.body.dataset.view = id;
  for (const s of $$('main > section, #v-loading')) s.hidden = s.id !== id;
  clearInterval(pollTimer);
  pollTimer = id === 'v-wait' ? setInterval(() => { if (!document.hidden) refresh(); }, POLL_MS) : null;
}

function showError(e) {
  lastError = e;
  $('#error-text').textContent = errMsg(e);
  show('v-error');
}

const stateUrl = () => `${base}/state?lang=${lang}`;

async function load() {
  try {
    S = await api('GET', stateUrl());
  } catch (e) {
    if (e.status === 401) return showJoin();
    return showError(e);
  }
  route(true);
}

async function refresh() {
  if (polling) return;
  polling = true;
  try {
    S = await api('GET', stateUrl());
    route();
  } catch (e) {
    if (e.status === 401) showJoin();
    else if (e.status === 404) showError(e);
  } finally {
    polling = false;
  }
}
document.addEventListener('visibilitychange', () => { if (!document.hidden && view === 'v-wait') refresh(); });

// Entscheidet anhand des Server-Stands, was angezeigt wird.
function route(force = false) {
  document.title = S.title ? `${S.title} · Foodfinder` : 'Foodfinder';
  if (S.phase === 'done') return showResult();
  if (!S.me.active) return showWait();
  if (S.me.vote && !editing) return showWait();
  if (!force && ['v-start', 'v-duel', 'v-over'].includes(view)) return;
  V = loadDraft() || newVote();
  if (V.step === 'over') return showOverview();
  if (V.step === 'duel') return showDuel();
  showStart();
}

// ---------- Beitreten ----------
function showJoin() {
  if (!$('#name').value) $('#name').value = store.get('ff_name') || '';
  show('v-join');
}

$('#join-form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const btn = ev.submitter;
  btn.disabled = true;
  $('#join-error').textContent = '';
  const name = $('#name').value.trim();
  try {
    await api('POST', `${base}/join`, { pin: $('#pin').value.trim(), name });
    store.set('ff_name', name);
    await load();
  } catch (e) {
    if (e.code === 'not_found') return showError(e);
    $('#join-error').textContent = errMsg(e);
  } finally {
    btn.disabled = false;
  }
});

// ---------- Start: Wunsch oder Hilfe ----------
function showStart() {
  $('#start-ey').textContent = S.title || '';
  $('#wish').value = V.wish;
  $('#wish-go').disabled = !V.wish.trim();
  renderQuick();
  show('v-start');
}

function renderQuick() {
  $('#quick').replaceChildren(...['q1', 'q2', 'q3', 'q4'].map((k) => h('button', {
    class: 'qchip', type: 'button', text: t(k),
    onclick: () => { V.wish = t(k); goOverview(); },
  })));
}

function goOverview() {
  V.step = 'over';
  saveDraft();
  showOverview();
}

$('#wish').addEventListener('input', (e) => {
  V.wish = e.target.value;
  $('#wish-go').disabled = !V.wish.trim();
  saveDraft();
});
$('#wish').addEventListener('keydown', (e) => { if (e.key === 'Enter' && V.wish.trim()) goOverview(); });
$('#wish-go').addEventListener('click', goOverview);
$('#help-me').addEventListener('click', () => {
  Object.assign(V, { wish: '', step: 'duel', i: 0 });
  saveDraft();
  showDuel();
});

// ---------- Duelle ----------
function duelHead(ink) {
  $('#v-duel').style.setProperty('--head', ink);
  $('#segs').replaceChildren(...PAIRS.map((_, i) => h('i', { class: i < V.i ? 'done' : '' })));
  $('#mini').replaceChildren(...S.people.filter((p) => !p.me && p.active).map((p) => h('span', {
    class: p.done ? 'done' : '', text: p.name.slice(0, 1).toUpperCase(), title: p.name,
  })));
}

function pairEl(pair) {
  const el = h('div', { class: 'pair enter' },
    pair.map((id, k) => {
      const b = h('button', {
        class: `half ${k ? 'b' : 'a'}${LIGHT_TEXT.has(id) ? ' light' : ''}`, type: 'button',
        onclick: () => choose(el, k ? 'b' : 'a', id),
      }, h('span', { class: 'w', text: t(`d_${id}`) }), h('span', { class: 's', text: t(`d_${id}_s`) }));
      b.style.setProperty('--c', `var(${COLORS[id]})`);
      return b;
    }),
    h('span', { class: 'or', text: t('or') }),
    h('button', { class: 'egal', type: 'button', text: t('egal'), onclick: () => choose(el, null, null) }));
  return el;
}

function showDuel() {
  if (V.i >= PAIRS.length) return goOverview();
  const el = pairEl(PAIRS[V.i]);
  el.classList.remove('enter');
  $('#d-stage').replaceChildren(el);
  duelHead('var(--ink)');
  show('v-duel');
}

function applyPick(id) {
  if (id === 'heiss' || id === 'kalt') V.temp = id;
  else if (id === 'scharf' || id === 'mild') V.spice = id;
  else if (id === 'veggie') V.diet = 'vegetarisch';
  else if (id === 'fleisch') V.diet = 'alles';
  else if (tasteColor(id)) V.tastes[id] = V.tastes[id] || 1;
}

async function choose(el, side, id) {
  if (busy) return;
  busy = true;
  if (id) {
    applyPick(id);
    el.dataset.chosen = side;
    $('#v-duel').style.setProperty('--head', LIGHT_TEXT.has(id) ? 'var(--paper)' : 'var(--ink)');
    navigator.vibrate?.(8);
    await wait(reducedMotion() ? 0 : 600);
  }
  V.i++;
  saveDraft();
  if (V.i >= PAIRS.length) {
    busy = false;
    return goOverview();
  }
  const next = pairEl(PAIRS[V.i]);
  $('#d-stage').append(next);
  next.getBoundingClientRect();
  next.classList.remove('enter');
  el.classList.add('leave');
  duelHead('var(--ink)');
  await wait(reducedMotion() ? 0 : 560);
  el.remove();
  busy = false;
}

// ---------- Übersicht: „Passt das so?“ ----------
function showOverview() {
  const wishMode = () => Boolean(V.wish.trim());
  const answered = Object.keys(V.tastes).length || V.spice || V.temp;
  const intro = h('p', { class: 'muted' });
  const sum = h('p', { class: 'muted small center' });
  const err = h('p', { class: 'error', role: 'alert' });
  const tasteBox = h('div', { class: 'secs' });

  // Mit konkretem Wunsch fallen Geschmack, Schärfe und Temperatur weg; Ernährung, Budget und No-Gos gelten weiter.
  const update = () => {
    tasteBox.hidden = wishMode();
    intro.textContent = t(wishMode() ? 'ov_intro_wish' : answered ? 'ov_intro_duel' : 'ov_intro_none');
    const nogo = [...V.nogo.map((k) => t(`nogo_${k}`)), ...V.nogoCustom];
    sum.textContent = [
      wishMode() ? t('sum_wish', { w: V.wish.trim() }) : t('sum_tastes', { n: Object.keys(V.tastes).length }),
      !wishMode() && V.spice ? t(`spice_${V.spice}`) : null,
      !wishMode() && V.temp ? t(`temp_${V.temp}`) : null,
      V.diet !== 'alles' ? t(`diet_${V.diet}`) : null,
      V.budget >= BUDGET_MAX ? t('sum_budget_egal') : t('sum_budget', { b: V.budget }),
      nogo.length ? t('sum_nogo', { list: nogo.join(', ') }) : null,
    ].filter(Boolean).join(' · ');
    saveDraft();
  };

  const sec = (title, ...kids) => h('div', { class: 'sec' }, h('p', { class: 'eyebrow', text: title }), ...kids);
  const seg = (key, items) => {
    const wrap = h('div', { class: 'segd', role: 'group', 'aria-label': t(`sec_${key}`) }, items.map(([v, label]) => h('button', {
      type: 'button', 'aria-pressed': String(V[key] === v), text: label,
      onclick: (e) => {
        V[key] = v;
        $$('button', wrap).forEach((b) => b.setAttribute('aria-pressed', String(b === e.currentTarget)));
        update();
      },
    })));
    return wrap;
  };

  const wishIn = h('input', { class: 'wish', type: 'text', maxlength: 40, placeholder: t('wish_ph2'), 'aria-label': t('sec_wish') });
  wishIn.value = V.wish;
  wishIn.addEventListener('input', () => { V.wish = wishIn.value; update(); });

  const chips = h('div', { class: 'tchips' }, TASTES.map((x) => {
    const b = h('button', {
      class: 'tchip', type: 'button', 'data-s': String(V.tastes[x.k] || 0),
      onclick: () => {
        const s = ((V.tastes[x.k] || 0) + 1) % 3;
        if (s) V.tastes[x.k] = s; else delete V.tastes[x.k];
        b.dataset.s = String(s);
        b.dataset.must = t('muss');
        update();
      },
    }, t(`taste_${x.k}`));
    b.dataset.must = t('muss');
    b.style.setProperty('--c', `var(${x.c})`);
    b.style.setProperty('--on', x.light ? 'var(--paper)' : 'var(--ink)');
    return b;
  }));
  tasteBox.append(
    sec(t('sec_taste'), h('p', { class: 'muted small', text: t('taste_hint') }), chips),
    sec(t('sec_spice'), seg('spice', [['scharf', t('spice_scharf')], ['mild', t('spice_mild')], [null, t('egal')]])),
    sec(t('sec_temp'), seg('temp', [['heiss', t('temp_heiss')], ['kalt', t('temp_kalt')], [null, t('egal')]])));

  const euro = () => (V.budget >= BUDGET_MAX ? `${BUDGET_MAX}+` : String(V.budget));
  const money = h('p', { class: 'money' }, h('span', { text: euro() }), ' ', h('small', { text: t('per_person') }));
  const range = h('input', { class: 'range', type: 'range', min: BUDGET_MIN, max: BUDGET_MAX, value: V.budget, 'aria-label': t('sec_budget') });
  const fill = () => range.style.setProperty('--fill', `${((V.budget - BUDGET_MIN) / (BUDGET_MAX - BUDGET_MIN)) * 100}%`);
  fill();
  range.addEventListener('input', () => {
    V.budget = Number(range.value);
    money.firstChild.textContent = euro();
    fill();
    update();
  });

  const ngChip = (key, label, custom) => h('button', {
    class: 'ng', type: 'button', 'aria-pressed': String(custom || V.nogo.includes(key)), text: label,
    onclick: (e) => {
      if (custom) {
        V.nogoCustom = V.nogoCustom.filter((x) => x !== label);
        e.currentTarget.remove();
      } else {
        V.nogo = V.nogo.includes(key) ? V.nogo.filter((x) => x !== key) : [...V.nogo, key];
        e.currentTarget.setAttribute('aria-pressed', String(V.nogo.includes(key)));
      }
      update();
    },
  });
  const nogo = h('div', { class: 'nogo' },
    NOGOS.map((k) => ngChip(k, t(`nogo_${k}`), false)),
    V.nogoCustom.map((c) => ngChip(null, c, true)));
  const customIn = h('input', { class: 'wish small', type: 'text', maxlength: 30, placeholder: t('nogo_ph'), 'aria-label': t('nogo_ph') });
  const addCustom = () => {
    const v = customIn.value.replace(/\s+/g, ' ').trim();
    err.textContent = '';
    if (!v) return;
    // Gibt es das schon als fertigen Chip (z. B. „Koriander“), wird der ausgewählt.
    const known = NOGOS.find((k) => t(`nogo_${k}`).toLowerCase() === v.toLowerCase());
    if (known) {
      if (!V.nogo.includes(known)) V.nogo = [...V.nogo, known];
      $$('.ng', nogo)[NOGOS.indexOf(known)].setAttribute('aria-pressed', 'true');
      customIn.value = '';
      update();
      return;
    }
    if (V.nogoCustom.length >= 5) { err.textContent = t('err_invalid'); return; }
    if (V.nogoCustom.some((x) => x.toLowerCase() === v.toLowerCase())) { err.textContent = t('err_duplicate'); return; }
    V.nogoCustom = [...V.nogoCustom, v];
    nogo.append(ngChip(null, v, true));
    customIn.value = '';
    update();
  };
  customIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') addCustom(); });

  const send = h('button', { class: 'btn accent', type: 'button', text: t('send'), onclick: () => submitVote(send, err) });
  update();
  $('#v-over').replaceChildren(h('div', { class: 'over' },
    h('div', { class: 'sec' }, h('p', { class: 'eyebrow', text: t('ov_eyebrow') }), h('h1', { text: t('ov_title') }), intro),
    sec(t('sec_wish'), wishIn),
    tasteBox,
    sec(t('sec_diet'), seg('diet', [['alles', t('diet_alles')], ['vegetarisch', t('diet_vegetarisch')], ['vegan', t('diet_vegan')]])),
    sec(t('sec_budget'), money, range, h('div', { class: 'tiers' }, h('span', { text: `${BUDGET_MIN} €` }), h('span', { text: t('budget_egal') }))),
    sec(t('sec_nogo'), nogo, h('div', { class: 'addrow' }, customIn, h('button', { class: 'btn ghost', type: 'button', text: t('nogo_add'), onclick: addCustom }))),
    h('div', { class: 'sendbar' }, err, sum, send)));
  show('v-over');
}

async function submitVote(btn, err) {
  btn.disabled = true;
  err.textContent = '';
  const vote = {
    wish: V.wish.trim(), tastes: V.tastes, spice: V.spice, temp: V.temp,
    diet: V.diet, budget: V.budget, nogo: V.nogo, nogoCustom: V.nogoCustom,
  };
  try {
    S = await api('PUT', `${base}/vote?lang=${lang}`, { vote });
    store.remove(DRAFT_KEY);
    store.set('ff_diet', V.diet);
    editing = false;
    route(true);
  } catch (e) {
    if (e.status === 401) return showJoin();
    if (e.code === 'wrong_phase' || e.code === 'excluded') {
      editing = false;
      store.remove(DRAFT_KEY);
      return load();
    }
    err.textContent = errMsg(e);
  } finally {
    btn.disabled = false;
  }
}

// ---------- Warten ----------
function showWait() {
  if (view !== 'v-wait') waitSince = Date.now();
  renderWait();
  show('v-wait');
}

function renderWait() {
  const active = S.people.filter((p) => p.active);
  const missing = Math.max(0, S.size - active.length);
  const link = location.origin + location.pathname;
  const hint = $('#share-hint');
  $('#wait-text').textContent = S.me.active ? t('wait_text') : t('err_excluded');
  $('#people').replaceChildren(
    ...active.map((p) => h('li', {},
      h('span', { class: 'who', text: p.me ? `${p.name} (${t('you')})` : p.name }),
      p.done
        ? h('span', { class: 'status done', text: `✓ ${t('st_done')}` })
        : h('span', { class: 'status' }, t('st_busy'), p.me ? null : h('button', {
          class: 'chip-btn', type: 'button', text: t('nudge'),
          onclick: () => shareMessage(t('nudge_text', { name: p.name, link }), hint),
        })))),
    missing ? h('li', { class: 'muted' },
      h('span', { class: 'who', text: t('st_missing', { n: missing }) }),
      h('button', { class: 'chip-btn', type: 'button', text: t('share_again'), onclick: () => shareMessage(t('share_text', { link }), hint) })) : null,
  );
  const waitingFor = active.filter((p) => !p.done).map((p) => p.name);
  if (missing) waitingFor.push(`+${missing}`);
  const skip = $('#skip');
  skip.hidden = !(S.me.active && active.filter((p) => p.done).length >= 2 && waitingFor.length && Date.now() - waitSince > SKIP_AFTER_MS);
  skip.dataset.names = waitingFor.join(', ');
  $('#change').hidden = !(S.me.active && S.me.vote && S.phase === 'vote');
}

$('#skip').addEventListener('click', async (ev) => {
  if (!confirm(t('skip_confirm', { names: ev.currentTarget.dataset.names }))) return;
  try {
    S = await api('POST', `${base}/skip?lang=${lang}`);
    route(true);
  } catch (e) {
    if (e.status === 401) return showJoin();
    alert(errMsg(e));
  }
});

$('#change').addEventListener('click', () => {
  editing = true;
  V = { ...newVote(), ...S.me.vote, step: 'over' };
  saveDraft();
  showOverview();
});

// ---------- Ergebnis ----------
async function showResult() {
  if (!flashed && ['v-wait', 'v-over'].includes(view) && !reducedMotion()) {
    flashed = true;
    show('v-flash');
    await wait(1400);
  }
  flashed = true;
  renderResult();
  show('v-result');
}

// Gruppenprofil als große Wörter: Wünsche, Schärfe, Geschmack, Temperatur, Budget
function profileWords(p) {
  const words = [];
  const wishes = new Map();
  for (const w of p.wishes) {
    const k = w.text.toLowerCase();
    wishes.set(k, { text: w.text, n: (wishes.get(k)?.n || 0) + 1 });
  }
  [...wishes.values()].sort((a, b) => b.n - a.n).slice(0, 2).forEach((w) => words.push([`${w.text}.`, '--accent']));
  if (p.spice) words.push([`${t(`spice_${p.spice}`)}.`, p.spice === 'mild' ? '--t-mild' : '--t-scharf']);
  const tail = [];
  if (p.temp) tail.push([`${t(`temp_${p.temp}`)}.`, p.temp === 'heiss' ? '--t-heiss' : '--t-kalt']);
  tail.push([p.budget >= BUDGET_MAX ? t('word_budget_egal') : t('word_budget', { b: p.budget }), '--fg']);
  // Höchstens 6 Wörter: Geschmäcker füllen auf, was übrig ist
  const slots = Math.max(0, Math.min(2, 6 - words.length - tail.length));
  p.top.slice(0, slots).forEach(([k]) => words.push([`${t(`taste_${k}`)}.`, tasteColor(k)]));
  return [...words, ...tail];
}

function renderResult() {
  const p = S.result.profile;
  $('#pwords').replaceChildren(...profileWords(p).map(([w, c]) => {
    const s = h('span', { text: w });
    s.style.setProperty('--c', `var(${c})`);
    return s;
  }));
  const wishes = $('#r-wishes');
  wishes.hidden = !p.wishes.length;
  wishes.replaceChildren(h('span', { text: `${t('res_wishes')} ` }), p.wishes.map((w) => `${w.text} (${w.name})`).join(', '));
  const nogo = [...p.nogo.map((k) => t(`nogo_${k}`)), ...p.nogoCustom];
  const nogoLine = $('#r-nogo');
  nogoLine.hidden = !nogo.length;
  nogoLine.replaceChildren(h('span', { text: `${t('res_without')} ` }), nogo.join(', '));
  $('#prompt').textContent = S.result.prompt;
  renderProviders();
}

// Anbieter wählbar, Claude vorausgewählt. Senden geht erst, wenn die KI angebunden ist.
function renderProviders() {
  provider = provider || S.ai.default;
  $('#providers').replaceChildren(...S.ai.providers.map((x) => h('button', {
    type: 'button', 'aria-pressed': String(x.id === provider), text: x.label,
    onclick: () => { provider = x.id; renderProviders(); },
  })));
  const label = S.ai.providers.find((x) => x.id === provider)?.label || '';
  $('#send-ai').textContent = t('ai_send', { p: label });
  $('#send-ai').disabled = !S.ai.connected;
}

$('#copy-prompt').addEventListener('click', (e) => copyText(S.result.prompt, e.currentTarget));

// ---------- Sprache ----------
document.addEventListener('langchange', () => {
  if (view === 'v-start') renderQuick();
  if (view === 'v-duel') showDuel();
  if (view === 'v-over') showOverview();
  if (view === 'v-wait') renderWait();
  if (view === 'v-result') load(); // Prompt in der neuen Sprache holen
  if (view === 'v-error') $('#error-text').textContent = errMsg(lastError);
});

load();
