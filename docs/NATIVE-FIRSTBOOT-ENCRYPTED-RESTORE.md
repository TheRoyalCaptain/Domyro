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
6. De afzonderlijke restore-database wordt verwijderd. In een private CI-receipt worden uitsluitend de twee SHA-256-waarden en aantallen bewaard. De fsynced firstbootjournal-fase `postgres_scratch_restore_verified` wordt pas vastgelegd nadat die bewijscontrole geslaagd is. Daarna vereist de afzonderlijke `config_scratch_restore_verified`-fase aanvullend bewijs van een teruggezette configuratie.
7. De `SIGKILL`-test stopt het installatieproces daarna abrupt. De buitenliggende hersteltest verifieert eerst het overgebleven journal, de nog draaiende Domyro-service en de oorspronkelijke database. Vervolgens wordt **dezelfde bewaarde versleutelde back-up opnieuw in een lege testdatabase** teruggezet en met het oude bewijs vergeleken. Hierna worden uitsluitend de tijdelijke CI-bronnen expliciet opgeruimd.

De wachtwoordsleutel bestaat uitsluitend in een `0600`-bestand onder de private CI-staging-directory. Dit is testmateriaal, geen veiligheidsontwerp voor officiële back-upopslag, herstelzinnen of remote NAS/USB.

## Scope en noodzakelijke vervolgstappen

Dit is herstelbewijs **voor de werkelijke PostgreSQL-applicatiedata én een beperkte selectie van runtime- en systemd-configuratie van een wegwerptest**, niet voor productie. Mosquitto/Zigbee2MQTT, Matter-fabrics, externe certificaten, onafhankelijke sleutelopslag en integratiegeheimen worden nog niet als geheel meegenomen. Er is nog geen consistente live database+config-snapshot, geen verifieerbare externe opslag, geen live restore-procedure, geen wachttijd-/retentiebeleid, geen echte stroomuitvalproef en geen goedgekeurde installer of updater.

De nieuwe adapter weigert iedere andere database-URL dan de exacte Docker-hosted CI-service, iedere andere directory dan de run-specifieke `.domyro-ci-signed-*`-werkmap en ieder ander commando dan `create` of `verify`. De geïsoleerde firstboot-fases worden uitsluitend onder `/tmp/domyro-firstboot-test-*` opgeslagen. De signing key is tijdelijk, niet officieel.

**Belangrijk:** een geslaagde scratch-restoratie is nog geen toestemming om productiegegevens te verwijderen, te overschrijven of automatisch een update uit te voeren. Alle 14 D-53-installatiechecks blijven geblokkeerd.

## Aanvullend: echte systeemconfiguratie bewaren en terugzetten

`scripts/ci-native-config-restore-proof.mjs` gebruikt de bestaande
`createEncryptedConfigFixture()` en `restoreConfigFixtureToScratch()`.
De CI-installatie kopieert **alleen** twee run-specifieke nieuwe bestanden
met expliciete private permissies naar zijn eigen afgeschermde stagingruimte:

- `native-runtime.env`, uit de op deze testmachine aangemaakte
  `/etc/<CI-service>/development.env` met de tijdelijke DB-verbinding
- `native-unit.service`, uit de op deze testmachine aangemaakte
  `/run/systemd/system/<CI-service>.service` met systemd-hardening

Beide bestanden gaan samen in de eigen versleutelde
`native-config.domyrobackup`. Het wachtwoord is niet in de repository
opgenomen. Een **apart, leeg, uitsluitend tijdelijk directorydoel** wordt
gevuld en daarna opnieuw als bestanden met exact dezelfde SHA-256-hashes
gecontroleerd. Ongeldige wachtwoorden en herhaald herstel naar hetzelfde
gevulde doel worden geweigerd.

In de zelfstandige SIGKILL-proef worden diezelfde versleutelde bestanden
**opnieuw** hersteld en met de vóór de crash vastgelegde hashes vergeleken.
De opgeslagen `ci-native-config-restore-proof.json` bevat uitsluitend
bestandsnamen en SHA-256-hashes, nooit de configuratiegeheimen.

Deze proef gebruikt bewust de tijdelijke runtimegeheimen van de CI-run.
Dit is **geen volledig herstelbaar productieback-upformaat**, en het
bestaat nog niet uit een gecoördineerde atomaire snapshot van PostgreSQL,
Domyro-configuratie, MQTT/Zigbee2MQTT en Matter-fabrics.

## Negatieve tests van de versleutelde PostgreSQL-snapshot

Aanvullend wordt een **aparte kopie** van de versleutelde dump expres
beschadigd. AES-GCM-authenticatie moet de gewijzigde ciphertext afwijzen
voordat PostgreSQL schrijft. Ook wordt een tweede restore naar de al
gevulde, tijdelijke database geweigerd. De oorspronkelijke brondata
worden na deze operaties opnieuw inhoudelijk gecontroleerd.

**Productiegebruik blijft verboden tot de volledige D-53-gates zijn bewezen.**
