# 🍽️ Foodfinder

Sag, worauf du Bock hast. Den Rest machen wir. Foodfinder nimmt einer Gruppe die Essensentscheidung ab.

1. Du legst unter `/admin` eine **Runde** an: **Ort** (landet im Prompt), wie viele ihr seid, optional ein Titel. Du bekommst einen geheimen Link und eine 6-stellige PIN. Teilen geht über das Teilen-Menü des Handys (z. B. WhatsApp).
2. Jede Person gibt PIN und Namen ein und wird gefragt: **„Weißt du schon, worauf du Bock hast?“**
   - **Ja:** Wunsch eintippen oder antippen (z. B. „Pizza“). Geschmacksfragen entfallen dann.
   - **Nein, hilf mir:** 6 Entweder-oder-Duelle im Vollbild (Heiß/Kalt, Scharf/Mild, Frisch/Deftig, Fruchtig/Herzhaft, Knusprig/Cremig, Veggie/Fleisch).
3. **„Passt das so?“:** Übersicht der eigenen Stimme zum Nachschärfen: Geschmack (gern oder muss), Schärfe, Temperatur, Ernährung, Budget pro Person und No-Gos (auch als Freitext). Mit Wunsch gibt es nur Ernährung, Budget und No-Gos.
4. Jede Stimme ist **geheim**. Sobald alle abgestimmt haben, wird daraus das **Gruppenprofil**: Wünsche, gewichteter Geschmack, Schärfe (will jemand mild, muss sie wählbar sein), Temperatur (Mehrheit), Ernährung, das niedrigste Budget und alle No-Gos.
5. **Ergebnis:** Alle sehen das Profil und den **Masterprompt** zum Kopieren. In Claude eingefügt, liefert er 3 Restaurants in der Nähe mit je 3 Gerichten, als JSON.

Die Seite aktualisiert sich während des Wartens selbst. Hängt jemand, kann man nach 20 Sekunden ohne diese Person weitermachen.

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

2–10 Personen pro Runde, 5 eigene No-Gos pro Person, 200 Runden insgesamt.

## Masterprompt und KI

- Der Prompt entsteht in `prompt.js` aus dem Gruppenprofil (`aggregate`) und wird mit `buildPrompt` zusammengesetzt. Bei Konflikten gilt: No-Gos vor Budget vor Ernährung vor Wünschen vor Geschmack. Freitext steht in Anführungszeichen und gilt ausdrücklich nicht als Anweisung.
- Die Antwortsprache folgt der Sprache der Oberfläche.
- `test/prompt.test.js` testet Profil und Prompt ohne Server. Dort lassen sich Prompt-Änderungen schnell absichern.
- **Noch ruft Foodfinder kein Sprachmodell auf.** `llm.js` bereitet die Anbindung vor: Anbieter Claude (Standard, `claude-opus-5-5`), ChatGPT und Gemini; Auswahl per `LLM_PROVIDER`. Zum Anbinden dort `generate()` umsetzen.

## Aufbau

```
server.js        HTTP-Server, API, Sicherheit (nur Node-Bordmittel)
db.js            SQLite-Schema (node:sqlite) und Migration älterer Datenbanken
prompt.js        Gruppenprofil und Masterprompt
llm.js           vorbereitete KI-Anbindung (noch ohne Aufruf)
public/
  common.js      Übersetzungen, Auswahl, Theme, Hilfsfunktionen
  round.js       Teilnehmerseite: Beitreten, Wunsch, Duelle, Übersicht, Warten, Ergebnis
  admin.js       Verwaltung
  *.html, style.css
test/            API-, Prompt- und Übersetzungstests (node:test)
Dockerfile       für Railway
.github/         CI-Workflow
```

Umgebungsvariablen: `ADMIN_PASSWORD` (Pflicht), `PORT` (setzt Railway), `DATA_DIR` (Standard im Container: `/data`), `TRUST_PROXY=1` (wird auf Railway automatisch erkannt), `TIMEZONE` (für die Uhrzeit im Prompt, Standard `Europe/Berlin`), `LLM_PROVIDER` (`claude`, `chatgpt` oder `gemini`, Standard `claude`).
