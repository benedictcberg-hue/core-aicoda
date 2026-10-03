"""Fassung des Betreiber-Pults hochzählen oder prüfen.

    python fassung.py            neue Fassung (Datum-Zähler) in alle Dateien schreiben
    python fassung.py --pruefen  nur prüfen, ob alle Stellen dieselbe Fassung tragen

Warum: GitHub Pages und Browser halten Dateien bis zu 10 Minuten. Ohne eigene
Fassung an jeder Datei (?v=…) kam nach einem Update die neue index.html mit dem
alten app.js/style.css zusammen und die Seite zerfiel. Jede Änderung an app.js,
style.css oder thema.js braucht deshalb eine neue Fassung.
"""
import datetime
import pathlib
import re
import sys

WURZEL = pathlib.Path(__file__).resolve().parent
STELLEN = {
    "index.html": [
        re.compile(r'(<meta name="pult-version" content=")([^"]+)(")'),
        re.compile(r'((?:style\.css|thema\.js|app\.js)\?v=)([^"]+)(")'),
    ],
    "style.css": [re.compile(r'(--pult-version: ")([^"]+)(")')],
    "app.js": [re.compile(r'(const FASSUNG = ")([^"]+)(")')],
}


def lesen(name):
    # newline="" liest die Zeilenenden so, wie sie in der Datei stehen (auch CRLF unter Windows).
    with open(WURZEL / name, encoding="utf-8", newline="") as f:
        return f.read()


def gefundene_fassungen():
    funde = []
    for name, muster in STELLEN.items():
        text = lesen(name)
        for m in muster:
            treffer = [t.group(2) for t in m.finditer(text)]
            if not treffer:
                raise SystemExit(f"{name}: Stelle {m.pattern!r} fehlt")
            funde += [(name, t) for t in treffer]
    return funde


def main():
    funde = gefundene_fassungen()
    werte = sorted({w for _, w in funde})
    if "--pruefen" in sys.argv:
        if len(werte) == 1:
            print(f"Fassung {werte[0]} an allen {len(funde)} Stellen.")
            return 0
        for name, wert in funde:
            print(f"  {name}: {wert}")
        print("Fassungen weichen ab. python fassung.py setzt alle neu.")
        return 1

    heute = datetime.date.today().strftime("%Y.%m.%d")
    zaehler = 1
    for wert in werte:
        tag, _, nummer = wert.partition("-")
        if tag == heute and nummer.isdigit():
            zaehler = max(zaehler, int(nummer) + 1)
    neu = f"{heute}-{zaehler}"
    for name, muster in STELLEN.items():
        text = lesen(name)
        for m in muster:
            text = m.sub(lambda t: t.group(1) + neu + t.group(3), text)
        with open(WURZEL / name, "w", encoding="utf-8", newline="") as f:
            f.write(text)
    print(f"Neue Fassung {neu} ({len(funde)} Stellen).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
