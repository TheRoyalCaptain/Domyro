# Ondertekende native eerste installatie

De eerste installatie gebruikt nu dezelfde cryptografische pakketcontrole als
de updater. De installer maakt de native core en de afzonderlijke updater
samen aan. Docker wordt niet gebruikt op de doelserver.

Dit is het gecontroleerde installatieprogramma achter de toekomstige publieke
bootstrap. Het is **nog geen vrijgegeven curl-installatiecommando**: de officiële
uitgeverssleutel/publicatie en automatische Node-runtimevoorziening ontbreken.
De installatievoorwaarden blijven gesloten in de repository.

## Wat de installer doet

`scripts/install-native-source.mjs` vereist root, Ubuntu 24.04 met systemd,
Node.js 22.12+ en drie expliciete absolute invoerpaden: het complete
ondertekende pakket, een afzonderlijk vertrouwd uitgeversbeleid en een
onderbouwde installatiegereedheidsregistratie. Die laatste bestanden moeten
root-owned zijn en mogen niet door andere accounts beschrijfbaar zijn.

Eerst controleert hij de installatievoorwaarden, Ed25519-sleutelpin, handtekening,
beide architectuurpakketten en hashes. Bestaande Domyro-bestanden/accounts worden
geweigerd. Daarna legt hij een exclusieve, blijvende installatieregistratie vast
in `/var/lib/domyro-first-install` en pakt de gecontroleerde broncode uit.

Als er geen PostgreSQL-serverunit bestaat, worden de officiële Ubuntu-pakketten
geïnstalleerd. Een bestaande maar gestopte PostgreSQL-server wordt niet gestart
of vervangen. De apt-tak voor een afwezige server is nog niet afzonderlijk op
een volledig lege machine bewezen; CI gebruikt native PostgreSQL vooraf.

Alleen het installatiescript **uit het gecontroleerde pakket** wordt uitgevoerd:

1. Een apart `domyro`-systeemaccount installeren.
2. Exacte npm-afhankelijkheden zonder lifecycle-scripts onder dat account
   installeren; daarna alle ondertekende bronbestanden opnieuw vergelijken en
   de applicatie root-owned maken.
3. Een nieuwe `domyro`-database met afzonderlijke migratie- en runtimegebruikers
   aanmaken, migraties uitvoeren en een eigenaar met willekeurig wachtwoord
   initialiseren. De runtime mag geen tabellen maken.
4. Private configuratie in `/etc/domyro` schrijven en de core en updater als
   afzonderlijke systemd-services installeren.
5. De echte HTTP-login, opgeslagen woning en bereikbaarheid van de updater
   controleren voordat de installatie als voltooid wordt gemarkeerd.

De portal bindt aan localhost op 8844. Toegang vanaf een andere computer loopt
via een SSH-tunnel; dit implementeert nog geen LAN-HTTPS-onboarding.
Het gegenereerde eigenaarwachtwoord blijft root-only in
`/etc/domyro/owner-password.txt`. Het wordt niet in logs of argumenten gezet.

## Onderbrekingen en herhaalde uitvoering

Fasen worden via write/fsync/rename bewaard. Een mislukte of onderbroken
installatie wist geen reeds aangemaakte eigenaar, database of credentials.
Een herhaalde installatie wordt geweigerd zodra bestaande resources of de
installatieregistratie worden gevonden. De fase staat in
`/var/lib/domyro-first-install/phase`; de manifestidentiteit in `receipt.json`.

Er is nog geen algemene automatische eerste-installatiereparatie. Verwijder
deze bestanden niet om een nieuwe installatie te forceren: dat is geen
herstelprocedure. Gewone core-updates gebruiken de aparte updateworker en
hebben wel een expliciete hersteltransactie.

## Native proef

`.github/workflows/native-first-install.yml` draait op Ubuntu 24.04 AMD64 en
ARM64 met tijdelijke testondertekening. De proef controleert:

- echte eerste installatie, accountlogin, kameropslag en herstart;
- afzonderlijke, blijvende updater en dezelfde worker-PID na core-herstart;
- weigering van een herhaalde installatie zonder credentialswijziging;
- een ondertekende foutinjectie na eigenaarinitialisatie, met behoud van de
  database, eigenaar en credentials;
- installatie van een volgende ondertekende versie via de geauthenticeerde
  portal-API, echte Unix-socket en root-worker, met behoud van de opgeslagen kamer.

Voor die laatste proef wordt het ondertekende pakket vooraf root-only geplaatst
in `/var/lib/domyro-updater/offline/VERSIE`. De worker behandelt zo'n pakket als
onvertrouwd totdat dezelfde sleutel-, handtekening-, schema- en hashcontroles
slagen. De aanvraag kan geen lokaal pad of willekeurige URL bevatten. Normale
publieke releases worden via de vaste GitHub-releasebron opgehaald.

Deze proef vult geen officiële productiecontroles automatisch in. Een compleet
publiek installatiecommando, officiële sleutel, machine-reboot/stroomuitval en
hardware/integratieherstel vereisen nog afzonderlijk bewijs.

## Versioned online installation transport

The existing trusted installer now accepts `--version=0.1.1` instead of
`--directory=/absolute/package`. Both modes require the same independently
provisioned publisher policy and installation-readiness files. They cannot be
combined. The online mode downloads only the selected official GitHub release,
checks its Ed25519 signature and both architecture hashes, then enters the same
verified native installation path. Readiness and publisher trust are checked
before any download. Temporary downloads are removed on success or installation
failure; the durable installation receipt and application data are retained.

GitHub's temporary asset redirect query parameters are supported. HTTPS,
allowlisted hosts, redirect limits, bounded sizes and signed byte verification
remain required. Tests use independently generated signatures and simulated
transport; they do not certify a published official release.

This is not yet a public curl bootstrap: a trusted checkout of the installer,
official publisher provisioning and production readiness are still required.
The Python entry point below supplies Node automatically. No official key or production authorization is generated implicitly.


## Automatic native Node prerequisite

`scripts/install-native.py` is the trusted-checkout entry point on Ubuntu 24.04.
It takes the same `--install`, `--directory` or `--version`, `--publisher-policy`
and `--readiness` arguments as the Node entry point. Python 3.12 and system CA
certificates must be present. No pip packages or third-party apt repositories
are added.

After checking root ownership and readiness, it downloads Node **22.23.4** from
nodejs.org for the detected AMD64/ARM64 architecture, checks a reviewed pinned
SHA-256 digest before extraction, bounds archive sizes, rejects path escapes and
unsafe links, and atomically installs `/opt/node`. The runtime is not replaced
if an unrelated `/opt/node` already exists. An exact receipt allows reuse after
a later application-install failure. A process lock prevents concurrent installs.
The runtime stays installed if application installation fails; application data
and installation receipts are preserved by the existing installer.

The native-first-install CI now uses this entry point and downloads the actual
pinned runtime instead of linking the runner's Node into `/opt/node`. It then
runs the existing login, persistence, update and installation-failure proof.
The runtime is not automatically upgraded during core updates. Runtime security
updates require a separately reviewed lifecycle change; publisher trust and
production readiness remain closed until independently configured.
