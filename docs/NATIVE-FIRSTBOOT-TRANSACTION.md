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

Het journal doet **niet** zelf die handelingen en accepteert geen bewijs dat een stap echt is uitgevoerd. Een writer lock voorkomt gelijktijdige wijzigingen. Na een normale persistente write worden bestand en directory gefsynct en krijgt het nieuwe journal een atomische naam. Bij een onderbroken schrijver kan een achterblijvende lock **niet** stilzwijgend worden weggehaald: verdere inspectie en stappen worden dan geweigerd totdat een beheerder de oorzaak onderzoekt. Een bestaande firstboot-intent mag niet opnieuw worden vervangen.

Het is een voorbereiding op een transactionele installer, niet een werkende installatietransactie. De echte installer zal later journalstappen aan **waarneembare en hercontroleerbare systeemresultaten** moeten koppelen, inclusief expliciete ownership- en herstelregels.

## 3. Wat nog niet gereed is

D-53 blijft dicht omdat cruciale productieonderdelen ontbreken: een officieel gepinde uitgeverssleutel, release-hosting, een zelfstandig op te starten bootstrap zonder vooraf geïnstalleerde Node.js, betrouwbare managed/existing-servicekeuzes, veilige lokale TLS-onboarding, volledige database/config/Matter-backup en herstel, een beheerdersgestuurde productie-updater en echte VM/reboot/bare-metal-acceptatietests.

**Geen van deze tools installeert Domyro op een privéserver.** Het journal schrijft alleen in afzonderlijke testmappen. De CI-native-service draait uitsluitend op tijdelijke GitHub-hosted runners. Er is geen automatische installatierelease of deploy-consent.
