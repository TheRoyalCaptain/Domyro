# Domyro: eerst één installatiecommando, daarna updates per release

**Prioriteit gewijzigd: de minimale bruikbare oplevering is een eenregelige Ubuntu-installatie, gevolgd door updates vanuit een bestaande Domyro-installatie.** Smart-homefuncties komen daarna. De beveiligingsstop **D-53 is nog gesloten**.

## Wat er technisch beschikbaar is

De nieuwe release-infrastructuur is daadwerkelijk geprogrammeerd:

1. **Officieel updatekanaal:** `src/lifecycle/native-release-discovery.mjs` controleert de publieke GitHub Releases API uitsluitend als **onbetrouwbare versie-indicatie**. Een nieuwere SemVer wordt voorgesteld, maar nooit direct vertrouwd of geactiveerd. Er is geen GitHub Releases-asset die automatisch voldoende installatierecht geeft.
2. **Download en verificatie:** `src/lifecycle/native-release-download.mjs` haalt de concrete versie op van `github.com/TheRoyalCaptain/Domyro/releases/download/vX.Y.Z`. HTTPS, een beperkt aantal toegestane redirects, groottebegrenzingen, precies twee architectuur-artefacten (AMD64/ARM64), de Ed25519-manifesthandtekening en SHA-256 worden onafhankelijk gecontroleerd voordat de volledige release als pakket wordt geretourneerd. Bij een fout wordt de private tijdelijke directory verwijderd.
3. **Updatecommando in releasepakket:** `scripts/domyro-release.mjs` wordt nu bij het bouwen van ondertekende bronpakketten meegeleverd:
   - `node scripts/domyro-release.mjs check --current=0.1.1`: vraag of GitHub een nieuwe officiële **stable** versie aankondigt. Dit controleert **nog niet** de releasehandtekening.
   - `node scripts/domyro-release.mjs prepare --current=0.1.1 --arch=amd64 --schema=3 --publisher-key=/pad/naar/geverifieerde-public.pem --publisher-fingerprint=64_HEX_CIJFERS`: alleen nadat een **apart geverifieerde uitgeverssleutel en eigen vingerafdruk** beschikbaar zijn, mag het volledige pakket worden opgehaald en gecontroleerd.
   - `install` en `update` geven **exitcode 53** en wijzigen niets zolang D-53 gesloten is.
4. **Officiële releaseondertekening voorbereid:** `src/lifecycle/publisher-trust-policy.mjs` en `tools/verify-release-publisher.mjs` controleren of de geheime Ed25519-uitgeverssleutel overeenkomt met de apart gecontroleerde publieke sleutel en SHA-256-vingerafdruk. Geen sleutelmateriaal wordt in git opgeslagen.
5. **Publicatiepipeline voorbereid:** `.github/workflows/publish-official-release.yml` kan pas na een geslaagde **volledige productie-gate**, op `main`, via een door de eigenaar te beheren `production-release`-omgeving en een GitHub-secret een ondertekende **conceptrelease** maken. Een reeds bestaande versie mag niet worden overschreven. De eigenaar moet de definitieve release nog goedkeuren/publiceren.

**De publieke uitgeverssleutel is opzettelijk nog niet ingesteld.** `config/release-publisher.json` heeft `configured:false`. Er is geen officiële productiesleutel of ondertekend publiek releasepakket dat Domyro voor installatie kan gebruiken.

## Nog niet af: noodzakelijke route naar één commando

Voor het daadwerkelijk beschikbaar stellen van het installatiecommando zijn nog verplicht:

1. Een door de eigenaar beheerde officiële publicatiesleutel en fingerprint, beheerd buiten de broncode; een aantoonbaar veilig op te halen bootstrap-script met een onafhankelijke trust anchor.
2. Alle afhankelijkheden op een lege Ubuntu 24.04 AMD64/ARM64 automatisch installeren of cryptografisch gepinde runtimes in de release bundelen, inclusief Node.js, PostgreSQL en de gekozen optionele diensten, zonder aan bestaande diensten te komen.
3. Een **echte**, consistente native installer met systeemaccounts, private opslag, database-/rolscheiding, eenmalige eigenaaraanmelding, veilige netwerk-/TLS-verbinding en verifieerbare systemd-start en -herstart. De huidige GitHub-hosted CI realiseert dit alleen met tijdelijke bekende testafhankelijkheden.
4. Het activeren van iedere nieuwere **ondertekende** compatible release vanuit de Domyro-webinterface met verificatie en expliciete autorisatie.
5. Vóór iedere update een gezamenlijke, geverifieerd te herstellen back-up van database, configuratie en waar nodig Zigbee2MQTT/Matter/fabricgeheimen. Updates die een ongedekte of irreversibele databasewijziging vereisen worden geweigerd.
6. Een atomische versieomschakeling, systemd-herstart, echte gezondheidsproef na update en bewezen **behoud van de oudere release en data** na onverwachte crash, package failure, system reboot en rollback. Pas daarna kan de eigenaar de gate openen.

## Belangrijke veiligheidsafspraken

- Een publieke GitHub-tag, releasebeschrijving of checksum is **geen** vervanging voor een onafhankelijke sleutelpin.
- `curl | sudo bash` van een veranderlijke branch zonder geauthenticeerd bootstrap-script is niet veilig genoeg. Er is daarom **nog geen uitvoerbaar productie-installatiecommando**.
- Releaseontdekking, voorbereiding en installatie moeten gescheiden blijven. Geen automatische installatie van een ongeteste versie.
- D-53 blijft dicht zolang één verplichte productiecheck ontbreekt of de eigenaar geen expliciete toestemming heeft gegeven.
- Tot dat moment mogen alle bestaande CI-experimenten alleen in wegwerpomgevingen draaien; geen wijzigingen aan de privéserver.

## CI-bewijs en beperkingen

De ontwikkelingstest verifieert signatures, sleutelpins, versiecontrole, onveilige redirects, ongeldige GitHub-tags, ongewenste architekturen, te grote downloads, ontbrekende bestanden en opzettelijk veranderde bytes. De bestaande native Ubuntu/systemd/PostgreSQL-en-herstelmatrix bewaakt regressies. De huidige tests draaien met **tijdelijke testuitgeverssleutels**, niet met een officiële productiesleutel. De releasepublicatiepipeline zelf wordt niet uitgevoerd zolang D-53 gesloten is.
