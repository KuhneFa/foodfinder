'use strict';

const token = location.pathname.split('/')[2];
const base = `/api/r/${token}`;
const POLL_MS = 3000;
const SKIP_AFTER_MS = 20_000;

let S = null;          // letzter Stand vom Server
let view = null;
let lastError = null;
let pollTimer = null;
let polling = false;
let waitSince = 0;
let confettiDone = false;
const noImg = new Set(); // Küchen ohne Foto → Emoji anzeigen

// Swipe-Sitzung
let queue = [];
let sessionTotal = 0;
let decisions = {};
let history = [];
let busy = false;
let newCardsMode = false;

// Endrunde
let order = [];
let veto = null;

const isFood = (key) => Boolean(food(key));
const idea = (key) => S?.ideas.find((i) => i.id === key);
const label = (key) => (isFood(key) ? t(`food_${key}`) : idea(key)?.label ?? '?');
const emoji = (key) => food(key)?.e ?? '💡';

// ---------- Ansichten ----------
function show(id) {
  if (view !== id) window.scrollTo(0, 0);
  view = id;
  document.body.dataset.view = id;
  for (const s of document.querySelectorAll('main > section, #v-loading')) s.hidden = s.id !== id;
  clearInterval(pollTimer);
  pollTimer = id === 'v-wait' ? setInterval(() => { if (!document.hidden) refresh(); }, POLL_MS) : null;
}

function showError(e) {
  lastError = e;
  $('#error-text').textContent = errMsg(e);
  show('v-error');
}

function setTitle(title) {
  document.title = title ? `${title} · Foodfinder` : 'Foodfinder';
}

async function load() {
  try {
    S = await api('GET', `${base}/state`);
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
    S = await api('GET', `${base}/state`);
    route();
  } catch (e) {
    if (e.status === 401) showJoin();
    else if (e.status === 404) showError(e);
    // sonst: beim nächsten Durchlauf erneut versuchen
  } finally {
    polling = false;
  }
}
document.addEventListener('visibilitychange', () => { if (!document.hidden && view === 'v-wait') refresh(); });

// Entscheidet anhand des Server-Stands, was angezeigt wird.
function route(force = false) {
  setTitle(S.title);
  const me = S.me;
  if (S.phase === 'done') return showResult();
  if (!me.active) return showWait();

  if (S.phase === 'swipe') {
    const swiped = me.swipes || {};
    const missing = S.deck.filter((k) => !Object.hasOwn(swiped, k));
    if (!missing.length) return showWait();
    if (!force && (view === 'v-swipe' || view === 'v-summary')) return;
    const fresh = FOODS.every((f) => !Object.hasOwn(swiped, f.k));
    if (S.swipeRound > 1 && fresh && Number(store.get(`ff_nm_${token}`)) < S.swipeRound) return showNoMatch();
    return startSwipe(missing, !fresh);
  }

  if (me.ranking) return showWait();
  if (force || view !== 'v-rank') startRank();
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

// ---------- Swipen ----------
// Reihenfolge pro Person gemischt (aber stabil beim Neuladen)
function seeded(str) {
  let x = 2166136261;
  for (let i = 0; i < str.length; i++) x = Math.imul(x ^ str.charCodeAt(i), 16777619);
  return () => {
    x = Math.imul(x ^ (x >>> 15), 2246822507);
    x = Math.imul(x ^ (x >>> 13), 3266489909);
    x ^= x >>> 16;
    return (x >>> 0) / 4294967296;
  };
}
function shuffle(arr, seed) {
  const rnd = seeded(seed);
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Entscheidungen bleiben beim Neuladen erhalten, bis sie abgeschickt sind.
const localKey = () => `ff_sw_${token}_${S.swipeRound}`;
function saveLocal() { store.set(localKey(), JSON.stringify(decisions)); }
function loadLocal() {
  try { return JSON.parse(store.get(localKey()) || '{}') || {}; } catch { return {}; }
}

function startSwipe(missing, newCards) {
  newCardsMode = newCards;
  const saved = loadLocal();
  decisions = Object.fromEntries(Object.entries(saved).filter(([k, v]) => missing.includes(k) && typeof v === 'boolean'));
  const cards = [...shuffle(missing.filter(isFood), `${token}:${S.me.name}:${S.swipeRound}`), ...missing.filter((k) => !isFood(k))];
  sessionTotal = cards.length;
  queue = cards.filter((k) => !Object.hasOwn(decisions, k));
  history = cards.filter((k) => Object.hasOwn(decisions, k));
  if (!queue.length) return showSummary();
  renderDeck();
  show('v-swipe');
}

function cardEl(key, cls) {
  const isIdea = !isFood(key);
  const card = h('div', { class: `card ${cls}${isIdea ? ' idea' : ''}${isIdea || noImg.has(key) ? ' noimg' : ''}`, 'data-key': key });
  if (!isIdea && !noImg.has(key)) {
    const img = h('img', { src: imgSrc(key), alt: '', draggable: 'false' });
    img.addEventListener('error', () => { noImg.add(key); img.remove(); card.classList.add('noimg'); });
    card.append(img);
  }
  let sub = null;
  if (isIdea) sub = t('idea_by', { name: idea(key)?.by ?? '' });
  else if (S.prev?.tally?.[key] > 0) sub = t('prev_tally', { n: S.prev.tally[key], total: S.prev.voters });
  card.append(
    h('div', { class: 'card-emoji', text: emoji(key), 'aria-hidden': 'true' }),
    h('div', { class: 'card-meta' },
      h('div', { class: 'card-name', text: label(key) }),
      sub ? h('div', { class: 'card-sub', text: sub }) : null),
    h('div', { class: 'stamp yes', text: t('swipe_yes'), 'aria-hidden': 'true' }),
    h('div', { class: 'stamp no', text: t('swipe_no'), 'aria-hidden': 'true' }),
  );
  return card;
}

function renderDeck() {
  const [first, second, third] = queue;
  $('#deck').replaceChildren(...[second && cardEl(second, 'next'), first && cardEl(first, 'top')].filter(Boolean));
  const top = $('#deck .top');
  if (top) bindDrag(top);
  if (third && isFood(third) && !noImg.has(third)) new Image().src = imgSrc(third); // vorladen
  $('#swipe-progress').textContent = `${Math.min(sessionTotal - queue.length + 1, sessionTotal)} / ${sessionTotal}`;
  $('#swipe-label').textContent = newCardsMode ? t('new_cards') : S.swipeRound > 1 ? t('round_n', { n: S.swipeRound }) : '';
  $('#btn-undo').disabled = !history.length;
}

function tilt(card, dx, dy) {
  card.style.transform = dx || dy ? `translate(${dx}px, ${dy * 0.25}px) rotate(${dx * 0.05}deg)` : '';
  card.querySelector('.stamp.yes').style.opacity = String(Math.max(0, Math.min(1, dx / 90)));
  card.querySelector('.stamp.no').style.opacity = String(Math.max(0, Math.min(1, -dx / 90)));
}

function bindDrag(card) {
  let drag = null;
  card.addEventListener('pointerdown', (e) => {
    if (busy || e.button > 0) return;
    card.setPointerCapture(e.pointerId);
    card.classList.remove('back');
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY, time: performance.now(), dx: 0 };
  });
  card.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    drag.dx = e.clientX - drag.x;
    tilt(card, drag.dx, e.clientY - drag.y);
  });
  const end = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const { dx, time } = drag;
    drag = null;
    const speed = Math.abs(dx) / Math.max(performance.now() - time, 1);
    if (Math.abs(dx) > 90 || (Math.abs(dx) > 30 && speed > 0.6)) decide(dx > 0);
    else { card.classList.add('back'); tilt(card, 0, 0); }
  };
  card.addEventListener('pointerup', end);
  card.addEventListener('pointercancel', end);
}

function decide(yes) {
  if (busy || !queue.length) return;
  busy = true;
  const key = queue[0];
  decisions[key] = yes;
  history.push(key);
  saveLocal();
  navigator.vibrate?.(10);
  const next = () => {
    queue.shift();
    busy = false;
    if (queue.length) renderDeck();
    else showSummary();
  };
  const card = $('#deck .top');
  if (!card || reducedMotion()) return next();
  card.classList.remove('back');
  card.classList.add('fly');
  tilt(card, (yes ? 1 : -1) * (window.innerWidth + 200), 60);
  setTimeout(next, 280);
}

function undo() {
  if (busy || !history.length) return;
  const key = history.pop();
  delete decisions[key];
  saveLocal();
  queue.unshift(key);
  renderDeck();
  show('v-swipe');
}

$('#btn-yes').addEventListener('click', () => decide(true));
$('#btn-no').addEventListener('click', () => decide(false));
$('#btn-undo').addEventListener('click', undo);
$('#summary-undo').addEventListener('click', undo);
document.addEventListener('keydown', (e) => {
  if (view !== 'v-swipe' || e.target.closest('input, textarea, select')) return;
  if (e.key === 'ArrowRight') decide(true);
  else if (e.key === 'ArrowLeft') decide(false);
  else if (e.key === 'Backspace') undo();
  else return;
  e.preventDefault();
});

// ---------- Zusammenfassung ----------
function showSummary() {
  renderSummary();
  $('#note').value = S.me.note || '';
  $('#summary-error').textContent = '';
  show('v-summary');
}

function renderSummary() {
  const server = S.me.swipes || {};
  const yes = S.deck.filter((k) => (Object.hasOwn(decisions, k) ? decisions[k] : server[k] === 1));
  $('#yes-chips').replaceChildren(...(yes.length
    ? yes.map((k) => h('span', { class: 'chip accent' }, `${emoji(k)} ${label(k)}`))
    : [h('span', { class: 'muted', text: t('summary_none') })]));
  $('#summary-undo').disabled = !history.length;
}

$('#idea-form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const input = $('#idea-input');
  const value = input.value.replace(/\s+/g, ' ').trim();
  const err = $('#summary-error');
  err.textContent = '';
  if (!value) return;
  if (S.deck.some((k) => label(k).toLowerCase() === value.toLowerCase())) {
    err.textContent = t('err_duplicate');
    return;
  }
  try {
    S = await api('POST', `${base}/ideas`, { label: value });
    input.value = '';
    renderSummary();
  } catch (e) {
    if (e.status === 401) return showJoin();
    if (e.code === 'wrong_phase' || e.code === 'excluded') return load();
    err.textContent = errMsg(e);
  }
});

$('#submit-swipes').addEventListener('click', async (ev) => {
  const btn = ev.currentTarget;
  btn.disabled = true;
  $('#summary-error').textContent = '';
  const key = localKey();
  try {
    const swipes = Object.fromEntries(Object.entries(decisions).filter(([k]) => S.deck.includes(k)));
    S = await api('PUT', `${base}/swipes`, { swipes, note: $('#note').value });
    store.remove(key);
    decisions = {};
    history = [];
    route(true);
  } catch (e) {
    if (e.status === 401) return showJoin();
    if (e.code === 'wrong_phase' || e.code === 'excluded') return load();
    $('#summary-error').textContent = errMsg(e);
  } finally {
    btn.disabled = false;
  }
});

// ---------- Warten ----------
function showWait() {
  if (view !== 'v-wait') waitSince = Date.now();
  renderWait();
  show('v-wait');
}

function renderWait() {
  const active = S.people.filter((p) => p.active);
  const missing = Math.max(0, S.size - active.length);
  $('#wait-text').textContent = t(S.phase === 'rank' ? 'wait_rank' : 'wait_swipe');
  $('#wait-excluded').hidden = S.me.active;
  $('#people').replaceChildren(
    ...active.map((p) => h('li', {},
      h('span', { text: p.me ? `${p.name} (${t('you')})` : p.name }),
      h('span', { class: `status${p.done ? ' done' : ''}`, text: p.done ? `✅ ${t('st_done')}` : `⏳ ${t('st_busy')}` }))),
    missing ? h('li', { class: 'muted' }, h('span', { text: t('st_missing', { n: missing }) }), h('span', { text: '👻' })) : null,
  );
  const waitingFor = active.filter((p) => !p.done).map((p) => p.name);
  if (missing) waitingFor.push(`+${missing}`);
  const doneCount = active.filter((p) => p.done).length;
  const skipBtn = $('#skip');
  skipBtn.hidden = !(S.me.active && doneCount >= 2 && waitingFor.length && Date.now() - waitSince > SKIP_AFTER_MS);
  skipBtn.dataset.names = waitingFor.join(', ');
}

$('#skip').addEventListener('click', async (ev) => {
  if (!confirm(t('skip_confirm', { names: ev.currentTarget.dataset.names }))) return;
  try {
    S = await api('POST', `${base}/skip`);
    route(true);
  } catch (e) {
    if (e.status === 401) return showJoin();
    alert(errMsg(e));
  }
});

// ---------- Kein Match ----------
function showNoMatch() {
  const prev = S.prev;
  const close = prev
    ? Object.entries(prev.tally).filter(([k, n]) => n > 0 && S.deck.includes(k)).sort((a, b) => b[1] - a[1]).slice(0, 3)
    : [];
  $('#close-wrap').hidden = !close.length;
  $('#close-chips').replaceChildren(...close.map(([k, n]) => h('span', { class: 'chip' }, `${emoji(k)} ${label(k)} · ${n}/${prev.voters}`)));
  show('v-nomatch');
}

$('#again').addEventListener('click', () => {
  store.set(`ff_nm_${token}`, String(S.swipeRound));
  route(true);
});

// ---------- Endrunde ----------
function startRank() {
  order = S.me.ranking ? [...S.me.ranking] : [...S.shortlist];
  veto = S.me.veto ?? null;
  $('#rank-error').textContent = '';
  renderRank(null, true);
  show('v-rank');
}

function thumb(key) {
  const wrap = h('span', { class: 'thumb', 'aria-hidden': 'true' });
  if (isFood(key) && !noImg.has(key)) {
    const img = h('img', { src: imgSrc(key), alt: '' });
    img.addEventListener('error', () => { noImg.add(key); img.replaceWith(emoji(key)); });
    wrap.append(img);
  } else {
    wrap.textContent = emoji(key);
  }
  return wrap;
}

// animate: nur beim ersten Erscheinen „aufploppen“, nicht bei jedem Veto/Verschieben
function renderRank(focusIndex, animate = false) {
  const ol = $('#rank-list');
  ol.classList.toggle('reveal', animate);
  ol.replaceChildren(...order.map((key, i) => {
    const vetoed = veto === key;
    const li = h('li', { class: `rank-item${vetoed ? ' vetoed' : ''}` },
      h('span', { class: 'pos', text: String(i + 1) }),
      thumb(key),
      h('span', { class: 'label', text: label(key) }),
      h('button', {
        type: 'button',
        class: `veto-btn${vetoed ? ' on' : ''}`,
        'aria-pressed': String(vetoed),
        text: `🙅 ${t('veto')}`,
        onclick: () => { veto = vetoed ? null : key; renderRank(); },
      }),
      h('button', {
        type: 'button',
        class: 'handle',
        text: '≡',
        'aria-label': `${t('drag')}: ${label(key)}`,
        onkeydown: (e) => moveByKey(e, key),
      }),
    );
    li.dataset.key = key;
    li.style.animationDelay = `${i * 80}ms`;
    return li;
  }));
  if (focusIndex != null) ol.children[focusIndex]?.querySelector('.handle').focus();
}

function moveByKey(e, key) {
  if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
  const i = order.indexOf(key);
  const j = e.key === 'ArrowUp' ? i - 1 : i + 1;
  if (j < 0 || j >= order.length) return;
  e.preventDefault();
  [order[i], order[j]] = [order[j], order[i]];
  renderRank(j);
}

// Sortieren per Ziehen am ≡ (Maus und Touch)
(() => {
  const ol = $('#rank-list');
  let drag = null;
  ol.addEventListener('pointerdown', (e) => {
    const handle = e.target.closest('.handle');
    if (!handle || e.button > 0) return;
    e.preventDefault();
    handle.setPointerCapture(e.pointerId);
    const li = handle.closest('li');
    drag = { li, id: e.pointerId, startY: e.clientY + window.scrollY };
    li.classList.add('dragging');
  });
  ol.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const { li } = drag;
    const y = e.clientY + window.scrollY;
    // Tauschen, sobald die Mitte des gezogenen Elements die Mitte des Nachbarn überschreitet
    for (let guard = 0; guard < ol.children.length; guard++) {
      const center = li.offsetTop + (y - drag.startY) + li.offsetHeight / 2;
      const prev = li.previousElementSibling;
      const next = li.nextElementSibling;
      const before = li.offsetTop;
      if (next && center > next.offsetTop + next.offsetHeight / 2) ol.insertBefore(next, li);
      else if (prev && center < prev.offsetTop + prev.offsetHeight / 2) ol.insertBefore(li, prev);
      else break;
      drag.startY += li.offsetTop - before;
    }
    li.style.transform = `translateY(${y - drag.startY}px)`;
    [...ol.children].forEach((el, i) => { el.querySelector('.pos').textContent = String(i + 1); });
  });
  const end = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    drag.li.style.transform = '';
    drag.li.classList.remove('dragging');
    drag = null;
    order = [...ol.children].map((li) => li.dataset.key);
    renderRank();
  };
  ol.addEventListener('pointerup', end);
  ol.addEventListener('pointercancel', end);
})();

$('#submit-rank').addEventListener('click', async (ev) => {
  const btn = ev.currentTarget;
  btn.disabled = true;
  $('#rank-error').textContent = '';
  try {
    S = await api('PUT', `${base}/ranking`, { ranking: order, veto });
    route(true);
  } catch (e) {
    if (e.status === 401) return showJoin();
    if (e.code === 'wrong_phase' || e.code === 'excluded') return load();
    $('#rank-error').textContent = errMsg(e);
  } finally {
    btn.disabled = false;
  }
});

// ---------- Ergebnis ----------
function showResult() {
  renderResult();
  show('v-result');
  if (!confettiDone) {
    confettiDone = true;
    confetti(emoji(S.result.order[0].key));
  }
}

function renderWinner(key) {
  const box = $('#winner');
  const hasImg = isFood(key) && !noImg.has(key);
  box.className = `result-card${hasImg ? '' : ' noimg'}${isFood(key) ? '' : ' idea'}`;
  const nodes = [];
  if (hasImg) {
    const img = h('img', { src: imgSrc(key), alt: '' });
    img.addEventListener('error', () => { noImg.add(key); img.remove(); box.classList.add('noimg'); });
    nodes.push(img);
  }
  nodes.push(
    h('div', { class: 'card-emoji', text: emoji(key), 'aria-hidden': 'true' }),
    h('div', { class: 'card-meta' }, h('div', { class: 'card-name', text: label(key) })),
  );
  box.replaceChildren(...nodes);
}

function renderResult() {
  const r = S.result;
  const [win, ...rest] = r.order;
  renderWinner(win.key);
  $('#result-note').textContent = r.perfect ? t('perfect') : r.tie ? t('tie') : '';
  // Plan B/C nur aus dem, was kein Veto hat (Vetos stehen in den Details)
  $('#plans').replaceChildren(...rest.filter((o) => !o.vetoes.length).slice(0, 2).map((o, i) => h('li', {},
    thumb(o.key),
    h('span', { class: 'grow' }, h('strong', { text: `${t('plan', { x: 'BC'[i] })}: ` }), label(o.key)),
  )));

  $('#details').replaceChildren(...r.order.map((o) => h('li', {},
    h('strong', { text: `${emoji(o.key)} ${label(o.key)}` }),
    h('div', {
      class: 'muted small',
      text: [
        o.positions.map((p) => `${p.name}: ${p.pos}`).join(' · '),
        o.vetoes.length ? t('vetoed_by', { names: o.vetoes.join(', ') }) : '',
      ].filter(Boolean).join(' — '),
    }),
  )));
  $('#notes-wrap').hidden = !S.notes.length;
  $('#notes').replaceChildren(...S.notes.map((n) => h('li', {}, h('strong', { text: `${n.name}: ` }), n.note)));

  if (document.activeElement !== $('#place')) $('#place').value = store.get('ff_place') || '';
  $('#md').textContent = buildPrompt();
}

function buildPrompt() {
  const r = S.result;
  const n = S.people.filter((p) => p.active).length;
  const place = $('#place').value.trim() || t('md_place_missing');
  const now = new Intl.DateTimeFormat(lang, { weekday: 'long', hour: '2-digit', minute: '2-digit' }).format(new Date());
  const first = label(r.order[0].key);
  const others = r.order.slice(1).filter((o) => !o.vetoes.length).map((o) => label(o.key));
  const oneLine = (s) => s.replace(/\s*\n\s*/g, ' ');

  const L = [`# ${t('app_name')}${S.title ? `: ${S.title}` : ''}`, '', t('md_intro', { n, place }), '', `## ${t('md_result')}`, ''];
  r.order.forEach((o, i) => {
    let line = `${i + 1}. ${label(o.key)}`;
    if (i === 0) line += ` (${t('md_winner')})`;
    if (o.vetoes.length) line += ` – ${t('md_vetoed', { names: o.vetoes.join(', ') })}`;
    L.push(line);
  });
  if (S.notes.length) {
    L.push('', `## ${t('md_notes')}`, '', ...S.notes.map((x) => `- ${x.name}: ${oneLine(x.note)}`));
  }
  L.push(
    '', `## ${t('md_task')}`, '',
    `1. ${t('md_order', { place, now, first, others: others.length ? others.join(', ') : t('md_similar') })}`,
    `2. ${t('md_cook', { first, n })}`,
    '',
  );
  return L.join('\n');
}

$('#place').addEventListener('input', () => {
  store.set('ff_place', $('#place').value.trim());
  $('#md').textContent = buildPrompt();
});

$('#copy-prompt').addEventListener('click', (e) => copyText(buildPrompt(), e.currentTarget));

$('#dl-md').addEventListener('click', () => {
  const url = URL.createObjectURL(new Blob([buildPrompt()], { type: 'text/markdown;charset=utf-8' }));
  const a = h('a', { href: url, download: 'foodfinder.md' });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

function confetti(winnerEmoji) {
  if (reducedMotion()) return;
  for (let i = 0; i < 70; i++) {
    const isEmoji = i % 6 === 0;
    const el = h('span', { class: `confetti${isEmoji ? ' emoji' : ''}`, 'aria-hidden': 'true', text: isEmoji ? winnerEmoji : '' });
    el.style.setProperty('--x', `${Math.random() * 100}vw`);
    el.style.setProperty('--dx', `${(Math.random() - 0.5) * 30}vw`);
    el.style.setProperty('--r', `${(Math.random() - 0.5) * 1080}deg`);
    el.style.setProperty('--d', `${2.2 + Math.random() * 1.8}s`);
    el.style.setProperty('--delay', `${Math.random() * 0.6}s`);
    el.style.setProperty('--c', i % 2 ? 'var(--accent)' : 'var(--fg)');
    document.body.append(el);
    setTimeout(() => el.remove(), 5000);
  }
}

// ---------- Sprache ----------
document.addEventListener('langchange', () => {
  if (view === 'v-swipe') renderDeck();
  if (view === 'v-summary') renderSummary();
  if (view === 'v-wait') renderWait();
  if (view === 'v-nomatch') showNoMatch();
  if (view === 'v-rank') renderRank();
  if (view === 'v-result') renderResult();
  if (view === 'v-error') $('#error-text').textContent = errMsg(lastError);
});

load();
