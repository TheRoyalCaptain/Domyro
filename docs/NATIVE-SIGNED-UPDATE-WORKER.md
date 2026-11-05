# Native ondertekende updates en herstel

Deze implementatie verbindt de ingelogde portal met een afzonderlijke native
updateworker. De productie-installatie blijft geblokkeerd: een officiële
uitgeverssleutel, gepubliceerde release en volledige eerste-installatieproef
ontbreken nog. De code zet geen productiecontroles op groen.

## Uitgevoerde route

1. Alleen een ingelogde eigenaar/beheerder met dezelfde browserorigin en een
   geldige sessiegebonden CSRF-token kan een versie aanvragen.
2. De core stuurt uitsluitend een versienummer over een lokale Unix-socket.
   De socket is toegankelijk voor root en de core-servicegroep. Er worden geen
   shellcommando's, bestandspaden of download-URL's uit HTTP geaccepteerd.
3. De worker controleert de installatievoorwaarden opnieuw, downloadt de
   versiegebonden officiële release en verifieert de afzonderlijk vastgepinde
   Ed25519-sleutel, handtekening, beide architectuurpakketten en alle hashes.
4. De worker vergelijkt alle SQL-migraties byte voor byte met de actieve
   versie. Schemawijzigingen worden geweigerd. Afhankelijkheden worden met
   `npm ci --omit=dev --ignore-scripts` onder de onbevoorrechte servicegebruiker
   geïnstalleerd; de ondertekende bronbestanden worden daarna opnieuw vergeleken.
5. De core stopt. De worker maakt een PostgreSQL-dump en een private kopie van
   de configuratie. De dump wordt daadwerkelijk hersteld in een afzonderlijke,
   tijdelijke database voordat de actieve release wordt gewijzigd.
6. Oude code blijft behouden. De nieuwe core start en moet de bedoelde versie
   én een werkende database terugmelden. Pas daarna wordt de update vastgelegd.
7. Bij een fout worden oude code, database en configuratie hersteld. Een
   onafgehandeld transactielogboek blokkeert een nieuwe update. De supervisor
   herstelt zo'n transactie bij de volgende start, voordat hij aanvragen accepteert.

De worker staat buiten de actieve release in `/usr/lib/domyro-updater` en
blijft draaien wanneer de webportal wordt herstart. Een processbrede `flock`
voorkomt twee supervisors. De HTTP-app krijgt geen sudo-rechten.

## Inrichting na bewezen installatiegereedheid

`scripts/native-update-setup.sh --install-native-updater` installeert de
supervisor alleen als de volgende bestaande rootbestanden correct zijn
ingericht (map 0700, bestanden 0600):

- `/etc/domyro-updater/publisher.json`: geverifieerd publiek uitgeversbeleid.
- `/etc/domyro-updater/installation-readiness.json`: daadwerkelijk onderbouwde
  installatiegereedheid en eigenaarstoestemming. Geen vinkjes wijzigen om de
  controle te omzeilen.
- `/etc/domyro-updater/worker.json`: schemaVersion 1, managedIntegrations een
  lege lijst, en een layout met app, config, work, unit, database, serviceUser
  en port. `work` is `/var/lib/domyro-updater/work` en moet op hetzelfde
  bestandssysteem staan als de actieve app voor rename-operaties.

De core gebruikt `DOMYRO_UPDATE_SOCKET=/run/domyro-updater/control.sock` en
`DOMYRO_MAINTENANCE_FILE=/var/lib/domyro-updater/work/maintenance`.
Deze onderhoudsmarkering blokkeert HTTP-schrijfacties tot een duurzame commit
of een geslaagd herstel; lezen en voortgang opvragen blijven mogelijk.
Zonder deze instelling blijft het bestaande geblokkeerde updatecentrum werken.
Zonder bereikbare worker wordt geen installatie gesuggereerd.

## Bewijs en grenzen

- Unitproeven behandelen concurrentie, geweigerde versies, mislukte voorbereiding,
  back-upfouten, terugzetten van gewijzigde gegevens, mislukte recovery en
  hervatten vanuit duurzame transactiefasen.
- HTTP-proeven controleren sessie, origin, CSRF en beheerdersrechten vóór IPC.
- De native Ubuntu CI-proef gebruikt echte systemd-services en PostgreSQL,
  zonder Docker. Een tijdelijke sleutel ondertekent een werkende update en een
  kapotte kandidaat die eerst een kamernaam in de database wijzigt. De proef
  eist dat zowel de eerdere code als de oorspronkelijke kamernaam terugkomen.
- Testondertekening is geen officiële releaseondertekening. Raadpleeg de
  bijbehorende Actions-run voor het resultaat van de huidige commit.
- Alleen core-updates met ongewijzigd databaseschema zijn ondersteund.
  Zigbee/Matter-services, fabricgegevens, externe brokers en hardware worden
  nog niet door deze hersteltransactie gedekt.
- Interne back-ups staan root-only op dezelfde host en zijn niet versleuteld.
  Dit vervangt geen externe herstelkopie, schijfruimtebeleid of hardwaretest.
- De healthcheck start de kandidaat op de bestaande localhost-poort. De
  onderhoudsmarkering blokkeert daarbij alle HTTP-schrijfacties, ook aanmelden.
  Interne achtergrondschrijvers/integraties zijn niet ondersteund.
- Echte stroomuitval, een volledige machine-reboot tijdens elke transactiefase,
  de onafhankelijke bootstrap en upgrade van de supervisor zelf zijn nog geen
  bewezen productiepad. Daarom blijft D-53 gesloten.

Domyro is een AI-gebouwd project onder toezicht en in samenwerking met
[@TheRoyalCaptain](https://github.com/TheRoyalCaptain).
