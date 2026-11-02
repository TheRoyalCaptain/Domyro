# Domyro: foutinjectie bij een native eerste installatie

**Status: afzonderlijke ontwikkeltest. D-53 blijft gesloten. Geen toestemming om Domyro op de server van de eigenaar te installeren.**

## Doel

Een werkende eerste installatie is onvoldoende als een half afgemaakte installatie een account, PostgreSQL-database, toegangsrechten of systemd-service achterlaat. Deze proef breidt de bestaande disposable Ubuntu 24.04 PostgreSQL + systemd-integratie uit met vier **opzettelijke** afbreekpunten.

| Injectiepunt | Uitgevoerde acties vóór de fout | Wat na afbreken aantoonbaar weg moet zijn |
| --- | --- | --- |
| `after-db-bootstrap` | Nieuwe PostgreSQL-testdatabase, migraties en eenmalige eigenaar | Testdatabase en tijdelijke bestanden |
| `after-db-role` | Ook de beperkte applicatie-DB-rol aangemaakt en DDL-verbod gecontroleerd | Database **en** applicatierol |
| `after-unit-start` | Ook account, root-owned broncode en daadwerkelijke systemd-service, plus geslaagde HTTP-login | Service, account, runtime/config/state directories, database en rol |
| `after-restart` | Ook normale herstart en herhaalde HTTP-login | Dezelfde complete verwijdering |

De foutcode **86** is uitsluitend een gesimuleerde onderbreking. Het CI-testscript controleert daarna met een afzonderlijke PostgreSQL-verbinding of zowel database als rol zijn verwijderd en controleert systemd, Linux-account en alle tijdelijke paden. Iedere onverwachte exitcode of achtergebleven resource laat GitHub Actions falen.

## Grenzen

De scripts starten **alleen** in GitHub-hosted, wegwerpbare Ubuntu 24.04 runners, met PostgreSQL 17 in een afzonderlijke Docker-testcontainer. De guards controleren onder meer de hosted-runneridentiteit, de exacte tijdelijk ingestelde testdatabase-URL, de werkmap, de CI-instellingen en de toegestane foutnamen. In de productie-installatie bestaat deze foutinjectie niet; `scripts/ci-native-account-test.sh` blijft een CI-only script en is niet opgenomen in de ondertekende runtime-bundel.

Deze tests bewijzen **niet** dat een eenregelige installer bestaat. Ook controleren ze nog geen echte package-manager-fouten, hostreboots, stroomuitval, gebruikersdata-retentie na een upgrade, het terugzetten van Matter-fabricgeheimen of de installatie op eigen hardware. In het definitieve ontwerp mag herstel van een **bestaande** installatie nooit worden verward met het opruimen van een **nieuwe** installatie. Behoud van bestaande gegevens krijgt aparte integratie- en hersteltests.

**Losse guardtests:** `node --test tests/native-installer-fault-matrix-safety.test.mjs`.

**CI op beide architecturen:** `.github/workflows/native-installer-fault-matrix.yml`.

De installatiestatus `config/installation-readiness.json` en de bestaande blokkerende update-endpoints worden niet aangepast.

## Abrupte procesuitval: SIGKILL en bescherming van bestaande gegevens

De aparte CI-proef `scripts/ci-native-sigkill-recovery.sh` beëindigt het
installatiescript met **SIGKILL** nadat de eigenaar is aangemaakt, een kamer is
opgeslagen en Domyro via systemd draait. Anders dan een normale exit wordt de
`EXIT`-opruimtrap daardoor niet uitgevoerd.

Vervolgens controleert een **afzonderlijk proces**:

1. De service draait nog, de systeemgebruiker en config zijn aanwezig en de
   PostgreSQL-database heeft nog precies één eigenaar en één kamer.
2. Een tweede installatiepoging wordt **direct** geweigerd (exit 93), vóór
   staging, databasebewerkingen of het registreren van een nieuwe cleanup-trap.
3. De systemd-configuratie en geheime runtimeconfiguratie zijn byte-identiek
   gebleven. De database-inhoud blijft eveneens behouden.
4. Alleen een apart, expliciet aangeroepen herstelpad ruimt achteraf de
   **uitsluitend tijdelijke** CI-database, rol, service, account en bestanden op.

Extra testen: achtergebleven datamappen en zelfs **dangling symlinks** in het
doelpad worden door de installer meteen geweigerd, zonder het doel te vervangen.

Dit simuleert een abrupt beëindigd proces, **niet** een echte stroomuitval,
filesystemcrash of volwaardige transactionele productie-installer. Het
bevestigt vooralsnog uitsluitend de bescherming van de geteste disposable
omgeving. Een herstelwizard voor bestaande gebruikersgegevens en veilig
power-cut recovery blijven releaseblokkades.
