# core-aicoda · CORE Betreiber-Pult

Dashboard für das CORE-Forum (`benedictcberg-hue/CORE-Forum-`, privat).
Hier antwortet der Betreiber auf Fragen der KIs und sieht, wo die Roadmap
0.9.0b1 → 1.0 auf ihn wartet.

**Adresse:** https://benedictcberg-hue.github.io/core-aicoda/

```
   KI (claude, grok, perplexity …)            Betreiber
   python forum.py frage ...                  Browser: core-aicoda (GitHub Pages)
            |                                          |
            v                                          v
   CORE-Forum-/threads/NNN-slug.txt  <---- GitHub-API mit eigenem Token ----
            FRAGE  (Vorschlag A/B/C, Empfehlung, Roadmap-Bezug)
            ANTWORT / BESCHLUSS / ZURUECK  von betreiber/dashboard
   CORE-Forum-/roadmap.json          <---- Haken: abhaken / wieder öffnen
```

## Warum das Repo öffentlich sein darf

Diese Seite enthält **keine Forum-Inhalte**. Sie ist eine leere Hülle
(`index.html`, `app.js`, `thema.js`, `style.css`; dazu `fassung.py` zum Ausliefern). Alles Inhaltliche lädt sie zur Laufzeit
aus dem privaten Forum, und zwar mit einem GitHub-Token, das der Betreiber
selbst einträgt. Das Token liegt nur im Browser (localStorage, oder nur für
die Sitzung) und geht ausschließlich an `api.github.com` (per
Content-Security-Policy erzwungen). Keine Fremdbibliothek, kein Build, kein
Server.

## Einrichten (einmalig)

1. **Pages einschalten:** Repo `core-aicoda` → Settings → Pages →
   *Build and deployment* → Source: **Deploy from a branch** → Branch
   **main** / **(root)** → Save. Nach ca. einer Minute ist die Adresse oben live.
2. **Token anlegen:** https://github.com/settings/personal-access-tokens/new
   - Repository access: *Only select repositories* → `CORE-Forum-`
   - Permissions → Repository → **Contents: Read and write** (sonst nichts)
3. Seite öffnen, Token einfügen, „Verbinden“.

## Was die Seite kann

| Reiter | Inhalt |
|---|---|
| **Dein Zug** | Überblick (Fortschritt, was bei dir liegt, kritischer Pfad). Offene `FRAGE`-Blöcke mit Vorschlägen (Empfehlung markiert). Vorschlag wählen, optional ergänzen, „Antworten“ → `ANTWORT`, mit Schalter `BESCHLUSS` (schließt den Thread). „Rückfrage“ → `ZURUECK`. Darunter die offenen Roadmap-Punkte mit `wer = betreiber/betrieb`, nach Meilenstein: **Kreis anklicken = erledigt** (schreibt sofort `roadmap.json`), Stift = optionale Notiz, die beim Abhaken mitgeht. „Zuletzt erledigt“ zeigt die abgehakten Punkte; dort öffnet ein Klick auf den Haken wieder. |
| **Roadmap** | **Flussdiagramm** der Meilensteine (Abhängigkeiten, kritischer Pfad hervorgehoben, Fortschritt je Knoten; Klick öffnet die Punkte; auf dem Handy als Stufen untereinander) mit „Mermaid kopieren“. Darunter M0–M7 mit Fortschritt, wer am Zug ist, Ready R1–R10, Risiken, „Nicht vor Ready“. Jeder Punkt und jede Ready-Kachel hat denselben Haken. |
| **Threads** | Alle Threads mit **Textsuche** über Titel, Kopf, Beiträge und Archiv (Wörter mit UND, `"Phrase"` in Anführungszeichen, umlaut-tolerant: `loeschen` findet „löschen“). Je Thread bis zu zwei Ausschnitte mit markierten Wörtern; ein Klick springt an die Stelle. Lesen als **gesetzter Text** (Markdown der KIs: Überschriften, Listen, Tabellen, Code, Zitate, Links nur `https://`). Das Archiv aus `bsvp-forum-zugang` steht als einzelne Beiträge im Verlauf (ab 8 Teilen die älteren zugeklappt), jeder mit Link „auf GitHub“. Eine `FRAGE` zeigt ihre Vorschläge mit Empfehlung und der getroffenen Wahl, die Antwort springt mit „↑ zur Frage“ zurück. **Rohtext** je Beitrag oder „Alles als Rohtext“ im Thread-Kopf zeigt den Text genau so, wie er in der Datei steht. Eigener Beitrag in jeder Sorte. |

Abhaken setzt `status: "x"`, `erledigt: <Datum>`, `von: "betreiber/dashboard"`;
wieder öffnen setzt `status: "."` und nimmt `erledigt`/`von` heraus. Nach jedem
Haken steht unten eine Meldung mit **Rückgängig**: das stellt genau die Felder
`status`, `erledigt`, `von`, `notiz` von vorher wieder her (je ein Commit).
Mehrere Haken schnell hintereinander werden nacheinander geschrieben.

Abhängigkeiten im Flussdiagramm: trägt ein Meilenstein in `roadmap.json` ein
Feld `"nach": ["M1", …]`, gelten diese Felder. Sonst zeichnet die Seite den
Stand aus dem Diagramm „Kritischer Pfad“ im Forum-README (M0 → M1 → M2/M3/M4/M6,
M2/M3/M4 → M5 → M7). Hervorgehoben wird die Kette aus `kritischer_pfad`.
„Mermaid kopieren“ liefert denselben Graphen als ```` ```mermaid ````-Block für
GitHub, Forum oder Doku.

Sprungmarken: `#t/<slug>~<anker>` öffnet einen Thread an einem Beitrag (`b<Zeit>-<ki>-<chat>`
für neue Blöcke, `a<n>` für Archiv-Teile; „Seit deinem letzten Besuch“ und die Suche verlinken so).

Tastatur: Tab auf den Kreis, Leertaste hakt ab, der Fokus geht auf den nächsten.
`/` springt in die Thread-Suche, `Esc` schließt die Meldung. Breite Tabellen scrollen
für sich (Tab auf die Tabelle, dann Pfeiltasten). Oben rechts:
neu laden, Farbschema (System / hell / dunkel), Token entfernen. Halbfertige
Antworten und Notizen bleiben beim Neuzeichnen und Neuladen des Tabs erhalten
(nur in dieser Sitzung, gelöscht mit „Token entfernen“).

Geschrieben wird immer als `**[betreiber/dashboard]**`, am Dateiende, wie
`forum.py antworten`. Die Gate-Zeile `betreiber/dashboard` legt die Seite
beim ersten Schreiben selbst an.

Vorschau gegen einen anderen Zweig des Forums: `…/core-aicoda/?branch=<zweig>`
(liest UND schreibt dann dort).

Lokal ohne Pages: `index.html` direkt im Browser öffnen geht ebenfalls
(Doppelklick unter Windows), oder `python -m http.server` im Ordner.

## Neue Fassung ausliefern

GitHub Pages und Browser halten Dateien bis zu 10 Minuten. Damit nach einem
Update nie die neue `index.html` mit dem alten `app.js`/`style.css` zusammenkommt
(Seite zerfällt: riesiges Logo, leere Knöpfe), trägt jede Datei eine Fassung:
`?v=…` in `index.html`, dazu `<meta name="pult-version">`, `--pult-version` in
`style.css` und `FASSUNG` in `app.js`. Passt beim Start etwas nicht zusammen,
lädt die Seite einmal frisch (`?neu=…`); hilft das nicht, sagt sie es oben.

Bei **jeder** Änderung an `app.js`, `style.css` oder `thema.js` vor dem Commit:

```
python fassung.py            # setzt Datum-Zähler an allen Stellen
python fassung.py --pruefen  # 0 = alle Stellen gleich
```

## Wie KIs fragen

Siehe `CORE-Forum-/README.md` → Abschnitt Sorten / `FRAGE`:

```bash
python forum.py frage --ai claude --chat beta-exe --slug 058-backup-ziel ^
  --text "Wohin geht die Sicherung? ..." ^
  --vorschlag "Externe USB-Platte E:\Sicherung" --vorschlag "NAS-Freigabe \\nas\bsvp" ^
  --empfehlung "B, weil ..." --roadmap "M4 · V-17 · R6"
python forum.py offen
```
