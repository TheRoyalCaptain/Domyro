# Domyro — native installer en updatecentrum: technische ontwikkelmijlpaal

**Status:** ontwikkelcode, geen productie-installer.  
**Projectbeheer:** AI-ondersteund gebouwd in samenwerking met en onder toezicht van [@TheRoyalCaptain](https://github.com/TheRoyalCaptain).  
**D-53:** **gesloten**. Niets op de server van de eigenaar installeren of upgraden.

## Updatecentrum in de lokale webinterface

De bestaande beveiligde **localhost-ontwikkelomgeving** heeft nu een gedeelte **Systeemupdates**, bereikbaar nadat een eigenaar of beheerder inlogt op `/login`.

- `GET /api/v1/system/updates` vereist een actieve sessie en een `owner`- of `admin`-lidmaatschap. Een gast of niet-aangemelde gebruiker krijgt geen updateoverzicht.
- Het overzicht vermeldt de huidige ontwikkelversie, de status van de officiële releasebron en de installatieblokkade D-53.
- Zolang er geen officiële releasefeed en volledig goedgekeurde installer/updater zijn, toont het overzicht **geen vertrouwde updates** en blijft **Update installeren uitgeschakeld**.
- Zelfs `POST /api/v1/system/updates/install` met een geldige eigenaarssessie, correcte Origin en CSRF-token retourneert **HTTP 423** (`installation_gate_closed`). Het voert geen installatie-, database-, restart- of downloadactie uit.
- De status is bewust geen claim dat de officiële productieaanmelding, HTTPS of de installer gereed zijn. Netwerktoegang blijft uitsluitend een localhost-testfunctie.

`src/lifecycle/update-center.mjs` controleert afzonderlijk ondertekende Ed25519-releasegegevens en adviseert, zonder netwerkverkeer of neveneffecten, over:

- Stable/Beta-kanaal, nieuwere versie en exacte hostarchitectuur;
- PostgreSQL-schemaverenigbaarheid en het weigeren van nog niet bewezen databasemigraties;
- geplande downloadmomenten van 0 tot 720 uur op basis van de ondertekende publicatiedatum;
- aparte instellingen voor automatische **controles** en **downloads**;
- permanent onderscheid: **automatisch installeren is nooit toegestaan**.

**Belangrijk:** dit model is nog niet gekoppeld aan een echte, door @TheRoyalCaptain ondertekende productiefeed of aan een downloadworker. De webinterface claimt dat ook niet.

## Native Ubuntu-installatieplanning

`src/lifecycle/native-install-plan.mjs` maakt uitsluitend een **plan**, zonder op de host te schrijven. Het gebruikt de bestaande CPU-, RAM-, vrije-schijfruimte-, port- en LTS-preflight.

Het plan weigert onder andere:

- onbekende of nog niet geteste Ubuntu-releases (de huidige CI-matrix test Ubuntu 24.04, amd64 en ARM64);
- ontoereikende systeembronnen of onveilige/gereserveerde poorten;
- een bestaande Domyro-installatie, waarvoor het aparte updater-/herstelproces nodig is;
- een ontbrekende PostgreSQL-keuze of een niet-geverifieerde verbinding met een bestaande dienst;
- ieder `managed`-servicepad waarvan de installatie nog niet is geïmplementeerd.

PostgreSQL is verplicht; MQTT en Matter kunnen in het toekomstige installatieproces als bestaande dienst worden gekoppeld, beheerd of uitgesteld. Zigbee2MQTT kan voorlopig alleen als bestaande dienst worden gekozen of uitgesteld. Het model pretendeert **niet** dat ontbrekende beheerde services al automatisch geïnstalleerd kunnen worden.

Er is een tekstuele, **niet geïnstalleerde** systemd-unit voor technische beoordeling met loopbackbinding, minimale privileges en afgeschermde schrijfpaden. Dit is uitdrukkelijk geen gevalideerde productie-unit of uitvoerbare one-line installer.

## Extra mijlpaal: geteste localhost-opstart vanuit volledige ondertekende ontwikkelbundel

De source-release-builder bevat nu de volledige `src/`- en `web/`-bronnen, in plaats van de oorspronkelijke negen bestanden, en neemt de echte schema-3-reeks op in het release-manifest. De nieuwe `native-rehearsal.mjs` start de uitgepakte ondertekende code daadwerkelijk op een tijdelijke localhost-poort en controleert status-API, aanmeldscherm en assets. De proef blijft zonder database bewust `not_ready`. Ze installeert geen systemd, apt, dependencypackages of serverdiensten en vervangt geen volledige native VM-installatietest. Zie [NATIVE-INSTALL-REHEARSAL.md](NATIVE-INSTALL-REHEARSAL.md).

## Wat hierna nog verplicht is

1. Officieel ondertekende, volledig uitvoerbare **Ubuntu Server LTS amd64/arm64-installatiebundel** inclusief Node-runtime, pakketafhankelijkheden, PostgreSQL-installatie/verbinding en foutafhandeling.
2. Een werkende en veilige eerste-run wizard, met geheimenbeheer, lokale TLS/vertrouwde reverse-proxyconfiguratie en volledige accountbeveiliging.
3. Werkelijke signed release discovery, een optionele **download-only** worker en een handmatig door de beheerder bevestigde update-engine vanuit de UI.
4. Gevalideerde volledige back-up van PostgreSQL, Domyro-configuratie, noodzakelijke integratiesleutels en Matter-fabrics, met herstel van een **complete** nieuwe installatie.
5. Rollback/recovery zonder stilzwijgend gegevensverlies, gecontroleerde migraties en storingsproeven op schone en bestaande Ubuntu-VM's plus echte hardware.
6. Officiële release-autorisatie door @TheRoyalCaptain en afzonderlijke toestemming voor installatie op de eigen server.

**Geen enkel projectcommando in deze mijlpaal installeert software op de server van de eigenaar.** D-53 blijft gesloten totdat de volledige acceptatie is aangetoond.

Zie [INSTALL-UPGRADE-GATE.md](INSTALL-UPGRADE-GATE.md), [SOFTWARE-UPDATES.md](SOFTWARE-UPDATES.md), [DEPLOYMENT.md](DEPLOYMENT.md) en [AI-DEVELOPMENT.md](AI-DEVELOPMENT.md).
