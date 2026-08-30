# Kjøre trenern med Podman Quadlet

Quadlet-enheter genererer systemd-tjenester fra `.container`/`.volume`/`.network`/
`.build`-filer. Denne mappa har to oppsett:

| Oppsett | Filer | Database |
| --- | --- | --- |
| **Standalone** (enklest) | `quadlet/trenern.container`, `trenern-data.volume`, `trenern-config.volume` | SQLite i data-volumet |
| **Med Postgres** | `quadlet/with-postgres/*` + `trenern-data.volume` + `trenern-config.volume` | PostgreSQL i egen container |

Alt kjører fint **rootless** (per bruker). Bytt `--user` / `~/.config` mot
`/etc/containers/systemd/` for et system-wide oppsett.

## 1. Bygg imaget

```bash
git clone git@github.com:mbirkis/trenern.git ~/src/trenern
cd ~/src/trenern
podman build -t localhost/trenern:latest -f Containerfile .
```

Alternativt: la Podman bygge automatisk – kopier `quadlet/trenern.build` inn
sammen med de andre enhetene, sett `SetWorkingDirectory` til checkout-stien, og
endre `Image=localhost/trenern:latest` til `Image=trenern.build` i
`trenern.container`.

## 2a. Standalone (SQLite)

```bash
mkdir -p ~/.config/containers/systemd
cp quadlet/trenern.container        ~/.config/containers/systemd/
cp quadlet/trenern-data.volume      ~/.config/containers/systemd/
cp quadlet/trenern-config.volume    ~/.config/containers/systemd/

systemctl --user daemon-reload
systemctl --user enable --now trenern.service
```

Åpne <http://localhost:3005>. Første start lager `config.json` i
`trenern-config`-volumet fra `config.example.json`.

## 2b. Med PostgreSQL

```bash
mkdir -p ~/.config/containers/systemd ~/.config/trenern

# hemmeligheter (samme passord begge steder)
PW=$(openssl rand -hex 24)
printf 'POSTGRES_PASSWORD=%s\n' "$PW"                                   > ~/.config/trenern/db.env
printf 'DATABASE_URL=postgres://trenern:%s@trenern-db:5432/trenern\n' "$PW" > ~/.config/trenern/app.env
chmod 600 ~/.config/trenern/*.env

cp quadlet/with-postgres/trenern.network      ~/.config/containers/systemd/
cp quadlet/with-postgres/trenern-db.volume    ~/.config/containers/systemd/
cp quadlet/with-postgres/trenern-db.container ~/.config/containers/systemd/
cp quadlet/with-postgres/trenern.container    ~/.config/containers/systemd/
cp quadlet/trenern-data.volume                ~/.config/containers/systemd/
cp quadlet/trenern-config.volume              ~/.config/containers/systemd/

systemctl --user daemon-reload
systemctl --user enable --now trenern.service   # trekker trenern-db med seg
```

`DATABASE_URL` i `app.env` velger Postgres-backend automatisk (overstyrer
`storage.backend` i config.json).

## Vanlige kommandoer

```bash
systemctl --user status trenern
journalctl --user -u trenern -f
systemctl --user restart trenern
podman volume ls | grep trenern
```

For at brukertjenester skal starte uten aktiv innlogging:

```bash
loginctl enable-linger "$USER"
```

## Data og migrering

- SQLite-fila ligger på `systemd-trenern-data:/app/data/trenern.db`.
- Har du kjørt en eldre versjon med JSON-lager (`data/activities/*.json` i
  volumet), importeres de automatisk til databasen ved første oppstart. Kjør
  manuelt ved behov:

  ```bash
  podman exec -it systemd-trenern node scripts/migrate-json-to-db.mjs
  ```

## Backup

```bash
# SQLite
podman run --rm -v systemd-trenern-data:/d:ro -v "$PWD":/out docker.io/library/alpine \
  cp /d/trenern.db /out/trenern-backup.db

# Postgres
podman exec systemd-trenern-db pg_dump -U trenern trenern > trenern-backup.sql
```
