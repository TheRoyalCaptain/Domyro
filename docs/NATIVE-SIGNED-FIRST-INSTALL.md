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
