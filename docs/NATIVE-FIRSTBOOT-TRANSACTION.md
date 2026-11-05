# Native Domyro installatiemijlpalen: ondertekend pakket en crash-journaal

**Datum:** 2 november 2026 · **Alleen ontwikkeltests** · **D-53 gesloten**

## 1. Beveiligde toegang van releasepakket tot een tijdelijke Ubuntu-installatie

De CI-tool `scripts/ci-stage-signed-source.mjs` gebruikt niet langer uitsluitend het in het geheugen ondertekende release-artefact. De test doet nu:

1. Maakt met een **tijdelijke Ed25519-testuitgeverssleutel** een bronrelease voor AMD64 én ARM64.
2. Schrijft het complete pakket met losse manifesthandtekening onder `offline-signed-package/` in een private GitHub-runner-directory.
3. Berekent onafhankelijk van het opgeslagen pakket de publieke sleutelvingerafdruk uit de tijdelijke testuitgeverssleutel. **Dit is testtrust; geen officiële publieke productie-uitgeverssleutel.**
4. Leest de bestanden opnieuw van schijf met `inspectOfflineNativeSourceRelease()`: publieke sleutelpin, manifesthandtekening, beide releasebestanden, SHA-256, schema en bestandsveiligheid worden gecontroleerd.
5. Leest vervolgens de ondertekende bytes opnieuw uit het pakket en laat `stageVerifiedBundle()` **nogmaals** de handtekening en geselecteerde artefacthash controleren voordat bronbestanden in de geïsoleerde store worden uitgepakt.
6. Controleert alle uitgepakte bestanden met `inspectVerifiedStagedBundle()`. Pas daarna kan het bestaande CI-script in de tijdelijke Ubuntu-VM een beperkte Linux-gebruiker, PostgreSQL-database en echte systemd-service opstarten.

Een tussenliggende bestandsvervanging wordt dus niet automatisch vertrouwd: het tweede staging-moment controleert de hashes opnieuw. In een definitieve installer moeten bestandseigendom, het beëindigen van lopende processen en gebruik onder exclusieve locks apart worden bewezen.

### Negatieve CI-proeven

`scripts/ci-signed-package-admission-matrix.sh` controleert op Ubuntu 24.04 AMD64 en ARM64:

- Een ongewijzigd pakket wordt geverifieerd en staged.
- Een wijziging in een bronartefact wordt geweigerd; er verschijnt **geen** staged release.
- Een corrupte manifesthandtekening wordt geweigerd; er verschijnt **geen** staged release.
- Een extra niet-ondertekend bestand wordt geweigerd; er verschijnt **geen** staged release.

Hetzelfde workflow-job start daarna de echte Domyro-testdienst, met PostgreSQL en systeemd-herstartproeven. De overige beveiligingstests bewaken dat dit script buiten een GitHub-hosted wegwerpmachine niet mag draaien.

CI-workflow: `.github/workflows/native-signed-admission.yml`.

## 2. Crash-zichtbaar firstboot-intent

De nieuwe module `src/lifecycle/native-firstboot-journal.mjs` is een **afzonderlijk testmodel** voor een toekomstige installatietransactie. Alleen private directories onder `os.tmpdir()`, aangemaakt met prefix `domyro-firstboot-test-`, worden toegestaan. Geen enkele gewone installatiemap wordt geopend.

Het journal bewaart welke releaseversie, manifesthash en uitgeversvingerafdruk bij een proef horen en laat de volgende, strikt geordende stappen vastleggen:

`intent_created` → `signed_source_verified` → `locked_dependencies_prepared` → `database_owner_bootstrapped` → `restricted_runtime_verified` → `native_service_started` → `http_login_and_persistence_verified` → `test_completed`.

Het journal doet **niet** zelf de installerhandelingen. Inmiddels is op de integratiebranch wel een **CI-evidence-adapter** gekoppeld die voor elke fase onafhankelijk controleert of de bijbehorende broncode, Node-afhankelijkheden, PostgreSQL-eigenaar, beperkte databasrol en/of systemd-dienst werkelijk bestaan. Het blijft CI-testbewijs en geen toestemming voor een productie-installatie. Een writer lock voorkomt gelijktijdige wijzigingen. Na een normale persistente write worden bestand en directory gefsynct en krijgt het nieuwe journal een atomische naam. Bij een onderbroken schrijver kan een achterblijvende lock **niet** stilzwijgend worden weggehaald: verdere inspectie en stappen worden dan geweigerd totdat een beheerder de oorzaak onderzoekt. Een bestaande firstboot-intent mag niet opnieuw worden vervangen.

Het is een voorbereiding op een transactionele installer, niet een werkende installatietransactie. De echte installer zal later journalstappen aan **waarneembare en hercontroleerbare systeemresultaten** moeten koppelen, inclusief expliciete ownership- en herstelregels.

## 3. Wat nog niet gereed is

D-53 blijft dicht omdat cruciale productieonderdelen ontbreken: een officieel gepinde uitgeverssleutel, release-hosting, een zelfstandig op te starten bootstrap zonder vooraf geïnstalleerde Node.js, betrouwbare managed/existing-servicekeuzes, veilige lokale TLS-onboarding, volledige database/config/Matter-backup en herstel, een beheerdersgestuurde productie-updater en echte VM/reboot/bare-metal-acceptatietests.

**Geen van deze tools installeert Domyro op een privéserver.** Het journal schrijft alleen in afzonderlijke testmappen. De CI-native-service draait uitsluitend op tijdelijke GitHub-hosted runners. Er is geen automatische installatierelease of deploy-consent.

## 4. Integratie van de duurzame releasebevestiging

De geïntegreerde testbranch `integration/native-installer-foundation` combineert
ook de `trusted-release-receipt` uit de eerder afzonderlijke PR #1.

Na de offline verificatie van het bestandenpakket wordt de *exact ondertekende*
manifestinhoud in een nieuwe private `domyro-test-*`-directory met een
fsync + atomische rename als vertrouwde versie geregistreerd. De test vergelijkt
daarna de bestands-hash, uitgeversvingerafdruk en versienaam nogmaals met
de originele offline verifier. Een aanvullende sabotageproef verandert de
persistente `manifestSha256` en controleert dat er **geen** release wordt
gestaged. Dit is **geen** permanente productie-truststore: de proefdirectory
wordt na afloop verwijderd.

De volledige GitHub-integratietest bestaat hiermee uit een geslaagde
pakketcontrole, **vier** negatieve pakket-/receipt-tests, het starten van
echte PostgreSQL/systemd uit de geauthenticeerde broncode en afzonderlijke
fout-/SIGKILL-tests. De firstboot-state-machine blijft nog een zelfstandig
testmodel, zonder enige productie-installatiebevoegdheid.

De oorspronkelijke PR's blijven ter beoordeling open; de samenbouw staat in
`integration/native-installer-foundation` (concept-PR #4). **Niets is
gemerged in `main` of geïnstalleerd op de server van de eigenaar.**

## 5. Eerste installatie met werkelijk vastgelegde fasebewijzen

In `scripts/ci-native-account-test.sh` wordt op een GitHub-hosted Ubuntu
24.04 testmachine een aparte, private firstboot-intent opgeslagen. De nieuwe
adapter `scripts/ci-native-firstboot-evidence.mjs` leest elke vereiste toestand
**voordat** de volgende fase persistente voortgang mag registreren:

- De ondertekende broncode: onafhankelijk gecontroleerde
  `ci-signed-admission.json` uit de reeds geverifieerde bronbundel, SHA-256
  van het op schijf opgeslagen manifest en bestaand release-entrypoint.
- Afhankelijkheden: echte `node_modules/pg` van `npm ci`.
- Database: daadwerkelijk één eigenaar en één site in de run-specifieke
  PostgreSQL-testdatabase, na expliciete migratie.
- Runtime-DB-gebruiker: bestaat, kan inloggen, heeft geen superuser-,
  createdb- of createrolebevoegdheid en mist `CREATE` op schema `public`.
- Systemd-dienst: daadwerkelijk actief onder de run-specifieke niet-inlogbare
  systeemgebruiker en met een succesvolle lokale HTTP-healthcheck.
- Testvoltooiing: dienst, eigenaar, site en beperkte databasrol bestaan nog na
  herstart en SIGKILL/herstel van het serviceproces.

De tests voor de vier normale installatiefouten vergelijken de **persistente
journal-fase** met de precies verwachte fase bij afbreken. De afzonderlijke
SIGKILL-proef controleert van buiten het afgebroken installatiescript dat
`config_scratch_restore_verified` op schijf is blijven staan, dus na een werkelijk uitgevoerde versleutelde PostgreSQL-restore én een geselecteerde systemd/runtime-configuratie-restore. Een
tweede installatiepoging wordt eerst geweigerd zonder het bestaande journal,
de draaiende service of PostgreSQL te overschrijven. Alleen de buitenliggende
CI-test voert daarna expliciet de opruiming uit.

Het ontbreken van een journal, een ongeldige fase of een onverwacht
overgebleven schrijflock maakt de proef **rood**, niet stilzwijgend hersteld.

**Beperking:** deze adapter gebruikt bewust hardcoded CI-testpaden,
run-specifieke wegwerpdatabases en uitsluitend GitHub-hosted testmachines.
Een toekomstige production installer heeft eigen vergrendelingen,
transactionele rollback, systeembackup en herstel bij stroomuitval nodig.
Ook na een succesvol journal mogen D-53 en de beheerdersgoedkeuring niet
automatisch worden geopend.

### Versleuteld PostgreSQL- en configuratieherstel als verplichte firstbootproef

De twee nieuwe journaling-fases volgen op de daadwerkelijke HTTP-aanmelding:

`http_login_and_persistence_verified` →
`postgres_scratch_restore_verified` →
`config_scratch_restore_verified` →
`test_completed`.

Een PostgreSQL-back-up in `DOMYROS2` moet correct naar een lege,
run-specifieke testdatabase zijn hersteld, inclusief behouden user/site/room.
Daarna moeten **de echte CI runtimeconfiguratie en systemd-unit** eveneens
versleuteld naar een nieuwe private directory worden teruggezet en
byte-/hash-identiek zijn. Pas dan mogen de latere faalpunten en
`test_completed` worden bereikt. De SIGKILL-parent herhaalt beide
restauraties onafhankelijk. Niets wordt over bestaande installatiepaden
heen teruggezet.

Dit is een gecontroleerde integratietest van bestaande back-upprimitieven,
**geen productiegeschikte transactie voor live herstel of een werkende
distributie-installer**.
