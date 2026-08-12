# Bingo-Abend

Eine responsive, deutschsprachige Bingo-Mehrspieler-Anwendung. Das vorhandene Frontend wird von einem Node.js-/Express-Server ausgeliefert. Socket.IO synchronisiert Räume live zwischen Geräten; SQLite speichert Räume, Teilnehmer, individuelle Karten, Markierungen, gezogene Zahlen und Spielstatus dauerhaft.

## Architektur

- **Frontend:** `index.html`, `styles.css` und `app.js`, ausgeliefert über Express.
- **Echtzeit:** Socket.IO nutzt dieselbe Domain und denselben Port wie die Webseite.
- **Backend:** `server.js` verbindet Transport und Spiellogik; `server/game-service.js` validiert alle Aktionen und Host-Rechte.
- **Persistenz:** SQLite via `better-sqlite3` mit parametrisierten Abfragen. Schema und Datenbank werden beim ersten Start automatisch angelegt.
- **Sitzung:** Nur eine nicht sensible Spieler-ID, Name und aktueller Raum werden im Browser gespeichert. Nach Neuladen oder kurzer Trennung wird die serverseitige Sitzung wiederhergestellt.

Räume laufen exakt 24 Stunden nach ihrer Erstellung ab. Der Server löscht abgelaufene Räume beim Start und danach alle 15 Minuten. Ein Zugriff nach dem Ablauf wird bereits unabhängig vom Bereinigungsintervall abgelehnt.

## Lokal starten

Voraussetzung ist Node.js 22 (oder eine aktuelle kompatible LTS-Version) mit Build-Werkzeugen für `better-sqlite3`.

```bash
npm install
DATABASE_PATH="$(pwd)/data/bingo.sqlite" npm start
```

Danach ist die Anwendung unter `http://localhost:3000` erreichbar. Prüfungen laufen mit:

```bash
npm run check
npm test
```

## Docker auf dem Raspberry Pi

Das Debian-Slim-Image und die im Build-Stage installierten Compilerwerkzeuge unterstützen auch ARM64. Der Container ist ausschließlich über `127.0.0.1:3011` erreichbar; die vorhandene Cloudflare-Konfiguration kann unverändert bleiben.

```bash
docker compose up -d --build
docker compose ps
docker compose logs --tail=100
```

SQLite liegt im Container unter `/app/data/bingo.sqlite`. Durch `./data:/app/data` befindet sich der dauerhafte Datenbestand auf dem Host im Repository-Unterordner `data/`.

## Updates

```bash
cd /srv/websites/bingo/Bingo
git pull
docker compose up -d --build
docker compose ps
docker compose logs --tail=100
```

Nach Änderungen ist `docker compose up -d --build` erforderlich, damit Abhängigkeiten und Anwendungsdateien neu gebaut und der Dienst neu gestartet werden. Nur bei reinen Datenänderungen ist kein Neubau nötig.

## Backup und Betrieb

Vor Updates empfiehlt sich ein Backup des gesamten Ordners `data` bei gestopptem Container, damit SQLite-Hauptdatei und mögliche WAL-Dateien konsistent zusammen gesichert werden:

```bash
docker compose stop
cp -a data "data-backup-$(date +%F-%H%M%S)"
docker compose up -d
```

Status, laufende Logs und ein lokaler Healthcheck:

```bash
docker compose ps
docker compose logs -f bingo
curl http://127.0.0.1:3011/health
```
