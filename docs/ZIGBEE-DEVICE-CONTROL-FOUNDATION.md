# Domyro: Zigbee2MQTT-apparaatbediening, eerste veilige protocoltest

**Status:** 2 november 2026 · ontwikkelprototype, **geen werkende productiebediening** · D-53 gesloten.

## Wat technisch is gebouwd

De bestaande Zigbee2MQTT-observer blijft een **read-only MQTT-abonnee**. Nieuw is een onafhankelijke command-controller die alleen in een expliciete testopstelling opdrachten voorbereidt en een door de test aangeleverde MQTT-publisher aanroept. De Domyro-HTTP-server activeert deze controller **niet** en krijgt geen HTTP-route om apparaten aan te sturen.

1. `zigbee2mqtt-capabilities.mjs` leest de werkelijk door Zigbee2MQTT gepubliceerde `bridge/devices` → `definition.exposes`. Alleen `light`/`switch` met één endpoint en `state` (ON/OFF) en eventueel `light.brightness` zijn toegestaan. Het Zigbee2MQTT-exposes-accessmasker moet **zowel lezen als schrijven** toelaten (bits 1 en 2). Ongedefinieerde, dubbele, ongeldige en read-only velden worden geweigerd.
2. `zigbee2mqtt-observer.mjs` geeft nu per IEEE-identiteit een **onveranderbare** kopie van toegestane capabilities terug. Naamwijzigingen, offline status en ongeldige brokerberichten blijven afgeschermd.
3. `zigbee2mqtt-command-controller.mjs` accepteert uitsluitend een expliciete, bevestigde bediening van een geldig IEEE-adres met een gevraagde boolean-schakelaarstatus of begrensde helderheid. Alleen actuele, niet-retained waarnemingen van dezelfde ondersteunde, beschikbare fysieke identiteit komen in aanmerking. Er is maximaal één lopende opdracht en een korte cooldown.
4. Een MQTT QoS1 `PUBACK` is alleen een bevestiging van het brokertransport. De gebruiker krijgt **pas een echte bevestiging** na een nieuwe niet-retained toestandmelding van dezelfde IEEE-identiteit, zonder rename, verlies van broker/bridge of wijziging in mogelijkheden. Geen update betekent `not_confirmed`, nooit een verzonnen succesvolle schakeling.
5. De controller publiceert nooit automatisch, herhaalt opdrachten niet en gebruikt geen `TOGGLE`, groups, locks, covers, pairing, `permit_join`, klimaatregeling of configuratietopics.

## Wat de webinterface al kan

De bestaande lokale, sessie-beveiligde HTTP-laag heeft nu `GET /api/v1/sites/:uuid/devices`, dat voor de aangemelde gebruiker **alleen** zijn eigen bewaarde Zigbee2MQTT-inventaris en geobserveerde toestand uit PostgreSQL teruggeeft. Een gebruiker van een andere site krijgt die gegevens niet. Er is **geen POST-controle-endpoint**.

Het startdashboard toont onder **Mijn apparaten** deze echte gegevens met meetkwaliteit en een expliciet **Alleen bekijken**-label. De UI gebruikt DOM-`textContent` en geen directe HTML-interpolatie van onbetrouwbare apparatenamen. Zonder aanmelding meldt hij dat eerst lokale authenticatie nodig is; zonder bekende apparaten wordt geen nepstatus getoond. Er is NL/EN-tekst.

## Testbereik

- Werkelijke, lokaal gestarte Aedes-MQTT-broker met twee onafhankelijke clients (simulatie Zigbee2MQTT-device en command-publisher). De bestaande read-only observer verstuurt geen berichten.
- Een expliciete `/set`-opdracht krijgt alleen `confirmed` wanneer een latere onafhankelijke fysieke toestandmelding wordt gesimuleerd.
- QoS1 zonder volgende toestandmelding geeft `not_confirmed`.
- Read-only exposes, dubbel gedefinieerde capabilities, multi-endpoints, sensoren, gevaarlijke domeinen en buiten-bereikwaarden worden geweigerd.
- Onjuiste gebruikerbevestiging, stale/retained state, apparaat-rename, brokeruitval, time-out, publishing failure en dubbele opdrachten blijven fail-closed.
- PostgreSQL/testauth controleert sessie, gebruiker-scoping, illegale UUIDs, vreemde sites en ontbrekend schrijfendpoint.

**Nog niet af:** echte hardware-integratie met beveiligde brokergeheimen en TLS, lifecycle van eigen Zigbee2MQTT-service, persistente command ledger/audit, directe HTTP-aansturing met autorisatie en CSRF, herstart- en multi-user-command concurrency, tests op echte lampen en sensoren en de uiteindelijke dashboardknoppen. Geen installatie op de server van de eigenaar.

Referentie voor `exposes` en het access-bitmasker: https://www.zigbee2mqtt.io/information/exposes.html
