# Domyro: offline verificatie van een ondertekende native bronrelease

**Status:** ontwikkelmodule, alleen lezen. **D-53 is gesloten.**

## Waarom dit nodig is

De toekomstige one-line installer mag gedownloade installatiecode nooit rechtstreeks uitvoeren. Eerst moet buiten de download zelf vaststaan welke uitgeverssleutel wordt vertrouwd. Pas daarna mag de softwarebundel cryptografisch en op bestandsniveau worden gecontroleerd.

Deze stap vult dat gat voor de **huidige bronrelease**, zonder een installatie te starten.

## Wat er nu werkt

`src/lifecycle/native-release-verifier.mjs` controleert een bestaande, lokale release-directory die door `tools/build-release.mjs` en `writeSignedRelease()` is opgebouwd:

- Een afzonderlijk aangeleverde, exact gepinde SHA-256-vingerafdruk van een **Ed25519 SPKI-DER publieke sleutel**.
- De ruwe `release-manifest.json` met de bijbehorende losstaande `release-manifest.sig`, zonder JSON eerst opnieuw te serialiseren.
- Complete AMD64- en ARM64-artefacten: SHA-256, exact bestandsgrootte en maximaal 64 MiB per bestand.
- Selectie van de bedoelde Ubuntu-architectuur, stable/beta-kanaal, publicatietijdstip en huidig PostgreSQL-schema. Nog niet bewezen migraties worden geweigerd.
- Exact verwachte bestandsnamen en aantallen. Extra bestanden, ontbrekende bestanden, links naar andere bestanden, onveilige permissies en onbetrouwbare directory-eigenschappen worden geweigerd.
- Geheugenvriendelijk controleren van het releasebestand met kleine leesblokken in plaats van het volledige artefact in het geheugen te laden.

**Deze verifier voert nooit code uit, maakt geen netwerkverbinding, schrijft geen data en installeert niets.** De uitkomst `canInstall`, `canExecute` en `canUpdate` blijft altijd `false`.

## Ontwikkelcommando

Dit commando is een **offline controle van een reeds aanwezige bronbundel**, geen one-line installer:

```bash
node scripts/verify-native-source-release.mjs \
  --directory=/private/test/signed-package \
  --publisher-key=/private/test/vertrouwde-publieke-sleutel.pem \
  --publisher-fingerprint=<64-tekens-hex-vingerafdruk-uit-onafhankelijke-bron> \
  --arch=amd64 \
  --schema=3
```

De publieke sleutel en haar SHA-256-vingerafdruk mogen **niet** allebei uitsluitend uit de download komen. Het zou cryptografische veiligheid spelen met de deur wagenwijd open.

De testcode maakt tijdelijke Ed25519-sleutels aan en test ook `arm64`. Er worden **geen productiesleutels** of privé-uitgeverssleutels in de repository toegevoegd.

## Tests en grenzen

`tests/native-release-verifier.test.mjs` controleert een echte gebouwde releasebundel, de CLI en negatieve gevallen zoals manifestvervalsing, sleutelvervanging, beschadigd artefact, links, extra bestanden, verkeerde architectuur en ontbrekend databaseschema.

Dit is **geen** garantie dat na controle niemand met lokale schrijfrechten het bestand alsnog wijzigt: een installer moet bij daadwerkelijk gebruik opnieuw authenticeren vanuit een afgeschermde staged directory. Ook ontbreekt nog de officiële distributie-feed, de zelfstandig te installeren Node-runtime, een pakketbeheerder, een echte installer-transaction en de volledige back-up/restore van PostgreSQL, configuratie en Matter-fabrics.

Deze module accepteert uitsluitend het huidige bronpakket. Het gereedmaken voor het uitvoeren van een productie-installatie vereist een apart, expliciet goedgekeurd en uitvoerig getest uitvoerpad. **Geen enkele D-53-check wordt hiermee als voltooid aangemerkt.**
