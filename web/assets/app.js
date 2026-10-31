// SPDX-License-Identifier: AGPL-3.0-only
const strings = {
  nl: {
    navTitle:'ONTWIKKELING',overview:'Overzicht',health:'Systeemstatus',next:'Volgende stappen',local:'Lokaal en onafhankelijk. Geen externe cloud nodig.',source:'Broncode op GitHub ↗',eyebrow:'DOMYRO 0.1 · EERSTE ONTWIKKELVERSIE',hero:'Je woning.<br><em>Jouw regels.</em>',intro:'De basis van een nieuwe, volledig lokale smart-homeomgeving staat. Apparaten en automatiseringen worden pas zichtbaar zodra de echte koppelingen zijn gebouwd.',system:'Systeemoverzicht',live:'Rechtstreeks uit je lokale Domyro-server. Geen verzonnen apparaten of statistieken.',refresh:'Verversen',core:'Core server',coreSub:'Lokale HTTP-dienst',database:'Database',dbSub:'PostgreSQL-koppeling gepland',devices:'Apparaten',devicesSub:'Nog geen integraties geactiveerd',roadmap:'Op weg naar een slim huis',planIntro:'We bouwen eerst een betrouwbaar fundament, daarna pas de functies die apparaten bedienen.',step1:'Ontwikkelbasis en veilige API',step1Sub:'De HTTP-server, echte statusmeldingen en automatische tests.',step2:'Accounts, PostgreSQL en kamers',step2Sub:'Veilige gebruikers, rechten en blijvende gegevens.',step3:'MQTT en Zigbee2MQTT',step3Sub:'Echte apparaten uitlezen en bedienen, zonder afhankelijkheid van Home Assistant.',step4:'Dashboard en automatiseringen',step4Sub:'De eerste bruikbare dagelijkse smart-homefuncties.',inProgress:'In ontwikkeling',footer:'Preview, nog niet voor productiegebruik',online:'Online',offline:'Niet bereikbaar',notReady:'Nog niet ingericht',notConnected:'Niet gekoppeld',checked:'Laatst gecontroleerd',error:'Server niet bereikbaar'
  },
  en: {
    navTitle:'DEVELOPMENT',overview:'Overview',health:'System status',next:'Next steps',local:'Local and independent. No external cloud required.',source:'Source code on GitHub ↗',eyebrow:'DOMYRO 0.1 · FIRST DEVELOPMENT VERSION',hero:'Your home.<br><em>Your rules.</em>',intro:'The foundation of a fully local smart-home platform is here. Devices and automations will only appear once their actual integrations have been implemented.',system:'System overview',live:'Directly from your local Domyro server. No fabricated devices or statistics.',refresh:'Refresh',core:'Core server',coreSub:'Local HTTP service',database:'Database',dbSub:'PostgreSQL integration planned',devices:'Devices',devicesSub:'No integrations activated yet',roadmap:'Building a smarter home',planIntro:'First, a dependable foundation. Device control comes later.',step1:'Development foundation and safe API',step1Sub:'HTTP server, real status information and automated tests.',step2:'Accounts, PostgreSQL and rooms',step2Sub:'Secure users, permissions and persistent data.',step3:'MQTT and Zigbee2MQTT',step3Sub:'Observe and control real devices without depending on Home Assistant.',step4:'Dashboard and automations',step4Sub:'The first useful daily smart-home features.',inProgress:'In progress',footer:'Preview, not ready for production',online:'Online',offline:'Unavailable',notReady:'Not configured',notConnected:'Not connected',checked:'Last checked',error:'Server unreachable'
  }
};
let language = 'nl';
let lastState = null;
const get = (id) => document.getElementById(id);
function translate(){
  document.documentElement.lang=language;
  document.title=`Domyro · ${strings[language].overview}`;
  for (const el of document.querySelectorAll('[data-i18n]')){
    const key=el.getAttribute('data-i18n');
    if (key === 'hero') el.innerHTML=strings[language][key]; // only constant local translation markup
    else el.textContent=strings[language][key] ?? key;
  }
  get('language').textContent=language==='nl'?'EN':'NL';
  if(lastState) render(lastState);
}
function updateValue(id,text,kind){const el=get(id);el.textContent=text;el.className='stat-value'+(kind?' '+kind:'');}
function render(state){
  const t=strings[language];
  updateValue('core-status',state.ok?t.online:t.offline,state.ok?'good':'warn');
  updateValue('db-status',state.ok&&state.data.persistence==='ready'?t.online:t.notReady,'warn');
  updateValue('device-status',t.notConnected,'');
  get('checked').textContent=`${t.checked}: ${new Intl.DateTimeFormat(language==='nl'?'nl-NL':'en-GB',{hour:'2-digit',minute:'2-digit',second:'2-digit'}).format(new Date())}${state.ok?'':` · ${t.error}`}`;
}
async function checkStatus(){
  const button=get('refresh');button.disabled=true;
  try {
    const response=await fetch('/api/v1/public/status',{cache:'no-store',signal:AbortSignal.timeout(5000)});
    if(!response.ok)throw new Error('Unreachable');
    const data=await response.json();
    if(data.service!=='Domyro'||data.core!=='running')throw new Error('Unexpected status');
    lastState={ok:true,data};
  }catch{lastState={ok:false,data:null};}
  render(lastState);button.disabled=false;
}
get('language').addEventListener('click',()=>{language=language==='nl'?'en':'nl';translate();});
get('refresh').addEventListener('click',checkStatus);
translate();
checkStatus();
