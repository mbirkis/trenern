# trenern

Self-hosted web-app for å spore trening (løpeturer, fjellturer, terrengløp osv.).
Ruter tegnes på et OpenStreetMap-kart, og et panel på høyre side viser puls,
tempo, skritt, pulssoner, tid og annen helsedata for den valgte økta.

Data hentes automatisk fra JSON-filer. Første datakilde er en **Google Drive**-mappe;
arkitekturen er plugin-basert så flere kilder og filformater kan legges til senere.

## Kom i gang

```bash
npm install
cp config/config.example.json config/config.json   # gjøres av installasjonen, rediger etter behov
npm run sample                                       # lager 3 eksempel-økter i data/sample/
npm start                                            # http://127.0.0.1:3005
```

`npm start` kjører en ingest ved oppstart og deretter hvert `ingest.intervalMinutes`.
Knappen **Synk nå** i toppen trigger en manuell henting.

## Konfigurasjon (`config/config.json`)

| Felt | Betydning |
| --- | --- |
| `server.port` / `server.host` | Hvor web-serveren lytter |
| `athlete.birthYear` | Brukes til å estimere makspuls (`220 − alder`) hvis `maxHr` er `null` |
| `athlete.maxHr` | Overstyr makspuls eksplisitt. Styrer pulssonene (5 soner, 50–100 % av maks) |
| `athlete.restingHr` | Hvilepuls (vises i panelet) |
| `ingest.autoOnStart` | Kjør ingest når serveren starter |
| `ingest.intervalMinutes` | Intervall for automatisk ingest (`0` = av) |
| `sources[]` | Liste med datakilder, se under |

Env-overstyring: `PORT`, `HOST`, `TRENERN_CONFIG` (alternativ config-sti).

## Datakilder

Hver kilde i `sources[]` har `id`, `type`, `enabled` og typespesifikke felter.

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

## Filformater (parsere)

Ingest prøver parserne i rekkefølge og bruker den første som kjenner igjen fila:

| Parser | Kjenner igjen |
| --- | --- |
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
| `GET` | `/api/stats` | Totaler |
| `GET` | `/api/config` | Utøver, pulssoner, parsere |
| `GET` | `/api/sources` | Konfigurerte kilder |
| `POST` | `/api/ingest` `{force?, sourceId?}` | Kjør ingest nå |
| `GET` | `/api/ingest/status` | Status / siste resultat |

## Lagring

Normaliserte økter lagres som JSON under `data/activities/<id>.json`, med et
sammendrags-indeks i `data/index.json`. Ingen database kreves. `data/` er
git-ignorert.

## Scripts

```bash
npm start                    # web-server + planlagt ingest
npm run ingest               # én ingest-runde fra CLI
npm run ingest -- --force    # ignorer cache
npm run sample               # regenerer eksempeldata
```
