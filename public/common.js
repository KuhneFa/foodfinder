'use strict';

// ---------- Übersetzungen ----------
const I18N = {
  de: {
    app_name: 'Foodfinder',
    theme: 'Hell/Dunkel',
    loading: 'Lädt …',
    index_text: 'Findet gemeinsam heraus, worauf alle Lust haben. Zum Mitmachen brauchst du einen Einladungslink.',
    join_title: 'Mitmachen',
    join_text: 'Gib die PIN ein, die du bekommen hast, und deinen Namen.',
    pin: 'PIN',
    name: 'Dein Name',
    join_btn: "Los geht's",
    rank_title: 'Deine Rangliste',
    rank_hint: 'Zieh die Essen am ≡ in deine Reihenfolge. Oben = am liebsten.',
    custom_ph: 'Eigenes Essen …',
    add: 'Hinzufügen',
    remove: 'Entfernen',
    drag: 'Verschieben (Pfeiltasten)',
    note_label: 'Notiz (optional)',
    note_ph: 'z. B. Allergien, Abneigungen, worauf du Lust hast …',
    submit: 'Abschicken',
    results_voted: '{n} von {total} haben abgestimmt.',
    pending: 'Noch offen: {names}',
    group_ranking: 'Gemeinsame Rangliste',
    match: 'Euer Match',
    all_like: 'alle mögen’s',
    score_hint: 'Prozent = durchschnittliche Platzierung (100 % = bei allen auf Platz 1). „alle mögen’s“ = bei allen in der oberen Hälfte.',
    custom_ideas: 'Eigene Ideen',
    notes: 'Notizen',
    export_title: 'Vorschläge per KI',
    export_text: 'Kopier diesen Text in ein Sprachmodell (z. B. Claude oder ChatGPT). Du bekommst Vorschläge zum Selberkochen und zum Bestellen.',
    copy: 'Kopieren',
    copied: 'Kopiert ✓',
    download: '.md herunterladen',
    edit: 'Rangliste ändern',
    refresh: 'Aktualisieren',
    place: 'Platz {n}',
    md_intro: 'Wir sind {n} Personen und wollen uns auf ein Essen einigen. Jede Person hat die Essen nach Vorliebe sortiert (Platz 1 = am liebsten).',
    md_group: 'Gemeinsame Rangliste',
    md_avg: 'Ø {p} %',
    md_individual: 'Einzelne Ranglisten',
    md_own: 'eigene Idee',
    md_note: 'Notiz',
    md_custom: 'Eigene Ideen',
    md_task: 'Aufgabe',
    md_task_text: 'Schlag uns auf Basis dieser Vorlieben Essen vor, das möglichst allen schmeckt. Beachte die Notizen (z. B. Allergien oder Abneigungen). Gliedere die Antwort in zwei Kategorien:\n\n1. **Selber kochen**: 3–5 konkrete Gerichte, jeweils mit kurzer Begründung, ungefährem Zeitaufwand und Zutatenliste.\n2. **Bestellen**: 3–5 konkrete Vorschläge, was wir bestellen könnten (Küche und Gericht), jeweils mit kurzer Begründung.',
    admin_title: 'Verwaltung',
    password: 'Admin-Passwort',
    login: 'Anmelden',
    logout: 'Abmelden',
    new_round: 'Neue Runde',
    round_title: 'Titel (optional)',
    round_title_ph: 'z. B. Freitagabend',
    create: 'Runde erstellen',
    created_title: 'Runde erstellt',
    created_hint: 'Schick den Link in die Gruppe, die PIN am besten separat. Die PIN wird nur jetzt angezeigt.',
    link: 'Link',
    copy_link: 'Link kopieren',
    copy_pin: 'PIN kopieren',
    share_wa: 'Per WhatsApp teilen',
    wa_text: 'Worauf habt ihr Lust? Stimmt hier ab: {link}',
    rounds: 'Runden',
    no_rounds: 'Noch keine Runden.',
    votes: '{voted}/{total} abgestimmt',
    expires: 'bis {date}',
    new_pin: 'Neue PIN',
    new_pin_done: 'Neue PIN: {pin}',
    delete: 'Löschen',
    confirm_delete: 'Runde „{title}“ löschen? Alle Antworten gehen verloren.',
    confirm_new_pin: 'Neue PIN erzeugen? Die alte PIN funktioniert dann nicht mehr.',
    food_pizza: 'Pizza',
    food_doener: 'Döner',
    food_pasta: 'Pasta',
    food_burger: 'Burger',
    food_chinese: 'Chinesisch',
    err_server: 'Etwas ist schiefgelaufen. Bitte versuch es nochmal.',
    err_rate_limited: 'Zu viele Versuche. Bitte warte ein paar Minuten.',
    err_bad_pin: 'Die PIN stimmt nicht.',
    err_locked: 'Zu viele falsche Versuche. Diese Runde ist für 15 Minuten gesperrt.',
    err_name_taken: 'Dieser Name ist schon vergeben.',
    err_name_required: 'Bitte gib deinen Namen ein.',
    err_full: 'Diese Runde ist voll.',
    err_not_found: 'Dieser Link ist ungültig oder abgelaufen.',
    err_bad_password: 'Falsches Passwort.',
    err_custom_limit: 'Maximal 5 eigene Essen.',
    err_duplicate: 'Das steht schon auf der Liste.',
    err_invalid: 'Ungültige Eingabe.',
    err_too_long: 'Der Text ist zu lang.',
    err_too_many_rounds: 'Zu viele Runden. Bitte lösch alte Runden.',
  },
  en: {
    app_name: 'Foodfinder',
    theme: 'Light/Dark',
    loading: 'Loading…',
    index_text: 'Find out together what everyone feels like eating. You need an invite link to join.',
    join_title: 'Join',
    join_text: 'Enter the PIN you received and your name.',
    pin: 'PIN',
    name: 'Your name',
    join_btn: "Let's go",
    rank_title: 'Your ranking',
    rank_hint: 'Drag the dishes by ≡ into your order. Top = favourite.',
    custom_ph: 'Your own dish…',
    add: 'Add',
    remove: 'Remove',
    drag: 'Move (arrow keys)',
    note_label: 'Note (optional)',
    note_ph: 'e.g. allergies, dislikes, what you’re craving…',
    submit: 'Submit',
    results_voted: '{n} of {total} have voted.',
    pending: 'Still waiting for: {names}',
    group_ranking: 'Group ranking',
    match: 'Your match',
    all_like: 'everyone likes it',
    score_hint: 'Percentage = average placement (100 % = first place for everyone). “everyone likes it” = in everyone’s top half.',
    custom_ideas: 'Own ideas',
    notes: 'Notes',
    export_title: 'AI suggestions',
    export_text: 'Paste this text into a language model (e.g. Claude or ChatGPT) to get suggestions for cooking yourselves and for ordering in.',
    copy: 'Copy',
    copied: 'Copied ✓',
    download: 'Download .md',
    edit: 'Change ranking',
    refresh: 'Refresh',
    place: 'place {n}',
    md_intro: 'We are {n} people trying to agree on what to eat. Each person sorted the dishes by preference (place 1 = favourite).',
    md_group: 'Group ranking',
    md_avg: 'avg {p} %',
    md_individual: 'Individual rankings',
    md_own: 'own idea',
    md_note: 'Note',
    md_custom: 'Own ideas',
    md_task: 'Task',
    md_task_text: 'Based on these preferences, suggest food that as many of us as possible will enjoy. Take the notes into account (e.g. allergies or dislikes). Split your answer into two categories:\n\n1. **Cook ourselves**: 3–5 specific dishes, each with a short reason, rough prep time and an ingredient list.\n2. **Order in**: 3–5 specific suggestions for what we could order (cuisine and dish), each with a short reason.',
    admin_title: 'Admin',
    password: 'Admin password',
    login: 'Log in',
    logout: 'Log out',
    new_round: 'New round',
    round_title: 'Title (optional)',
    round_title_ph: 'e.g. Friday night',
    create: 'Create round',
    created_title: 'Round created',
    created_hint: 'Send the link to the group, ideally with the PIN separately. The PIN is only shown now.',
    link: 'Link',
    copy_link: 'Copy link',
    copy_pin: 'Copy PIN',
    share_wa: 'Share via WhatsApp',
    wa_text: 'What do you feel like eating? Vote here: {link}',
    rounds: 'Rounds',
    no_rounds: 'No rounds yet.',
    votes: '{voted}/{total} voted',
    expires: 'until {date}',
    new_pin: 'New PIN',
    new_pin_done: 'New PIN: {pin}',
    delete: 'Delete',
    confirm_delete: 'Delete round “{title}”? All answers will be lost.',
    confirm_new_pin: 'Generate a new PIN? The old PIN will stop working.',
    food_pizza: 'Pizza',
    food_doener: 'Döner kebab',
    food_pasta: 'Pasta',
    food_burger: 'Burger',
    food_chinese: 'Chinese',
    err_server: 'Something went wrong. Please try again.',
    err_rate_limited: 'Too many attempts. Please wait a few minutes.',
    err_bad_pin: 'The PIN is not correct.',
    err_locked: 'Too many wrong attempts. This round is locked for 15 minutes.',
    err_name_taken: 'This name is already taken.',
    err_name_required: 'Please enter your name.',
    err_full: 'This round is full.',
    err_not_found: 'This link is invalid or has expired.',
    err_bad_password: 'Wrong password.',
    err_custom_limit: 'At most 5 own dishes.',
    err_duplicate: 'That’s already on the list.',
    err_invalid: 'Invalid input.',
    err_too_long: 'The text is too long.',
    err_too_many_rounds: 'Too many rounds. Please delete old ones.',
  },
  es: {
    app_name: 'Foodfinder',
    theme: 'Claro/Oscuro',
    loading: 'Cargando…',
    index_text: 'Descubrid juntos qué os apetece a todos. Para participar necesitas un enlace de invitación.',
    join_title: 'Participar',
    join_text: 'Introduce el PIN que te han dado y tu nombre.',
    pin: 'PIN',
    name: 'Tu nombre',
    join_btn: '¡Vamos!',
    rank_title: 'Tu ranking',
    rank_hint: 'Arrastra las comidas desde ≡ para ordenarlas. Arriba = tu favorita.',
    custom_ph: 'Comida propia…',
    add: 'Añadir',
    remove: 'Quitar',
    drag: 'Mover (teclas de flecha)',
    note_label: 'Nota (opcional)',
    note_ph: 'p. ej. alergias, lo que no te gusta, lo que te apetece…',
    submit: 'Enviar',
    results_voted: '{n} de {total} han votado.',
    pending: 'Faltan: {names}',
    group_ranking: 'Ranking del grupo',
    match: 'Vuestro match',
    all_like: 'a todos les gusta',
    score_hint: 'Porcentaje = posición media (100 % = puesto 1 para todos). «a todos les gusta» = en la mitad superior de todos.',
    custom_ideas: 'Ideas propias',
    notes: 'Notas',
    export_title: 'Sugerencias con IA',
    export_text: 'Copia este texto en un modelo de lenguaje (p. ej. Claude o ChatGPT). Recibirás sugerencias para cocinar en casa y para pedir a domicilio.',
    copy: 'Copiar',
    copied: 'Copiado ✓',
    download: 'Descargar .md',
    edit: 'Cambiar ranking',
    refresh: 'Actualizar',
    place: 'puesto {n}',
    md_intro: 'Somos {n} personas y queremos ponernos de acuerdo sobre qué comer. Cada persona ha ordenado las comidas según sus preferencias (puesto 1 = la favorita).',
    md_group: 'Ranking del grupo',
    md_avg: 'Ø {p} %',
    md_individual: 'Rankings individuales',
    md_own: 'idea propia',
    md_note: 'Nota',
    md_custom: 'Ideas propias',
    md_task: 'Tarea',
    md_task_text: 'Basándote en estas preferencias, sugiérenos comida que guste al mayor número posible de nosotros. Ten en cuenta las notas (p. ej. alergias o cosas que no nos gustan). Divide la respuesta en dos categorías:\n\n1. **Cocinar en casa**: 3–5 platos concretos, cada uno con una breve justificación, el tiempo aproximado y la lista de ingredientes.\n2. **Pedir a domicilio**: 3–5 sugerencias concretas de qué podríamos pedir (cocina y plato), cada una con una breve justificación.',
    admin_title: 'Administración',
    password: 'Contraseña de administrador',
    login: 'Entrar',
    logout: 'Salir',
    new_round: 'Nueva ronda',
    round_title: 'Título (opcional)',
    round_title_ph: 'p. ej. Viernes por la noche',
    create: 'Crear ronda',
    created_title: 'Ronda creada',
    created_hint: 'Envía el enlace al grupo y, mejor, el PIN por separado. El PIN solo se muestra ahora.',
    link: 'Enlace',
    copy_link: 'Copiar enlace',
    copy_pin: 'Copiar PIN',
    share_wa: 'Compartir por WhatsApp',
    wa_text: '¿Qué os apetece? Votad aquí: {link}',
    rounds: 'Rondas',
    no_rounds: 'Todavía no hay rondas.',
    votes: '{voted}/{total} han votado',
    expires: 'hasta el {date}',
    new_pin: 'Nuevo PIN',
    new_pin_done: 'Nuevo PIN: {pin}',
    delete: 'Eliminar',
    confirm_delete: '¿Eliminar la ronda «{title}»? Se perderán todas las respuestas.',
    confirm_new_pin: '¿Generar un nuevo PIN? El PIN anterior dejará de funcionar.',
    food_pizza: 'Pizza',
    food_doener: 'Kebab',
    food_pasta: 'Pasta',
    food_burger: 'Hamburguesa',
    food_chinese: 'Comida china',
    err_server: 'Algo ha salido mal. Inténtalo de nuevo.',
    err_rate_limited: 'Demasiados intentos. Espera unos minutos.',
    err_bad_pin: 'El PIN no es correcto.',
    err_locked: 'Demasiados intentos fallidos. Esta ronda está bloqueada durante 15 minutos.',
    err_name_taken: 'Ese nombre ya está cogido.',
    err_name_required: 'Introduce tu nombre.',
    err_full: 'Esta ronda está completa.',
    err_not_found: 'Este enlace no es válido o ha caducado.',
    err_bad_password: 'Contraseña incorrecta.',
    err_custom_limit: 'Máximo 5 comidas propias.',
    err_duplicate: 'Eso ya está en la lista.',
    err_invalid: 'Entrada no válida.',
    err_too_long: 'El texto es demasiado largo.',
    err_too_many_rounds: 'Hay demasiadas rondas. Elimina las antiguas.',
  },
  ro: {
    app_name: 'Foodfinder',
    theme: 'Luminos/Întunecat',
    loading: 'Se încarcă…',
    index_text: 'Aflați împreună ce vă place tuturor. Ca să participi ai nevoie de un link de invitație.',
    join_title: 'Participă',
    join_text: 'Introdu PIN-ul primit și numele tău.',
    pin: 'PIN',
    name: 'Numele tău',
    join_btn: 'Hai!',
    rank_title: 'Clasamentul tău',
    rank_hint: 'Trage mâncărurile de ≡ în ordinea ta. Sus = preferata.',
    custom_ph: 'Mâncare proprie…',
    add: 'Adaugă',
    remove: 'Elimină',
    drag: 'Mută (tastele săgeți)',
    note_label: 'Notă (opțional)',
    note_ph: 'de ex. alergii, ce nu-ți place, ce poftă ai…',
    submit: 'Trimite',
    results_voted: '{n} din {total} au votat.',
    pending: 'Încă lipsesc: {names}',
    group_ranking: 'Clasamentul grupului',
    match: 'Potrivirea voastră',
    all_like: 'le place tuturor',
    score_hint: 'Procent = poziția medie (100 % = locul 1 la toți). „le place tuturor” = în jumătatea de sus la toți.',
    custom_ideas: 'Idei proprii',
    notes: 'Note',
    export_title: 'Sugestii cu AI',
    export_text: 'Copiază acest text într-un model de limbaj (de ex. Claude sau ChatGPT). Vei primi sugestii pentru gătit acasă și pentru comandat.',
    copy: 'Copiază',
    copied: 'Copiat ✓',
    download: 'Descarcă .md',
    edit: 'Modifică clasamentul',
    refresh: 'Actualizează',
    place: 'locul {n}',
    md_intro: 'Suntem {n} persoane și vrem să ne punem de acord ce să mâncăm. Fiecare persoană a ordonat mâncărurile după preferințe (locul 1 = preferata).',
    md_group: 'Clasamentul grupului',
    md_avg: 'Ø {p} %',
    md_individual: 'Clasamente individuale',
    md_own: 'idee proprie',
    md_note: 'Notă',
    md_custom: 'Idei proprii',
    md_task: 'Sarcină',
    md_task_text: 'Pe baza acestor preferințe, sugerează-ne mâncare care să le placă tuturor cât mai mult. Ține cont de note (de ex. alergii sau lucruri care nu ne plac). Împarte răspunsul în două categorii:\n\n1. **Gătit acasă**: 3–5 feluri de mâncare concrete, fiecare cu o scurtă justificare, timpul aproximativ și lista de ingrediente.\n2. **Comandat**: 3–5 sugestii concrete despre ce am putea comanda (bucătărie și fel de mâncare), fiecare cu o scurtă justificare.',
    admin_title: 'Administrare',
    password: 'Parola de administrator',
    login: 'Autentificare',
    logout: 'Deconectare',
    new_round: 'Rundă nouă',
    round_title: 'Titlu (opțional)',
    round_title_ph: 'de ex. Vineri seara',
    create: 'Creează runda',
    created_title: 'Rundă creată',
    created_hint: 'Trimite linkul în grup și, de preferat, PIN-ul separat. PIN-ul este afișat doar acum.',
    link: 'Link',
    copy_link: 'Copiază linkul',
    copy_pin: 'Copiază PIN-ul',
    share_wa: 'Distribuie pe WhatsApp',
    wa_text: 'Ce poftă aveți? Votați aici: {link}',
    rounds: 'Runde',
    no_rounds: 'Încă nu există runde.',
    votes: '{voted}/{total} au votat',
    expires: 'până la {date}',
    new_pin: 'PIN nou',
    new_pin_done: 'PIN nou: {pin}',
    delete: 'Șterge',
    confirm_delete: 'Ștergi runda „{title}”? Toate răspunsurile se vor pierde.',
    confirm_new_pin: 'Generezi un PIN nou? PIN-ul vechi nu va mai funcționa.',
    food_pizza: 'Pizza',
    food_doener: 'Shaorma',
    food_pasta: 'Paste',
    food_burger: 'Burger',
    food_chinese: 'Mâncare chinezească',
    err_server: 'Ceva n-a mers. Încearcă din nou.',
    err_rate_limited: 'Prea multe încercări. Așteaptă câteva minute.',
    err_bad_pin: 'PIN-ul nu este corect.',
    err_locked: 'Prea multe încercări greșite. Runda este blocată 15 minute.',
    err_name_taken: 'Numele acesta este deja folosit.',
    err_name_required: 'Introdu numele tău.',
    err_full: 'Runda este plină.',
    err_not_found: 'Linkul nu este valid sau a expirat.',
    err_bad_password: 'Parolă greșită.',
    err_custom_limit: 'Maximum 5 mâncăruri proprii.',
    err_duplicate: 'Este deja pe listă.',
    err_invalid: 'Date invalide.',
    err_too_long: 'Textul este prea lung.',
    err_too_many_rounds: 'Prea multe runde. Șterge-le pe cele vechi.',
  },
};
const LANGS = { de: 'Deutsch', en: 'English', es: 'Español', ro: 'Română' };

const FOODS = [
  { k: 'pizza', e: '🍕' },
  { k: 'doener', e: '🥙' },
  { k: 'pasta', e: '🍝' },
  { k: 'burger', e: '🍔' },
  { k: 'chinese', e: '🥡' },
];

// ---------- Hilfsfunktionen ----------
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* egal */ } },
};

let lang = (() => {
  const saved = store.get('ff_lang');
  if (saved && I18N[saved]) return saved;
  const nav = (navigator.language || 'de').slice(0, 2).toLowerCase();
  return I18N[nav] ? nav : 'de';
})();

(() => {
  const th = store.get('ff_theme');
  if (th === 'light' || th === 'dark') document.documentElement.dataset.theme = th;
})();

function t(key, vars) {
  let s = I18N[lang][key] ?? I18N.de[key] ?? key;
  if (vars) s = s.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ''));
  return s;
}

function errMsg(e) {
  const key = `err_${e && e.code}`;
  return I18N.de[key] ? t(key) : t('err_server');
}

const $ = (sel, root = document) => root.querySelector(sel);

function h(tag, props, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (v === true) n.setAttribute(k, '');
    else if (v !== false && v != null) n.setAttribute(k, v);
  }
  for (const c of children) if (c != null && c !== false) n.append(c);
  return n;
}

function applyI18n() {
  document.documentElement.lang = lang;
  for (const n of document.querySelectorAll('[data-i18n]')) n.textContent = t(n.dataset.i18n);
  for (const n of document.querySelectorAll('[data-i18n-ph]')) n.placeholder = t(n.dataset.i18nPh);
  for (const n of document.querySelectorAll('[data-i18n-aria]')) {
    n.setAttribute('aria-label', t(n.dataset.i18nAria));
    n.title = t(n.dataset.i18nAria);
  }
}

async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    credentials: 'same-origin',
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = {};
  try { data = await res.json(); } catch { /* leer */ }
  if (!res.ok) {
    const err = new Error(data.error || 'server');
    err.status = res.status;
    err.code = data.error || 'server';
    throw err;
  }
  return data;
}

const foodLabel = (it) => (it.k ? t(`food_${it.k}`) : it.c);
const foodEmoji = (it) => (it.k && FOODS.find((f) => f.k === it.k)?.e) || '🍽️';

async function copyText(text, btn) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = h('textarea');
    ta.value = text;
    document.body.append(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
  if (btn) {
    btn.textContent = t('copied');
    setTimeout(() => { btn.textContent = t(btn.dataset.i18n || 'copy'); }, 1500);
  }
}

function toggleTheme() {
  const root = document.documentElement;
  const dark = root.dataset.theme
    ? root.dataset.theme === 'dark'
    : matchMedia('(prefers-color-scheme: dark)').matches;
  root.dataset.theme = dark ? 'light' : 'dark';
  store.set('ff_theme', root.dataset.theme);
}

document.addEventListener('DOMContentLoaded', () => {
  const sel = $('#lang');
  if (sel) {
    for (const [k, v] of Object.entries(LANGS)) sel.append(h('option', { value: k, text: v }));
    sel.value = lang;
    sel.addEventListener('change', () => {
      lang = sel.value;
      store.set('ff_lang', lang);
      applyI18n();
      document.dispatchEvent(new Event('langchange'));
    });
  }
  $('#theme')?.addEventListener('click', toggleTheme);
  applyI18n();
});
