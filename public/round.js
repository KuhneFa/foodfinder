'use strict';

const MAX_CUSTOM = 5;
const token = location.pathname.split('/')[2];
const base = `/api/r/${token}`;

let state = null;    // { title, me: { name, ranking, note } }
let items = [];      // aktuelle Rangliste: [{ k }] oder [{ c }]
let results = null;  // { title, participants: [...] }
let view = null;
let lastError = null;

function show(id) {
  view = id;
  for (const s of document.querySelectorAll('main > section, #v-loading')) s.hidden = s.id !== id;
  window.scrollTo(0, 0);
}

function showError(e) {
  lastError = e;
  $('#error-text').textContent = errMsg(e);
  show('v-error');
}

function setTitle(title) {
  for (const n of document.querySelectorAll('.round-title')) n.textContent = title || '';
  document.title = title ? `${title} · Foodfinder` : 'Foodfinder';
}

async function load() {
  try {
    state = await api('GET', `${base}/state`);
  } catch (e) {
    if (e.status === 401) return show('v-join');
    return showError(e);
  }
  setTitle(state.title);
  if (state.me.ranking) await loadResults();
  else startRanking();
}

// ---------- Beitreten ----------
$('#join-form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const btn = ev.submitter;
  btn.disabled = true;
  $('#join-error').textContent = '';
  try {
    await api('POST', `${base}/join`, { pin: $('#pin').value.trim(), name: $('#name').value.trim() });
    await load();
  } catch (e) {
    if (e.code === 'not_found') return showError(e);
    $('#join-error').textContent = errMsg(e);
  } finally {
    btn.disabled = false;
  }
});

// ---------- Rangliste ----------
function startRanking() {
  items = state.me.ranking ? state.me.ranking.map((it) => ({ ...it })) : FOODS.map((f) => ({ k: f.k }));
  $('#note').value = state.me.note || '';
  $('#rank-error').textContent = '';
  renderRank();
  show('v-rank');
}

function renderRank(focusIndex) {
  const ol = $('#rank-list');
  ol.replaceChildren(...items.map((it, i) => {
    const li = h('li', { class: 'rank-item' },
      h('span', { class: 'pos', text: String(i + 1) }),
      h('span', { class: 'emoji', text: foodEmoji(it), 'aria-hidden': 'true' }),
      h('span', { class: 'label', text: foodLabel(it) }),
      it.c ? h('button', { type: 'button', class: 'remove', text: '✕', 'aria-label': t('remove'), title: t('remove'),
        onclick: () => { items.splice(items.indexOf(it), 1); renderRank(); } }) : null,
      h('button', { type: 'button', class: 'handle', text: '≡', 'aria-label': `${t('drag')}: ${foodLabel(it)}`,
        onkeydown: (e) => moveByKey(e, it) }),
    );
    li._item = it;
    return li;
  }));
  if (focusIndex != null) ol.children[focusIndex]?.querySelector('.handle').focus();
}

function renumber() {
  [...$('#rank-list').children].forEach((li, i) => { li.querySelector('.pos').textContent = String(i + 1); });
}

function moveByKey(e, it) {
  const i = items.indexOf(it);
  const j = e.key === 'ArrowUp' ? i - 1 : e.key === 'ArrowDown' ? i + 1 : -1;
  if (j < 0 || j >= items.length || !['ArrowUp', 'ArrowDown'].includes(e.key)) return;
  e.preventDefault();
  [items[i], items[j]] = [items[j], items[i]];
  renderRank(j);
}

// Drag & Drop per Pointer-Events (funktioniert mit Maus und Touch)
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
    // Tauschen, sobald die Mitte des gezogenen Elements die Mitte des Nachbarn überschreitet.
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
    renumber();
    if (e.clientY < 60) window.scrollBy(0, -12);
    else if (e.clientY > window.innerHeight - 60) window.scrollBy(0, 12);
  });

  const end = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    drag.li.style.transform = '';
    drag.li.classList.remove('dragging');
    drag = null;
    items = [...ol.children].map((li) => li._item);
    renumber();
  };
  ol.addEventListener('pointerup', end);
  ol.addEventListener('pointercancel', end);
})();

$('#custom-form').addEventListener('submit', (ev) => {
  ev.preventDefault();
  const input = $('#custom-input');
  const value = input.value.replace(/\s+/g, ' ').trim();
  const err = $('#rank-error');
  err.textContent = '';
  if (!value) return;
  if (items.filter((it) => it.c).length >= MAX_CUSTOM) { err.textContent = t('err_custom_limit'); return; }
  const lower = value.toLowerCase();
  if (items.some((it) => foodLabel(it).toLowerCase() === lower || (it.c || '').toLowerCase() === lower)) {
    err.textContent = t('err_duplicate');
    return;
  }
  items.push({ c: value });
  input.value = '';
  renderRank();
});

$('#submit-vote').addEventListener('click', async (ev) => {
  const btn = ev.currentTarget;
  btn.disabled = true;
  $('#rank-error').textContent = '';
  try {
    const note = $('#note').value;
    await api('PUT', `${base}/vote`, { ranking: items, note });
    state.me.ranking = items.map((it) => ({ ...it }));
    state.me.note = note.trim();
    await loadResults();
  } catch (e) {
    if (e.status === 401) return load();
    $('#rank-error').textContent = errMsg(e);
  } finally {
    btn.disabled = false;
  }
});

// ---------- Auswertung ----------
async function loadResults() {
  try {
    results = await api('GET', `${base}/results`);
  } catch (e) {
    if (e.code === 'vote_first') return startRanking();
    if (e.status === 401) return show('v-join');
    return showError(e);
  }
  setTitle(results.title);
  renderResults();
  show('v-results');
}

const pct = (x) => Math.round(x * 100);

// Platz i (0-basiert) in einer Liste der Länge n → Wert zwischen 1 (Platz 1) und 0 (letzter Platz).
function aggregate(voters) {
  const rows = FOODS.map((f) => {
    const per = voters.map((v) => {
      const i = v.ranking.findIndex((it) => it.k === f.k);
      const n = v.ranking.length;
      return { name: v.name, pos: i + 1, score: n > 1 ? 1 - i / (n - 1) : 1 };
    });
    const scores = per.map((p) => p.score);
    const avg = scores.reduce((a, b) => a + b, 0) / (scores.length || 1);
    const min = scores.length ? Math.min(...scores) : 0;
    return { item: { k: f.k }, per, avg, min, all: voters.length > 1 && min >= 0.5 };
  }).sort((a, b) => b.avg - a.avg || b.min - a.min);

  const customs = new Map();
  for (const v of voters) {
    v.ranking.forEach((it, i) => {
      if (!it.c) return;
      const key = it.c.toLowerCase();
      if (!customs.has(key)) customs.set(key, { item: it, by: [] });
      customs.get(key).by.push({ name: v.name, pos: i + 1 });
    });
  }
  return { rows, customs: [...customs.values()].sort((a, b) => b.by.length - a.by.length) };
}

function renderResults() {
  const voters = results.participants.filter((p) => p.ranking);
  const pending = results.participants.filter((p) => !p.ranking);
  const agg = aggregate(voters);

  let status = t('results_voted', { n: voters.length, total: results.participants.length });
  if (pending.length) status += ` ${t('pending', { names: pending.map((p) => p.name).join(', ') })}`;
  $('#res-status').textContent = status;

  $('#res-list').replaceChildren(...agg.rows.map((r, i) => {
    const bar = h('span');
    bar.style.width = `${pct(r.avg)}%`;
    return h('li', { class: `res-item${i === 0 ? ' first' : ''}` },
      h('div', { class: 'res-main' },
        h('span', { class: 'emoji', text: foodEmoji(r.item), 'aria-hidden': 'true' }),
        h('span', { class: 'label', text: foodLabel(r.item) }),
        i === 0 ? h('span', { class: 'badge solid', text: t('match') }) : null,
        r.all ? h('span', { class: 'badge', text: `👍 ${t('all_like')}` }) : null,
        h('span', { class: 'score', text: `${pct(r.avg)} %` }),
      ),
      h('div', { class: 'bar' }, bar),
      h('div', { class: 'per', text: r.per.map((p) => `${p.name}: ${p.pos}`).join(' · ') }),
    );
  }));

  $('#res-custom-wrap').hidden = !agg.customs.length;
  $('#res-custom').replaceChildren(...agg.customs.map((c) => h('li', {},
    `${foodEmoji(c.item)} `, h('strong', { text: c.item.c }),
    h('span', { class: 'muted', text: ` · ${c.by.map((b) => `${b.name} (${t('place', { n: b.pos })})`).join(', ')}` }),
  )));

  const withNotes = voters.filter((v) => v.note);
  $('#res-notes-wrap').hidden = !withNotes.length;
  $('#res-notes').replaceChildren(...withNotes.map((v) => h('li', {}, h('strong', { text: `${v.name}: ` }), v.note)));

  $('#md').textContent = buildMarkdown(results.title, voters, agg);
}

function buildMarkdown(title, voters, agg) {
  const md = (s) => s.replace(/\s*\n\s*/g, ' ');
  const L = [`# ${t('app_name')}${title ? `: ${title}` : ''}`, '', t('md_intro', { n: voters.length }), ''];

  L.push(`## ${t('md_group')}`, '');
  agg.rows.forEach((r, i) => {
    const per = r.per.map((p) => `${p.name}: ${t('place', { n: p.pos })}`).join(', ');
    L.push(`${i + 1}. ${foodLabel(r.item)} (${t('md_avg', { p: pct(r.avg) })}; ${per})`);
  });

  L.push('', `## ${t('md_individual')}`, '');
  for (const v of voters) {
    L.push(`### ${v.name}`, '');
    v.ranking.forEach((it, i) => L.push(`${i + 1}. ${foodLabel(it)}${it.c ? ` (${t('md_own')})` : ''}`));
    if (v.note) L.push('', `${t('md_note')}: ${md(v.note)}`);
    L.push('');
  }

  if (agg.customs.length) {
    L.push(`## ${t('md_custom')}`, '');
    for (const c of agg.customs) {
      L.push(`- ${c.item.c} (${c.by.map((b) => `${b.name}: ${t('place', { n: b.pos })}`).join(', ')})`);
    }
    L.push('');
  }

  L.push(`## ${t('md_task')}`, '', t('md_task_text'), '');
  return L.join('\n');
}

$('#copy-md').addEventListener('click', (e) => copyText($('#md').textContent, e.currentTarget));

$('#dl-md').addEventListener('click', () => {
  const blob = new Blob([$('#md').textContent], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: 'foodfinder.md' });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

$('#edit-vote').addEventListener('click', startRanking);
$('#refresh').addEventListener('click', loadResults);

document.addEventListener('langchange', () => {
  if (view === 'v-rank') renderRank();
  if (view === 'v-results') renderResults();
  if (view === 'v-error') $('#error-text').textContent = errMsg(lastError);
});

load();
