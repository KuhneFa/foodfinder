# 🍽️ Foodfinder

Swipen. Matchen. Essen. In einer Minute herausfinden, worauf die ganze Gruppe Bock hat.

1. Du legst unter `/admin` eine **Runde** an, gibst an, **wie viele ihr seid**, und bekommst einen geheimen Link und eine 6-stellige PIN. Teilen geht über das Teilen-Menü des Handys (z. B. WhatsApp).
2. Jede Person gibt PIN und Namen ein und **swipt durch 15 Küchen**: rechts = Bock, links = nö. Am Ende kann man bis zu 3 eigene Ideen einbringen, die dann alle anderen auch swipen, und eine Notiz (Allergien, No-Gos) hinterlassen.
3. Sobald alle fertig sind, gibt es die **Matches**: Küchen, auf die *alle* Bock haben. Gibt es keins, startet eine neue Swipe-Runde, und es wird angezeigt, was knapp war. Bei genau einem Match steht das Ergebnis sofort fest.
4. In der **Endrunde** sortiert jede Person die Matches. Jede Person hat **ein Veto**: Was vetoiert wird, kann nicht gewinnen.
5. **Ergebnis:** Der Gewinner wird groß angezeigt, dazu Plan B und C. Dann gibt man noch den Ort ein („📍 Wo seid ihr?“, bleibt nur im Browser) und kopiert einen fertigen **KI-Prompt** in Claude oder ChatGPT. Er fragt nach Restaurants in der Nähe, die gerade liefern, und nach schnellen Rezepten zum Selberkochen.

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

2–10 Personen pro Runde, 3 eigene Ideen pro Person (10 pro Runde), 200 Runden insgesamt.

## Fotos

Jede Küche zeigt das Foto `public/img/<küche>.jpg` (z. B. `public/img/thai.jpg`, Hochformat 2:3, z. B. 720×1080). Die Namen stehen in `FOODS` in `public/common.js`. Fehlt ein Foto, zeigt die Karte stattdessen ein großes Emoji. Nach dem Austauschen von Fotos den Server neu starten. Bildnachweise stehen in [CREDITS.md](CREDITS.md).

## Aufbau

```
server.js        HTTP-Server, API, Sicherheit (nur Node-Bordmittel)
db.js            SQLite-Schema (node:sqlite)
public/
  common.js      Übersetzungen, Theme, Hilfsfunktionen
  round.js       Teilnehmerseite: Beitreten, Swipen, Endrunde, Ergebnis, KI-Prompt
  admin.js       Verwaltung
  *.html, style.css
  img/           Fotos der Küchen
test/            API-Tests (node:test)
Dockerfile       für Railway
.github/         CI-Workflow
```

Umgebungsvariablen: `ADMIN_PASSWORD` (Pflicht), `PORT` (setzt Railway), `DATA_DIR` (Standard im Container: `/data`), `TRUST_PROXY=1` (wird auf Railway automatisch erkannt).
