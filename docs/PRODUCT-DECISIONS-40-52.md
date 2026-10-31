# Domyro — Definitieve productkeuzes D-40 t/m D-52

**Besluitenregister:** PRODUCT-DECISIONS-40-52  
**Vastgelegd:** 31 oktober 2026  
**Status:** eigenaar heeft alle dertien antwoorden goedgekeurd; technische invulling blijft waar nodig ter beoordeling voor G0.  
**Implementatie:** niet toegestaan zonder afzonderlijke formele G0-goedkeuring.

## Leeswijzer

Alle aangevinkte opties zijn bindende, **cumulatieve** producteisen. Bij D-43 moeten IP:poort, mDNS-hostnaam en eigen domein/reverse proxy **naast elkaar** kunnen werken. Niet-aangevinkte opties zijn niet automatisch verboden; ze zijn **niet goedgekeurd als extra producteis**. Deze beslissingen preciseren de eerdere D-01 t/m D-39 en bepalen concreet de scope van de compacte, stabiele 1.0.

## D-40 — Native platform en CPU-architecturen

**Definitief:** Ubuntu Server **LTS**, zowel **x86-64 (amd64)** als **ARM64 (aarch64)**, bij installatie via de officiële Ubuntu Server ISO en zowel bare metal als in een VM.

- Eén ondersteunde native installatieaanpak per architectuur, met dezelfde UI/bedieningsmogelijkheden en dezelfde beveiliging.
- Release-artifacts, dependencies en servicepackages moeten expliciet beschikbaar en getest zijn voor beide architecturen. Een x86-64-binary op ARM64 is geen ondersteuning.
- Exacte ondersteunde Ubuntu LTS-versies en specifieke ARM64 hardware/boot- en virtualisatieomgevingen zijn nog een open compatibiliteitsbesluit.
- Docker en Umbrel blijven afzonderlijke distributievormen uit D-03. **Debian is niet door D-40 gekozen als officieel vereiste native 1.0-platform**; kan later als aparte compatibiliteitskeuze terugkomen. Er moet geen stille claim ontstaan dat elke Debian-versie officieel wordt ondersteund.
- Installatie, update-download, handmatige upgrade, backup/restore, MQTT, Zigbee2MQTT en Matter-netwerkpreflight behoren tot de matrix op beide architecturen.

**Acceptatie:** verse Ubuntu Server LTS x86-64 én ARM64, op representatieve hardware/VM, starten dezelfde eencommando-installatie en doorlopen de overeengekomen functionele tests.

## D-41 — Installatieassistent: ondersteunende diensten kiezen

**Definitief:** tijdens de installer/wizard beslist de beheerder **per dienst** wat er moet gebeuren.

Per relevante dienst, bijvoorbeeld PostgreSQL, Mosquitto, Zigbee2MQTT, Matter.js Server:
1. **Lokaal installeren en door Domyro laten beheren** (alleen als ondersteund en expliciet bevestigd).
2. **Bestaande externe of lokaal al geïnstalleerde dienst koppelen**, met bereikbaarheid en authenticatiecheck.
3. **Overslaan/uitstellen** wanneer het protocol/de functie niet nodig is; vereiste kernafhankelijkheden kunnen niet worden weggelaten zonder duidelijk uitgelegde gevolgen.

De installer toont vrije poorten, versie-compatibiliteit, benodigde opslag, privileges, eigen servicegebruiker, netwerkinstellingen, privacy en eventuele radio-eigenaarschap. Nooit automatisch een bestaande Zigbee-mesh of externe PostgreSQL overschrijven of stoppen. Domyro's kern zelf heeft zijn verplichte database, maar laat een geschikte bestaande database kiezen waar veilig ondersteund.

**Acceptatie:** elk servicebesluit heeft een eigen bevestiging en kan later in **Systeem → Diensten** opnieuw bekeken of veilig aangepast worden. De ene opdracht start de volledige wizard, niet een onzichtbare installatie van alles.

## D-42 — Meerdere woningen en optioneel meerdere Domyro-servers

**Definitief:** zowel één Domyro-installatie met meerdere woningen/locaties, als **afzonderlijke Domyro-servers die optioneel gekoppeld kunnen worden**.

- 1.0: installatie kan meerdere sites bevatten, met per-site gebruikers-, kamer-, apparaten- en rechtenafbakening (D-19). Een tweede installatie kan onafhankelijk draaien.
- Koppeling van afzonderlijke installaties: **langetermijneis**; voorgestelde fase na 1.0 om betrouwbaarheid niet te compromitteren. In G0 moet het toekomstige federatiecontract worden voorbereid, niet per se uitgevoerd.
- Later: expliciete wederzijdse pairing (beide eigenaren/admins stemmen toe), identificatie/uitwisseling van vertrouwde sleutels, scopes per site/entiteit, read-only of commandrechten, intrekken van vertrouwen, offline queue policy, audit en conflictoplossing.
- Geen verplichte centrale cloud, geen impliciete toegang tussen gekoppelde woningen, geen automatisch gedeelde accounts of apparaten en geen verplicht doorlopende internetverbinding.
- De koppeling van servers is **niet hetzelfde** als de latere optionele Domyro-remote-accessdienst (D-51). Een eigenaar beheert zelf de veilige netwerkroute (LAN/VPN/HTTPS reverse proxy waar geschikt).

**Acceptatie:** losse servers werken zelfstandig; toekomstig koppelen vraagt instemming aan beide zijden en revocatie stopt nieuwe datadeling en commando's.

## D-43 — Drie tegelijk ondersteunde lokale toegangsmethoden

**Definitief, ALLE DRIE:**
- Gewoon **IP-adres en poort**, bijvoorbeeld `http://192.0.2.10:PORT` als illustratie.
- Automatische herkenbare **mDNS-hostnaam**, bij voorkeur `domyro.local` op het lokale subnet als deze vrij is en de netwerkstack discovery ondersteunt.
- **Eigen domeinnaam of reverse proxy** naar de Domyro-dienst.

Ontwerpafspraken:
- IP:poort is altijd de herstel-/fallbackroute op het lokale netwerk. Poortkeuze en conflictcontrole zijn installer-instellingen.
- mDNS wordt geprobeerd als optioneel extra toegangspad; werkt niet gegarandeerd over VLANs, VPNs of netwerken die multicast blokkeren. Toon een concrete bereikbare fallback, detecteer naamconflicten en ondersteun eigen mDNS-naam.
- Eigen domein/reverse proxy vereist trusted-proxyconfig, veilige Origin/Host-validatie, correcte WebSocket-forwarding, TLS-aanbeveling en duidelijke HTTPS-instructies. Domyro mag nooit vertrouwelijk auth-verkeer zomaar blootstellen aan het internet.
- De gebruiker **selecteerde geen verplicht ingebouwd certificaatbeheer**; zo'n beheertool is niet automatisch een extra producteis.
- De eventuele optionele publieke relay komt pas na 1.0 (D-51).

**Acceptatie:** alle drie vormen zijn bruikbaar op ondersteunde netwerken; als mDNS niet werkt blijft IP:poort werken zonder foutieve "online"-status.

## D-44 — Automatische pluginupdatecontrole, downloaden/installeren handmatig

**Definitief:** Domyro mag updates voor reeds geïnstalleerde plugins **automatisch controleren**, maar **zowel downloaden als installeren is handmatig**.

- Automatische controles vragen enkel ondertekende/reputabel beoordeelde metadata van de ingestelde catalogus; geen plugincode downloaden, uitvoeren, uitpakken of installeren.
- Eigenaars kunnen de controles uitzetten en handmatig een updatecheck starten; standaardfrequentie wordt later bepaald.
- Pluginupdate-download vereist een uitdrukkelijke beheerderactie; installatie vereist daarna **opnieuw** expliciete bevestiging (D-26), inclusief versie/uitgever/rechten/compatibiliteit.
- Geen automatische plugininstallatie of automatische serviceherstart via pluginupdater, ook niet bij security fixes. Een kritieke update mag wel waarschuwingen geven.
- **D-13 voor Domyro-core blijft onaangetast:** daar is automatische *download* optioneel met uitstel toegestaan; de pluginregel is strenger.

**Acceptatie:** periodieke plugincataloguschecks veranderen geen binaries of runtime; niets wordt automatisch gedownload/geïnstalleerd.

## D-45 — Standaard back-upbewaarbeleid

**Definitief standaardprofiel:**
- **7 dagelijkse back-ups**
- **4 wekelijkse back-ups**
- **12 maandelijkse back-ups**

De gebruiker mag schema, aantal, locatie en bewaartermijnen aanpassen (D-38). Dag/week/maand zijn logische retentiecategorieën, niet drie afzonderlijke back-ups op een dag zonder noodzaak; de scheduler definieert labels en deduplicatie.

Veiligheidsregels:
- Bewaarbeleid geldt per bestemming of benoemd backupbeleid; meerdere bestemmingen (lokaal, SMB/NAS, FTP/FTPS/SFTP, USB) worden afzonderlijk gerapporteerd.
- Verwijder alleen back-ups die Domyro aantoonbaar beheert, pas na een succesvol en geverifieerd nieuw exemplaar wanneer anders geen herstelpunt zou blijven.
- Een verdwenen USB-stick, volle NAS of kapotte FTP-verbinding mag geen gezonde backups op een andere bestemming verwijderen.
- Encrypted archive, manifest/checksum en een ingestelde integriteitscontrole. Hersteltests blijven afzonderlijk verplicht.

**Acceptatie:** rotatie houdt volgens de ingestelde categorieën de juiste aantallen aan, voorkomt onbedoelde dubbele bewaartellingen en toont exact waarom iets verwijderd werd.

## D-46 — Gemiste geplande automatiseringen na uitval

**Definitief:** **per automatisering instelbaar**:
1. **Overslaan** (veilige standaard).
2. **Inhalen** (na herstel, met configureerbaar maximaal inhaalvenster en maximum aantal uitvoeringen).
3. **Eerst toestemming vragen** (wachtrij voor expliciete bevestiging).

- Automatiseringsschema, IANA-tijdzone, afgelopen geplande triggers en gemiste vensters worden duurzaam bijgehouden.
- Geen blinde historische massa-herhaling (storm) na offline periode.
- Niet-idempotente of veiligheidskritische acties zoals toggles, ontgrendelen, openen of sirenes worden **niet automatisch ingehaald** bij onzekere vorige status; vraag toestemming of sla over.
- De "toestemming vragen"-modus registreert een actie met vervaldatum en details van geplande en effectieve tijd, niet een onbeperkt openstaande gevaarlijke actie.
- Zomer-/wintertijdregels en vertragingen hebben expliciete eenmalige/skip-semantiek.
- De beheerder kan achteraf zien welke geplande triggers zijn gemist, ingehaald, geweigerd of verlopen.

**Acceptatie:** gecontroleerde downtime waarbij één of meerdere geplande triggers gemist worden: elk van drie beleidsmodi geeft precies het verwachte, auditbare resultaat en veroorzaakt geen onbedoelde fysieke actie.

## D-47 — Account-herstel via herstelcodes EN beveiligde lokale procedure

**Definitief beide:** herstelcodes **en** veilige herstelprocedure vanaf lokale installatie/console.

- Herstelcodes zijn eenmalig, hoog-entropisch, gehasht opgeslagen, worden veilig getoond bij MFA/passkey-activering, kunnen met stap-up vervangen worden, en zijn intrekbaar.
- Zonder codes: herstel uitsluitend via lokaal vertrouwd beheer (bijvoorbeeld fysieke/VM-console met beperkte beheerderrechten, speciale eenmalige herstelopdracht die het account niet automatisch ontgrendelt op internet).
- Herstel geeft geen toegang tot plaintext wachtwoorden, oude passkey private keys, of verborgen back-up encryptiesleutels. Waar nodig worden nieuwe credentials aangemaakt na extra controle.
- Rate limiting, audit, session revocation en optioneel notificatie aan bestaande eigenaars. Bij herstel van de laatste eigenaar moet duidelijk zijn welke lokale hosttoegang volstaat en welke niet.
- Geen standaard masterwachtwoord of universele cloudherstelservice.

**Acceptatie:** account recovery met geldige recovery code én afzonderlijk via gecontroleerde lokale console zonder code; een bezoeker op het LAN mag geen identieke mogelijkheid hebben.

## D-48 — Dashboardeditor voor 1.0

**Definitief 1.0:** **dashboardtemplates en eenvoudige dashboardaanpassingen**. Geen eis dat de volledige drag-and-drop-editor, zelfbouw-widgets of wandtabletmodus in 1.0 beschikbaar zijn.

1.0 omvat minimaal kiezen/instantiëren van sjablonen, eenvoudige kaart toevoegen/verwijderen/herschikken, ruimte-/gebruikersgebonden dashboardinstellingen en persistente layout; toegankelijk via toetsenbord/touch. Exacte edit controls worden in UX ADR gekozen.

De uitgebreide vier features uit D-22 blijven goedgekeurd voor latere versies, inclusief volledige drag-and-drop, custom widgets en wall/tablet modes.

**Acceptatie:** na bewaren en herstart consistent dashboard met juiste echte apparaatstatus; geen misleidende placeholders.

## D-49 — Automatiseringseditor voor 1.0

**Definitief 1.0:** **eenvoudige regels plus een veilige basis van de visuele editor**.

- Eén typed/revisioned graph-execution engine voor beide editors (D-06).
- 1.0 biedt noodzakelijke triggers, getypeerde voorwaarden, acties, beperkt aantal flowknopen en basale fout-/runtrace.
- Geavanceerde formules, uitgebreide debugging, herbruikbare scripts/subflows en complexe herhaalpatronen uit D-25 blijven gepland voor latere releases.
- Zelfs de beperkte 1.0-editor moet veilige wachten, toestemming, uitschakeling, verouderde apparaatstatus en herstel na reboot juist verwerken.

**Acceptatie:** beide 1.0-editors maken compatibele uitvoerbare definities zonder onbegrensde lussen of onzichtbare fysieke acties.

## D-50 — Duitse vertaling na eerste stabiele release

**Definitief:** Duits (`de-DE`) **pas na Domyro 1.0**. De eerste stabiele release is compleet **Nederlands en Engels**; een Duitse volledige vertaling wordt als latere versie gepland.

- Leg vertaalbare teksten/locale keys vast vanaf de basis zodat de Duitse vertaling later kan worden toegevoegd zonder API- of databankwijziging.
- Duitse vertaling en QA vallen in een 1.x-release of later, met eigen acceptatie en toegankelijkheidscontrole.
- Eerdere "German might ship in 1.0" aanbevelingen zijn **vervangen door D-50**.

**Acceptatie:** UI in 1.0 NL+EN afgerond, geen de-DE als voltooid geadverteerd; na release kan Duits correct uitgerold worden.

## D-51 — Optionele Domyro remote-accessoplossing na 1.0

**Definitief:** in 1.0 alleen handleidingen/instellingen voor **eigen VPN of reverse proxy**. **Optionele Domyro-eigen externe toegang pas na 1.0**.

- Lokale Domyro blijft volledig werken zonder internet of een vendor cloudaccount.
- VPN of reverse proxy wordt door eigenaar beheerd; niet automatisch een open firewallpoort of domein bij iemand aanmaken.
- Toekomstige eigen relay moet opt-in zijn, sterke versleuteling en authenticatie, sleutelrotatie, opzegging/revocatie en onafhankelijkheid van lokale functionaliteit hebben.
- Multi-serverkoppeling D-42 is een afzonderlijke, eveneens nog te faseren capability.

**Acceptatie:** op een offline lokaal netwerk werken essentiële bediening en automatiseringen. 1.0 mag geen verplichte door Domyro gehoste relay-account aanbieden.

## D-52 — Energie en camera's in versie 1.0

**Definitief:** **eenvoudige energiegrafieken in 1.0; camera's pas na 1.0**.

- 1.0 gebruikt bestaande meetentiteiten en geschiedenis voor eenvoudige elektriciteits-/vermogens- en waar ondersteund gas/water-trendlijnen, correcte eenheden, tijdlabels, onbekende waarden en selecteerbare periode. "Eenvoudige grafiek" is geen garantie dat er elke meter/bron in 1.0 gekoppeld kan worden.
- Kostenberekening, dynamische tarieven, zonnepanelen, batterijen, slim EV-laden (D-27) blijven goedgekeurd als geavanceerde features voor latere versies.
- Camera's D-28 blijven volledig in de productroadmap: ONVIF/RTSP, live feed, opnames, terugkijken, beweging en meldingen. **Geen 1.0 release blocker of productclaim**, alleen uitbreidbare entity/privacy/plug-in contracten.
- Dashboardtemplates voor 1.0 kunnen een eenvoudige energietrendkaart opnemen als echte gegevens aanwezig zijn.

**Acceptatie:** grafiek bij echte ondersteunde energiemonitoringsensor toont correcte eenheid/periode en stale waarden; camera's worden niet als klaar of ondersteund in 1.0 geadverteerd.

## Bevestigde releasegrenzen (alle nieuwe besluiten gecombineerd)

| Gebied | Domyro 1.0 | Na 1.0 |
|---|---|---|
| Native hosts | Ubuntu Server LTS x86-64 + ARM64, bare metal/VM | Extra distro's alleen na afzonderlijk besluit |
| Container | Docker en Umbrel via eigen packaging/test | Uitbreiden hardware/support |
| Installer | Eén entry-command; kies ondersteunende dienst per stap | Meer integraties |
| Meerdere locaties | Eén server kan meerdere sites beheren; losse servers zelfstandig | Optioneel koppelen van afzonderlijke servers |
| Lokale toegang | IP:poort, werkende mDNS-naam waar netwerk het toestaat, eigen domein/reverse proxy | Domyro-eigen remote relay |
| Plugin updates | Automatische **controle**, handmatige download én installatie | Geen auto-install afgesproken |
| Back-ups | Standaard 7 dagelijks / 4 wekelijks / 12 maandelijks; meerdere bestemmingen, checks | Extra backend/restore-optimalisaties |
| Gemiste automatiseringen | Per automatisering overslaan / begrensd inhalen / bevestiging vragen | Meer geavanceerde planningsopties |
| Account-herstel | Eenmalige herstelcodes + veilig lokaal consoleherstel | Optionele enterprise/federated recovery later |
| Dashboards | Templates en eenvoudige aanpassingen | Volledige DnD, custom widgets, wandtablet |
| Automatiseringen | Eenvoudig + veilige visuele basis | Geavanceerde scripts/subflows/debugging |
| Talen | Nederlands + Engels | Duits (de-DE) |
| Externe toegang | Eigen VPN/reverse-proxyconfig | Optionele Domyro remote-accessdienst |
| Energie | Eenvoudige grafieken voor ondersteunde meetwaarden | Kosten, dynamische prijzen, zonne-energie, accu, EV |
| Camera's | Geen functionele cameraplicht in 1.0 | ONVIF/RTSP, live, recording/playback/motion |

## Wat nog **niet** beslist is

- Exacte Ubuntu LTS-versies, specifieke ARM64 boards/CPU en minimum-RAM-/schijfeisen.
- Exacte installatie-/pakketverificatiemethode, MQTT- of databaseversies, locale poort en mDNS naamconflictstrategie.
- Transport/protocol/autoriteiten en prioriteit voor gekoppelde meerdere Domyro-servers.
- Standaardfrequentie en notificatiestijl van plug-in updatechecks.
- Hoe groot het veilige inhaalvenster is, maxima en individuele risico-allowlist bij automatiseringen.
- Herstelcodes-aantal, consoleherstelprivilege en secrets rotation, binnen vastgelegde veilige principes.
- Dashboardwidgettypes en laagste set grafiek-meting-entiteiten die getoond kunnen worden.
- Precieze remote-access- en federatiearchitectuur na 1.0.
- Toekomstige cameraopslag en videobeleid.
- Technische stack (evidence-based evaluatie), hardwaretestopstelling en GitHub branches beschermen.

## G0-regel

Deze **dertien productbesluiten zijn goedgekeurd**, niet de complete architectuur. De eigenaar heeft **niet** toegestaan om te programmeren. Bestaande plan-alleen-afspraken blijven van kracht.

Zie: [MASTERPLAN.md](MASTERPLAN.md), [DECISIONS.md](DECISIONS.md), [G0-READINESS.md](G0-READINESS.md), [DEPLOYMENT.md](DEPLOYMENT.md), [AUTOMATION-ENGINE.md](AUTOMATION-ENGINE.md), [PRODUCT-UX.md](PRODUCT-UX.md), [SECURITY-OPERATIONS.md](SECURITY-OPERATIONS.md), [PRODUCT-DECISIONS-22-39.md](PRODUCT-DECISIONS-22-39.md).
