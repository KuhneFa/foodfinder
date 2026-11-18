'use strict';

let rounds = [];
let created = null;      // zuletzt erstellte Runde { id, token, pin }
let size = 3;
const newPins = {};      // id → neu erzeugte PIN (nur in dieser Sitzung sichtbar)

function show(id) {
  for (const s of document.querySelectorAll('main > section, #v-loading')) s.hidden = s.id !== id;
}

const roundLink = (tok) => `${location.origin}/r/${tok}`;
const fmtDate = (ts) => new Intl.DateTimeFormat(lang, { dateStyle: 'medium' }).format(ts);

function winnerText(w) {
  if (!w) return '';
  const f = food(w.key);
  return f ? `${f.e} ${t(`food_${w.key}`)}` : `💡 ${w.label}`;
}
function phaseText(r) {
  if (r.phase === 'done') return t('ph_done', { winner: winnerText(r.winner) });
  return t(r.phase === 'rank' ? 'ph_rank' : 'ph_swipe', { done: r.done, size: r.size });
}

async function load() {
  try {
    rounds = (await api('GET', '/api/admin/rounds')).rounds;
  } catch (e) {
    if (e.status !== 401) $('#login-error').textContent = errMsg(e);
    return show('v-login');
  }
  renderRounds();
  show('v-admin');
}

$('#login-form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const btn = ev.submitter;
  btn.disabled = true;
  $('#login-error').textContent = '';
  try {
    await api('POST', '/api/admin/login', { password: $('#password').value });
    $('#password').value = '';
    await load();
  } catch (e) {
    $('#login-error').textContent = errMsg(e);
  } finally {
    btn.disabled = false;
  }
});

$('#logout').addEventListener('click', async () => {
  await api('POST', '/api/admin/logout').catch(() => {});
  created = null;
  $('#created').hidden = true;
  show('v-login');
});

// ---------- Neue Runde ----------
function renderSize() {
  $('#size').textContent = String(size);
  $('#size-minus').disabled = size <= 2;
  $('#size-plus').disabled = size >= 10;
}
$('#size-minus').addEventListener('click', () => { size = Math.max(2, size - 1); renderSize(); });
$('#size-plus').addEventListener('click', () => { size = Math.min(10, size + 1); renderSize(); });
renderSize();

$('#create-form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const btn = ev.submitter;
  btn.disabled = true;
  $('#create-error').textContent = '';
  try {
    created = await api('POST', '/api/admin/rounds', { title: $('#round-title').value, size });
    $('#round-title').value = '';
    renderCreated();
    await load();
    $('#created').scrollIntoView({ behavior: 'smooth', block: 'center' });
  } catch (e) {
    if (e.status === 401) return show('v-login');
    $('#create-error').textContent = errMsg(e);
  } finally {
    btn.disabled = false;
  }
});

function renderCreated() {
  if (!created) return;
  const link = roundLink(created.token);
  $('#c-link').textContent = link;
  $('#c-pin').textContent = created.pin;
  $('#c-join').href = link;
  $('#c-share-hint').hidden = true;
  $('#created').hidden = false;
}

$('#c-share').addEventListener('click', () => {
  shareMessage(t('share_text', { link: roundLink(created.token) }), $('#c-share-hint'));
});
$('#c-copy-link').addEventListener('click', (e) => copyText(roundLink(created.token), e.currentTarget));
$('#c-copy-pin').addEventListener('click', (e) => copyText(created.pin, e.currentTarget));

// ---------- Runden ----------
function renderRounds() {
  const ul = $('#rounds');
  if (!rounds.length) {
    ul.replaceChildren(h('li', { class: 'muted', text: t('no_rounds') }));
    return;
  }
  ul.replaceChildren(...rounds.map((r) => {
    const title = r.title || t('app_name');
    const hint = h('p', { class: 'muted small', role: 'status', hidden: true });
    return h('li', {},
      h('strong', { text: title }),
      h('p', { class: 'small', text: phaseText(r) }),
      h('p', { class: 'muted small', text: `${fmtDate(r.created_at)} · ${t('expires', { date: fmtDate(r.expires_at) })}` }),
      newPins[r.id] ? h('p', { class: 'pin-out', text: t('new_pin_done', { pin: newPins[r.id] }) }) : null,
      h('div', { class: 'row' },
        h('a', { class: 'btn', href: roundLink(r.token), target: '_blank', rel: 'noopener', text: '↗' }),
        h('button', { type: 'button', text: t('share'), onclick: () => shareMessage(t('share_text', { link: roundLink(r.token) }), hint) }),
        h('button', { type: 'button', text: t('new_pin'), onclick: () => resetPin(r) }),
        h('button', { type: 'button', text: t('delete'), onclick: () => removeRound(r, title) }),
      ),
      hint,
    );
  }));
}

async function resetPin(r) {
  if (!confirm(t('confirm_new_pin'))) return;
  try {
    newPins[r.id] = (await api('POST', `/api/admin/rounds/${r.id}/pin`)).pin;
    renderRounds();
  } catch (e) {
    if (e.status === 401) return show('v-login');
    alert(errMsg(e));
  }
}

async function removeRound(r, title) {
  if (!confirm(t('confirm_delete', { title }))) return;
  try {
    await api('DELETE', `/api/admin/rounds/${r.id}`);
    if (created && created.id === r.id) { created = null; $('#created').hidden = true; }
    await load();
  } catch (e) {
    if (e.status === 401) return show('v-login');
    alert(errMsg(e));
  }
}

document.addEventListener('langchange', () => { renderRounds(); renderCreated(); });

load();
