# Domyro: visuele ontwikkelportal met echte backend

**Doel:** de complete webinterface cosmetisch kunnen beoordelen terwijl de echte backend gebruikers, woningen, kamers en bestaande apparaatwaarnemingen opslaat in PostgreSQL.

**Vereisten:** een aparte **Ubuntu-ontwikkelcomputer**, Node.js 22.12+ en een werkende, lokale Docker Engine. **Niet uitvoeren op de Domyro-productieserver, Home Assistant-host of een remote Docker-context.** Dit is geen productie-installer.

## Lokaal starten

Clone de actuele geïntegreerde ontwikkelbranch (nog een draft-PR), installeer de exact gelockte JavaScript-afhankelijkheden en start één afgeschermde preview:

```bash
git clone --branch integration/native-installer-foundation --single-branch https://github.com/TheRoyalCaptain/Domyro.git
cd Domyro
npm ci --ignore-scripts --no-audit --no-fund
npm run preview:portal
```

Open daarna **http://127.0.0.1:8844** en **http://127.0.0.1:8844/login** op dezelfde computer.

Het ontwikkelaccount heet **`preview_owner`**. Zijn willekeurig gegenereerde wachtwoord staat in een privébestand:

```bash
cat .domyro-preview/owner-password.txt
```

De wachtwoorden en database-instellingen liggen in `.domyro-preview/`, met private bestandstoegangsrechten en uitgesloten van Git. Je hoeft geen databasewachtwoorden in shell-history te plakken.

### Wat is nu echt functioneel?

- Aanmelden/uitloggen via bestaande Argon2id-hashes, HttpOnly-sessies en CSRF-bescherming.
- Beheer via `/login`: **woningen aanmaken en hernoemen**, **kamers aanmaken en hernoemen**. Veranderingen worden meteen in PostgreSQL opgeslagen, ook na het herstarten van de webserver.
- Hoofddashboard via `/`: echte, per account zichtbare woningen, kamers, database-status en het aantal bekende apparaten. Geen nepdata.
- Per woning aangemelde **Zigbee2MQTT-apparaten en waarnemingen** bekijken, waar die daadwerkelijk zijn opgeslagen. Geen echte apparaatbediening.
- Alleen eigen lidmaatschappen kunnen woningen/kamers bekijken. Renames vereisen minimaal `admin` voor woningen en `manager` voor kamers.
- Gebruikersinvoer wordt veilig als tekst weergegeven, niet als willekeurige HTML.

### Wat wordt aangemaakt?

De ontwikkelstarter `scripts/dev-portal.mjs` gebruikt een random containernaam, een uniek Docker-volume en een vrij toegewezen **alleen op 127.0.0.1 bereikbare poort** voor PostgreSQL. Hij weigert gebruik als root, een remote Docker-context en een bestaande container/volume zonder het verwachte Domyro-label. Hij verandert geen systemd-units, reverse proxies, port 80/443, Home Assistant-, Matter- of Zigbee2MQTT-installaties. Er wordt **geen sudo uitgevoerd**.

Het ontwikkelwachtwoord en PostgreSQL-testwachtwoord worden eenmalig lokaal gegenereerd. Bij opnieuw starten wordt de bestaande testdatabase behouden en kan de portal opnieuw worden geopend.

**Webserver stoppen:** Ctrl+C. De lokale testdatabase blijft opzettelijk beschikbaar, zodat ontwerpwijzigingen niet verloren gaan.

**Database stoppen, zonder gegevens te wissen:**

```bash
npm run preview:stop
```

**Belangrijk:** ook bij stoppen blijft het eigen Docker-volume bestaan. Er is geen automatische 'reset' of verwijdering, om onbedoeld gegevensverlies te vermijden.

### Beveiliging en grenzen

De portal is **ontwikkelsoftware**. Er is nog geen TLS/MFA/robuste sessieherstelroute, geen productiegeschikte installatie, geen complete live-integratie of veilige update-activator. De native installer-gate D-53 blijft volledig **GESLOTEN**. Deze preview gebruikt nooit een bestaande PostgreSQL-database op je server.

### Automatische volledige ketentest

`.github/workflows/portal-preview-smoke.yml` start op een aparte GitHub-hosted Ubuntu-testcomputer een eigen Docker PostgreSQL 17, voert werkelijk migraties en éénmalige eigenaarbootstrap uit, start de webserver en controleert:

- Beide HTML-portals en hun stylesheet worden echt door HTTP geserveerd.
- Zonder sessie zijn privésites onbereikbaar.
- Login werkt met het werkelijk gegenereerde ontwikkelwachtwoord.
- Nieuw huis aanmaken, hernoemen, nieuwe kamer aanmaken/hernoemen en opnieuw lezen.
- Een niet-geautoriseerde wijziging zonder CSRF blijft geweigerd.
- Zonder echte integratie tonen de apparaten-API's een lege, read-only lijst.
- De update-installatieknop blijft onbruikbaar terwijl D-53 gesloten is.
- De database is uitsluitend via 127.0.0.1 gemapt, niet op het LAN.

Deze tests maken Domyro **geschikt om lokaal op vormgeving te beoordelen**, maar bewijzen niet dat de officiële one-line installer of productie-updates klaar zijn.
