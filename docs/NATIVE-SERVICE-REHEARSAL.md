# Domyro: Ubuntu native servicemap- en procesproef

**Status:** development-only, 1 november 2026. **Geen systemd-installatie of vrijgegeven ééncommando-installer.**  
**Project:** met AI ontwikkeld onder toezicht en in samenwerking met [@TheRoyalCaptain](https://github.com/TheRoyalCaptain).  
**D-53:** GESLOTEN. Geen toegang tot of wijzigingen op de eigen servers of de bestaande Home Assistant-/Zigbee-infrastructuur.

## Wat nu is gebouwd

`src/lifecycle/native-service-rehearsal.mjs` neemt de bestaande ontwikkelbronbundel, controleert de Ed25519-manifesthandtekening en SHA-256-bestandsdigest en voert een veilige native **oefening** uit.

De oefening maakt **uitsluitend onder een automatisch nieuw gemaakte, privé-tijdelijke map** de volgende structuur aan:

```text
<temporary-sandbox>/
  opt/domyro/
    .domyro-release-root
    releases/<signed-version>/...
    current -> releases/<signed-version>
  etc/domyro/
  etc/systemd/system/domyro.service    # Niet geactiveerde concept-unit
  var/lib/domyro/
  var/log/domyro/
```

De directories zijn privé en niet vrij toegankelijk voor andere gebruikers. De oefening maakt een **concept-systemd-unit** als bestand, niet op de echte locatie `/etc/systemd/system` van de Ubuntu-host en nooit via `systemctl`.

De module controleert herhaald aanmaken van de mappenstructuur. Bestaande unitbestanden die afwijken of een andere `current`-versie worden geweigerd. Voordat de testserver mag draaien, controleert Domyro **opnieuw** alle uitgepakte bestanden tegen de ondertekende release en weigert ongeautoriseerde extra bronbestanden, gewijzigde bytes, symlinks en onbetrouwbare directory-inhoud.

Daarna start de daadwerkelijke uitgepakte Domyro-server als een **apart Node.js-subproces**, met een beperkte ontwikkelomgeving, zonder PostgreSQL-/MQTT-/Matter-gegevens en gebonden aan een willekeurige lokale `127.0.0.1`-poort.

De proef controleert:

- `/api/v1/health/live` geeft HTTP 200 terug;
- `/api/v1/health/ready` blijft **HTTP 503** omdat de database en productiebeveiliging niet zijn ingeschakeld;
- `/api/v1/public/status` blijft expliciet `productionReady: false`;
- de loginpagina en JS-/CSS-bestanden worden geladen;
- de eerste instantie wordt gestopt en een **nieuw** afzonderlijk subproces doorstaat opnieuw de status- en assetcontroles;
- na succes **en** na foutinjectie verdwijnt de volledige tijdelijke mappenstructuur.

Tests proberen ook een niet-vertrouwde ondertekeningssleutel, een gemanipuleerd archief, een wijziging aan een bestaand bronbestand, een toegevoegd extra JS-bestand en een gemanipuleerde systemd-unit. Die acties moeten **vóór** het opstarten worden geweigerd.

## Bewijs en beperkingen

GitHub Actions voert de volledige reeks uit op Ubuntu 24.04 amd64 en ARM64 met Node.js 22 en 24. De nieuwe proef **start werkelijk een los Node-proces** vanuit de uitgepakte bundel, maar dat is **niet hetzelfde als een door systemd beheerde productieservice**.

Dit is bovendien **geen volledige Ubuntu-VM-installatie**: de tests draaien rechtstreeks op geïsoleerde CI-hosts met aparte tijdelijke directorystructuren. Ze installeren geen Debian-pakket, npm-dependencies, Node-runtime, PostgreSQL of native systemd-unit, configureren geen beheerdersaccount en controleren geen persistent gebruik over een machine-reboot. De ontwikkeling gebruikt een tijdelijke testsigningsleutel, niet een officiële releasehandtekening.

Een geslaagde unit-/procesproef kan niet als bewijs dienen voor veilige productie-updates of terugzetten van een complete smart-home-installatie.

## Nieuwe vervolgproef: vergrendelde dependencies en herstelbare proceswissel

De repo heeft nu een reproduceerbare npm-lockfile en een extra proef die vanuit een ondertekende ontwikkelbundel daadwerkelijk alle **production npm-dependencies** installeert in een tijdelijke directory en native Argon2-functionaliteit test op amd64 en ARM64. Een afzonderlijke proef schakelt tussen twee ondertekende releases en test na een fout een volledige herstart van het **oude proces**. De testconcept-unit wordt door `systemd-analyze verify` nagekeken, met een tijdelijk Node-uitvoerpad dat op de CI-runner bestaat. Dit zijn nog **geen** VM-installatie, productie-updater of geteste terugrol van echte databasegegevens. Zie [NATIVE-DEPENDENCIES-AND-UPDATE-REHEARSAL.md](NATIVE-DEPENDENCIES-AND-UPDATE-REHEARSAL.md).

## Volgende stappen tot de echte installatie

1. Maak een reproduceerbare, geteste en **vergrendelde dependencybundel**, inclusief Node-runtime en native PostgreSQL-/Argon2-/MQTT-dependencies voor amd64 en ARM64.
2. Bouw een expliciet geïsoleerd Ubuntu VM-testscenario waarin een eigen onprivileged serviceaccount, systemd-service, pakketafhankelijkheden, eigen poorten en eerste-startconfiguratie echt worden geïnstalleerd.
3. Maak de installer herhaalbaar, met betrouwbaar herstel na een onderbroken installatie en zonder ongevraagd ingrijpen bij bestaande PostgreSQL-/MQTT-/Zigbee-services.
4. Voltooi complete versleutelde back-ups en herstel van database, configuratie, integratiesleutels en Matter-fabrics en sluit die aan op de updater.
5. Bouw vanuit de webinterface een **handmatig bevestigde** installatie van een officieel ondertekende update met healthchecks en gecontroleerde rollback.
6. Pas na afzonderlijke toestemming van @TheRoyalCaptain mag een installatie op diens server worden overwogen.

Zie ook [INSTALL-UPGRADE-GATE.md](INSTALL-UPGRADE-GATE.md), [NATIVE-INSTALL-REHEARSAL.md](NATIVE-INSTALL-REHEARSAL.md) en [AI-DEVELOPMENT.md](AI-DEVELOPMENT.md).
