# Domyro: echte native firstboot-databaseback-up en dubbele restoreproef

**Datum:** 2 november 2026. **Status:** alleen disposable GitHub Actions Ubuntu 24.04 (AMD64/ARM64); **D-53 blijft gesloten**.

## Waarom

Een installatie die na een crash netjes herstart, is niet automatisch een installatie waarvan de eigenaar zijn **gegevens kan terugzetten**. Daarom koppelt deze proef de bestaande Domyro AES-256-GCM-versleutelde streaming-back-up en PostgreSQL 17-restore aan een *daadwerkelijk draaiende native Domyro-testinstallatie*, inclusief echte login en opgeslagen kamer.

## Volledig geteste stroom

Het nieuwe `scripts/ci-native-backup-restore-proof.mjs` werkt alleen met de vaste CI-PostgreSQL-service en de run-specifieke, net gecreëerde tijdelijke Domyro-database:

1. Na een succesvolle HTTP-aanmelding, site- en kamermodificatie worden de huidige gebruiker, site, lidmaatschap en kamer als deterministisch gesorteerde data opgehaald en als SHA-256-overzicht vergeleken. Er worden **geen wachtwoordhashes of gebruikersrijen gelogd**.
2. `pg_dump` maakt een PostgreSQL 17 `custom`-dump van uitsluitend de ontwikkeltestdatabase. Domyro schrijft die met de reeds aanwezige streamende AES-256-GCM-functie in een private `DOMYROS2`-back-up met een tijdelijk gegenereerde CI-passphrase.
3. Een afzonderlijke, volledig lege `domyro_restore_test_<runid>_<attempt>`-database wordt gecreëerd. Een herstelpoging met **verkeerd wachtwoord** moet falen voordat de restoretool toegang tot die database krijgt.
4. Herstel met het juiste wachtwoord gebeurt in één PostgreSQL-transactie, zonder `--clean`, `--create` of herstel over bestaande productiegegevens heen.
5. Domyro verifieert de schema- en migratieversie en vergelijkt de teruggezette gebruikers, sites, lidmaatschappen en kamers **inhoudelijk** met de oorspronkelijke bron. Niet alleen het exitcode van `pg_restore` telt.
6. De afzonderlijke restore-database wordt verwijderd. In een private CI-receipt worden uitsluitend de twee SHA-256-waarden en aantallen bewaard. Een nieuwe `postgres_scratch_restore_verified`-fase wordt pas in het fsynced firstbootjournal vastgelegd nadat die bewijscontrole geslaagd is.
7. De `SIGKILL`-test stopt het installatieproces daarna abrupt. De buitenliggende hersteltest verifieert eerst het overgebleven journal, de nog draaiende Domyro-service en de oorspronkelijke database. Vervolgens wordt **dezelfde bewaarde versleutelde back-up opnieuw in een lege testdatabase** teruggezet en met het oude bewijs vergeleken. Hierna worden uitsluitend de tijdelijke CI-bronnen expliciet opgeruimd.

De wachtwoordsleutel bestaat uitsluitend in een `0600`-bestand onder de private CI-staging-directory. Dit is testmateriaal, geen veiligheidsontwerp voor officiële back-upopslag, herstelzinnen of remote NAS/USB.

## Scope en noodzakelijke vervolgstappen

Dit is herstelbewijs **voor de werkelijke PostgreSQL-applicatiedata in een wegwerptest**, niet voor productie: configuratiebestanden, sleutels, Mosquitto/Zigbee2MQTT en Matter-fabrics worden niet meegenomen. Er is nog geen consistente live database+config-snapshot, geen verifieerbare externe opslag, geen live restore-procedure, geen wachttijd-/retentiebeleid, geen echte stroomuitvalproef en geen goedgekeurde installer of updater.

De nieuwe adapter weigert iedere andere database-URL dan de exacte Docker-hosted CI-service, iedere andere directory dan de run-specifieke `.domyro-ci-signed-*`-werkmap en ieder ander commando dan `create` of `verify`. De geïsoleerde firstboot-fases worden uitsluitend onder `/tmp/domyro-firstboot-test-*` opgeslagen. De signing key is tijdelijk, niet officieel.

**Belangrijk:** een geslaagde scratch-restoratie is nog geen toestemming om productiegegevens te verwijderen, te overschrijven of automatisch een update uit te voeren. Alle 14 D-53-installatiechecks blijven geblokkeerd.
