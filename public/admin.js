'use strict';

let rounds = [];
let created = null;      // zuletzt erstellte Runde { token, pin }
const newPins = {};      // id → neu erzeugte PIN (nur in dieser Sitzung sichtbar)

function show(id) {
  for (const s of document.querySelectorAll('main > section, #v-loading')) s.hidden = s.id !== id;
}

const roundLink = (tok) => `${location.origin}/r/${tok}`;
const fmtDate = (ts) => new Intl.DateTimeFormat(lang, { dateStyle: 'medium' }).format(ts);

async function load() {
  try {
    rounds = (await api('GET', '/api/admin/rounds')).rounds;
  } catch (e) {
    if (e.status === 401) return show('v-login');
    $('#login-error').textContent = errMsg(e);
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

$('#create-form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const btn = ev.submitter;
  btn.disabled = true;
  $('#create-error').textContent = '';
  try {
    created = await api('POST', '/api/admin/rounds', { title: $('#round-title').value });
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
  $('#c-wa').href = `https://wa.me/?text=${encodeURIComponent(t('wa_text', { link }))}`;
  $('#created').hidden = false;
}

$('#c-copy-link').addEventListener('click', (e) => copyText(roundLink(created.token), e.currentTarget));
$('#c-copy-pin').addEventListener('click', (e) => copyText(created.pin, e.currentTarget));

function renderRounds() {
  const ul = $('#rounds');
  if (!rounds.length) {
    ul.replaceChildren(h('li', { class: 'muted', text: t('no_rounds') }));
    return;
  }
  ul.replaceChildren(...rounds.map((r) => {
    const title = r.title || t('app_name');
    const copyBtn = h('button', { type: 'button', 'data-i18n': 'copy_link', text: t('copy_link') });
    copyBtn.addEventListener('click', () => copyText(roundLink(r.token), copyBtn));
    return h('li', {},
      h('strong', { text: title }),
      h('p', { class: 'muted small', text: [
        fmtDate(r.created_at),
        t('votes', { voted: r.voted, total: r.total }),
        t('expires', { date: fmtDate(r.expires_at) }),
      ].join(' · ') }),
      newPins[r.id] ? h('p', { class: 'pin-out', text: t('new_pin_done', { pin: newPins[r.id] }) }) : null,
      h('div', { class: 'row' },
        h('a', { class: 'btn', href: roundLink(r.token), target: '_blank', rel: 'noopener noreferrer', text: '↗' }),
        copyBtn,
        h('button', { type: 'button', text: t('new_pin'), onclick: () => resetPin(r) }),
        h('button', { type: 'button', text: t('delete'), onclick: () => removeRound(r, title) }),
      ),
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
