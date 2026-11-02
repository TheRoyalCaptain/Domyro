# Domyro: duurzame ontvangstbevestiging voor ondertekende ontwikkelreleases

**Status:** uitsluitend geïsoleerde ontwikkel- en CI-proef; **D-53 blijft gesloten**.

`src/lifecycle/trusted-release-receipt.mjs` legt de hoogste reeds vertrouwde versie van een exact Ed25519-ondertekend release-manifest vast. Dit is een ontbrekend beveiligingsonderdeel tussen offline release-cataloguscontrole en een toekomstige automatische downloadworker. Er is **geen** officiële releasebron, definitieve uitgeverssleutel, updater of installer aangesloten.

## Werking

- Het manifest wordt geverifieerd met een vooraf vertrouwde publieke Ed25519-sleutel, **voordat** bestanden worden gewijzigd.
- Het record bevat de SemVer-versie, SHA-256 van de oorspronkelijke manifestbytes en SHA-256 van de publieke sleutel in SPKI-DER-formaat. Het bevat geen wachtwoorden of privésleutels.
- Een oudere ondertekende versie, een ander manifest met dezelfde versie en een gewijzigde uitgeverssleutel worden geweigerd. Herhaling van dezelfde exacte release is toegestaan.
- De directory moet een door de test aangemaakte, eigenaar-privémap `domyro-test-*` onder `os.tmpdir()` zijn. Willekeurige paden, waaronder `/etc/domyro` en `/var/lib/domyro`, worden geweigerd.
- Een exclusieve lock-directory voorkomt gelijktijdige schrijvers. Een bij procesuitval achtergebleven lock blokkeert ook **lezers**; er is bewust geen automatische ontgrendeling.
- Het nieuwe record wordt naar een exclusief aangemaakt tijdelijk bestand geschreven, gesynchroniseerd, atomair hernoemd en samen met de directory gesynchroniseerd. Symlinks, onveilige permissies, harde links en ongeldige records worden geweigerd.
- De bestaande offline catalogusselectie kan het ingelezen `version` en `manifestSha256` als `highestSeenVersion` en `highestSeenManifestSha256` gebruiken. Een aparte integratietest controleert die koppeling.

## Nog niet gegarandeerd

Dit is **geen** productie-truststore: een aanvaller met schrijfrechten als dezelfde gebruiker, een root-aanvaller of iemand met toegang tot de oorspronkelijke vertrouwenssleutel kan lokaal ingrijpen. Het mechanisme houdt nog geen rekening met rollbacks van PostgreSQL, versleutelde configuratie, Matter-fabrics, machinebrede stroomuitval of herstel vanaf een schone server. De uiteindelijke key provisioning en sleutelrotatie vereisen een apart ontwerp en goedkeuring door de eigenaar.

**Tests:** `node --test tests/trusted-release-receipt.test.mjs`. Deze tests maken alleen tijdelijke eigen directories aan. Ook na alle geslaagde tests blijft `readyForOwnerInstallation: false` en blijft de install-knop geblokkeerd.
