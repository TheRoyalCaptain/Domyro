# Geïsoleerd herstel van versleutelde configuraties

**Status:** Mijlpaal in de ontwikkeling, geen productieherstel en geen installatie op apparatuur van de eigenaar.  
**Projectbeheer:** AI-ondersteunde ontwikkeling onder toezicht en in samenwerking met [@TheRoyalCaptain](https://github.com/TheRoyalCaptain).

## Wat nu echt werkt

De module `src/lifecycle/config-fixture-restore.mjs` neemt een versleutelde `DOMYROS2`-back-up met `DOMCONF1`-configuratiegegevens en kan maximaal twaalf expliciet geselecteerde kleine testbestanden herstellen in een **nieuw aangemaakte, privé-herstelmap**.

Het herstelproces:

1. Controleert de aangevraagde herstelmap op een strikte, uitsluitend voor tests bedoelde naam `domyro_restore_test_...`. Een bestaande map of bestand mag **nooit** worden vervangen.
2. Controleert de versleutelde back-up met AES-256-GCM voordat het een herstelmap aanmaakt. Een verkeerd wachtwoord of beschadigd bestand wordt geweigerd.
3. Controleert de inhoud van alle bestanden en SHA-256-checksums vooraf, en weigert padtraversal, onbekende componenten, dubbele bestanden, onjuiste lengtes en ongeldige base64-inhoud.
4. Maakt de testmap aan met 0700-rechten; bestanden krijgen 0600-rechten. Ondersteunde afzonderlijke submappen zijn `domyro_core`, `mosquitto` en `zigbee2mqtt`.
5. Schrijft alleen door het back-upformaat toegestane bestanden naar die submappen. Na het schrijven worden de bytes gecontroleerd en wordt de opslag gesynchroniseerd.
6. Maakt pas na volledig succesvol schrijven `RESTORE_VERIFIED.json` aan. Zonder die marker is de herstelmap **onvolledig**. Daarna verifieert de module alle herstelde bestanden nogmaals rechtstreeks vanaf schijf.
7. Ruimt een door deze bewerking nieuw aangemaakte, gedeeltelijke herstelmap op als er tijdens het uitvoeren een fout optreedt. Bij een echte stroomuitval kan een onvolledige map achterblijven; die telt nooit als geslaagd en mag niet worden hergebruikt.

De onafhankelijke controle `inspectScratchConfigRestore` weigert ontbrekende of gewijzigde bestanden, extra bestanden, onbetrouwbare rechten, symbolische links en gewijzigde inhoud. De marker is **niet cryptografisch ondertekend**; deze controle bewijst alleen de integriteit van de tijdelijke testbestanden volgens hun lokale manifest, **niet** de veiligheid van een productieherstel.

## Testresultaten en grenzen

Automatische tests op Ubuntu 24.04 (x86-64 én ARM64, Node 22 en 24) controleren volledige herstelinhoud, hashcontrole, geen overschrijvingen, ongeldig wachtwoord, ongeldige inhoud, symlink-doelen, storingen na het eerste bestand en controles na herstel. Een aanvullende test gebruikt in een **tijdelijke testomgeving** zowel een echte PostgreSQL 17-databaseback-up als een afzonderlijk versleuteld configuratiepakket en herstelt beide naar nieuwe, afzonderlijke bestemmingen.

De PostgreSQL- en configuratieback-ups worden in de test **apart** gemaakt en hersteld. Er is nog geen gecoördineerde, consistente snapshot van het gehele smart-homesysteem, geen herstel naar een draaiende Domyro-installatie en geen garantie dat het geheel na een servercrash operationeel wordt. Een geslaagde test verandert niets aan D-53.

**Nog te bouwen:** veilig herstel van alle echte Domyro-instellingen en secrets, MQTT/Zigbee2MQTT-configuraties, Matter-fabrics en uploads, onderlinge consistentie, onafhankelijke disaster-recovery-acceptatie, automatische back-upplanning, NAS/USB-doelen, handmatige veilige updates met rollback en de complete ééncommando-installer.

Zie ook [BACKUP-CATALOG-RECOVERY.md](BACKUP-CATALOG-RECOVERY.md), [INSTALL-UPGRADE-GATE.md](INSTALL-UPGRADE-GATE.md) en [AI-DEVELOPMENT.md](AI-DEVELOPMENT.md).
