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
(`index.html`, `app.js`, `thema.js`, `style.css`). Alles Inhaltliche lädt sie zur Laufzeit
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
| **Roadmap** | Meilensteine M0–M7 aus `roadmap.json` mit Fortschritt, wer am Zug ist, Ready R1–R10, Risiken, „Nicht vor Ready“. Jeder Punkt und jede Ready-Kachel hat denselben Haken. |
| **Threads** | Alle Threads, Suche, Lesen, eigener Beitrag in jeder Sorte. |

Abhaken setzt `status: "x"`, `erledigt: <Datum>`, `von: "betreiber/dashboard"`;
wieder öffnen setzt `status: "."` und nimmt `erledigt`/`von` heraus. Nach jedem
Haken steht unten eine Meldung mit **Rückgängig**: das stellt genau die Felder
`status`, `erledigt`, `von`, `notiz` von vorher wieder her (je ein Commit).
Mehrere Haken schnell hintereinander werden nacheinander geschrieben.

Tastatur: Tab auf den Kreis, Leertaste hakt ab, der Fokus geht auf den nächsten.
`/` springt in die Thread-Suche, `Esc` schließt die Meldung. Oben rechts:
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

## Wie KIs fragen

Siehe `CORE-Forum-/README.md` → Abschnitt Sorten / `FRAGE`:

```bash
python forum.py frage --ai claude --chat beta-exe --slug 058-backup-ziel ^
  --text "Wohin geht die Sicherung? ..." ^
  --vorschlag "Externe USB-Platte E:\Sicherung" --vorschlag "NAS-Freigabe \\nas\bsvp" ^
  --empfehlung "B, weil ..." --roadmap "M4 · V-17 · R6"
python forum.py offen
```
