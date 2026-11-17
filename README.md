# 🍽️ Foodfinder

Gemeinsam herausfinden, worauf alle Lust haben.

1. Du legst unter `/admin` eine **Runde** an und bekommst einen geheimen Link und eine 6-stellige PIN.
2. Du schickst den Link (z. B. per WhatsApp) an die Gruppe, die PIN am besten separat.
3. Jede Person gibt PIN und Namen ein und **zieht die Essen in ihre Reihenfolge**. Man kann bis zu 5 eigene Essen ergänzen und eine Notiz hinterlassen.
4. Wer abgestimmt hat, sieht die **gemeinsame Rangliste** und bekommt einen **Markdown-Text**, den man in ein Sprachmodell kopiert. Das liefert dann Vorschläge zum Selberkochen und zum Bestellen.

Sprachen: Deutsch, Englisch, Spanisch, Katalanisch, Rumänisch. Hell- und Dunkelmodus folgen dem System und lassen sich per ◐ umschalten.

## Lokal starten

Benötigt Node.js ≥ 22.13. Es gibt keine weiteren Abhängigkeiten, ein `npm install` ist nicht nötig.

```bash
npm run dev                                   # Admin-Passwort: dev-password-123
ADMIN_PASSWORD='dein-eigenes-passwort' npm start   # oder mit eigenem Passwort
```

Dann http://localhost:3000/admin öffnen.

## Tests

```bash
npm test                                                   # startet einen eigenen Server mit Test-Datenbank
BASE_URL=http://localhost:3000 ADMIN_PASSWORD=… npm test   # gegen einen laufenden Server
```

Die CI (GitHub Actions) führt die Tests bei jedem Push aus, einmal direkt und einmal gegen den gebauten Docker-Container. Dabei wird auch geprüft, dass die Daten im Volume einen Neustart überleben.

## Auf Railway deployen

1. Projekt in ein GitHub-Repo pushen. Alternativ mit der Railway-CLI: `railway up`.
2. In Railway: **New Project → Deploy from GitHub repo**. Das `Dockerfile` wird automatisch erkannt.
3. Im Service ein **Volume** anlegen, Mount-Pfad: **`/data`**. Dort liegt die SQLite-Datenbank. Ohne Volume gehen bei jedem Deploy alle Daten verloren.
4. Unter **Variables** setzen:
   - `ADMIN_PASSWORD`: langes, zufälliges Passwort (mindestens 12 Zeichen, besser 20+). Ohne diese Variable startet die App nicht.
5. Unter **Settings → Networking → Generate Domain** eine öffentliche URL erzeugen.
6. `https://<deine-domain>/admin` öffnen und die erste Runde anlegen.

## Sicherheit

- **Link:** 128 Bit Zufall, praktisch nicht erratbar.
- **PIN:** wird nur als scrypt-Hash gespeichert. Nach 5 Fehlversuchen ist die Runde 15 Minuten gesperrt. Das gilt auch für parallele Anfragen.
- **Rate-Limits** pro IP für API, Beitreten und Admin-Login, dazu ein globales Limit für fehlgeschlagene Admin-Logins.
- **Sessions:** zufällige Tokens, nur gehasht gespeichert, als `HttpOnly`/`SameSite=Strict`-Cookie (über HTTPS mit `Secure`).
- **Schreibende Anfragen** werden nur akzeptiert, wenn der `Origin`-Header zur eigenen Domain passt (CSRF-Schutz).
- **Header:** strenge Content-Security-Policy (keine Inline-Skripte, keine fremden Quellen), `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer` (der geheime Link landet nirgends als Referrer), HSTS, `noindex`.
- **Eingaben** werden serverseitig geprüft und gekürzt, die Ausgabe erfolgt nur als Text (kein HTML), daher kein XSS.
- **Aufräumen:** Runden und alle zugehörigen Antworten werden nach **30 Tagen** automatisch gelöscht.
- **Keine npm-Abhängigkeiten.** Es gibt also keine fremden Pakete, über die eine Lücke hereinkommen kann.

### Grenzen

Max. 20 Teilnehmer pro Runde, 5 eigene Essen pro Person, 200 Runden insgesamt.

## Aufbau

```
server.js        HTTP-Server, API, Sicherheit (nur Node-Bordmittel)
db.js            SQLite-Schema (node:sqlite)
public/
  common.js      Übersetzungen, Theme, Hilfsfunktionen
  round.js       Teilnehmerseite: Beitreten, Rangliste, Auswertung, Export
  admin.js       Verwaltung
  *.html, style.css
test/            API-Tests (node:test)
Dockerfile       für Railway
.github/         CI-Workflow
```

Umgebungsvariablen: `ADMIN_PASSWORD` (Pflicht), `PORT` (setzt Railway), `DATA_DIR` (Standard im Container: `/data`), `TRUST_PROXY=1` (wird auf Railway automatisch erkannt).
