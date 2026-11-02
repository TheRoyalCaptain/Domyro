# Domyro NATIVE serverportal, zonder Docker

**Doel:** Domyro als echte, zelfstandig draaiende webserver op een **aparte Ubuntu 24.04 LTS-server** kunnen bekijken en visueel verbeteren. **Geen Docker, Podman of containers** op de doelserver.

Deze code is een vrijwillig te starten **ontwikkelpreview**. De officiële productie-installatie en automatische release-updates blijven geblokkeerd onder D-53.

## Serverarchitectuur

- Domyro Node.js 22.12+ draait rechtstreeks als een onprivileged systemd-service: `domyro-preview-native.service`.
- PostgreSQL 16 of 17 draait **native als Ubuntu-dienst**, niet binnen een container. De installatiescript maakt uitsluitend een aparte `domyro_preview_native`-database en twee beperkte roles aan.
- De service gebruikt een *beperkte runtime-rol*, zonder `CREATE`-rechten op de database of het public-schema. Migraties en eigenaarbootstrap lopen eenmalig via een afzonderlijke migratierol.
- De applicatiebestanden onder `/opt/domyro-preview-native` zijn root-owned, de geheimen staan in root-only `/etc/domyro-preview-native` (0600).
- HTTP wordt uitsluitend gebonden aan **127.0.0.1:8844**, zonder firewallpoorten voor het LAN/internet open te zetten. Bezoeken vanaf een andere computer gaat via een SSH-tunnel. Login werkt alleen vanaf loopback.
- De systemd-service is enabled en wordt na een reboot automatisch opnieuw gestart. PostgreSQL-data blijft behouden.

**Niet uitvoeren op een reeds gebruikte Home Assistant- of Domyro-productiehost.** Dit is voor een aparte Ubuntu-ontwikkelserver of -VM. Zorg voor een snapshot/back-up vóór een nieuw systeemexperiment.

## Wat moet er op de server aanwezig zijn?

Vooraf bewust apart installeren en controleren:
- Ubuntu Server 24.04 LTS, met systemd.
- Node.js >=22.12 en npm. Gebruik een betrouwbaar native Ubuntu/Node.js-pakket; niet via Docker.
- PostgreSQL >=16 als Ubuntu service (bijvoorbeeld `sudo apt install postgresql postgresql-client`).
- Git en curl.
- Een gebruiker met sudo-rechten en SSH-toegang.

De native preview installeert geen OS-pakketten, laat bestaande PostgreSQL-databases met rust en gebruikt geen automatische Docker-installatie.

## Native ontwikkelpreview installeren

Op de server, in de shell van je normale gebruiker:

```bash
git clone --branch integration/native-installer-foundation --single-branch https://github.com/TheRoyalCaptain/Domyro.git
cd Domyro
npm ci --omit=dev --ignore-scripts --no-audit --no-fund
sudo bash scripts/native-preview-install.sh --install-native-preview
```

**Let op:** het commando met `sudo` maakt een *nieuwe*, afzonderlijke database, twee PostgreSQL-rollen, een eigen systeemgebruiker, bestanden onder `/opt` en `/etc` en een actieve systemd-service. Het is expliciet **niet** bedoeld voor een al in gebruik zijnde Domyro-installatie. Bij bestaande doelpaden/rollen/database/poort weigert het script vóór installatie te beginnen. Bij een onderbroken eerste installatie blijven eventueel reeds aangemaakte onderdelen staan; ze worden **niet** automatisch verwijderd of overschreven.

Eenmalig aangemaakte inlog:
- **Gebruikersnaam:** `native_preview_owner`.
- **Wachtwoord:** `sudo cat /etc/domyro-preview-native/owner-password.txt`. Bewaar dit zorgvuldig.

De ontwikkelserver zelf is beschikbaar op `http://127.0.0.1:8844` (alleen binnen die server).

### Open de portal vanaf je eigen computer

Maak op jouw lokale computer een SSH-tunnel. Vervang de laatste twee velden door jouw echte servergegevens:

```bash
ssh -L 8844:127.0.0.1:8844 <linux-gebruiker>@<server-adres>
```

Open vervolgens in **je lokale browser**:

- Dashboard: `http://127.0.0.1:8844/`
- Inloggen en woning-/kamerbeheer: `http://127.0.0.1:8844/login`

De portal en browser-API blijven binnen de SSH-tunnel. Je hoeft geen HTTP-poort naar het publieke internet open te zetten.

## Dagelijks beheer

```bash
sudo systemctl status domyro-preview-native
sudo systemctl restart domyro-preview-native
sudo journalctl -u domyro-preview-native -n 100 --no-pager
```

Een herstart behoudt de PostgreSQL-data. Een tweede keer het installatiescript uitvoeren **wordt geweigerd** en overschrijft dus geen bestaande portal. Stoppen zonder verwijderen: `sudo systemctl stop domyro-preview-native`.

**Er is nog geen automatische updatefunctie.** Deze native ontwikkelpreview biedt een stabiele start voor frontend/backend-werk, niet het uiteindelijke release-/rollbackmechanisme.

## Testen zonder Docker

In `.github/workflows/native-preview-host.yml` worden Ubuntu 24.04 (AMD64 + ARM64) wegwerp-VM's gebruikt, met PostgreSQL **rechtstreeks als host-service**. De test voert het echte opt-in installatiescript uit en controleert systemd-hardening, loopbackpoort, inloggen, CSRF, woning-/kameraanmaak, data na een systemd-herstart, het afwijzen van een tweede installer en het gesloten blijven van D-53. Alleen de wegwerp-testmachines worden achteraf opgeruimd.

## Productieveiligheid

Dit is een ontwikkelservervariant, **geen** officiële productie-uitgave. Nog nodig: herkomstgecontroleerde one-line distributie, echte release signing key, TLS/reverse-proxy-authenticatie, hardwareveiligheid, volledige database/config/Matter/Zigbee2MQTT-backup en een geverifieerd updateproces dat fouten zonder gegevensverlies terugdraait. D-53 blijft gesloten.
