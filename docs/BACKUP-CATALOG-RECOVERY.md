# Backupcatalogus en hersteldekking: ontwikkelfase

**Status 1 november 2026:** code gebouwd en geïsoleerd getest. **D-53 blijft GESLOTEN**. Geen installatie op de server van de eigenaar, geen automatische back-ups, geen destructieve retentie en geen veilig herstel van een bestaande installatie.

## De back-upcatalogus

`src/lifecycle/backup-catalog.mjs` registreert bestaande lokale, versleutelde `DOMYROS2`-bestanden met een **onveranderlijke, atomair geschreven receipt** (`*.domyrobackup.receipt.json`). Deze bevat bestandstype, bestandsnaam, lokale doelcode, datum, omvang en SHA-256-controlesommen. Geen wachtwoord, sleutel of configuratie-inhoud wordt in een receipt opgenomen.

Er zijn nu twee ondersteunde ontwikkeltypes:

- `postgresql-custom`: reeds bestaande, versleutelde PostgreSQL-back-up. De catalogus verifieert een nieuwe AES-GCM-decryptie, controlesommen en de PGDMP-kop. Een geldige PostgreSQL-kop is **geen bewijs dat pg_restore slaagt**.
- `domyro-selected-config-fixture`: een versleuteld testpakket met expliciet geselecteerde privébestanden voor `domyro_core`, `mosquitto` en `zigbee2mqtt`. Alle interne bestandschecksums worden gecontroleerd. Het pakket is **geen** volledige of herstelde configuratie van een operationele smart-home-server.

Een ontbrekende receipt, een verkeerd wachtwoord, een symlink, onveilige permissies, een gewijzigd bestand of een onbetrouwbare registratie wordt als **niet geverifieerd** getoond. Een opgeslagen receipt wordt nooit zelfstandig als bewijs van herstel beschouwd.

`scripts/inspect-backup-catalog.mjs` is een **handmatige, alleen-lezen** inspectie van een vooraf bestaande privé-directory. Met een optioneel privéwachtwoordbestand kan de ontwikkelaar de bestandsauthenticatie opnieuw laten uitvoeren. Het script verwijdert of verplaatst niets, beheert geen back-upschema, schrijft geen bestanden en benadert geen netwerkschijven. De ontwikkelaar kan in een **geïsoleerde testomgeving** aanroepen:

```bash
npm run backup:catalog -- --directory /absolute/private/test-backups
# Optioneel een privébestand (0600) met de testsleutel:
npm run backup:catalog -- --directory /absolute/private/test-backups --password-file /absolute/private/test-secret
```

**Nooit uitvoeren tegen de operationele Home Assistant-, Zigbee2MQTT- of PostgreSQL-bestanden van de eigenaar.**

## Retentie en veilig verwijderen

De bestaande planningsregel blijft **7 dagelijkse, 4 wekelijkse en 12 maandelijkse** snapshots, onafhankelijk per opslagbestemming. Deze catalogus is momenteel alleen voor de **lokale** ontwikkelbestemming ingericht. `catalogRetentionSuggestions` gebruikt de bestaande pure retentieplanner, maar voert bewust alle records als **niet herstelbewezen** aan. Daardoor levert zelfs een vervalste status `verified: true` geen verwijderadvies op. **Er bestaat nog geen functie die back-ups verwijdert of oude herstelpunten automatisch opruimt.**

Voordat retentie veilig kan worden geactiveerd, moet Domyro een onafhankelijke hersteltest van de **volledige** herstelset registreren en verifiëren, inclusief consistentie over PostgreSQL, configuratiebestanden, integratiesleutels en eventueel Matter-fabrics. Ook moet een bestandsverwijdering nog apart door eigenaarschap, bestemming, bewaarbeleid en laatste herstelpunt worden begrensd.

## Configuratieback-ups: wat is er echt gebouwd?

`src/lifecycle/config-fixture-backup.mjs` leest maximaal twaalf expliciet geselecteerde kleine bestanden rechtstreeks uit een privé **testmap**, weigert symlinks, onveilige bestandsrechten en padtraversal, en versleutelt deze als één `DOMYROS2`-backup. Met `inspectEncryptedConfigFixture` kan de versleutelde inhoud en de SHA-256 van elk bestand worden geverifieerd zonder de inhoud aan de gebruiker te tonen. **Herstellen naar echte operationele systeemconfiguratie is nog niet geïmplementeerd.** Er is nu wél een afzonderlijke testmodule die geselecteerde configuraties uitsluitend in een **nieuwe privé-herstelmap** terugzet, met controles op checksums, permissies, ontbrekende of extra bestanden en mislukte writes. Zie [SCRATCH-CONFIG-RESTORE.md](SCRATCH-CONFIG-RESTORE.md). Deze code mag geen willekeurige mappen van de host scannen.

Er is **nog geen automatische toegang** tot echte Mosquitto-/Zigbee2MQTT-configuratie, Domyro-opslag, uploadbestanden, wachtwoordkluizen, certificaten of Matter-fabrics. Die moeten per beheerde of externe service met expliciete toestemming, versleutelde opslag en geteste terugzetprocedures worden ontworpen.

## Volledigheidscontrole

`src/lifecycle/recovery-coverage.mjs` beschrijft zeven vereiste of conditionele herstelcomponenten: PostgreSQL, Domyro-configuratie, account-/herstelsleutels, uploads, Mosquitto, Zigbee2MQTT en Matter-fabrics. De contractcontrole signaleert ontbrekende bestanden, onvolledige decryptie, niet-geteste herstelacties of ontbrekende consistentie tussen componenten. Zelfs wanneer een ontwikkelaar alle contractvelden op waar zet, blijft **productieherstelgoedkeuring altijd false**. Dit is slechts een planning- en testcontract, geen onafhankelijke technische attestatie.

## Testbewijs en resterend werk

GitHub Actions controleert de catalogus en configuratiefixtures op Ubuntu 24.04 voor amd64 en ARM64, met Node.js 22 en 24. De reeds bestaande PostgreSQL-integratietest neemt nu ook een echt gegenereerde `DOMYROS2`-backup in de catalogus op. Tests bestrijken ontbrekende registraties, gewijzigde ciphertext, verkeerde wachtwoorden, symlinks, onveilige rechten, config-typen, back-upregistratie en het uitsluiten van alle automatische verwijderadviezen.

**Nog open:** echt operationeel herstel van alle configuratie en sleutels in een nieuwe installatie (de geïsoleerde testconfiguratieherstelmodule is nog geen productieherstel), onafhankelijke herstelbewijsregistratie, back-upschema, opslagdoelen (USB, NAS/SMB, SFTP, enzovoort), versleutelde back-upbestemming/kluis, key recovery, schijfruimtecontrole, hervatten na stroomuitval, authenticatie over netwerk, volledige handmatig goedgekeurde updater met databasecompatibiliteit en rollback en de native ééncommando-Ubuntu-installer. Geen van die eisen mag als geslaagd worden gemarkeerd enkel omdat de catalogustests slagen.

Zie [INSTALL-UPGRADE-GATE.md](INSTALL-UPGRADE-GATE.md), [STREAMED-BACKUP-V2.md](STREAMED-BACKUP-V2.md), [PLATFORM-SERVICES-BACKUPS.md](PLATFORM-SERVICES-BACKUPS.md).
