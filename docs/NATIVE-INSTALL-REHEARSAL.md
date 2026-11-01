# Domyro: volledige ontwikkelbronbundel en geïsoleerde native installatieproef

**Datum:** 1 november 2026  
**Status:** Ontwikkelbewijs, **geen ééncommando-productieinstaller**.  
**D-53:** GESLOTEN. Geen wijzigingen aan servers, Home Assistant, Zigbee, MQTT, Matter of netwerkapparaten van de eigenaar.  
**Project:** door AI ontwikkeld onder leiding, toezicht en samenwerking van [@TheRoyalCaptain](https://github.com/TheRoyalCaptain).

## Wat gebouwd is

### Complete ondertekende bronbundel

De bestaande `tools/build-release.mjs` verpakte eerder slechts een klein deel van Domyro. De ontwikkelpacker omvat nu alle reguliere bronbestanden in `src/` en alle webbestanden in `web/`, plus `package.json`. Bestanden worden deterministisch gesorteerd. Symbolische links, verborgen of onbekende bestandstypen, individuele bestanden groter dan 8 MiB en te grote/talrijke bundels worden geweigerd.

Daardoor zitten de huidige localhost-login, de beveiligings- en databasemodules, SQL-migraties, Zigbee2MQTT-observer, lifecycle/recovery-code en frontendbestanden in de ondertekende **source**-bundel. Tests controleren de aanwezigheid van de belangrijkste onderdelen en uitsluiting van tests/documentatie.

De **Ed25519-signatuur** wordt over exacte manifestbytes gemaakt met een apart aangeleverde ontwikkel-private sleutel. De CI genereert tijdelijke testkeys, **niet de officiële sleutel van @TheRoyalCaptain**. SHA-256 hoort bij ieder archief. De manifestdatabaseversie wordt nu afgeleid van de opeenvolgende SQL-migratiebestanden (momenteel schema **3**), in plaats van onterecht hardcoded schema `0`; er wordt **geen migratiecompatibiliteit** beloofd bij een schemawijziging.

**Nog geen native pakket:** Node.js, platformspecifieke dependencies (`pg`, `mqtt`, `argon2`), een geverifieerde dependency lockfile, Ubuntu-repository/apt-installatiestappen, officiële handtekeningsleutel en echte `systemd`-installatie worden niet gebundeld of geconfigureerd. De sourcebundle kan dus **niet** als compleet geïnstalleerd product worden verspreid.

### Echte localhost-opstartproef van de ondertekende bundel

De nieuwe module `src/lifecycle/native-rehearsal.mjs`:

1. Maakt **zelf** een nieuwe tijdelijke map via het besturingssysteem aan, niet een door de gebruiker gekozen installatielocatie.
2. Controleert de Ed25519-handtekening, SHA-256 en exacte amd64/arm64-hostarchitectuur en staged de broncode in deze map.
3. Controleert de verwachte Domyro-projectidentiteit en genereert ter beoordeling een **niet geïnstalleerde** systemd-unittekst.
4. Importeert de **daadwerkelijk uitgepakte** `src/server.mjs` en start een echte Domyro HTTP-server op een willekeurige lokale `127.0.0.1`-poort.
5. Controleert live `/api/v1/health/live`, `/api/v1/health/ready`, `/api/v1/public/status`, `/login` en de belangrijkste webassets.
6. **Eist** dat readiness `503 not_ready` en `productionReady: false` blijven wanneer database en operationele configuratie ontbreken.
7. Sluit de proefserver en verwijdert de gehele tijdelijke map, zowel na succes als bij fout. Tests injecteren ongeldige sleutel, gewijzigde bundel, fout tijdens preflight en verkeerde architectuur.

Dit test het **daadwerkelijk opstarten van de huidige development-frontend en API vanuit een signed sourcebundle**, niet PostgreSQL-connectiviteit of Zigbee- of Matter-aansturing. Er wordt niets op de host geïnstalleerd, geen `systemd`-unit geactiveerd en geen bestaande installatie vervangen. Het is geen test van langdurig draaien, opstarten na stroomuitval of de veilige updater.

## Volgende noodzakelijke stappen

1. Verifieerbare, gereproduceerde **native dependency-installatie** voor Ubuntu Server LTS amd64 en ARM64, inclusief complete pakket-lock/digest/pinning, Node-runtime en rechten.
2. Werkelijke eenmalige **native systemd/hostinstallatie** op compleet wegwerpbare Ubuntu-VM's, met eigenaarschap van servicepaden, expliciete servicekeuzes, idempotentie, foutinjectie en cleanup.
3. Beveiligde owner onboarding, vertrouwde verbinding/TLS en verifieerbare connectie met beheerde of externe PostgreSQL/MQTT-diensten.
4. Volledige gecorreleerde back-up en restore van gegevens, configuraties en integratiesleutels, en realistische mislukte-upgradeherstelproeven.
5. Officiële releasefeed, handmatig goedgekeurde update-engine met geteste migratie/rollback en gecontroleerde gezondheid na herstart.
6. Onafhankelijke bare-metal/VM-tests en afzonderlijke toestemming van @TheRoyalCaptain voor installatie op diens eigen server.

**Dit is een technische mijlpaal, niet het moment om Domyro op een eigen Ubuntu-server te installeren.**

Zie [INSTALL-UPGRADE-GATE.md](INSTALL-UPGRADE-GATE.md), [INSTALLER-UPDATE-CENTER-MILESTONE.md](INSTALLER-UPDATE-CENTER-MILESTONE.md), [AI-DEVELOPMENT.md](AI-DEVELOPMENT.md).
