# Domyro: echte PostgreSQL-eerste-installatieproef via native systemd

**Ontwikkelstatus: 2 november 2026.** Alleen op wegwerpbare, door GitHub gehoste Ubuntu 24.04-machines; **geen distributie-installer en geen toestemming voor installatie op eigen apparatuur**.

**Project:** ontwikkeld met AI onder leiding, toezicht en in samenwerking met [@TheRoyalCaptain](https://github.com/TheRoyalCaptain).

## Wat nu daadwerkelijk werkt in CI

De bestaande native service-integratie is uitgebreid met een extra matrix van **Ubuntu AMD64 en ARM64**. Die nieuwe jobs gebruiken elk een zelfstandige, tijdelijke Docker-gehoste PostgreSQL 17-database op loopback.

1. Een CI-bewaking controleert exact dat het proces op een GitHub-hosted Ubuntu 24.04-runner wordt uitgevoerd. Het PostgreSQL-doel moet exact overeenkomen met de wegwerpverbinding `domyro_test`. Andere servers, willekeurige URL's en eigen apparatuur zijn uitgesloten.
2. Domyro wordt vanuit een **Ed25519-ondertekende ontwikkelbronbundel** uitgepakt. Die bevat nu expliciet de migratie-CLI `scripts/migrate-db.mjs` en de console-bootstrap-CLI `scripts/bootstrap-owner.mjs`; CI- en releasesigningtools worden juist niet meegeleverd. Een integriteitscontrole vóór en na `npm ci --omit=dev --ignore-scripts` beschermt alle meegeleverde bronbestanden.
3. Een aparte PostgreSQL-testdatabase wordt aangemaakt; vervolgens wordt **met de CLI uit de ondertekende bundel** de schema-migratie uitgevoerd, met controle op de status. De eerste eigenaar en een site worden in dezelfde nieuwe database geïnitialiseerd. Een tweede eigenaar-bootstrap moet expliciet worden geweigerd.
4. Voor de Domyro-service wordt een **aparte PostgreSQL-runtimegebruiker** met willekeurig CI-wachtwoord aangemaakt. Deze krijgt alleen verbinding, schematoegang en de benodigde `SELECT/INSERT/UPDATE/DELETE`-rechten op de huidige tabellen en sequences. De migratie-/beheerdersidentiteit wordt niet aan het webproces gegeven. De test verifieert dat de runtimegebruiker **geen tabellen mag aanmaken**, en controleert expliciet de geweigerde DDL-poging.
5. Er wordt op de disposable CI-machine een echte, beperkte Linux-gebruiker zonder inlogshell aangemaakt, een root-owned broninstallatie en private configuratiemap voorbereid en een *tijdelijke* native systemd-unit geïnstalleerd maar niet ingeschakeld voor opstart bij boot. Het webproces gebruikt het beperkte databaseaccount, niet de databasebeheerder.
6. Vanuit het draaiende native Domyro-proces wordt een echte HTTP-login gedaan. De proef controleert het HttpOnly-sessiecooky, eigen site, rolgebaseerde toegang tot de updatepagina en weigering van update-installaties met **HTTP 423 / D-53**. Daarna wordt een kamer opgeslagen.
7. Er volgt een normale `systemctl restart`, een tweede login en een controle dat de kamer persistent gebleven is. Na een doelbewuste `SIGKILL` van *alleen de tijdelijke Domyro-unit* herstart systemd de service opnieuw en worden login, kamer en updateblokkade nogmaals gevalideerd.
8. Bij afronding worden de tijdelijke systemd-unit, Linux-account, bron- en configuratiemap, PostgreSQL-testdatabase én beperkte testrol opgeruimd. Alle acties zijn strikt beperkt tot CI.

## Concrete bewijsvoering

De workflow `.github/workflows/native-systemd-integration.yml` bevat naast de bestaande tests twee jobs `CI-only native PostgreSQL + owner`, voor AMD64 en ARM64. Beide zijn geslaagd, inclusief gescheiden SQL-rechten en behoud van de kamer na twee serviceherstarts.

## Wat nog ontbreekt

Dit is een **substantiële stap richting eerste native installatie**, maar nog niet het eindproduct:

- Een **echt ééncommando-Ubuntu-installatieprogramma** met geautoriseerde, getekende distributie, gecontroleerde runtime en installaties op volledig schone VM's inclusief reboot.
- Verantwoorde productie-HTTPS, eerste-inrichtingswizard, accountsessiebeveiliging en wachtwoord-/herstelbeleid.
- Individuele keuzes voor beheerde versus externe PostgreSQL, MQTT/Zigbee2MQTT en Matter, zonder bestaande services over te nemen.
- Gecoördineerde versleutelde back-up en herstel van live database, configuratie, integratiesleutels, Matter-fabrics en bijbehorende processen.
- Een met die herstelketen geïntegreerde, **handmatig goedgekeurde** updater die crash-/stroomuitvalproeven en volledige rollback doorstaat.

De PostgreSQL-rollen in deze oefening zijn beperkt, maar een productieontwerp moet nog migratierollen, tabelfuture-grants, credentialrotatie en verdere afscherming beoordelen.

**D-53 blijft GESLOTEN**, en de eigenaar heeft geen toestemming gegeven om op eigen apparatuur te installeren. Zie [INSTALL-UPGRADE-GATE.md](INSTALL-UPGRADE-GATE.md), [AI-DEVELOPMENT.md](AI-DEVELOPMENT.md), [README.md](../README.md).
