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
  get('add-site-form').hidden = !authenticated;
  if (!authenticated) {
    state.csrf = null;
    state.sites = [];
    state.selected = null;
    get('rooms-panel').hidden = true;
    get('sites').replaceChildren();
    get('rooms').replaceChildren();
    get('updates-panel').hidden = true;
    get('user-devices').hidden = true;
    get('user-device-list').replaceChildren();
    get('rename-site-form').hidden = true;
    get('add-site-form').hidden = true;
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
  get('rename-site').hidden = !['owner','admin'].includes(site.role);
  get('rename-site-form').hidden = true;
  const list = get('rooms');
  list.replaceChildren();
  const data = await api('sites/' + site.id + '/areas');
  if (state.selected?.id !== site.id) return;
  for (const area of data.areas) {
    const li = document.createElement('li');
    li.className = 'room-entry';
    const label=document.createElement('span');
    label.textContent=area.display_name;
    li.append(label);
    if(['owner','admin','manager'].includes(site.role)){
      const edit=document.createElement('button');
      edit.type='button';edit.className='secondary tiny-button';
      edit.textContent='Hernoemen';
      const form=document.createElement('form');
      form.className='room-edit-form';
      form.hidden=true;
      const input=document.createElement('input');
      input.type='text';input.required=true;input.maxLength=100;
      input.setAttribute('aria-label','Nieuwe naam voor '+area.display_name);
      input.value=area.display_name;
      const save=document.createElement('button');
      save.type='submit';save.textContent='Opslaan';
      const cancel=document.createElement('button');
      cancel.type='button';cancel.className='secondary';cancel.textContent='Annuleren';
      cancel.addEventListener('click',()=>{form.hidden=true;edit.hidden=false;});
      edit.addEventListener('click',()=>{form.hidden=false;edit.hidden=true;input.focus();input.select();});
      form.append(input,save,cancel);
      form.addEventListener('submit',async event=>{
        event.preventDefault();
        save.disabled=true;
        try{
          await api('sites/'+site.id+'/areas/'+area.id,{
            method:'PATCH',csrf:true,body:{displayName:input.value},
          });
          if(state.selected?.id===site.id)await selectSite(site);
          showMessage('Kamernaam opgeslagen.',true);
        }catch(error){showMessage(explain(error));}
        finally{save.disabled=false;}
      });
      li.append(edit,form);
    }
    list.appendChild(li);
  }
  if (!data.areas.length) {
    const li = document.createElement('li');
    li.textContent = 'Er zijn nog geen kamers ingericht. Voeg je eerste kamer toe.';
    list.appendChild(li);
  }
  for (const button of get('sites').querySelectorAll('button.site-item')) {
    button.classList.toggle('current', button.dataset.id === site.id);
  }
  await loadDevices(site);
}
async function loadDevices(site){
  if(!site||state.selected?.id!==site.id)return;
  const panel=get('user-devices'),output=get('user-device-list'),message=get('user-device-message');
  panel.hidden=false;output.replaceChildren();message.textContent='Apparaten ophalen…';
  try{
    const result=await api('sites/'+site.id+'/devices');
    if(state.selected?.id!==site.id)return;
    if(result.readOnly!==true||!Array.isArray(result.devices))throw Error('invalid_device_inventory');
    message.textContent=result.devices.length?'Alleen bekijken · '+result.devices.length+' apparaten':
      'Er zijn nog geen Zigbee2MQTT-apparaten geregistreerd.';
    for(const device of result.devices){
      const card=document.createElement('article');card.className='portal-device-card';
      const h=document.createElement('h4');h.textContent=device.friendlyName??device.ieeeAddress;
      const sub=document.createElement('p');
      sub.textContent=[device.vendor,device.model].filter(Boolean).join(' · ')||device.ieeeAddress;
      card.append(h,sub);
      const values=document.createElement('dl');
      for(const [key,observation] of Object.entries(device.observations??{})){
        const row=document.createElement('div'),dt=document.createElement('dt'),dd=document.createElement('dd');
        dt.textContent=key.replaceAll('_',' ');
        const value=observation?.value;
        dd.textContent=(value===true?'Ja':value===false?'Nee':typeof value==='number'?String(value):
          typeof value==='string'?value:'Onbekend')+
          ' · '+(observation.quality==='confirmed'?'Bevestigd':'Niet bevestigd');
        row.append(dt,dd);values.append(row);
      }
      card.append(values);output.append(card);
    }
  }catch(error){
    if(state.selected?.id!==site.id)return;
    message.textContent=explain(error);
  }
}
async function loadSites(preferredId=null) {
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
  await selectSite(sites.find(x=>x.id===(preferredId??state.selected?.id))??sites[0]);
}
async function loadUpdateCenter() {
  const panel = get('updates-panel');
  panel.hidden = true;
  try {
    const status = await api('system/updates');
    panel.hidden = false;
    get('updates-version').textContent = status.currentVersion ?? 'Onbekend';
    get('updates-feed').textContent = status.signedFeedConfigured ? 'Vertrouwde bron ingesteld' : 'Nog niet ingesteld';
    get('updates-gate').textContent = status.installationGate + (status.installAllowed ? ' open' : ' gesloten');
    get('updates-status').textContent = status.installAllowed
      ? 'Handmatig installeren vereist afzonderlijke toestemming.'
      : 'Updaten is geblokkeerd totdat de volledige installatie- en hersteltests zijn goedgekeurd.';
    get('update-install').disabled = !status.installAllowed;
    get('update-install').setAttribute('aria-disabled', String(!status.installAllowed));
  } catch (error) {
    // Guests are not system administrators; don't show an admin-only panel.
    if (error.status !== 403 && error.status !== 401) {
      panel.hidden = false;
      get('updates-status').textContent = 'Updatecentrum momenteel niet beschikbaar.';
    }
  }
}

async function initialize() {
  try {
    const me = await api('auth/me');
    state.csrf = me.csrfToken;
    get('welcome-heading').textContent = 'Welkom, ' + me.login;
    setAuthenticated(true);
    await loadSites();
    await loadUpdateCenter();
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
    await loadUpdateCenter();
    showMessage('Je bent aangemeld bij de lokale ontwikkelomgeving.', true);
  } catch (error) {
    get('password').value = '';
    showMessage(explain(error));
  } finally { button.disabled = false; }
});
get('add-site-form').addEventListener('submit',async event=>{
  event.preventDefault();
  if(!state.csrf)return;
  const name=get('site-name'),button=event.currentTarget.querySelector('button');
  button.disabled=true;
  try{
    const created=await api('sites',{method:'POST',csrf:true,
      body:{displayName:name.value,timeZone:'Europe/Amsterdam',locale:'nl'}});
    name.value='';
    await loadSites(created.site.id);
    showMessage('Woning toegevoegd en opgeslagen.',true);
  }catch(error){showMessage(explain(error));}
  finally{button.disabled=false;}
});
get('rename-site').addEventListener('click',()=>{
  if(!state.selected)return;
  get('rename-site-name').value=state.selected.display_name;
  get('rename-site-form').hidden=false;
  get('rename-site-name').focus();
});
get('cancel-rename-site').addEventListener('click',()=>{
  get('rename-site-form').hidden=true;
});
get('rename-site-form').addEventListener('submit',async event=>{
  event.preventDefault();
  const site=state.selected;
  if(!site)return;
  const button=event.currentTarget.querySelector('button[type=submit]');
  button.disabled=true;
  try{
    await api('sites/'+site.id,{method:'PATCH',csrf:true,
      body:{displayName:get('rename-site-name').value}});
    await loadSites(site.id);
    get('rename-site-form').hidden=true;
    showMessage('Woningnaam opgeslagen.',true);
  }catch(error){showMessage(explain(error));}
  finally{button.disabled=false;}
});
get('refresh-devices').addEventListener('click',()=>{
  if(state.selected)void loadDevices(state.selected);
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
