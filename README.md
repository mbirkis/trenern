# trenern

Self-hosted web-app for å spore trening (løpeturer, fjellturer, terrengløp osv.).
Ruter tegnes på et OpenStreetMap-kart, og et panel på høyre side viser puls,
tempo, skritt, pulssoner, tid og annen helsedata for den valgte økta.

Data hentes automatisk fra JSON-filer. Første datakilde er en **Google Drive**-mappe;
arkitekturen er plugin-basert så flere kilder og filformater kan legges til senere.

## Kom i gang

```bash
npm install
cp config/config.example.json config/config.json   # opprettes automatisk hvis den mangler
npm run sample                                       # lager 3 eksempel-økter i data/sample/
npm start                                            # http://127.0.0.1:3005
```

Garmin Connect-synk bruker Garmins personlige API og krever ingen ekstra
avhengigheter – bare en personlig API-nøkkel (se [`garminConnect`](#garminconnect)).

`npm start` kjører en ingest ved oppstart og deretter hvert `ingest.intervalMinutes`.
Knappen **Synk nå** i toppen trigger en manuell henting.

## Kjøre med Podman (Quadlet)

```bash
podman build -t localhost/trenern:latest -f Containerfile .
```

Quadlet-enheter for både et **standalone**-oppsett (SQLite) og et oppsett med
**PostgreSQL i egen container** ligger i [`deploy/quadlet/`](deploy/quadlet/).
Full veiledning: [`deploy/README.md`](deploy/README.md). Kort fortalt:

```bash
cp deploy/quadlet/trenern.container deploy/quadlet/trenern-*.volume \
   ~/.config/containers/systemd/
systemctl --user daemon-reload
systemctl --user enable --now trenern.service   # http://localhost:3005
```

Containeren lager `config/config.json` fra eksempelet ved første start, og
persisterer database + config i to named volumes.

## Konfigurasjon (`config/config.json`)

| Felt | Betydning |
| --- | --- |
| `server.port` / `server.host` | Hvor web-serveren lytter |
| `athlete.birthYear` | Brukes til å estimere makspuls (`220 − alder`) hvis `maxHr` er `null` |
| `athlete.maxHr` | Overstyr makspuls eksplisitt. Styrer pulssonene (5 soner, 50–100 % av maks) |
| `athlete.restingHr` | Hvilepuls (vises i panelet) |
| `ingest.autoOnStart` | Kjør ingest når serveren starter |
| `ingest.intervalMinutes` | Intervall for automatisk ingest (`0` = av) |
| `storage.backend` | `"sqlite"` (standard) eller `"postgres"` |
| `storage.sqlite.file` | Sti til SQLite-fila (standard `./data/trenern.db`) |
| `storage.postgres.url` | Tilkoblingsstreng når backend er `postgres` |
| `map.tracestrackKey` | API-nøkkel for Tracestrack Topo-kartstilen (se under) |
| `map.tileUrl` / `map.attribution` / `map.maxZoom` | Kart-tiles. Standard er Tracestrack Topo |
| `map.fallbackTileUrl` / `map.fallbackAttribution` | Brukes når ingen Tracestrack-nøkkel er satt (standard OSM raster) |
| `sources[]` | Liste med datakilder, se under |

### Kart

Kartet bruker **Tracestrack Topo** (topografisk OSM-stil). Denne krever en gratis
API-nøkkel fra <https://tracestrack.com/> — legg den i `map.tracestrackKey` eller
miljøvariabelen `TRACESTRACK_KEY`. Uten nøkkel faller kartet tilbake til vanlige
OpenStreetMap-tiles.

Under **Innstillinger → Kartvisning** kan du velge **Vanlig kart (2D)** eller
**3D-kart med GPS-spor**. Vanlig kart er standard. 3D-kartet viser terreng med
høydedata fra Mapterhorn og legger GPS-sporene over terrenget, med turtypefarger
i oversikten og pulssoner samt start/slutt i detaljvisningen. Bruk kompasset,
høyre museknapp eller to fingre for å dreie og vippe kartet. Begge visningene
bruker det valgte bakgrunnskartet. Valget lagres i nettleseren. 3D krever WebGL
og nettforbindelse for kartfliser og høydedata.

Under **Innstillinger → Bakgrunnskart** kan du bytte kartstil i nettleseren
(valget lagres lokalt): OpenTopoMap som vektorkart eller rasterfliser,
Kartverkets Norgeskart (topografisk og gråtone), serverens egen kartstil
(Tracestrack Topo, se over) og OpenStreetMap.

**OpenTopoMap – vektor** er standardvalget. Det tegner OpenTopoMap-stilen med
MapLibre GL (`public/vendor/maplibre/`, lastes først når kartet vises) og regner
ut høydekurver lokalt fra terrengdata, slik <https://opentopomap.org/vector/>
gjør. Det krever WebGL, og faller tilbake til OpenTopoMap-rasterflisene om
biblioteket ikke lar seg laste.

Alle turer tegnes på kartet samtidig (farget etter turtype). Velger du én tur —
i listen eller ved å klikke ruta — skjules de andre, og ruta farges etter
pulssone. «← Alle turer» i detaljpanelet tar deg tilbake til oversikten.

Turlisten kan skjules med pilen øverst og åpnes igjen fra kartet. Søkefeltet
filtrerer både listen og kartet etter aktivitetsnavn og stedstagger. For turer
med GPS-spor i Norge hentes flere stedsnavn langs ruta automatisk fra
[Kartverkets stedsnavn-API](https://kartverket.no/en/api-and-data/stedsnavndata/brukarrettleiing-stadnamn-api).
Navnene lagres på økten og beholdes ved synkronisering. Innendørsøkter og ruter
utenfor Norge får ingen automatiske stedstagger. Hvis tjenesten er utilgjengelig,
vises «Prøv igjen» i turlisten.

Env-overstyring: `PORT`, `HOST`, `TRENERN_CONFIG` (alternativ config-sti),
`TRACESTRACK_KEY`,
`DATABASE_URL` (setter Postgres-backend), `TRENERN_SQLITE_FILE`,
`TRENERN_DB_BACKEND`.

## Datakilder

Kilder kan legges til og endres direkte i web-UI-et: klikk **Kilder** øverst til
høyre. Der kan du legge til en Google Drive-mappe (lime inn service-konto-JSON
eller API-nøkkel), teste tilkoblingen, synke én kilde av gangen, og aktivere/
slette kilder. Endringene lagres i `config/config.json`, og opplastede nøkler
skrives til `config/keys/<id>.json` (begge er git-ignorert). Ingen omstart trengs.

Alternativt kan `sources[]` redigeres for hånd. Hver kilde har `id`, `type`,
`enabled` og typespesifikke felter.

### `localFolder`

Leser `*.json` fra en mappe på disk. Nyttig for testing og for filer du selv legger inn.

```json
{ "id": "local-sample", "type": "localFolder", "enabled": true,
  "path": "./data/sample", "recursive": true, "filePattern": "\\.json$" }
```

### `googleDrive`

Leser `*.json` fra en Google Drive-mappe (og undermapper hvis `recursive`).

```json
{ "id": "gdrive-health", "type": "googleDrive", "enabled": true,
  "folderId": "1AbC...DriveFolderId",
  "auth": { "method": "serviceAccount",
            "serviceAccountKeyFile": "./config/gdrive-service-account.json" },
  "recursive": true, "filePattern": "\\.json$" }
```

**Oppsett med service-konto (anbefalt for self-hosting):**

1. [Google Cloud Console](https://console.cloud.google.com/) → nytt prosjekt.
2. Aktiver **Google Drive API** for prosjektet.
3. Lag en **Service Account** → legg til en **JSON-nøkkel** → lagre den som
   `config/gdrive-service-account.json`.
4. Del Drive-mappen med service-kontoens `client_email` (Leser-tilgang holder).
5. Sett `folderId` til ID-en i mappe-URL-en
   (`https://drive.google.com/drive/folders/<folderId>`).

Alternativt, for en offentlig delt mappe: `"auth": { "method": "apiKey", "apiKey": "..." }`.

### `garminConnect`

Henter aktivitets- og helsedata fra **Garmins personlige API**
(`https://personal.connectapi.garmin.com`) – aktiviteter, GPS-spor, puls, tempo
og høyde. API-et er offisielt, skrivebeskyttet og krever ingen Python eller
tredjepartsbibliotek; alt går gjennom Node.

```json
{ "id": "garmin-mitt", "type": "garminConnect", "enabled": true,
  "label": "Min Garmin-konto" }
```

**Autentisering** skjer med en personlig API-nøkkel:

1. Logg inn på Garmin Connect og åpne
   <https://connect.garmin.com/app/settings/personalApiToken>.
2. Velg **Create Key**, godta vilkårene og velg utløpstid. Nøkkelen vises bare
   én gang – kopier den med én gang.
3. Opprett kilden under Innstillinger → Datakilder.
4. Installer nøkkelen fra en interaktiv terminal på maskinen som kjører Trenern
   (i container: `podman exec -it systemd-trenern node scripts/auth-garmin.mjs --source-id garmin-mitt`):

```bash
node scripts/auth-garmin.mjs --source-id garmin-mitt
# -> limer inn API-nøkkelen (skjult input, aldri som argument)
# -> nøkkelen verifiseres mot Garmin og lagres, klar til ingest
```

Nøkkelen lagres i `config/keys/garmin-<id>/api-key` (katalog 0700, fil 0600),
aldri via web-UI-et. Nøkkelen byttes automatisk i et kortlevd bearer-token som
mellomlagres i samme katalog (`bearer-token.json`) og fornyes en time før utløp.
Når nøkkelen utløper eller trekkes tilbake, svarer Garmin 401 og synken stopper
med en tydelig feilmelding – lag en ny nøkkel og kjør skriptet på nytt.

**Viktig:** Ikke send API-nøkkelen som kommandolinjeargument (lekker via `ps`).
Skriptet spør på stdin uten å vise det du skriver.

**Utvidet Garmin-import:** Aktiviteter inkluderer sammendrag, GPS-spor og
måleserier for puls, kadens, fart, effekt, temperatur og løpsdynamikk – også
uten GPS. Måleseriene dekodes fra den originale FIT-fila
(`/download-service/files/activity/{id}`), siden det personlige API-et ikke har
noe måleserie-endepunkt. Det gir full oppløsning: hver enkelt FIT-måling, ikke
en nedskalert graf. Garmins tid i puls- og effektsoner, sonegrenser,
rundesammendrag, styrkesett og tilhørende økter hentes fra listesvaret og
separate endepunkter. Ukjente Garmin-felt bevares og kan åpnes under «Alle
Garmin-målinger». Aktiviteter uten originalfil (manuelt registrerte) importeres
med sammendrag og merkes `samples: unsupported` under «Datadekning».

Statistikksiden viser også daglige skritt, kalorier, etasjer, intensitetsminutter,
døgnpuls/hvilepuls, søvn og søvnscore, HRV, stress, Body Battery, SpO₂,
respirasjon, hydrering, vekt og kondisjonsalder. Velg periode, kilde og dag;
detaljer og måleserier er tilgjengelige i utfoldbare felt med paginering.
Tilgjengelige målinger avhenger av klokke, sensorer og Garmin-konto.

VO₂-maks, treningsstatus/belastning og treningsberedskap/restitusjonstid finnes
ikke i det personlige API-et og vises som «Ikke tilgjengelig» under
«Datadekning». VO₂-maks for en enkelt økt følger fortsatt med aktiviteten.

**Historikk:** `healthStartDate` (YYYY-MM-DD) velger første helsedag. Uten dato
brukes eldste aktivitetsdato. `healthBatchDays` (1–90, standard 30) begrenser
antall eldre dager per synk; de tre siste dagene oppdateres alltid. Hver synk
fortsetter med dager som ikke er hentet ennå. Delvise feil prøves igjen uten å
blokkere videre historikk; tidligere verdier bevares. Innstillingene finnes i
kildeskjemaet, og synkresultatet viser antall eldre dager som gjenstår.
Dagene lagres per kilde i `garmin_health` i SQLite/PostgreSQL; tabellen opprettes
automatisk ved oppstart uten å endre eksisterende aktiviteter.

**Inkrementell synk:** Garmins stabile aktivitets-ID brukes som referanse.
Endringer i aktivitetssammendraget (inkludert navn) utløser ny import. Første
synk etter oppgraderingen importerer tidligere Garmin-økter på nytt for å fylle
nye felt og rette tallene. Endringer som bare berører separate detaljendepunkter
kan kreve tvunget import (`npm run ingest -- --force`). Hentefeil vises i
«Datadekning», og eksisterende ekstra målinger bevares ved delvise feil.
Uten lagret API-nøkkel feiler kilden tydelig; den bruker aldri eksempeldata.

**Beregninger:** Tempo bruker autoritativ Garmin-distanse og bevegelsestid.
Garmins maks­fart og tid i pulssoner bevares. Appberegnede soner brukes bare når
Garmin-soner mangler, og merkes tydelig. Nedstigning kopieres aldri fra stigning.
Årsstatistikken inkluderer kalorier, skritt, total-/pausetid, nedstigning,
pulssonetid og flere treningsmål. Puls/kadens/effekt/temperatur vektes etter
bevegelsestid; manglende målinger inngår ikke som null i gjennomsnitt.

**Tester:** `node --test tests/*.test.js` (dekker API-klient, token-håndtering,
ZIP/FIT-dekoding, kildeadapteren og parserne).

## Filformater (parsere)

Ingest prøver parserne i rekkefølge og bruker den første som kjenner igjen fila:

| Parser | Kjenner igjen |
| --- | --- |
| `garminConnect` | Data fra Garmin Connect (`_garmin: true`). Håndterer både GPS- og ikke-GPS-aktiviteter |
| `healthAutoExport` | JSON fra iOS-appen *Health Auto Export* (`data.workouts[]` med `route`, `heartRateData`, `stepCount` …) |
| `genericTrack` | Fallback: en punktliste med `lat`/`lon` (+ valgfritt `ele`, `hr`, `time`) under vanlige nøkler (`track`, `points`, `route`, `samples`, `coordinates` …) pluss løs metadata |

Alt normaliseres til én felles aktivitetsmodell (se `src/model.js`). Avledede tall
(distanse, stigning, tempo, tid-i-sone) regnes ut fra sporet når parseren ikke
oppgir dem.

## Legge til en ny datakilde

1. Lag `src/sources/minKilde.js` som eksporterer en factory som returnerer
   `{ id, type, describe(), listFiles(), readJson(file) }`.
   - `listFiles()` → `[{ ref, name, modifiedTime, size }]`
   - `readJson(file)` → ferdig parset JSON
2. Registrer den i `src/sources/index.js` under `FACTORIES`.
3. Legg en oppføring i `config.json` sin `sources[]`.

Ingest cacher `ref + modifiedTime + size` per kilde, så uendrede filer hoppes over
(bruk `npm run ingest -- --force` eller `POST /api/ingest {"force":true}` for full re-lesing).

## Legge til et nytt filformat

1. Lag `src/parsers/minParser.js` som eksporterer `{ id, detect(json, filename), parse(json, ctx) }`.
   `parse` returnerer en liste med delvis utfylte aktiviteter; resten fylles av
   `finalizeActivity`.
2. Legg den inn i `PARSERS`-lista i `src/parsers/index.js` (mest spesifikk først,
   `genericTrack` sist).

## API

| Metode | Rute | Beskrivelse |
| --- | --- | --- |
| `GET` | `/api/activities?type=&from=&to=` | Liste (sammendrag) |
| `GET` | `/api/activities/:id` | Full økt inkl. spor |
| `DELETE` | `/api/activities/:id` | Slett lagret økt |
| `GET` | `/api/routes?type=&from=&to=` | Forenklede ruter (alle turer) for kartet |
| `GET` | `/api/stats` | Totaler |
| `GET` | `/api/stats/by-year` | Årsstatistikk med treningsmål og pulssoner |
| `GET` | `/api/garmin/health?source=&from=&to=` | Lagrede Garmin-helsedager |
| `GET` | `/api/config` | Utøver, pulssoner, parsere, kart |
| `GET` | `/api/sources` | Konfigurerte kilder |
| `POST` | `/api/ingest` `{force?, sourceId?}` | Kjør ingest nå |
| `GET` | `/api/ingest/status` | Status / siste resultat |
| `GET` | `/api/sources` | `{ types, sources }` (uten hemmeligheter) |
| `POST` | `/api/sources` | Legg til kilde |
| `PUT` | `/api/sources/:id` | Endre kilde (tomt nøkkelfelt = behold eksisterende) |
| `DELETE` | `/api/sources/:id` | Slett kilde + nøkkelfil |
| `POST` | `/api/sources/:id/test` | Test tilkobling (lister filer) |

## Lagring

Normaliserte økter lagres i en database. Backend velges av `storage.backend`:

- **`sqlite`** (standard) — én fil, `data/trenern.db`. Ingen ekstern tjeneste.
- **`postgres`** — sett `storage.postgres.url` eller `DATABASE_URL`
  (`postgres://bruker:pass@vert:5432/db`). Tabellen opprettes automatisk.

Begge backendene deler skjema (`src/db/shared.js`): skalarkolonner for lister,
filter og statistikk, pluss hele det normaliserte objektet (inkl. sporet) i en
`data`-kolonne (`TEXT`/`jsonb`).

Har du kjørt en tidligere versjon med JSON-lager, importeres
`data/activities/*.json` automatisk til databasen ved første oppstart (én gang,
markert med `data/.migrated-to-db`). Manuelt: `npm run migrate`.

## Scripts

```bash
npm start                    # web-server + planlagt ingest
npm run ingest               # én ingest-runde fra CLI
npm run ingest -- --force    # ignorer cache
npm run sample               # regenerer eksempeldata
npm run migrate              # importer gammelt JSON-lager til databasen
```
