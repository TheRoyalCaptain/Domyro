# Domyro: echte PostgreSQL-back-up en geïsoleerde herstelproef

**Ontwikkelmijlpaal (2026-11-01):** de databaseback-up gebruikt nu werkelijk PostgreSQL 17 `pg_dump` en `pg_restore`, in combinatie met een geauthenticeerd versleuteld back-upbestand.

**D-53: INSTALLATIE OP DE SERVER VAN DE EIGENAAR BLIJFT GEBLOKKEERD.**

## Wat aantoonbaar werkt

De nieuwe module `src/lifecycle/postgres-snapshot.mjs` ondersteunt een **kleine geïsoleerde testdatabase**:

1. Een PostgreSQL 17 custom-format archief van het `public` schema maken met `pg_dump`, zonder eigenaars- of privilegeverklaringen.
2. De exacte archiefinhoud controleren op `PGDMP`-opmaak en een SHA-256-checksum opnemen in de back-upmetadata.
3. Het back-updocument versleutelen via de bestaande AES-256-GCM + scrypt-module (met willekeurig salt en nonce). Er wordt geen wachtwoord in het archief opgenomen.
4. Voor herstel eerst decryptie, authenticatie, archieflengte en SHA-256-validering uitvoeren.
5. Herstel **uitsluitend naar een nieuw aangemaakte, lege testdatabase** met naam `domyro_restore_test_...` toestaan. Geen `DROP`, `--clean`, `--create` of destructieve overschrijving uitvoeren.
6. Een `pg_restore --single-transaction --exit-on-error` toepassen. Bij een fout wordt de PostgreSQL-transactie afgebroken; herstel naar een ongeschikte of al gevulde database wordt geweigerd.
7. De historische Domyro-migratiechecksums na herstel controleren.

De CI maakt een geïsoleerde bron- en doeldatabase op PostgreSQL 17, vult de bron met een installatie, gebruiker, woning, kamergegevens, integratie, Zigbee-apparaat en waarnemingen, versleutelt de echte dump en herstelt deze. Daarna vergelijkt de test onder meer aantallen, apparaatidentiteit, observatiewaarde, gebruikersgegevens en migratiestatus. Er zijn tevens tests voor verkeerd wachtwoord, beschadigde ciphertext, herhaalde restore, verkeerde doelnaam, een niet-lege database en een **authentiek versleutelde maar ongeldige PostgreSQL-archive**.

In CI worden de pg-tools uit de **PostgreSQL 17 Docker-testimage** gebruikt, op Ubuntu x86-64/ARM64 met Node 22/24. Dit installeert niets op apparaten van de eigenaar. De gebruikte testwachtwoorden zijn tijdelijk en niet bedoeld voor productie.

## Grenzen van deze eerste versie

**Dit is een echte database-hersteldemonstratie, maar nog geen volledige Domyro-back-upoplossing.**

- De huidige in-memory AES-module ondersteunt maximaal 32 MiB plaintext. Daarom is het PostgreSQL-custom-archief voorlopig conservatief begrensd op **20 MiB**, en worden backups geheel in RAM verwerkt. Grote huishoudelijke historie en mediabestanden werken hiermee niet. De productieversie moet versleuteling en verwerking streamen, met redelijke RAM- en schijflimieten.
- Alleen het PostgreSQL-`public`-schema is opgenomen. **Niet** afgedekt zijn OS/service-instellingen, MQTT-brokerconfiguratie, externe Zigbee2MQTT-data, Matter-fabrics en sleutels, bestandsuploads, certificaten en secrets buiten PostgreSQL. Die zijn noodzakelijk voor herstel van een compleet smart-home-systeem.
- De ontwikkelmodule beheert geen opslagbestemming, periodieke jobs, USB/NAS/SMB, back-upretentie, key-rotatie, secure keystore, hostinstallatie, databaserollen of al bestaande databases.
- Er is geen veilig herstel van een operationele database en geen automatische database-terugrol tijdens een software-update. **Dit prototype weigert juist een niet-lege restore-database.**
- Een live database kan tijdens het schrijven veranderen. `pg_dump` levert een consistente PostgreSQL-snapshot, maar de **gecombineerde** staat van Domyro, bestanden, MQTT/Zigbee2MQTT en Matter vereist nog een transactioneel herstelplan.
- Deze test gebruikt expliciete tijdelijke PostgreSQL-databases. Er is nog geen afzonderlijk betrouwbare productiesigning key, onafhankelijk geteste noodherstelprocedure of ééncommando Ubuntu-installer. Er is dus nog **geen productie-installatiecommando**.

## Volgende noodzakelijke stappen

1. Versleutelde **streaming** back-up met aangewezen veilige opslag en limieten.
2. Uitbreiden naar alle Domyro-configuratie, integratiesleutels, Matter-fabric data en persistentie buiten PostgreSQL.
3. Een gecontroleerde `domyro repair`/restore-wizard naar een **nieuwe geïsoleerde installatie**, inclusief hersteltesten van sessies, permissies, integraties en migraties.
4. Manuele updater met compatibiliteitspreflight, back-upverificatie, herstelbare schema-migraties, healthchecks en rollback of veilige herstelmodus.
5. Complete native Ubuntu Server LTS amd64/arm64 one-command installer, veiligheidsreview, echte VM/bare-metal tests en een **afzonderlijke expliciete toestemming** voordat de eigenaar Domyro op zijn eigen server installeert.

Zie ook [INSTALL-UPGRADE-GATE.md](INSTALL-UPGRADE-GATE.md), [SAFETY-FOUNDATION.md](SAFETY-FOUNDATION.md), [TEST-RELEASE.md](TEST-RELEASE.md).
