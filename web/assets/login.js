// SPDX-License-Identifier: AGPL-3.0-only
// Local-only development UI. No token or password is stored in localStorage,
// sessionStorage or browser-accessible cookies.
const get = id => document.getElementById(id);
const state = { csrf: null, sites: [], selected: null };
const signIn = get('signin'), signedIn = get('signedin');
const message = get('message');

function showMessage(text, success = false) {
  message.hidden = !text;
  message.textContent = text;
  message.classList.toggle('success', success);
}
function setAuthenticated(authenticated) {
  signIn.hidden = authenticated;
  signedIn.hidden = !authenticated;
  if (!authenticated) {
    state.csrf = null;
    state.sites = [];
    state.selected = null;
    get('rooms-panel').hidden = true;
    get('sites').replaceChildren();
    get('rooms').replaceChildren();
  }
}
async function api(path, { method = 'GET', body, csrf = false } = {}) {
  const headers = { accept: 'application/json' };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (csrf) headers['x-domyro-csrf'] = state.csrf ?? '';
  const response = await fetch('/api/v1/' + path, {
    method, headers, credentials: 'same-origin',
    cache: 'no-store', body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(8000),
  });
  let result = {};
  try { result = await response.json(); }
  catch { /* Fail without reflecting untrusted server HTML. */ }
  if (!response.ok) {
    const error = new Error(result.error || 'server_unavailable');
    error.status = response.status;
    throw error;
  }
  return result;
}
function explain(error) {
  if (error.status === 401) return 'Onjuiste gegevens of verlopen sessie.';
  if (error.status === 403) return 'Geen toestemming. Controleer je account en vernieuw de pagina.';
  if (error.status === 429) return 'Te veel pogingen. Probeer het later opnieuw.';
  if (error.status === 503) return 'De lokale database of aanmeldservice is nog niet beschikbaar.';
  return 'De bewerking is niet gelukt. Controleer je lokale testomgeving.';
}
async function selectSite(site) {
  state.selected = site;
  get('rooms-title').textContent = 'Kamers · ' + site.display_name;
  get('rooms-panel').hidden = false;
  get('add-room-form').hidden = !['owner', 'admin', 'manager'].includes(site.role);
  const list = get('rooms');
  list.replaceChildren();
  const data = await api('sites/' + site.id + '/areas');
  for (const area of data.areas) {
    const li = document.createElement('li');
    li.textContent = area.display_name;
    list.appendChild(li);
  }
  if (!data.areas.length) {
    const li = document.createElement('li');
    li.textContent = 'Er zijn nog geen kamers ingericht.';
    list.appendChild(li);
  }
  for (const button of get('sites').querySelectorAll('button')) {
    button.classList.toggle('current', button.dataset.id === site.id);
  }
}
async function loadSites() {
  const { sites } = await api('sites');
  state.sites = sites;
  const container = get('sites');
  container.replaceChildren();
  if (!sites.length) {
    const empty = document.createElement('p');
    empty.textContent = 'Er zijn geen woningen aan dit account gekoppeld.';
    container.appendChild(empty);
    get('rooms-panel').hidden = true;
    return;
  }
  for (const site of sites) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'site-item';
    button.dataset.id = site.id;
    const label = document.createElement('strong');
    label.textContent = site.display_name;
    const sub = document.createElement('small');
    sub.textContent = [site.role, site.time_zone].filter(Boolean).join(' · ');
    button.append(label, sub);
    button.addEventListener('click', async () => {
      try { await selectSite(site); showMessage(''); }
      catch (e) { showMessage(explain(e)); }
    });
    container.appendChild(button);
  }
  await selectSite(sites[0]);
}
async function initialize() {
  try {
    const me = await api('auth/me');
    state.csrf = me.csrfToken;
    get('welcome-heading').textContent = 'Welkom, ' + me.login;
    setAuthenticated(true);
    await loadSites();
  } catch (error) {
    setAuthenticated(false);
    if (error.status && error.status !== 401 && error.status !== 404) showMessage(explain(error));
  }
}
get('login-form').addEventListener('submit', async event => {
  event.preventDefault();
  const button = get('login-button');
  if (button.disabled) return;
  button.disabled = true;
  showMessage('');
  try {
    const data = await api('auth/login', {
      method: 'POST', body: { login: get('login').value, password: get('password').value },
    });
    get('password').value = '';
    state.csrf = data.csrfToken;
    get('welcome-heading').textContent = 'Welkom, ' + data.user.login;
    setAuthenticated(true);
    await loadSites();
    showMessage('Je bent aangemeld bij de lokale ontwikkelomgeving.', true);
  } catch (error) {
    get('password').value = '';
    showMessage(explain(error));
  } finally { button.disabled = false; }
});
get('add-room-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (!state.selected || !state.csrf) return;
  const input = get('room-name');
  const button = event.currentTarget.querySelector('button');
  button.disabled = true;
  try {
    await api('sites/' + state.selected.id + '/areas', {
      method: 'POST', csrf: true, body: { displayName: input.value },
    });
    input.value = '';
    await selectSite(state.selected);
    showMessage('Kamer toegevoegd.', true);
  } catch (error) { showMessage(explain(error)); }
  finally { button.disabled = false; }
});
get('logout').addEventListener('click', async () => {
  try { await api('auth/logout', { method: 'POST', csrf: true, body: {} }); }
  catch { showMessage('Kon de server niet bereiken. De sessie kan nog actief zijn.'); return; }
  setAuthenticated(false);
  showMessage('Je bent uitgelogd.', true);
});
initialize();
