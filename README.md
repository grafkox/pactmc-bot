# PactMC-Bot

Discord-Bot für den PactMC-Server, gebaut mit [discord.js](https://discord.js.org/).

## Features

| Slash-Command | Beschreibung | Berechtigung |
|---|---|---|
| `/ping` | Aktuelle Bot-Latenz anzeigen | jeder |
| `/mc` | Status des Minecraft-Servers (`pactmc.de`) abfragen | jeder |
| `/kopfoderzahl` | Eine Münze werfen | jeder |
| `/rules` | Server-Regeln als Embed posten | Owner |
| `/ticket-panel` | Ticket-Panel mit den Buttons Bug, Hilfe und Beschwerde posten | Owner |
| `/bewerbungs-panel` | Bewerbungs-Infos mit Button posten | Owner |
| `/add <user>` | User zum aktuellen Ticket hinzufügen | Team, in normalen Tickets auch der Ersteller |
| `/remove <user>` | Hinzugefügten User wieder aus dem Ticket entfernen | Team, in normalen Tickets auch der Ersteller |
| `/unlink <user>` | Bestätigten Ingame-Namen eines Users zurücksetzen | Owner, Admin, Mod-Leitung, Mod |
| `/console-upgrade` | Ticket auf Console-Zugang hochstufen | Owner, Admin |
| `/bot-mode <an/aus>` | Bot betreut das Ticket komplett | Owner, Admin, Mod |
| `/mc-killswitch [zustand]` | Console-Zugang global ein- oder ausschalten | Owner |
| `/mc-policy [profil]` | Policy-Profil für Server-Befehle wählen | Owner |
| `/systemtest [modelle]` | Prüft Rechte, Kategorien, Daten, Modelle, RCON und Logs | Owner |

| Prefix-Command | Beschreibung |
|---|---|
| `!dm @user <text>` | Schickt `<text>` als DM an den erwähnten User (Owner-only) |
| `!message #channel <text>` | Schickt `<text>` in den erwähnten Channel (Owner-only) |

Außerdem:
- Begrüßt neue Mitglieder automatisch im Welcome-Channel und per DM.
- Pingt das Support-Team, sobald jemand den Support-Warteraum betritt (höchstens alle 2 Minuten pro User).
- Rotiert seine Discord-Status-Aktivität alle 30 Sekunden.

## Ticket-System

Der Bot verwaltet Tickets selbst. Die Panels werden einmal per Command gepostet, die Buttons funktionieren
auch nach einem Neustart weiter.

- Bug, Hilfe und Beschwerde liegen in einer gemeinsamen Kategorie. Zugriff haben Ersteller, Owner, Admin, Mod und Probe-Mod.
- Bewerbungen haben eigene Kategorien. Zugriff haben Ersteller, Owner, Admin und Mod-Leitung.
- Channels heißen `bug-0001`, `hilfe-0002` und so weiter, mit einem gemeinsamen Zähler.
- Schließen kann jeder per Button, nach einer Rückfrage. Das Ticket wandert in die Closed-Kategorie, der Ersteller und per `/add` hinzugefügte User verlieren die Sicht.
- Im geschlossenen Ticket gibt es die Buttons "Wieder öffnen" (alles wird zurückgesetzt) und "Löschen" (mit Rückfrage, endgültig).
  Beides darf nur das Team.
- Pro User sind höchstens `TICKET_MAX_OPEN_PER_USER` Tickets gleichzeitig offen (Default 3) und höchstens 5 neue pro Stunde.
  Per `/add` kommen höchstens 10 weitere User in ein Ticket.
  `/remove` entfernt nur User, die per `/add` dazugekommen sind. Bots und Teammitglieder, die das Ticket schon über ihre
  Rolle sehen, lassen sich nicht hinzufügen. In Bewerbungs- und Console-Tickets entscheidet nur das Team, wer mitliest.
- Zähler, offene Tickets, Panels, Killswitch, Policy-Profil und bestätigte Ingame-Namen stehen in `data/tickets.json` (siehe Docker).
  Ist die Datei beim Start nicht lesbar, wird sie als `tickets.json.defekt-<Zeit>` gesichert und neu angelegt.

Kategorien, Rollen und Channel-IDs stehen in [src/config.js](src/config.js).

## AI Ticket Assistant

Der Bot liest in Tickets mit und beantwortet einfache Support-Fragen über [Open WebUI](https://github.com/open-webui/open-webui)
(OpenAI-kompatibler Endpoint). Zwei Stufen:

1. Gate: entscheidet pro Nachricht, ob der Bot antwortet, still bleibt oder ein Mensch übernimmt.
2. Antwort (`pact-answer`, Vision und Knowledge): formuliert die Antwort.

Das Gate läuft wahlweise über Open WebUI (`pact-gate`) oder über ein lokales Entscheidungsmodell in Ollama
(`nimble`, Endpoint `/v1/systemone`). Gesteuert wird das mit `GATE_MODE`:

| Wert | Verhalten |
|---|---|
| `openwebui` | Standard, nur das Open-WebUI-Gate |
| `shadow` | Open-WebUI-Gate entscheidet, das lokale läuft mit, Abweichungen werden geloggt |
| `ollama` | Das lokale Gate entscheidet. Bei Fehler oder Timeout wird eskaliert (oder per `ROUTER_FALLBACK=openwebui` aufs alte Gate gewechselt) |

Jede Entscheidung des lokalen Gates landet mit Text, Wahrscheinlichkeiten und Latenz in `ROUTER_LOG_FILE` (JSON Lines).
Beim lokalen Gate gehen Nachrichten mit Bild ohne Anfrage direkt zum Antwortmodell.

Verhalten je Ticket:

| Modus | Antworten | Pausiert durch |
|---|---|---|
| normal | höchstens `MAX_AUTO_REPLIES`, danach wird das Team gepingt | Nachricht von Owner, Admin, Mod oder Probe-Mod |
| console | unbegrenzt | Nachricht von Owner, Admin oder Mod |
| bot-mode | unbegrenzt, Team-Nachrichten pausieren nicht | `/bot-mode aus` |

- Kurz aufeinanderfolgende Nachrichten werden zusammengefasst (Debounce), Bilder sofort geladen.
- In Console-Tickets und im Bot-Modus entscheidet das Antwortmodell über Eskalationen, nicht das Gate.
- In Bewerbungs-Tickets antwortet der Bot nicht von selbst, `/console-upgrade` und `/bot-mode` gehen dort nicht.
- Bei Fehler, Timeout oder ungültigem JSON wird eskaliert statt geraten.
- In Modi ohne Antwort-Limit greift ein Anfrage-Limit (20 Antworten in 10 Minuten pro Ticket), danach übernimmt das Team.
- Wer den Bot per `@Bot` erwähnt (in Tickets, Mod-Chat und Admin-Chat), bekommt eine Antwort mit den letzten `MENTION_CONTEXT_MESSAGES`
  Nachrichten als Kontext, höchstens `MENTION_CONTEXT_HOURS` Stunden alt. Der Bot eskaliert dabei nicht von sich aus,
  das Team wird nur gepingt, wenn jemand ausdrücklich einen Menschen verlangt. Erwähnungen sind auf 5 pro Minute je User begrenzt.
  In offenen Tickets (nicht in Bewerbungen) kann der Bot dabei Logs durchsuchen und den Ingame-Namen bestätigen lassen,
  auch nach einer Eskalation. Server-Befehle laufen per Erwähnung nie.

Prompts und Einrichtung der Modelle stehen in [docs/open-webui-setup.md](docs/open-webui-setup.md).

## Console-Zugang und Server-Befehle

Ein Ticket kann per `/console-upgrade` oder automatisch durch das Antwortmodell auf Console-Zugang hochgestuft werden.
Es zieht in die Console-Kategorie, wird zu `console-<Nr>` umbenannt und Probe-Mods verlieren die Sicht. Ersteller, Owner, Admin,
Mod und hinzugefügte User bleiben. Die Meldung dazu geht in den Audit-Channel.

In Console-Tickets darf das Antwortmodell Befehle per RCON an den Leaf-Server oder den Velocity-Proxy vorschlagen.
Jeder Befehl läuft durch mehrere Schichten, in dieser Reihenfolge:

1. Killswitch: Ist der Console-Zugang aus, wird nichts geprüft und nichts ausgeführt.
2. Rate-Limit: `MC_RATE_LIMIT_PER_USER` Vorschläge pro Minute, je User und je Channel.
3. Policy im Code, kein Modell: Blocklist, Allowlist mit Argumentprüfung, Tier und Profil.
4. Supervisor (`pact-terminal-supervisor`): bekommt Befehl, Begründung und Zitate der Spielernachrichten als Daten und lehnt im Zweifel ab.
5. Bestätigung durch Owner oder Admin, falls das Profil es für den Tier verlangt.
6. Ausführung per RCON, Ausgabe zurück ans Antwortmodell, Eintrag im Audit-Channel.

Lehnt Policy oder Supervisor ab, bekommt das Antwortmodell den Grund und kann einen angepassten Befehl vorschlagen oder dem
Spieler antworten. Pro Nutzer-Nachricht gibt es höchstens `ACTION_MAX_CYCLES` Aktionsschritte (Befehle und Log-Abfragen), danach wird eskaliert.

Die Policy lehnt unabhängig von Modell und Profil ab: Befehle außerhalb der Allowlist, `stop`, `restart`, `op`, `deop`, `reload`, `execute`,
`function`, `save-off`, Rechteverwaltung, Namespace-Befehle (`minecraft:...`), Selektoren (`@a`, `@e`, `@p`),
Gamerule-Änderungen, Whitelist an/aus, gefährliche Items bei `give` (Command-Blöcke, TNT, End-Kristalle, Lava, Spawn-Eier und ähnliche), Teleports unter Y -64 oder über Y 320.
Bei `effect` sind nur hilfreiche Effekte ohne PvP-Vorteil freigegeben (z.B. Nachtsicht, Feuerresistenz, Regeneration). Spieler aus
`MC_PROTECTED_PLAYERS` (Team) sind geschützt vor `tp`, `gamemode`, `effect`, `experience`, `kick`, `ban`, `pardon`, `kill`,
`clear`, `send`, `whitelist remove` und `data get`. Die Tiers:

| Tier | Befehle |
|---|---|
| read-only | reine Abfragen ohne private Spielerdaten (`list`, `tps`, `banlist players`, `whitelist list`, `glist`, ...) |
| moderation | `kick` |
| privileged | alles, was Spielern etwas gibt, sie bewegt, sperrt oder in ihrem Namen spricht (`give`, `tp`, `gamemode`, `effect`, `ban`, `pardon`, `say`, `msg`, `whitelist add`, `data get`, `send`) |
| destructive | `clear`, `kill` auf einen Spieler |

Die vollständige Liste steht in [policy.js](src/features/mcCommands/policy.js).

| Profil | read-only | moderation | privileged | destructive |
|---|---|---|---|---|
| `open` | automatisch | automatisch | automatisch | automatisch |
| `guarded` (Standard) | automatisch | automatisch | Bestätigung | Bestätigung |
| `locked` | Bestätigung | Bestätigung | Bestätigung | Bestätigung |

Im Standardprofil laufen also nur Abfragen und `kick` ohne Rückfrage. Wird der Killswitch umgelegt, während eine Bestätigung offen ist,
wird der Befehl auch nach der Bestätigung nicht mehr ausgeführt. Serverausgaben gehen ohne IP-Adressen ans Antwortmodell, im Audit-Channel
steht die Rohausgabe.

Killswitch und Profil werden in `data/tickets.json` gespeichert und überleben Neustarts. Ohne gesetzten Wert startet der Console-Zugang
ausgeschaltet. Mit `MC_DRY_RUN=true` läuft alles inklusive Audit, aber es wird nichts an den Server gesendet. Zum Einführen bietet sich
`MC_DRY_RUN`, dann `guarded`, dann erst `open` an.

## Server-Logs

Vor der ersten Log-Abfrage muss ein Spieler bestätigen, dass ihm der Ingame-Name gehört. Das läuft ohne KI: Der Bot
schickt per RCON `msg <Name> <Code>` ins Spiel, der Spieler gibt den 6-stelligen Code im Ticket ein. Es gibt einen
Button zum erneuten Senden (30 Sekunden Abklingzeit, höchstens 5 Codes pro Bestätigung, 6 pro Ingame-Name und 10 pro User je Stunde). Ist der Spieler nicht online, kann er
den Code neu senden lassen, den Namen ändern oder angeben, dass er nicht auf den Server kommt. Nach 3 falschen
Eingaben kommt automatisch ein neuer Code. Die Verknüpfung Discord-User und Ingame-Name wird 30 Tage gespeichert.
Danach darf der Spieler nur nach seinem eigenen Namen suchen, und der Supervisor bekommt den bestätigten Namen
für Befehle mit. Das Antwortmodell kann die Bestätigung auch ohne Log-Abfrage anstoßen (Aktion `verify`), etwa vor
einem Befehl. Eine falsche Verknüpfung hebt das Team mit `/unlink` auf.

Das Antwortmodell kann in jedem Ticket Server-Logs durchsuchen, zum Beispiel wenn ein Spieler fehlende Villager meldet und im Log steht,
dass Zombies sie getötet haben. Gelesen werden `latest.log` und ältere `*.log.gz`, höchstens 10 Dateien im gewählten Zeitraum
(bis 7 Tage), nur lesend. Jede Abfrage braucht mindestens einen Suchbegriff oder Spielernamen, die Treffer sind auf 30 Zeilen begrenzt.
Vor der Weitergabe werden IP-Adressen, Mail-Adressen, Token und Bestätigungscodes entfernt. Zeilen über andere Spieler (Chat, Befehle,
Login, Logout) fallen ganz weg, Koordinaten bleiben nur in Zeilen mit dem eigenen Namen stehen. Das gilt in jedem Ticket, auch mit
Console-Zugang. Die Logs müssen als Volume in den Container gemountet werden.

## Setup (lokal)

Voraussetzung: **Node.js 24** (LTS Krypton) oder neuer.

```bash
# 1. Repo klonen
git clone https://github.com/GrafkoxLP/pactmc-bot.git
cd pactmc-bot

# 2. Environment-Variablen anlegen
cp .env.example .env
# anschließend .env öffnen und Werte eintragen (siehe unten)

# 3. Dependencies installieren
npm install

# 4. Bot starten
npm start
```

Für Live-Reload während der Entwicklung: `npm run dev`.

## Setup (Docker)

```bash
docker build -t pactmc-bot .
docker run --rm --env-file .env pactmc-bot
```

Das im Repo enthaltene GitHub-Actions-Workflow [docker-image.yml](.github/workflows/docker-image.yml) baut bei jedem Push auf `main` automatisch ein Image und pusht es nach GHCR.

Im Betrieb braucht der Bot ein Volume für `data/` (sonst gehen Zähler, offene Tickets, Killswitch und Policy-Profil bei jedem Neustart
verloren), das Docker-Netzwerk der Minecraft-Server für RCON und die Server-Logs als Read-only-Mounts:

```yaml
services:
  pactmc-bot:
    image: ghcr.io/grafkoxlp/pactmc-bot:latest
    env_file: .env
    restart: unless-stopped
    volumes:
      - ./data:/usr/src/app/data
      - /pfad/zu/velocity/logs:/data/logs/velocity/logs:ro
      - /pfad/zu/leaf/logs:/data/logs/leaf/logs:ro
    networks:
      - minecraft

networks:
  minecraft:
    external: true
```

Der Bot braucht auf dem Server die Rechte Kanäle verwalten, Rollen verwalten, Kanäle ansehen, Nachrichten senden, Links einbetten,
Dateien anhängen und Nachrichtenverlauf lesen. Aktiviert sein müssen die privilegierten Intents Server Members und Message Content, Presence braucht der Bot nicht.

Nach dem ersten Start oder einem Update prüft `/systemtest`, ob alles erreichbar ist: Bot-Rechte, Rollen, Kategorien (inklusive Auslastung,
Discord erlaubt 50 Channels pro Kategorie), Audit-Channel, Panels, Schreibzugriff auf `data/`, Open WebUI mit allen Modellen, das lokale Gate,
RCON zu beiden Servern und die Log-Ordner. Mit `modelle: false` werden keine Testanfragen an die Modelle geschickt.

## Environment-Variablen

Alles außer den ersten beiden Zeilen ist optional, Defaults stehen in [src/config.js](src/config.js).

Schalter verstehen `true`/`1`/`yes`/`on` und `false`/`0`/`no`/`off`. Ungültige Werte werden mit Warnung durch den Default ersetzt,
bei `MC_DRY_RUN` bleibt der Trockenlauf dann an.

| Variable | Beschreibung |
|---|---|
| `DISCORD_BOT_TOKEN` | Bot-Token aus dem Discord Developer Portal (Pflicht) |
| `DISCORD_APPLICATION_ID` | Application-ID des Bots (Pflicht) |
| `DEV_GUILD_ID` | Falls gesetzt UND in [src/handlers/loadCommands.js](src/handlers/loadCommands.js) der entsprechende Routes-Aufruf einkommentiert wird, registrieren sich die Slash-Commands sofort auf diesem Test-Server statt global |
| `TICKET_DATA_FILE` | Pfad der Ticket-Daten (Default `./data/tickets.json`) |
| `TICKET_MAX_OPEN_PER_USER` | Offene Tickets pro User (Default `3`) |
| `OPENWEBUI_BASE_URL`, `OPENWEBUI_API_KEY` | Open WebUI inkl. `/api` und API-Key. Ohne beides bleibt der Assistent aus |
| `GATE_MODEL`, `ANSWER_MODEL` | Open-WebUI-Modelle (Default `pact-gate`, `pact-answer`) |
| `OPENWEBUI_TIMEOUT_MS` | Timeout für Open-WebUI-Aufrufe (Default `30000`) |
| `TICKET_ASSISTANT_ENABLED`, `TICKET_ASSISTANT_VERBOSE` | `false` schaltet den Assistenten ab, `true` loggt zusätzlich Nachrichten und Antworttexte |
| `DEBOUNCE_SECONDS`, `MAX_AUTO_REPLIES` | Debounce-Fenster (Default `4`) und Antwort-Limit im Normalmodus (Default `5`) |
| `GATE_MODE`, `OLLAMA_BASE_URL`, `ROUTER_MODEL` | Gate-Modus, Ollama-URL und Modell (Default `openwebui`, leer, `nimble:latest`) |
| `ROUTER_TIMEOUT_MS`, `ROUTER_CONTEXT_MESSAGES`, `ROUTER_FALLBACK`, `ROUTER_LOG_FILE` | Timeout (`5000`), Anzahl Nachrichten für das Gate (`3`), Fallback (`escalate` oder `openwebui`) und Logdatei (leer schaltet das Log ab) |
| `VELOCITY_RCON_HOST`, `VELOCITY_RCON_PORT`, `VELOCITY_RCON_PASSWORD` | RCON des Velocity-Proxys (Port Default `25575`) |
| `LEAF_RCON_HOST`, `LEAF_RCON_PORT`, `LEAF_RCON_PASSWORD` | RCON des Leaf-Servers |
| `SUPERVISOR_MODEL` | Modell des Supervisors (Default `pact-terminal-supervisor`) |
| `ACTION_MAX_CYCLES`, `MC_RATE_LIMIT_PER_USER`, `RCON_TIMEOUT_MS` | Aktionsschritte pro Nachricht (`3`), Befehle pro Minute (`5`), RCON-Timeout (`5000`) |
| `MC_DRY_RUN`, `MC_PROTECTED_PLAYERS` | Trockenlauf ohne Senden, kommagetrennte Spielernamen, die nicht gebannt, gekickt oder getötet werden dürfen |
| `SERVER_LOGS_ENABLED`, `VELOCITY_LOGS_PATH`, `LEAF_LOGS_PATH` | Log-Zugriff und Pfade (Default `/data/logs/velocity/logs`, `/data/logs/leaf/logs`) |
| `MENTION_CONTEXT_MESSAGES`, `MENTION_CONTEXT_HOURS` | Kontext bei `@Bot` (`15` Nachrichten, `48` Stunden) |
| `TICKET_CATEGORY_IDS`, `SUPPORT_ROLE_IDS` | Komma-separierte ID-Overrides, nur fürs lokale Testen |

Token und Application-ID findest du im [Discord Developer Portal](https://discord.com/developers/applications) unter deiner Application: ID auf der Seite *General Information*, Token unter *Bot*, dann *Reset Token*.

## Projektstruktur

```
src/
├── index.js                 # Entry: Client, Login, Loader-Aufrufe, Error-Handler
├── config.js                # IDs, Rollen, Kategorien, Branding und Feature-Konfiguration
├── utils/                   # Embed-Helper, Rollen-Checks
├── commands/                # Slash-Commands ({ data, execute })
├── events/                  # Event-Handler ({ name, once?, execute })
├── features/
│   ├── ticketSystem/        # Panels, Öffnen, Schließen, /add, /remove, Console-Upgrade, JSON-Store
│   ├── ticketAssistant/     # Gate, Antwortmodell, Open-WebUI-Client, Modi, Eskalation
│   ├── mention/             # Antworten auf @Bot mit Kontext
│   ├── mcCommands/          # Policy, Supervisor, RCON, Bestätigung, Audit
│   ├── serverLogs/          # Log-Reader und Sanitizer
│   ├── verification/        # Ingame-Namen per Code bestätigen
│   └── systemTest/          # Prüfungen für /systemtest
└── handlers/                # Auto-Discovery für commands/* und events/*
docs/
└── open-webui-setup.md      # Modelle, Antwortformat und Prompts für Open WebUI
```

Neue Slash-Commands oder Events können einfach als Datei in `src/commands/` bzw. `src/events/` abgelegt werden und werden beim nächsten Bot-Start automatisch geladen.

## Lizenz

ISC
