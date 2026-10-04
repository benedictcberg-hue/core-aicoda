/* CORE Betreiber-Pult — liest und schreibt das private Repo CORE-Forum- direkt
 * über die GitHub-API. Kein Server, kein Build, keine Fremdbibliothek.
 * Das Token bleibt im Browser (localStorage oder sessionStorage).
 * Format der Threads: siehe CORE-Forum-/README.md.
 */
"use strict";

const OWNER = "benedictcberg-hue";
const REPO = "CORE-Forum-";
const API = `https://api.github.com/repos/${OWNER}/${REPO}`;
const ICH = { ki: "betreiber", chat: "dashboard" };
const SORTEN = ["BEFUND", "ANTRAG", "EINWAND", "ZUSTIMMUNG", "ZURUECK", "BESCHLUSS", "FRAGE", "ANTWORT", "REVIEW"];
const REVIEW_ANTWORT = ["BEFUND", "EINWAND", "ZUSTIMMUNG", "ZURUECK"];
const NICHT_THREADS = ["LESE-MICH.txt", "werkstatt.txt", "INDEX.txt"];
const KOPF = /^\*\*\[([a-z0-9_-]+)\/([a-z0-9_-]+)\]\*\* (\S+)$/;
const TOKEN_SCHLUESSEL = "core-pult-token";
const THEMA_SCHLUESSEL = "core-pult-thema";
const ENTWURF_SCHLUESSEL = "core-pult-entwuerfe";
const LESEMODUS_SCHLUESSEL = "core-pult-lesemodus";
const ZWEIG = new URLSearchParams(location.search).get("branch") || "main";
const SEITENTITEL = document.title;

const zustand = {
  token: "",
  threads: [],          // {slug, pfad, sha, text, kopf, titel, bloecke, vorgeschichte, offen, geschlossen}
  roadmap: null,        // geparstes roadmap.json
  roadmapSha: null,
  geladen: null,        // Zeitpunkt des letzten vollständigen Ladens
  gateOk: false,        // Gate-Zeile in dieser Sitzung schon geprüft
  laufend: new Map(),   // Punkt-ID -> Zielstatus, solange der Haken geschrieben wird
  offen: new Map(),     // auf-/zugeklappte Bereiche, überlebt das Neuzeichnen
  fokusNach: null,      // data-fokus-Schlüssel für den Fokus, wenn das fokussierte Element verschwindet
  schreibt: new Set(),  // Thread-Pfade, an die gerade angehängt wird (Knöpfe bleiben gesperrt, auch nach Neuzeichnen)
  kopf: null,           // Commit, auf dem der angezeigte Stand beruht
  kopfEtag: null,       // ETag dazu: der Puls fragt mit If-None-Match (304 kostet kein Kontingent)
  neu: null,            // was seit dem letzten Besuch passiert ist (neuesErmitteln)
  rest: null,           // X-RateLimit-Remaining der letzten Antwort
  wartet: new Map(),    // Thread-Pfad → Anhang in der Atempause {bis, sorte, nummer, quelle, arbeit …}
  zuendung: null,       // {ms, bis}: Meilenstein, der gerade durch einen Haken fertig wurde
  probe: null,          // Set gedachter Haken, solange die Probe läuft (sonst null); wird nie gespeichert
};

/* Während laden() läuft: was seit Ladebeginn geschrieben wurde. Das ist neuer als der Baum,
 * den laden() am Anfang gelesen hat, und darf am Ende nicht überschrieben werden. */
let ladeLauf = null;

/* Ein Fehler, den der Betreiber so lesen soll, wie er ist (ohne „Nicht geschrieben: …“). */
class Hinweis extends Error {}
/* Abgemeldet, während ein Schreibvorgang lief: still beenden. */
class Abgebrochen extends Error {}

/* ---------- kleine Helfer ---------- */

const $ = (id) => document.getElementById(id);

function el(tag, attrs, ...kinder) {
  const knoten = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === "class") knoten.className = v;
    else if (k === "text") knoten.textContent = v;
    else if (k.startsWith("on")) knoten.addEventListener(k.slice(2), v);
    else knoten.setAttribute(k, v === true ? "" : v);
  }
  for (const kind of kinder.flat()) {
    if (kind === undefined || kind === null || kind === false) continue;
    knoten.append(kind instanceof Node ? kind : document.createTextNode(String(kind)));
  }
  return knoten;
}

const SVG_NS = "http://www.w3.org/2000/svg";
function svgEl(tag, attrs) {
  const knoten = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs || {})) if (v !== null && v !== undefined) knoten.setAttribute(k, String(v));
  return knoten;
}

/* Strich-Icons im 24er-Raster. Ein Eintrag ist ein Pfad oder {kreis}/{rechteck}, „voll“ = gefüllt. */
const ICONS = {
  haken: ["M20 6 9 17l-5-5"],
  x: ["M18 6 6 18", "M6 6l12 12"],
  neu: ["M21 12a9 9 0 1 1-2.64-6.36L21 8", "M21 3v5h-5"],
  sonne: [{ kreis: [12, 12, 4] }, "M12 2v2", "M12 20v2", "m4.93 4.93 1.41 1.41", "m17.66 17.66 1.41 1.41", "M2 12h2", "M20 12h2", "m6.34 17.66-1.41 1.41", "m19.07 4.93-1.41 1.41"],
  mond: ["M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9z"],
  auto: [{ kreis: [12, 12, 9] }, { pfad: "M12 3a9 9 0 0 1 0 18z", voll: true }],
  abmelden: ["M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4", "m16 17 5-5-5-5", "M21 12H9"],
  zug: ["M22 12h-6l-2 3h-4l-2-3H2", "M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"],
  roadmap: ["M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z", "M4 22v-7"],
  threads: ["M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"],
  suche: [{ kreis: [11, 11, 7] }, "m21 21-4.3-4.3"],
  pfeil: ["M5 12h14", "m13 6 6 6-6 6"],
  zurueck: ["M19 12H5", "m11 18-6-6 6-6"],
  senden: ["m22 2-11 11", "M22 2 15 22l-4-9-9-4z"],
  undo: ["M9 14 4 9l5-5", "M4 9h11a5 5 0 0 1 0 10h-3"],
  rueckfrage: [{ kreis: [12, 12, 9] }, "M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3", "M12 17h.01"],
  notiz: ["M12 20h9", "M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"],
  warnung: ["M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z", "M12 9v4", "M12 17h.01"],
  uhr: [{ kreis: [12, 12, 9] }, "M12 7v5l3 2"],
  code: ["m16 18 6-6-6-6", "m8 6-6 6 6 6"],
  entscheidung: ["M12 3v3", "M12 13v8", "M5 6h12l3 3.5-3 3.5H5z"],
  handlauf: ["M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"],
  stern: [{ pfad: "M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01z", voll: true }],
  runter: ["m6 9 6 6 6-6"],
  schloss: [{ rechteck: [3, 11, 18, 11, 2] }, "M7 11V7a5 5 0 0 1 10 0v4"],
  info: [{ kreis: [12, 12, 9] }, "M12 16v-4", "M12 8h.01"],
  ready: ["m3 7 2 2 4-4", "m3 17 2 2 4-4", "M13 7h8", "M13 12h8", "M13 17h8"],
  pause: [{ kreis: [12, 12, 9] }, "M10 15V9", "M14 15V9"],
  ok: [{ kreis: [12, 12, 9] }, "m8 12 3 3 5-6"],
  fluss: [{ rechteck: [2, 4, 7, 6, 1.5] }, { rechteck: [15, 4, 7, 6, 1.5] }, { rechteck: [15, 14, 7, 6, 1.5] }, "M9 7h6", "M12 7v10h3"],
  kopieren: [{ rechteck: [9, 9, 12, 12, 2] }, "M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"],
  funke: ["M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z", "M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"],
  plus: ["M12 5v14", "M5 12h14"],
  minus: ["M5 12h14"],
  person: [{ kreis: [12, 8, 4] }, "M4 21a8 8 0 0 1 16 0"],
  hebel: ["M13 2 3 14h9l-1 8 10-12h-9l1-8z"],
  schild: ["M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z", "M12 8v4", "M12 16h.01"],
};

function icon(name, klasse) {
  const svg = svgEl("svg", { viewBox: "0 0 24 24", class: "ic" + (klasse ? " " + klasse : ""), "aria-hidden": "true", focusable: "false" });
  for (const teil of Object.prototype.hasOwnProperty.call(ICONS, name) ? ICONS[name] : []) {
    let k;
    if (typeof teil === "string") k = svgEl("path", { d: teil });
    else if (teil.pfad) k = svgEl("path", { d: teil.pfad });
    else if (teil.kreis) k = svgEl("circle", { cx: teil.kreis[0], cy: teil.kreis[1], r: teil.kreis[2] });
    else if (teil.rechteck) {
      const [x, y, w, h, rx] = teil.rechteck;
      k = svgEl("rect", { x, y, width: w, height: h, rx });
    }
    if (teil.voll) k.setAttribute("class", "voll");
    svg.append(k);
  }
  return svg;
}

function speicherLesen(schluessel) {
  for (const s of [() => localStorage, () => sessionStorage]) {
    try { const w = s().getItem(schluessel); if (w) return w; } catch (_) { /* gesperrt */ }
  }
  return "";
}
function speicherSchreiben(schluessel, wert, dauerhaft) {
  try { (dauerhaft ? localStorage : sessionStorage).setItem(schluessel, wert); } catch (_) { /* gesperrt */ }
}
function speicherLoeschen(schluessel) {
  try { localStorage.removeItem(schluessel); } catch (_) { /* gesperrt */ }
  try { sessionStorage.removeItem(schluessel); } catch (_) { /* gesperrt */ }
}

/* Entwürfe (Antworttext, Wahl, Notiz) überleben das Neuzeichnen und ein Neuladen des Tabs. */
const entwuerfe = (() => {
  try { return JSON.parse(sessionStorage.getItem(ENTWURF_SCHLUESSEL) || "{}") || {}; } catch (_) { return {}; }
})();
function entwurf(schluessel) {
  return Object.prototype.hasOwnProperty.call(entwuerfe, schluessel) ? entwuerfe[schluessel] : "";
}
function entwuerfeSichern() {
  const text = JSON.stringify(entwuerfe);
  try { sessionStorage.setItem(ENTWURF_SCHLUESSEL, text); return; } catch (_) { /* voll oder gesperrt */ }
  // Voll: der Blob-Zwischenspeicher lässt sich neu laden, ein Entwurf nicht.
  try {
    for (const k of Object.keys(sessionStorage)) if (k.startsWith("blob:")) sessionStorage.removeItem(k);
    sessionStorage.setItem(ENTWURF_SCHLUESSEL, text);
  } catch (_) { /* gesperrt */ }
}
function entwurfSetzen(schluessel, wert) {
  if (wert === "" || wert === null || wert === undefined) delete entwuerfe[schluessel];
  else entwuerfe[schluessel] = wert;
  entwuerfeSichern();
}
function entwuerfeLoeschen(praefix) {
  for (const k of Object.keys(entwuerfe)) if (k.startsWith(praefix)) delete entwuerfe[k];
  entwuerfeSichern();
}

function b64ZuText(b64) {
  const bin = atob(b64.replace(/\s/g, ""));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder("utf-8").decode(bytes);
}
function textZuB64(text) {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

const zwei = (n) => String(n).padStart(2, "0");
function jetzt() {
  return new Date().toISOString().slice(0, 16) + "Z";
}
/* Kalendertag hier am Platz, nicht in UTC: ein Haken um 0:30 Uhr gehört zum neuen Tag. */
function heute() {
  const d = new Date();
  return `${d.getFullYear()}-${zwei(d.getMonth() + 1)}-${zwei(d.getDate())}`;
}
function zeitLesbar(iso) {
  // Blöcke tragen Minuten (…T01:45Z), das Archiv Sekunden (…T16:35:03Z)
  const s = String(iso || "");
  const d = new Date(/T\d{2}:\d{2}Z$/.test(s) ? s.replace(/Z$/, ":00Z") : s);
  if (isNaN(d)) return s;
  return d.toLocaleString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}
function datumLesbar(tag) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(tag || "");
  return m ? `${m[3]}.${m[2]}.${m[1]}` : tag || "";
}
function anzahl(n, eins, viele) {
  return `${n} ${n === 1 ? eins : viele}`;
}
function bewegungAus() {
  return window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/* ---------- Meldung (unten, mit optionaler Aktion wie „Rückgängig“) ---------- */

let meldungTimer = null;
let meldungSeit = 0;          // letzter Inhaltswechsel: ein Klick kurz danach galt der vorigen Meldung
let meldungFokus = null;      // data-fokus-Schlüssel, der den Fokus bekommt, wenn die Meldung ihn hatte
function meldungZu() {
  clearTimeout(meldungTimer);
  const m = $("meldung");
  const hatteFokus = m.contains(document.activeElement);
  m.hidden = true;
  if (hatteFokus) {
    const ziel = sichtbarFinden(meldungFokus) || $("inhalt");
    ziel.focus({ preventScroll: true });
  }
}
function meldungSpaeterZu(ms) {
  clearTimeout(meldungTimer);
  const m = $("meldung");
  // Liegt Maus oder Fokus auf der Meldung, wartet sie; mouseleave/focusout starten neu.
  if (m.matches(":hover") || m.contains(document.activeElement)) return;
  meldungTimer = setTimeout(meldungZu, ms);
}
function melden(text, optionen) {
  const o = optionen && typeof optionen === "object" ? optionen : { fehler: !!optionen };
  const m = $("meldung");
  const kinder = [
    icon(o.fehler ? "warnung" : "ok", "meldung-ic"),
    el("span", { class: "meldung-text", text }),
  ];
  if (o.aktion) {
    kinder.push(el("button", {
      type: "button", class: "meldung-aktion", "aria-label": o.aktion.label || o.aktion.text,
      onclick: () => {
        if (Date.now() - meldungSeit < 600) return;
        meldungZu();
        o.aktion.tun();
      },
    }, icon(o.aktion.icon || "undo"), o.aktion.text));
  }
  kinder.push(el("button", { type: "button", class: "meldung-zu", "aria-label": "Meldung schließen", title: "Schließen", onclick: meldungZu }, icon("x")));
  m.replaceChildren(...kinder);
  // Auch eine frisch auftauchende Meldung: sie erscheint dort, wo gerade geklickt wird.
  meldungSeit = Date.now();
  meldungFokus = o.fokus || null;
  m.className = "meldung" + (o.fehler ? " fehler" : "");
  m.hidden = false;
  m.dataset.dauer = String(o.fehler ? 9000 : o.aktion ? 10000 : 4000);
  meldungSpaeterZu(Number(m.dataset.dauer));
}

/* ---------- GitHub ---------- */

class GitHubFehler extends Error {
  constructor(status, text) { super(`${status}: ${text}`); this.status = status; }
}

function restMerken(antwort) {
  const rest = antwort.headers.get("X-RateLimit-Remaining");
  if (rest === null || rest === "") return;
  zustand.rest = Number(rest);
  const ziel = $("fuss-rest");
  if (ziel) ziel.textContent = `API-Kontingent ${zustand.rest}`;
}

const zweigUrl = () => ZWEIG.split("/").map(encodeURIComponent).join("/");

/* Aktueller Commit des Zweigs. Mit ETag fragt der Puls: 304 = nichts Neues und zählt nicht
 * gegen das Kontingent. Liefert null bei 304. */
async function kopfLesen(etag) {
  const antwort = await fetch(`${API}/git/ref/heads/${zweigUrl()}`, {
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${zustand.token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(etag ? { "If-None-Match": etag } : {}),
    },
  });
  restMerken(antwort);
  if (antwort.status === 304) return null;
  if (!antwort.ok) {
    let text = antwort.statusText;
    try { text = (await antwort.json()).message || text; } catch (_) { /* kein JSON */ }
    throw new GitHubFehler(antwort.status, text);
  }
  const d = await antwort.json();
  return { sha: d.object.sha, etag: antwort.headers.get("ETag") };
}

async function gh(pfad, optionen = {}) {
  const antwort = await fetch(API + pfad, {
    ...optionen,
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${zustand.token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(optionen.body ? { "Content-Type": "application/json" } : {}),
    },
  });
  restMerken(antwort);
  if (!antwort.ok) {
    let text = antwort.statusText;
    try { text = (await antwort.json()).message || text; } catch (_) { /* kein JSON */ }
    throw new GitHubFehler(antwort.status, text);
  }
  return antwort.status === 204 ? null : antwort.json();
}

/* Je Segment kodieren: encodeURI ließe ? und # stehen, und ein solcher Dateiname leitete
 * Lesen und Schreiben in eine andere Datei um. */
const pfadUrl = (pfad) => pfad.split("/").map(encodeURIComponent).join("/");

async function dateiLesen(pfad, ref = ZWEIG) {
  const d = await gh(`/contents/${pfadUrl(pfad)}?ref=${encodeURIComponent(ref)}`);
  return { text: b64ZuText(d.content), sha: d.sha };
}

async function dateiSchreiben(pfad, text, sha, meldung) {
  const koerper = { message: meldung, content: textZuB64(text), branch: ZWEIG };
  if (sha) koerper.sha = sha;
  const r = await gh(`/contents/${pfadUrl(pfad)}`, { method: "PUT", body: JSON.stringify(koerper) });
  // Eigener Commit ist der neue Kopf: der Puls soll ihn nicht als „neu im Forum“ melden.
  if (r.commit && r.commit.sha) { zustand.kopf = r.commit.sha; zustand.kopfEtag = null; }
  return r.content.sha;
}

const istKonflikt = (e) => e instanceof GitHubFehler && (e.status === 409 || e.status === 422);

/* Steht genau dieser Beitrag schon als letzter Block da (eigener Block, gleiche Sorte, gleicher
 * Text, jünger als 15 Minuten)? Dann kam ein früherer Versuch an, nur die Antwort ging verloren. */
function schonAngehaengt(text, sorte, inhalt) {
  const l = threadParsen("pruefung", text).letzter;
  if (!l || l.ki !== ICH.ki || l.chat !== ICH.chat || l.sorte !== sorte || l.text !== inhalt.trim()) return false;
  const zeit = new Date(l.zeit.replace(/Z$/, ":00Z"));
  return !isNaN(zeit) && Date.now() - zeit.getTime() < 15 * 60 * 1000;
}

/* Liest frisch, hängt an, schreibt. Bei Konflikt (jemand schrieb dazwischen) einmal neu. */
async function anhaengen(pfad, sorte, inhalt, meldung, pruefen) {
  const block = blockText(sorte, inhalt);
  for (let versuch = 0; versuch < 3; versuch++) {
    const { text, sha } = await dateiLesen(pfad);
    if (schonAngehaengt(text, sorte, inhalt)) return { text, sha, schonDa: true };
    if (pruefen) pruefen(text);
    const neu = (text.endsWith("\n") ? text : text + "\n") + block;
    try {
      const neuSha = await dateiSchreiben(pfad, neu, sha, meldung);
      return { text: neu, sha: neuSha };
    } catch (e) {
      if (!istKonflikt(e) || versuch === 2) throw e;
    }
  }
  throw new Error("nicht geschrieben");
}

async function gateSicherstellen() {
  if (zustand.gateOk) return;
  const pfad = "gate/anmeldungen.txt";
  const zeile = `\t${ICH.ki}\t${ICH.chat}`;
  const { text, sha } = await dateiLesen(pfad);
  if (!text.split("\n").some((z) => z.endsWith(zeile))) {
    const neu = (text.endsWith("\n") ? text : text + "\n") + `${jetzt()}${zeile}\n`;
    await dateiSchreiben(pfad, neu, sha, `Gate: ${ICH.ki}/${ICH.chat}`);
  }
  zustand.gateOk = true;
}

/* ---------- Format ---------- */

function threadParsen(slug, text) {
  const zeilen = text.split("\n");
  const kopf = {};
  let i = 0;
  for (; i < zeilen.length && zeilen[i].trim() !== ""; i++) {
    const m = /^([A-Za-zÄÖÜäöü]+): ?(.*)$/.exec(zeilen[i]);
    if (!m) break;
    kopf[m[1]] = m[2];
  }
  const funde = [];
  for (let j = 0; j + 2 < zeilen.length; j++) {
    if (zeilen[j] !== "---") continue;
    const k = KOPF.exec(zeilen[j + 1]);
    if (k && SORTEN.includes(zeilen[j + 2])) funde.push({ j, k, sorte: zeilen[j + 2] });
  }
  const bloecke = funde.map((f, n) => {
    const ende = n + 1 < funde.length ? funde[n + 1].j : zeilen.length;
    return {
      ki: f.k[1], chat: f.k[2], zeit: f.k[3], sorte: f.sorte,
      text: zeilen.slice(f.j + 3, ende).join("\n").trim(),
    };
  });
  const startVorgeschichte = i;
  const endeVorgeschichte = funde.length ? funde[0].j : zeilen.length;
  const vorgeschichte = zeilen.slice(startVorgeschichte, endeVorgeschichte).join("\n").trim();

  let offen = [];
  for (const b of bloecke) {
    if (b.sorte === "FRAGE") offen.push(b);
    else if (b.ki === ICH.ki) offen = [];
  }
  const letzter = bloecke[bloecke.length - 1];
  const geschlossen = /^closed$/i.test(kopf.Status || "") || (letzter && letzter.sorte === "BESCHLUSS");
  const nummer = (/^(\d+)-/.exec(slug) || [])[1] || "";
  const titel = (kopf.Titel || kopf.Frage || slug).replace(/^\[[^\]]+\]\s*/, "");
  const art = (/^\[([^\]]+)\]/.exec(kopf.Titel || "") || [])[1] || "";
  return { slug, nummer, kopf, titel, art, bloecke, vorgeschichte, offen, geschlossen, letzter };
}

/* KIs, auf die ein Pflicht-Review („Pflicht: ja“, read before proceed) im Thread noch wartet. Wie forum.py:
   getaggt wird nur in der Zeile „An:“, geantwortet ist mit BEFUND/EINWAND/ZUSTIMMUNG/ZURUECK
   danach (gleich aus welchem Chat), ein BESCHLUSS des Betreibers danach schließt. */
function pflichtOffen(t) {
  const fehlt = new Set();
  t.bloecke.forEach((b, i) => {
    if (b.sorte !== "REVIEW" || !/^Pflicht: ja$/m.test(b.text)) return;
    const danach = t.bloecke.slice(i + 1);
    if (danach.some((x) => x.ki === "betreiber" && x.sorte === "BESCHLUSS")) return;
    const an = ((/^An:(.*)$/m.exec(b.text) || [])[1] || "").match(/@[a-z0-9][a-z0-9_-]{1,23}/g) || [];
    for (const k of an.map((x) => x.slice(1))) {
      if (!danach.some((x) => x.ki === k && REVIEW_ANTWORT.includes(x.sorte))) fehlt.add(k);
    }
  });
  return [...fehlt];
}

function pflichtText(fehlt) {
  return `Review-Pflicht offen: wartet auf ${fehlt.map((k) => "@" + k).join(" ")}.`;
}

function frageParsen(block) {
  const vorschlaege = [];
  let empfehlung = "";
  const roadmap = [];
  const rest = [];
  for (const zeile of block.text.split("\n")) {
    let m;
    if ((m = /^Vorschlag ([A-Z]): (.+)$/.exec(zeile))) vorschlaege.push({ buchstabe: m[1], text: m[2] });
    else if ((m = /^Empfehlung: (.+)$/.exec(zeile))) empfehlung = m[1];
    // linear teilen: \s*[·,]\s* lief auf langen Leerzeichen-Zeilen quadratisch (Pult fror ein)
    else if ((m = /^Roadmap: (.+)$/.exec(zeile))) roadmap.push(...m[1].split(/[·,]/).map((x) => x.trim()).filter(Boolean));
    else rest.push(zeile);
  }
  const absaetze = rest.join("\n").trim().split(/\n\s*\n/);
  const frage = (absaetze.shift() || "").trim();
  const kontext = absaetze.join("\n\n").trim();
  const empfohlen = (/^([A-Z])\b/.exec(empfehlung) || [])[1] || "";
  return { frage, kontext, vorschlaege, empfehlung, empfohlen, roadmap };
}

function blockText(sorte, text) {
  return `\n---\n**[${ICH.ki}/${ICH.chat}]** ${jetzt()}\n${sorte}\n\n${text.trim()}\n`;
}

/* ---------- Laden ---------- */

async function alles(laden, parallel) {
  const ergebnis = new Array(laden.length);
  let naechster = 0;
  async function arbeiter() {
    while (naechster < laden.length) {
      const n = naechster++;
      ergebnis[n] = await laden[n]();
    }
  }
  await Promise.all(Array.from({ length: Math.min(parallel, laden.length) }, arbeiter));
  return ergebnis;
}

function blobCache(sha) {
  try { return sessionStorage.getItem("blob:" + sha); } catch (_) { return null; }
}
function blobMerken(sha, text) {
  try { sessionStorage.setItem("blob:" + sha, text); } catch (_) { /* voll oder gesperrt */ }
}

async function blobLesen(sha) {
  const gemerkt = blobCache(sha);
  if (gemerkt !== null) return gemerkt;
  const d = await gh(`/git/blobs/${sha}`);
  const text = b64ZuText(d.content);
  blobMerken(sha, text);
  return text;
}

function hatDaten() {
  return zustand.threads.length > 0 || !!zustand.roadmap;
}

// Ein Lauf zur Zeit: Puls, Fokus und Knopf riefen sonst parallel und überholten sich.
let ladeVersprechen = null;
function laden() {
  if (!ladeVersprechen) ladeVersprechen = ladenEcht().finally(() => { ladeVersprechen = null; });
  return ladeVersprechen;
}
async function ladenEcht() {
  // Ein Haken, der gerade geschrieben wird, soll nicht von einem älteren Stand überholt werden.
  await roadmapKette;
  const token = zustand.token;
  const lauf = { threads: new Map(), roadmap: false };
  ladeLauf = lauf;
  const erstesMal = !hatDaten();
  const knopf = $("neu-laden");
  if (erstesMal) zeigen("lade");
  else knopfWartet(knopf, true);
  try {
    $("lade-balken").style.width = "5%";
    $("lade-text").textContent = "Lade Verzeichnis …";
    const kopf = await kopfLesen();
    const baum = await gh(`/git/trees/${kopf.sha}?recursive=1`);
    const dateien = baum.tree.filter((e) => e.type === "blob");
    // dieselbe Regel wie forum.py (SLUG): nur a–z, 0–9 und Bindestrich
    const threadDateien = dateien.filter((e) => /^threads\/[a-z0-9]+(?:-[a-z0-9]+)*\.txt$/.test(e.path)
      && !NICHT_THREADS.includes(e.path.slice("threads/".length)));
    const roadmapDatei = dateien.find((e) => e.path === "roadmap.json");

    let fertig = 0;
    const gesamt = threadDateien.length + (roadmapDatei ? 1 : 0);
    const fortschritt = () => {
      fertig++;
      $("lade-balken").style.width = `${5 + Math.round((fertig / gesamt) * 95)}%`;
      $("lade-text").textContent = `Lade Threads … ${fertig}/${gesamt}`;
    };

    const auftraege = threadDateien.map((e) => async () => {
      const text = await blobLesen(e.sha);
      fortschritt();
      const slug = e.path.slice("threads/".length, -4);
      return { ...threadParsen(slug, text), pfad: e.path, sha: e.sha };
    });
    const threads = (await alles(auftraege, 8)).sort((a, b) => b.slug.localeCompare(a.slug));

    // Netz- oder HTTP-Fehler beim Blob gehen an starten() („Neu laden fehlgeschlagen“, alter Stand bleibt).
    let roadmap = null;
    let roadmapSha = null;
    let kaputt = null;
    if (roadmapDatei) {
      const roh = await blobLesen(roadmapDatei.sha);
      try { roadmap = JSON.parse(roh); roadmapSha = roadmapDatei.sha; } catch (e) { kaputt = e; }
      fortschritt();
    }
    // Was seit dem letzten Besuch passiert ist: darf das Laden nie scheitern lassen.
    let neu = null;
    try { neu = await neuesErmitteln(kopf.sha, threads, roadmap); } catch (e) { neu = null; }
    if (zustand.token !== token) return;
    zustand.kopf = kopf.sha;
    zustand.kopfEtag = kopf.etag;
    zustand.neu = neu;

    // Während des Ladens Geschriebenes ist neuer als der Baum vom Anfang.
    zustand.threads = threads.map((t) => lauf.threads.get(t.pfad) || t);
    for (const [pfad, t] of lauf.threads) if (!zustand.threads.some((x) => x.pfad === pfad)) zustand.threads.unshift(t);
    if (lauf.roadmap) {
      // zustand.roadmap ist schon der frische Stand aus dem Schreibvorgang
    } else if (kaputt) {
      melden(`roadmap.json ist kein gültiges JSON: ${kaputt.message}${zustand.roadmap ? " — angezeigt wird der letzte gute Stand." : ""}`, true);
    } else {
      zustand.roadmap = roadmap === null ? null : roadmapSauber(roadmap);
      zustand.roadmapSha = roadmapSha;
    }
    zustand.geladen = new Date();
  } finally {
    if (ladeLauf === lauf) ladeLauf = null;
    knopfWartet(knopf, false);
  }

  const pille = $("verbindung");
  pille.replaceChildren(el("span", { class: "pille-punkt", "aria-hidden": "true" }),
    el("span", { class: "pille-text", text: ZWEIG === "main" ? "verbunden" : `Zweig ${ZWEIG}` }));
  pille.className = "pille " + (ZWEIG === "main" ? "ok" : "zweig");
  pille.title = `${OWNER}/${REPO} @ ${ZWEIG}`;
  for (const id of ["verbindung", "neu-laden", "abmelden", "reiter", "fuss"]) $(id).hidden = false;
  $("neu-balken").hidden = true;
  const uhr = zustand.geladen.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
  $("fuss-quelle").textContent = `${REPO} @ ${ZWEIG}`;
  $("fuss-stand").textContent = `geladen ${uhr}`;
  $("neu-laden").title = `Neu laden (zuletzt ${uhr})`;
  allesZeichnen();
}

/* roadmap.json pflegen KIs von Hand. Für die Anzeige nur, was die erwartete Form hat: ein
 * falsch typisiertes Feld darf nicht das ganze Pult anhalten. Geschrieben wird immer aus der
 * frisch gelesenen Datei selbst (roadmapAendern), nie aus dieser Kopie. */
function roadmapSauber(rm) {
  const ist = (v) => !!v && typeof v === "object" && !Array.isArray(v);
  if (!ist(rm)) return null;
  const text = (v) => (typeof v === "string" ? v : v === undefined || v === null ? "" : String(v));
  const wahl = (v) => (v === undefined || v === null ? undefined : text(v));
  const liste = (v) => (Array.isArray(v) ? v : []);
  let ohneId = 0;
  const id = (v) => (v === undefined || v === null || v === "" ? `ohne-id-${++ohneId}` : text(v));
  const status = (v) => (v === "x" || v === "~" || v === "." ? v : ".");
  const punkt = (p) => ({
    id: id(p.id), titel: text(p.titel), status: status(p.status), wer: text(p.wer),
    notiz: wahl(p.notiz), frage: wahl(p.frage), thread: wahl(p.thread), erledigt: wahl(p.erledigt), von: wahl(p.von),
    ready: Array.isArray(p.ready) ? p.ready.map(text) : undefined,
  });
  return {
    stand: text(rm.stand), basis: text(rm.basis), quelle: text(rm.quelle), produkt: text(rm.produkt),
    ziel: text(rm.ziel), kritischer_pfad: text(rm.kritischer_pfad),
    legende: ist(rm.legende) && ist(rm.legende.wer) ? { wer: rm.legende.wer } : undefined,
    meilensteine: liste(rm.meilensteine).filter(ist).map((m) => ({
      id: id(m.id), titel: text(m.titel),
      nach: Array.isArray(m.nach) ? m.nach.map(text) : undefined,
      punkte: liste(m.punkte).filter(ist).map(punkt),
    })),
    ready: liste(rm.ready).filter(ist).map((r) => ({ id: id(r.id), titel: text(r.titel), status: status(r.status), fehlt: wahl(r.fehlt) })),
    risiken: liste(rm.risiken).map(text),
    nicht_vor_ready: liste(rm.nicht_vor_ready).map(text),
  };
}

function kopfSetzen() {
  if (zustand.roadmap) {
    $("kopf-unter").textContent = `Roadmap-Stand ${datumLesbar(zustand.roadmap.stand) || "?"} · ${zustand.roadmap.basis || ""}`;
  }
}

function threadErsetzen(pfad, text, sha) {
  const slug = pfad.slice("threads/".length, -4);
  const neu = { ...threadParsen(slug, text), pfad, sha };
  blobMerken(sha, text);
  if (ladeLauf) ladeLauf.threads.set(pfad, neu);
  const i = zustand.threads.findIndex((t) => t.pfad === pfad);
  if (i >= 0) zustand.threads[i] = neu; else zustand.threads.unshift(neu);
  allesZeichnen();
}

/* ---------- Ansichten ---------- */

function zeigen(name) {
  for (const id of ["anmeldung", "lade", "ansicht-zug", "ansicht-roadmap", "ansicht-threads", "ansicht-thread"]) {
    $(id).hidden = id !== name;
  }
}

/* Sprungmarke je Beitrag: #t/<slug>~<anker>. Slugs enthalten nie „~“. */
function blockAnker(t) {
  const aus = new Map();
  const gezaehlt = new Map();
  for (const b of t.bloecke) {
    const basis = `b${String(b.zeit).replace(/\D/g, "")}-${b.ki}-${b.chat}`;
    const n = (gezaehlt.get(basis) || 0) + 1;
    gezaehlt.set(basis, n);
    aus.set(b, n === 1 ? basis : `${basis}-${n}`);
  }
  return aus;
}
function ankerLink(t, b) {
  const a = b ? blockAnker(t).get(b) : null;
  return `#t/${encodeURIComponent(t.slug)}${a ? "~" + a : ""}`;
}
function ankerSpringen(anker) {
  const ziel = document.getElementById(`anker-${anker}`);
  if (!ziel) return false;
  for (let d = ziel.closest("details"); d; d = d.parentElement ? d.parentElement.closest("details") : null) d.open = true;
  ziel.scrollIntoView({ behavior: bewegungAus() ? "auto" : "smooth", block: "start" });
  ziel.focus({ preventScroll: true });
  ziel.classList.add("ist-ziel");
  setTimeout(() => ziel.classList.remove("ist-ziel"), 2000);
  return true;
}
// Nur einmal je Adresse springen: route() läuft auch bei jedem Neuzeichnen (Puls, Haken).
let angesprungen = null;

function route() {
  if (!zustand.token) { zeigen("anmeldung"); return; }
  if (!hatDaten()) return;
  const h = decodeURIComponent(location.hash.slice(1)) || "zug";
  let reiter = h;
  if (h.startsWith("t/")) {
    reiter = "threads";
    const [slug, anker] = h.slice(2).split("~");
    threadDetailZeichnen(slug);
    zeigen("ansicht-thread");
    if (anker && angesprungen !== location.hash && ankerSpringen(anker)) angesprungen = location.hash;
  } else if (["zug", "roadmap", "threads"].includes(h)) {
    zeigen("ansicht-" + h);
  } else {
    reiter = "zug";
    zeigen("ansicht-zug");
  }
  if (zustand.probe && reiter !== "roadmap") {
    zustand.probe = null;
    if (zustand.roadmap) roadmapZeichnen();
  }
  for (const a of document.querySelectorAll("#reiter a")) {
    const aktiv = a.dataset.reiter === reiter;
    a.classList.toggle("aktiv", aktiv);
    if (aktiv) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
  }
}

/* Zeichnet neu und gibt den Fokus dem gleichen Element zurück (Schlüssel data-fokus),
 * samt Cursorposition. Verschwindet es (abgehakter Punkt), bekommt ihn zustand.fokusNach. */
/* Sichtbar heißt auch: nicht in einem zugeklappten <details> (dort hat ein Element in
 * neueren Browsern noch Rechtecke, nimmt aber keinen Fokus an). */
function istSichtbar(e) {
  if (typeof e.checkVisibility === "function") return e.checkVisibility();
  return e.getClientRects().length > 0 && !e.closest("details:not([open]) > :not(summary)");
}
function sichtbarFinden(schluessel) {
  if (!schluessel) return null;
  for (const e of document.querySelectorAll(`[data-fokus="${CSS.escape(schluessel)}"]`)) {
    if (istSichtbar(e)) return e;
  }
  return null;
}
function mitFokus(zeichnen, gewuenscht) {
  const aktiv = document.activeElement;
  const schluessel = aktiv && aktiv.dataset ? aktiv.dataset.fokus : undefined;
  let auswahl = null;
  try {
    if (aktiv && typeof aktiv.selectionStart === "number") auswahl = [aktiv.selectionStart, aktiv.selectionEnd];
  } catch (_) { /* Feldart ohne Auswahl */ }
  // Höhe halten, solange neu gezeichnet wird: sonst springt die Seite beim Abhaken nach oben.
  const main = $("inhalt");
  main.style.minHeight = `${main.offsetHeight}px`;
  try { zeichnen(); } finally { main.style.minHeight = ""; }
  if (!gewuenscht && (!schluessel || (aktiv && aktiv.isConnected))) return;
  for (const kandidat of [gewuenscht, schluessel, zustand.fokusNach]) {
    const ziel = sichtbarFinden(kandidat);
    if (!ziel) continue;
    ziel.focus({ preventScroll: true });
    if (document.activeElement !== ziel) continue;
    if (kandidat === zustand.fokusNach) zustand.fokusNach = null;
    if (auswahl && kandidat === schluessel && typeof ziel.setSelectionRange === "function") {
      try { ziel.setSelectionRange(auswahl[0], auswahl[1]); } catch (_) { /* Feldart ohne Auswahl */ }
    }
    return;
  }
}

function allesZeichnen() {
  mitFokus(() => {
    kopfSetzen();
    fragenZeichnen();
    zugRoadmapZeichnen();
    roadmapZeichnen();
    threadListeZeichnen();
    zaehlerSetzen();
    route();
  });
}

/* Nach einem Haken: nur was an roadmap.json hängt. Fragen und Thread-Ansicht bleiben stehen. */
function roadmapTeileZeichnen(gewuenscht) {
  mitFokus(() => {
    kopfSetzen();
    zugRoadmapZeichnen();
    roadmapZeichnen();
    zaehlerSetzen();
  }, gewuenscht);
}

function offeneFragen() {
  const liste = [];
  for (const t of zustand.threads) {
    for (const b of t.offen) liste.push({ thread: t, block: b, f: frageParsen(b) });
  }
  return liste.sort((a, b) => a.block.zeit.localeCompare(b.block.zeit) || a.thread.slug.localeCompare(b.thread.slug));
}

function roadmapPunkte() {
  const aus = [];
  for (const m of (zustand.roadmap && zustand.roadmap.meilensteine) || []) {
    for (const p of m.punkte || []) aus.push({ meilenstein: m, punkt: p });
  }
  return aus;
}

function threadZuSlug(slug) {
  return zustand.threads.find((t) => t.slug === slug);
}

const WER = { code: "KI · Code", betreiber: "deine Entscheidung", betrieb: "dein Handlauf" };
const WER_ICON = { code: "code", betreiber: "entscheidung", betrieb: "handlauf" };
const STATUS = { x: ["fertig", "ok"], "~": ["teilweise", "teil"], ".": ["offen", "offen"] };

const istMeins = (p) => p.wer === "betreiber" || p.wer === "betrieb";
const anzeigeStatus = (eintrag) => (zustand.laufend.has(eintrag.id) ? zustand.laufend.get(eintrag.id) : eintrag.status);

function werText(wer) {
  const legende = zustand.roadmap && zustand.roadmap.legende && zustand.roadmap.legende.wer;
  const eigen = legende && Object.prototype.hasOwnProperty.call(legende, wer) && typeof legende[wer] === "string" ? legende[wer] : "";
  return eigen || (Object.prototype.hasOwnProperty.call(WER, wer) ? WER[wer] : "") || wer || "?";
}
function werMarke(wer, fertig) {
  const art = wer === "code" ? "" : fertig ? "ok" : "zug";
  return el("span", { class: `marke ${art}`.trim() }, icon(Object.prototype.hasOwnProperty.call(WER_ICON, wer) ? WER_ICON[wer] : "info"), werText(wer));
}
function leer(ic, titel, text) {
  return el("div", { class: "leer" }, icon(ic, "leer-ic"),
    el("div", {}, el("strong", { text: titel }), text ? el("p", { text }) : null));
}
function threadVerweis(t, kurz) {
  return el("a", { class: "verweis" + (kurz ? " kurz" : ""), href: `#t/${encodeURIComponent(t.slug)}`, title: t.slug },
    icon("threads"), el("span", { class: "verweis-nr", text: t.nummer || "–" }),
    kurz ? null : el("span", { class: "verweis-titel", text: t.titel }));
}
function ringBox(anteil, beschriftung) {
  const r = 18;
  const umfang = 2 * Math.PI * r;
  const svg = svgEl("svg", { viewBox: "0 0 44 44", class: "ring", "aria-hidden": "true", focusable: "false" });
  svg.append(svgEl("circle", { cx: 22, cy: 22, r, class: "ring-grund" }));
  if (anteil > 0) {
    svg.append(svgEl("circle", {
      cx: 22, cy: 22, r, class: "ring-wert", transform: "rotate(-90 22 22)",
      "stroke-dasharray": `${(anteil * umfang).toFixed(2)} ${umfang.toFixed(2)}`,
    }));
  }
  return el("div", { class: "ring-box", role: "img", "aria-label": beschriftung }, svg,
    el("span", { class: "ring-zahl", "aria-hidden": "true", text: `${Math.round(anteil * 100)}%` }));
}
/* --- Wartezustände: core-wait aus dem Style Book (Kapitel 07) ---
 * Unter 2 s die Ringschlange am Auslöser, ohne Text; 2–10 s ein Marken-Loader mit einem Satz.
 * Die Animation malt Konturen in der Grundfarbe ihrer Palette, darum muss die Palette zur
 * Fläche passen: Seitengrund hell = light, Karte und Knopf hell = white, dunkel = dark. */
function dunkelAktiv() {
  const t = document.documentElement.getAttribute("data-theme");
  if (t) return t === "dark";
  return typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches;
}
const wartePalette = (flaeche) => (dunkelAktiv() ? "dark" : flaeche === "grund" ? "light" : "white");
function warteZeichen(anim, flaeche = "flaeche") {
  return el("core-wait", {
    class: `warten warten-${anim}`, anim, palette: wartePalette(flaeche), "data-flaeche": flaeche,
    fill: anim === "ring" ? ".98" : null, "aria-hidden": "true",
  });
}
function wartePalettenNachziehen() {
  for (const w of document.querySelectorAll("core-wait[data-flaeche]")) w.setAttribute("palette", wartePalette(w.dataset.flaeche));
}
if (typeof matchMedia === "function") {
  const mq = matchMedia("(prefers-color-scheme: dark)");
  if (mq.addEventListener) mq.addEventListener("change", wartePalettenNachziehen);
}
/* Knopf belegt: gesperrt, aria-busy, und die Ringschlange am Auslöser (CSS blendet beim
 * Icon-Knopf das Icon aus). */
function knopfWartet(k, an) {
  if (an) {
    k.disabled = true;
    k.setAttribute("aria-busy", "true");
    if (!k.querySelector(":scope > core-wait")) k.prepend(warteZeichen("ring"));
  } else {
    k.disabled = false;
    k.removeAttribute("aria-busy");
    for (const w of k.querySelectorAll(":scope > core-wait")) w.remove();
  }
}

function aufklappen(details, schluessel, vorgabe) {
  details.open = zustand.offen.has(schluessel) ? zustand.offen.get(schluessel) : vorgabe;
  details.addEventListener("toggle", () => zustand.offen.set(schluessel, details.open));
  return details;
}

/* --- Haken: ein Klick schreibt roadmap.json, Rückgängig in der Meldung --- */

const HAKEN_FELDER = ["status", "erledigt", "von", "notiz"];

let roadmapKette = Promise.resolve();
/* Schreibvorgänge auf roadmap.json laufen nacheinander, sonst stolpert jeder über den sha des anderen. */
function nacheinander(arbeit) {
  const lauf = roadmapKette.then(arbeit);
  roadmapKette = lauf.catch(() => {});
  return lauf;
}

function eintraegeFinden(rm, id, art) {
  if (art === "ready") return (rm.ready || []).filter((r) => r.id === id);
  const treffer = [];
  for (const m of rm.meilensteine || []) for (const p of m.punkte || []) if (p.id === id) treffer.push(p);
  return treffer;
}
const hakenFelder = (eintrag) => {
  const aus = {};
  for (const f of HAKEN_FELDER) if (Object.prototype.hasOwnProperty.call(eintrag, f)) aus[f] = eintrag[f];
  return aus;
};

async function roadmapAendern(id, art, aendern, betreff) {
  const token = zustand.token;
  const uebernehmen = (rm, sha) => {
    if (zustand.token !== token) throw new Abgebrochen();
    zustand.roadmap = roadmapSauber(rm);
    zustand.roadmapSha = sha;
    if (ladeLauf) ladeLauf.roadmap = true;
  };
  for (let versuch = 0; versuch < 3; versuch++) {
    const { text, sha } = await dateiLesen("roadmap.json");
    const rm = JSON.parse(text);
    // Die KIs pflegen roadmap.json von Hand: eine doppelte ID darf nie still den falschen Punkt treffen.
    const treffer = eintraegeFinden(rm, id, art);
    if (treffer.length !== 1) {
      throw new Hinweis(treffer.length ? `${id} steht ${treffer.length}-mal in roadmap.json – bitte dort bereinigen, nichts geschrieben.`
        : `${id} steht nicht mehr in roadmap.json – „Neu laden“ zeigt den aktuellen Stand.`);
    }
    const eintrag = treffer[0];
    const vorher = hakenFelder(eintrag);
    if (!aendern(eintrag)) {
      // Schon so, wie gewünscht (jemand war schneller): nichts schreiben, nur den frischen Stand zeigen.
      uebernehmen(rm, sha);
      return { vorher, nachher: vorher, geaendert: false };
    }
    const nachher = hakenFelder(eintrag);
    const neu = JSON.stringify(rm, null, 2) + "\n";
    try {
      await gateSicherstellen();
      const titel = typeof betreff === "function" ? betreff(vorher) : betreff;
      const neuSha = await dateiSchreiben("roadmap.json", neu, sha, `roadmap: ${titel} [${ICH.ki}/${ICH.chat}]`);
      blobMerken(neuSha, neu);
      uebernehmen(rm, neuSha);
      return { vorher, nachher, geaendert: true };
    } catch (e) {
      if (!istKonflikt(e) || versuch === 2) throw e;
    }
  }
  throw new Error("nicht geschrieben");
}

function schreibFehler(e) {
  if (e instanceof Hinweis) { melden(e.message, true); return; }
  if (!(e instanceof GitHubFehler)) {
    // fetch selbst ist gescheitert: ob GitHub den Schreibvorgang noch angenommen hat, ist offen.
    melden(`Verbindung abgerissen (${e.message}). Ob geschrieben wurde, ist unklar – bitte „Neu laden“ und nachsehen.`, true);
    return;
  }
  const hinweis = e.status === 403 || e.status === 404
    ? " — hat das Token „Contents: Read and write“ auf CORE-Forum-?" : "";
  melden("Nicht geschrieben: " + e.message + hinweis, true);
}

/* Die Zeile in „Dein Zug“ wechselt bei jedem Haken die Liste: kurz ausblenden statt springen. */
function wegAnimieren(id) {
  if (bewegungAus() || $("ansicht-zug").hidden) return Promise.resolve();
  const zeilen = document.querySelectorAll(`#ansicht-zug [data-zeile="${CSS.escape(id)}"]`);
  if (!zeilen.length) return Promise.resolve();
  for (const z of zeilen) z.classList.add("geht");
  return new Promise((fertig) => setTimeout(fertig, 280));
}

/* Fokus nach dem Haken: auf den nächsten Kreis derselben Liste (Tastatur: Leertaste, Leertaste, …). */
function naechsterFokus(id) {
  const knopf = sichtbarFinden(`haken:${id}`);
  const liste = knopf && knopf.closest("[data-hakenliste]");
  // Nur in „Dein Zug“ verlässt der Punkt seine Liste; in der Roadmap bleibt er stehen.
  if (!liste || !["aufgaben", "zuletzt"].includes(liste.dataset.hakenliste)) return null;
  const alle = [...liste.querySelectorAll(".haken")];
  const i = alle.indexOf(knopf);
  const nachbar = alle[i + 1] || alle[i - 1];
  return nachbar ? nachbar.dataset.fokus : null;
}

async function statusSchreiben({ id, art, ziel, aendern, betreff, erfolg }) {
  if (zustand.laufend.has(id)) return;
  const token = zustand.token;
  zustand.fokusNach = naechsterFokus(id);
  zustand.laufend.set(id, ziel);
  roadmapTeileZeichnen();
  try {
    const ergebnis = await nacheinander(() => roadmapAendern(id, art, aendern, betreff));
    await wegAnimieren(id);
    if (zustand.token !== token) return;
    // Lag der Fokus auf diesem Kreis, geht er zum Nachbarn – auch wenn der Punkt in der
    // aufgeklappten Liste „Zuletzt erledigt“ wieder auftaucht.
    const aktiv = document.activeElement;
    const weiter = zustand.fokusNach && aktiv && aktiv.dataset && aktiv.dataset.fokus === `haken:${id}` ? zustand.fokusNach : undefined;
    zustand.laufend.delete(id);
    roadmapTeileZeichnen(weiter);
    zustand.fokusNach = null;
    erfolg(ergebnis);
  } catch (e) {
    if (e instanceof Abgebrochen || zustand.token !== token) return;
    zustand.laufend.delete(id);
    zustand.fokusNach = null;
    roadmapTeileZeichnen();
    schreibFehler(e);
  }
}

/* Notiz nur, wenn ihr Feld offen ist: was man nicht sieht, wird nicht geschrieben. */
function notizBereit(id) {
  const feld = `notizfeld:${id}`;
  const offen = zustand.offen.has(feld) ? zustand.offen.get(feld) : !!entwurf(`notiz:${id}`);
  return offen ? String(entwurf(`notiz:${id}`)).trim() : "";
}

function rueckgaengig(id, art, ergebnis) {
  return { text: "Rückgängig", label: `${id} zurücknehmen`, tun: () => zuruecknehmen(id, art, ergebnis) };
}

/* vorgabe: Vermerk, der vor eine getippte Notiz kommt („laut BESCHLUSS 055 …“). */
async function abhaken(eintrag, art, vorgabe) {
  const id = eintrag.id;
  const notizSchluessel = `notiz:${id}`;
  let getippt = art === "punkt" ? notizBereit(id) : "";
  if (getippt) {
    // Die Notiz landet in roadmap.json – auch die lesen alle KIs.
    const feld = sichtbarFinden(`notiztext:${id}`);
    if (feld && (await pruefeVorSenden([{ el: feld, entwurf: notizSchluessel }], sichtbarFinden(`haken:${id}`))) !== "senden") return;
    getippt = notizBereit(id);
  }
  const notiz = [vorgabe, getippt].filter(Boolean).join(" · ");
  const st0 = art === "punkt" && zustand.roadmap ? graphStand(zustand.roadmap) : null;
  statusSchreiben({
    id, art, ziel: "x",
    betreff: (vorher) => (vorher.status === "x" ? `${id} Notiz` : `${id} erledigt`),
    aendern: (p) => {
      if (p.status === "x") {
        // Jemand war schneller: die getippte Notiz trotzdem nicht verlieren.
        if (!notiz) return false;
        p.notiz = p.notiz ? `${p.notiz} · ${notiz}` : notiz;
        return true;
      }
      p.status = "x";
      p.erledigt = heute();
      p.von = `${ICH.ki}/${ICH.chat}`;
      if (notiz) p.notiz = p.notiz ? `${p.notiz} · ${notiz}` : notiz;
      return true;
    },
    erfolg: (ergebnis) => {
      if (!ergebnis.geaendert) { melden(`${id} war schon erledigt.`, { fokus: `haken:${id}` }); return; }
      if (getippt) { entwurfSetzen(notizSchluessel, ""); zustand.offen.delete(`notizfeld:${id}`); roadmapTeileZeichnen(); }
      let text = `${id} abgehakt.`;
      if (ergebnis.vorher.status === "x") text = `${id} war schon erledigt – Notiz ergänzt.`;
      else if (st0 && zustand.roadmap) {
        const folge = folgeSatz(id, st0, graphStand(zustand.roadmap));
        text = folge.text;
        // Für das Flussdiagramm: der fertige Meilenstein „zündet“ kurz.
        if (folge.fertig) {
          zustand.zuendung = { ms: folge.fertig, bis: Date.now() + 1500 };
          mitFokus(flussZeichnen);
        }
      }
      melden(text, { aktion: rueckgaengig(id, art, ergebnis), fokus: `haken:${id}` });
    },
  });
}

function wiederOeffnen(eintrag, art) {
  const id = eintrag.id;
  statusSchreiben({
    id, art, ziel: ".", betreff: `${id} wieder offen`,
    aendern: (p) => {
      if (p.status !== "x") return false;
      p.status = ".";
      delete p.erledigt;
      delete p.von;
      return true;
    },
    erfolg: (ergebnis) => {
      if (!ergebnis.geaendert) { melden(`${id} war schon offen.`, { fokus: `haken:${id}` }); return; }
      melden(`${id} wieder offen.`, { aktion: rueckgaengig(id, art, ergebnis), fokus: `haken:${id}` });
    },
  });
}

/* Stellt genau die Haken-Felder wieder her, wie sie vor dem Klick waren – aber nur, wenn in
 * der Datei noch steht, was der Klick geschrieben hat. Fremde Änderungen bleiben. */
const gleicheFelder = (a, b) => HAKEN_FELDER.every((f) => Object.prototype.hasOwnProperty.call(a, f) === Object.prototype.hasOwnProperty.call(b, f) && a[f] === b[f]);

function zuruecknehmen(id, art, { vorher, nachher }) {
  statusSchreiben({
    id, art, ziel: vorher.status || ".", betreff: `${id} zurückgenommen`,
    aendern: (p) => {
      if (!gleicheFelder(hakenFelder(p), nachher)) {
        throw new Hinweis(`${id} wurde inzwischen geändert – nicht zurückgenommen.`);
      }
      let anders = false;
      for (const f of HAKEN_FELDER) {
        const hatte = Object.prototype.hasOwnProperty.call(vorher, f);
        if (hatte && p[f] !== vorher[f]) { p[f] = vorher[f]; anders = true; }
        if (!hatte && Object.prototype.hasOwnProperty.call(p, f)) { delete p[f]; anders = true; }
      }
      return anders;
    },
    erfolg: () => melden(`${id} zurückgenommen.`, { fokus: `haken:${id}` }),
  });
}

function hakenKnopf(eintrag, art, klein) {
  const status = anzeigeStatus(eintrag);
  const laeuft = zustand.laufend.has(eintrag.id);
  const fertig = status === "x";
  const svg = svgEl("svg", { viewBox: "0 0 24 24", "aria-hidden": "true", focusable: "false" });
  svg.append(
    svgEl("circle", { class: "haken-ring", cx: 12, cy: 12, r: 9.5 }),
    svgEl("path", { class: "haken-teil", d: "M8 12h8" }),
    svgEl("path", { class: "haken-strich", d: "m7.5 12.4 3 3 6-6.4" }),
  );
  const knopf = el("button", {
    type: "button",
    class: "haken" + (klein ? " klein" : ""),
    role: "checkbox",
    "aria-checked": fertig ? "true" : status === "~" ? "mixed" : "false",
    "aria-label": `${eintrag.id} ${eintrag.titel || ""}`.trim(),
    "aria-busy": laeuft ? "true" : null,
    title: zustand.probe ? "Probe läuft – erst beenden" : laeuft ? "wird gespeichert …" : fertig ? "erledigt · klicken öffnet wieder" : "als erledigt abhaken",
    "data-fokus": `haken:${eintrag.id}`,
    disabled: !!zustand.probe,
  }, svg, laeuft ? warteZeichen("ring") : null);
  knopf.addEventListener("click", () => {
    if (zustand.laufend.has(eintrag.id) || zustand.probe) return;
    if (fertig) wiederOeffnen(eintrag, art); else abhaken(eintrag, art);
  });
  return knopf;
}

/* --- Beschlüsse und was daraus folgt: Nachzug, Aufträge, Zusagen, Termine ---
 * Ein Beschluss ändert roadmap.json nicht selbst, das ziehen die KIs nach (AGENT.md). Bis dahin
 * stünden Punkte „bei dir“, über die längst entschieden ist. Hier wird nur gerechnet und
 * gezeigt; geschrieben wird über die vorhandenen Wege, und alles, was KIs anstoßen soll, ist
 * ein Entwurf, den der Betreiber selbst absendet. */

const NACHZUG_ZURUECK = `core-pult-nachzug-zurueck:${ZWEIG}`;
const WOCHENTAG = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
const WOCHENTAG_LANG = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];
const MONAT = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];
const TAG_MS = 86400000;

/* „B-8“ → B8, „V-17“ → V17; „Anhang B 9“ und „Anh.B 9“ → ANHB9, eine eigene Klasse (nie B9). */
function kennungNorm(s) {
  return String(s).trim().replace(/^Anh(?:ang|\.)?\s*B\s*/i, "ANHB").toUpperCase().replace(/[^A-Z0-9]/g, "");
}
const TITEL_KENNUNG = /^(Anhang B \d+|[A-Z]{1,2}-?\d+)(?=[\s:,(]|$)/;
/* Kennungen eines Punkts: aus dem Titelanfang und der ID ohne „M4-“. Anhang B steht für sich. */
function punktSchluessel(p) {
  const m = TITEL_KENNUNG.exec(String(p.titel || ""));
  const ausTitel = m ? kennungNorm(m[1]) : "";
  if (ausTitel.startsWith("ANHB")) return new Set([ausTitel]);
  const aus = new Set();
  if (ausTitel) aus.add(ausTitel);
  const rest = kennungNorm(String(p.id || "").replace(/^M\d+-/, ""));
  if (rest) aus.add(rest);
  return aus;
}
/* „Roadmap: M2 · B-8 · R1“ einer FRAGE → [{punkt, ms, weil, vermutet}] */
function punkteZuTokens(tokens, rm, frageText, slug) {
  const ms = ((rm && rm.meilensteine) || []).filter((m) => m && Array.isArray(m.punkte));
  const aus = [];
  const dazu = (punkt, m, weil, vermutet) => {
    if (!aus.some((a) => a.punkt === punkt)) aus.push({ punkt, ms: m, weil, vermutet: !!vermutet });
  };
  for (const m of ms) for (const p of m.punkte) if (slug && p.frage === slug) dazu(p, m, `frage ${slug}`, false);
  const mIds = tokens.filter((t) => /^M\d+$/.test(t));
  const kennungen = tokens.filter((t) => !/^[MR]\d+$/.test(t)).map((t) => [t, kennungNorm(t)]).filter(([, k]) => k.length >= 2);
  for (const m of mIds.length ? ms.filter((x) => mIds.includes(x.id)) : ms) {
    for (const p of m.punkte) {
      const schluessel = punktSchluessel(p);
      const k = kennungen.find(([, n]) => schluessel.has(n));
      if (k) dazu(p, m, k[0], false);
    }
  }
  // Nur ein Meilenstein genannt: sein einziger offener Punkt, wenn die Frage ihn beim Namen nennt.
  for (const m of ms.filter((x) => mIds.includes(x.id))) {
    if (aus.some((a) => a.ms === m)) continue;
    const offen = m.punkte.filter((p) => p.status !== "x");
    if (offen.length !== 1) continue;
    const wort = (/[A-Za-zÄÖÜäöüß]{6,}/.exec(String(offen[0].titel || "")) || [])[0];
    if (wort && String(frageText || "").toLowerCase().includes(wort.toLowerCase())) dazu(offen[0], m, wort, true);
  }
  return aus;
}

/* --- Datum: Tage zählen in Ortszeit --- */
const tagVon = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
function tagAus(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || "");
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
}
const zweistellig = (n) => String(n).padStart(2, "0");
const isoVon = (d) => `${d.getFullYear()}-${zweistellig(d.getMonth() + 1)}-${zweistellig(d.getDate())}`;
function zeitPunkt(iso) {
  const s = String(iso || "");
  const d = new Date(/T\d{2}:\d{2}Z$/.test(s) ? s.replace(/Z$/, ":00Z") : s);
  return isNaN(d) ? null : d;
}
const tageBis = (d) => Math.round((tagVon(d) - tagVon(new Date())) / TAG_MS);
const kurzDatum = (d) => `${WOCHENTAG[d.getDay()]} ${zweistellig(d.getDate())}.${zweistellig(d.getMonth() + 1)}.`;
const langDatum = (d) => `${WOCHENTAG_LANG[d.getDay()]}, ${d.getDate()}. ${MONAT[d.getMonth()]}`;
function relativ(tage) {
  if (tage === 0) return "heute";
  if (tage === 1) return "morgen";
  if (tage > 1) return `in ${tage} Tagen`;
  return `seit ${-tage} ${tage === -1 ? "Tag" : "Tagen"} überfällig`;
}
function seitDauer(d) {
  if (!d) return "";
  const min = Math.max(0, Math.round((Date.now() - d) / 60000));
  if (min < 60) return `seit ${min} Min.`;
  const std = Math.round(min / 60);
  return std < 48 ? `seit ${std} Std.` : `seit ${Math.round(std / 24)} Tagen`;
}
/* „5.10.26“ oder „05.10.2026“ → 2026-10-05; ungültige Daten zählen nicht. */
function datumImText(text) {
  const m = /(^|[^\d.])(\d{1,2})\.(\d{1,2})\.(\d{4}|\d{2})(?![\d.])/.exec(String(text || ""));
  if (!m) return "";
  const jahr = m[4].length === 2 ? 2000 + Number(m[4]) : Number(m[4]);
  const d = new Date(jahr, Number(m[3]) - 1, Number(m[2]));
  if (d.getFullYear() !== jahr || d.getMonth() !== Number(m[3]) - 1 || d.getDate() !== Number(m[2])) return "";
  return isoVon(d);
}

/* --- Text --- */
function kuerzen(text, max) {
  const s = String(text || "").replace(/\s+/g, " ").trim();
  if (s.length <= max) return s;
  const schnitt = s.slice(0, max);
  const i = schnitt.lastIndexOf(" ");
  return `${(i > max * 0.6 ? schnitt.slice(0, i) : schnitt).replace(/[\s,;:.–-]+$/, "")} …`;
}
/* Sätze enden an . ! ? vor einem Leerzeichen; „vergleich.cmd“ bleibt ganz. */
function saetze(text) {
  const s = String(text || "").replace(/\s+/g, " ").trim();
  const aus = [];
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    if (".!?".includes(s[i]) && (i + 1 === s.length || s[i + 1] === " ")) { aus.push(s.slice(start, i + 1).trim()); start = i + 1; }
  }
  if (s.slice(start).trim()) aus.push(s.slice(start).trim());
  return aus;
}
const zitatAus = (text) => ((/„([^“”"]+)[“”"]/.exec(String(text || "")) || [])[1] || "").trim();

/* --- Paare aus FRAGE und Antwort des Betreibers --- */
function antwortZerlegen(b) {
  const zeilen = String(b.text).split("\n");
  const w = WAHL.exec(zeilen[1] || "");
  const angaben = {};
  const rest = [];
  for (const z of zeilen.slice(w ? 2 : 1)) {
    const a = /^(Pfad|Termin|Anzahl|Angabe): (.+)$/.exec(z);
    if (a) angaben[a[1]] = a[2].trim();
    else if (!z.startsWith("Nachtrag:")) rest.push(z);
  }
  const zusatz = rest.join("\n").trim();
  if (!w) return { wahl: "", wahlText: "", angaben, zusatz };
  if (w[1]) return { wahl: w[1], wahlText: w[2].trim(), angaben, zusatz };
  return { wahl: "eigen", wahlText: zusatz, angaben, zusatz: "" };
}
/* Wofür steht der Beschluss? Der erste Treffer zählt. */
function klasseVon(wahlText, zusatz) {
  const text = `${wahlText}\n${zusatz}`;
  if (/^\s*Wenn\b/i.test(wahlText)) return "regel";
  if (/verschoben|nach §\s?3|\bparken\b|\bgeparkt\b|nach (der )?Beta\b|nach 1\.0|\bspäter\b/i.test(text)) return "geparkt";
  if (/\bHaken\b|\berfüllt\b|als erledigt/i.test(text)) return "erledigt";
  return "beschluss";
}
function faedenBauen(threads, rm) {
  const paare = [];
  for (const t of threads) {
    const jeFrage = new Map();
    for (const [b, frage] of antwortenZuordnen(t).frageVon) {
      if (!frage || (b.sorte !== "ANTWORT" && b.sorte !== "BESCHLUSS")) continue;
      if (!jeFrage.has(frage)) jeFrage.set(frage, []);
      jeFrage.get(frage).push(b);
    }
    for (const [frage, antworten] of jeFrage) {
      const teile = antworten.map((b) => ({ b, ...antwortZerlegen(b) }));
      // Gilt die letzte Wahl; ein Nachtrag ohne Wahl ergänzt nur die Angaben.
      const haupt = [...teile].reverse().find((x) => x.wahl) || teile[teile.length - 1];
      const angaben = Object.assign({}, ...teile.map((x) => x.angaben));
      const zusatz = teile.map((x) => x.zusatz).filter(Boolean).join("\n");
      const text = `${haupt.wahlText}\n${zusatz}`;
      const f = frageParsen(frage);
      const klasse = klasseVon(haupt.wahlText, zusatz);
      const termin = /^\d{4}-\d{2}-\d{2}$/.test(angaben.Termin || "") ? angaben.Termin
        : datumImText(haupt.wahl === "eigen" ? text : zusatz);
      const danach = t.bloecke.slice(t.bloecke.indexOf(haupt.b) + 1);
      paare.push({
        thread: t, frage, antwort: haupt.b, f,
        wahl: haupt.wahl, wahlText: haupt.wahlText, empfohlen: f.empfohlen, zusatz, angaben,
        punkte: punkteZuTokens(f.roadmap, rm, f.frage, t.slug),
        mTokens: f.roadmap.filter((x) => /^M\d+$/.test(x)),
        rTokens: f.roadmap.filter((x) => /^R\d+$/.test(x)),
        klasse,
        kiAuftrag: klasse !== "regel" && /\beine KI\b/i.test(text),
        zusage: /\bich\b[^.]*\bmelde\b|Ergebnis hier melden/i.test(text),
        termin,
        kiDanach: danach.some((x) => x.ki !== ICH.ki),
        betreiberDanach: danach.some((x) => x.ki === ICH.ki),
      });
    }
  }
  return paare.sort((a, b) => a.antwort.zeit.localeCompare(b.antwort.zeit) || a.thread.slug.localeCompare(b.thread.slug));
}

function nachzugZurueckLesen() {
  try {
    const w = JSON.parse(localStorage.getItem(NACHZUG_ZURUECK) || "[]");
    return Array.isArray(w) ? w.filter((x) => typeof x === "string") : [];
  } catch (_) { return []; }
}
function nachzugZurueckSchreiben(ids) {
  try {
    if (ids.length) localStorage.setItem(NACHZUG_ZURUECK, JSON.stringify(ids)); else localStorage.removeItem(NACHZUG_ZURUECK);
  } catch (_) { /* gesperrt: gilt bis zum Neuladen nicht */ }
}

/* Einmal je Stand gerechnet: Threads (sha), roadmap.json (Objekt) und die „gehört doch zu mir“-Liste. */
let beschlussMemo = null;
function beschluesse() {
  const rm = zustand.roadmap;
  const zurueck = nachzugZurueckLesen();
  const schluessel = `${zustand.threads.map((t) => t.sha).join(",")}|${zurueck.join(",")}`;
  if (beschlussMemo && beschlussMemo.rm === rm && beschlussMemo.schluessel === schluessel) return beschlussMemo;
  const paare = faedenBauen(zustand.threads, rm);
  const ausgenommen = new Set(zurueck);
  const nachzug = new Map();
  for (const paar of paare) {
    if (paar.klasse !== "erledigt" && paar.klasse !== "geparkt") continue;
    for (const treffer of paar.punkte) {
      const p = treffer.punkt;
      if (p.status === "x" || !istMeins(p) || ausgenommen.has(p.id) || nachzug.has(p.id)) continue;
      nachzug.set(p.id, { paar, treffer });
    }
  }
  const fragenRoadmap = [];
  for (const t of zustand.threads) {
    for (const blk of t.bloecke) {
      if (blk.sorte !== "FRAGE") continue;
      const f = frageParsen(blk);
      if (f.roadmap.length) fragenRoadmap.push({ thread: t, frage: blk, f, punkte: punkteZuTokens(f.roadmap, rm, f.frage, t.slug) });
    }
  }
  beschlussMemo = { rm, schluessel, paare, nachzug, fragenRoadmap };
  return beschlussMemo;
}
const istBeiDir = (p) => istMeins(p) && p.status !== "x" && !beschluesse().nachzug.has(p.id);

/* Zusagen des Betreibers („ich … melde“): offen, bis er im Thread wieder schreibt. */
function zusagenOffen() {
  const rm = zustand.roadmap;
  return beschluesse().paare.filter((p) => p.zusage && !p.betreiberDanach).map((paar) => {
    const text = `${paar.wahlText}\n${paar.zusatz}`;
    const beschluss = zeitPunkt(paar.antwort.zeit);
    let frist = null;
    if (beschluss && /diese Woche/i.test(text)) {
      frist = tagVon(beschluss);
      frist.setDate(frist.getDate() + ((7 - frist.getDay()) % 7));
    } else if (beschluss && /\bmorgen\b/i.test(text)) {
      frist = tagVon(beschluss);
      frist.setDate(frist.getDate() + 1);
    }
    // Ist der Handlauf schon abgehakt, fehlt nur noch das Ergebnis im Thread.
    const seit = beschluss ? isoVon(tagVon(beschluss)) : "";
    const kandidaten = paar.punkte.length ? paar.punkte.map((t) => t.punkt)
      : ((rm && rm.meilensteine) || []).filter((m) => paar.mTokens.includes(m.id)).flatMap((m) => m.punkte || []);
    const abgehakt = kandidaten.find((p) => p.wer === "betrieb" && p.status === "x" && String(p.erledigt || "") >= seit) || null;
    return { paar, frist, abgehakt };
  });
}
/* Aufträge an „eine KI“: erledigt, sobald nach dem Beschluss eine KI im Thread schreibt. */
function auftraegeOffen() {
  return beschluesse().paare.filter((p) => p.kiAuftrag && !p.kiDanach).map((paar) => {
    const treffer = paar.punkte.find((t) => t.punkt.wer === "code" && t.punkt.status !== "x");
    return { paar, punkt: treffer ? treffer.punkt : null, satz: saetze(paar.wahlText).find((s) => /\beine KI\b/i.test(s)) || kuerzen(paar.wahlText, 120) };
  });
}
/* Threads, deren letztes Wort ein ANTRAG oder EINWAND einer KI ist. */
function antraegeOhneAntwort() {
  return zustand.threads
    .filter((t) => !t.geschlossen && t.letzter && (t.letzter.sorte === "ANTRAG" || t.letzter.sorte === "EINWAND") && t.letzter.ki !== ICH.ki)
    .map((t) => {
      const s = saetze(t.letzter.text);
      return { thread: t, block: t.letzter, zitat: kuerzen(s.filter((x) => x.includes("?")).pop() || s[0] || "", 120) };
    })
    .sort((a, b) => b.block.zeit.localeCompare(a.block.zeit));
}
/* Termine aus Beschlüssen: kommend oder höchstens 14 Tage überfällig, der nächste zuerst. */
function termineAktiv() {
  return beschluesse().paare.filter((p) => p.termin).map((paar) => {
    const tag = tagAus(paar.termin);
    return { paar, tag, tage: tageBis(tag), ms: paar.mTokens[0] || "" };
  }).filter((x) => x.tage >= -14).sort((a, b) => a.tag - b.tag);
}
function terminEtikett(x) {
  const ready = (zustand.roadmap && zustand.roadmap.ready) || [];
  const r = x.paar.rTokens.map((id) => ready.find((q) => q.id === id)).find(Boolean);
  if (r && r.titel) return r.titel;
  if (x.paar.punkte.length) return x.paar.punkte[0].punkt.titel;
  return x.paar.thread.titel.split(" (")[0].split("?")[0].trim();
}
/* Alle Meilensteine, auf die id (über Kanten) wartet; ein Kreis hält nicht an. */
function vorfahrenVon(g, id) {
  const aus = new Set();
  const stapel = [id];
  while (stapel.length) {
    const x = stapel.pop();
    for (const k of g.kanten) if (k.nach === x && !aus.has(k.von)) { aus.add(k.von); stapel.push(k.von); }
  }
  aus.delete(id);
  return aus;
}

/* --- Aktionen: Haken mit Vermerk, „gehört doch zu mir“, Entwürfe vorbereiten --- */
function vermerkFuer(paar) {
  return `laut ${paar.antwort.sorte} ${paar.thread.nummer} (${datumLesbar(paar.antwort.zeit)}): ${zitatAus(paar.wahlText) || "erledigt per Beschluss"}`;
}
function nachzugWas(paar) {
  if (paar.klasse === "erledigt") {
    const z = zitatAus(paar.wahlText);
    return z ? `Haken mit Vermerk „${z}“` : "Haken per Beschluss";
  }
  return /§\s?3/.test(`${paar.wahlText}\n${paar.zusatz}`) ? "nach §3 verschoben" : `geparkt („${kuerzen(paar.wahlText, 80)}“)`;
}
function nachzugZurueckNehmen(id) {
  const ids = nachzugZurueckLesen();
  if (!ids.includes(id)) nachzugZurueckSchreiben([...ids, id]);
  roadmapTeileZeichnen(`haken:${id}`);
  melden(`${id} steht wieder bei dir.`, {
    fokus: `haken:${id}`,
    aktion: {
      text: "Rückgängig", label: `${id} wieder als Nachzug führen`,
      tun: () => {
        nachzugZurueckSchreiben(nachzugZurueckLesen().filter((x) => x !== id));
        roadmapTeileZeichnen();
        melden(`${id} wartet wieder auf Nachzug.`);
      },
    },
  });
}
/* Thread öffnen und den Fokus ins Feld setzen, sobald die Ansicht steht. */
function zuEntwurf(t, fokus) {
  const ziel = `#t/${encodeURIComponent(t.slug)}`;
  const danach = () => {
    const f = sichtbarFinden(fokus);
    if (!f) return;
    f.focus({ preventScroll: true });
    f.scrollIntoView({ block: "center", behavior: bewegungAus() ? "auto" : "smooth" });
    if (typeof f.setSelectionRange === "function") {
      const n = f.value.length;
      try { f.setSelectionRange(n, n); } catch (_) { /* Feldart ohne Auswahl */ }
    }
  };
  if (location.hash === ziel) { route(); danach(); return; }
  window.addEventListener("hashchange", () => setTimeout(danach, 0), { once: true });
  location.hash = ziel;
}
/* Beitrags-Entwurf ergänzen, ohne schon Vorhandenes zu verdoppeln. Gesendet wird nur über „Anhängen“. */
function entwurfVorbereiten(t, sorte, text) {
  const schl = `beitrag:${t.slug}`;
  entwurfSetzen(`${schl}:sorte`, sorte);
  const alt = entwurf(`${schl}:text`);
  const zeilen = text.split("\n");
  if (!alt.trim()) entwurfSetzen(`${schl}:text`, text);
  else if (!alt.includes(zeilen[0])) entwurfSetzen(`${schl}:text`, `${alt.trimEnd()}\n\n${text}`);
  else {
    const fehlen = zeilen.filter((z) => z.trim() && !alt.includes(z));
    if (fehlen.length) entwurfSetzen(`${schl}:text`, `${alt.trimEnd()}\n${fehlen.join("\n")}`);
  }
  zuEntwurf(t, `${schl}:text`);
}
function anstossZiel() {
  const rm = zustand.roadmap;
  const nr = (/Thread (\d{3})/.exec((rm && rm.quelle) || "") || [])[1] || "031";
  return zustand.threads.find((t) => t.nummer === nr) || null;
}
function kisAnstossen(ziel) {
  const rm = zustand.roadmap;
  const gruppen = new Map();
  for (const [id, { paar }] of beschluesse().nachzug) {
    if (!gruppen.has(paar)) gruppen.set(paar, []);
    gruppen.get(paar).push(id);
  }
  const zeilen = [`Nachzug fehlt in roadmap.json (Stand ${(rm && rm.stand) || "?"}):`];
  for (const [paar, ids] of gruppen) zeilen.push(`- ${ids.join(", ")} laut ${paar.antwort.sorte} ${paar.thread.nummer} (${datumLesbar(paar.antwort.zeit)}): ${nachzugWas(paar)}`);
  zeilen.push("Bitte roadmap.json nachziehen (AGENT.md).");
  entwurfVorbereiten(ziel, "BEFUND", zeilen.join("\n"));
  melden(`Entwurf in ${ziel.nummer} vorbereitet – prüfen und anhängen.`);
}
function ergebnisMelden(t) {
  const schl = `beitrag:${t.slug}`;
  const vorlage = entwurf(`${schl}:text`).trim() ? "" : `Ergebnis: …\nDatum: ${datumLesbar(heute())}\nProtokoll: …`;
  entwurfVorbereiten(t, "BEFUND", vorlage || entwurf(`${schl}:text`));
}

/* --- Zeichnen --- */
function beschlussVerweis(paar) {
  const wort = paar.antwort.sorte === "BESCHLUSS" ? "Beschluss" : "Antwort";
  return el("a", { class: "beschluss-link", href: ankerLink(paar.thread, paar.antwort) }, icon("threads"),
    `${wort} ${paar.thread.nummer} · ${zeitLesbar(paar.antwort.zeit)} · ${paar.wahl === "eigen" ? "eigene Antwort" : `Wahl ${paar.wahl}`}`);
}
function nachzugZeichnen() {
  const box = $("nachzug-box");
  box.replaceChildren();
  if (!zustand.roadmap) return;
  const { nachzug } = beschluesse();
  if (!nachzug.size) return;
  const ziel = anstossZiel();
  let anstoss = null;
  if (ziel) {
    const juengster = [...nachzug.values()].reduce((z, { paar }) => (paar.antwort.zeit > z ? paar.antwort.zeit : z), "");
    const schon = [...ziel.bloecke].reverse().find((b) => b.ki === ICH.ki && b.sorte === "BEFUND" && b.text.startsWith("Nachzug fehlt") && b.zeit > juengster);
    anstoss = schon
      ? el("a", { class: "knopf zweit klein-knopf", href: ankerLink(ziel, schon) }, icon("ok"), `Schon angestoßen (${datumLesbar(schon.zeit).slice(0, 6)})`)
      : el("button", { type: "button", class: "knopf zweit klein-knopf", "data-fokus": "nachzug:anstossen", onclick: () => kisAnstossen(ziel) },
        icon("senden"), "KIs anstoßen");
  }
  const zeilen = [...nachzug.entries()].map(([id, { paar, treffer }]) => {
    const p = treffer.punkt;
    const laeuft = zustand.laufend.has(id);
    return el("li", { class: "nachzug-zeile", "data-zeile": `nachzug:${id}` },
      el("div", { class: "nachzug-haupt" },
        el("div", { class: "aufgabe-titel" }, el("span", { class: "kennung", text: id }), " ", p.titel,
          treffer.vermutet ? el("span", { class: "marke leise vermutet", title: `vermutet: über „${treffer.weil}“` }, "vermutet") : null),
        beschlussVerweis(paar),
        el("p", { class: "nachzug-weil", text: `weil ${paar.thread.nummer} sagt: „${kuerzen(paar.wahlText, 140)}“` })),
      el("div", { class: "nachzug-aktionen" },
        paar.klasse === "erledigt"
          ? el("button", {
            type: "button", class: "knopf klein-knopf", "data-fokus": `vermerk:${id}`, disabled: laeuft, "aria-busy": laeuft ? "true" : null,
            title: vermerkFuer(paar), onclick: () => abhaken(p, "punkt", vermerkFuer(paar)),
          }, laeuft ? warteZeichen("ring", "flaeche") : icon("haken"), "Mit Vermerk abhaken")
          : el("span", { class: "hinweis nachzug-park", text: "Umsortieren ist Sache der KI (nach §3)." }),
        el("button", { type: "button", class: "knopf zweit klein-knopf", "data-fokus": `meins:${id}`, onclick: () => nachzugZurueckNehmen(id) },
          icon("person"), "Gehört doch zu mir")));
  });
  const details = el("details", { class: "karte nachzug" },
    el("summary", {},
      icon("uhr", "nachzug-ic"),
      el("span", { class: "nachzug-name" }, "Wartet auf Nachzug ", el("span", { class: "zaehler leise", text: String(nachzug.size) })),
      el("span", { class: "nachzug-satz", text: "Du hast entschieden, roadmap.json zeigt es noch nicht." }),
      icon("runter", "chevron")),
    el("div", { class: "nachzug-kopf" },
      el("p", { class: "hinweis", text: `Die KIs ziehen roadmap.json nach (AGENT.md).${ziel ? ` Ein BEFUND in ${ziel.nummer} erinnert sie daran.` : ""}` }),
      anstoss),
    el("ul", { class: "checkliste nachzug-liste" }, zeilen));
  box.append(aufklappen(details, "nachzug", false));
}

function springenZu(schluessel) {
  const z = sichtbarFinden(schluessel);
  if (!z) return;
  z.scrollIntoView({ block: "center", behavior: bewegungAus() ? "auto" : "smooth" });
  z.focus({ preventScroll: true });
}
/* Wer ist am Zug? Zwei Knöpfe, ein Klick klappt die Liste darunter auf. */
function ballZeichnen(aufgaben) {
  const offen = zustand.offen.get("ball") || "";
  const dir = [];
  for (const q of offeneFragen()) {
    dir.push(el("li", {}, icon("rueckfrage"),
      el("a", { href: ankerLink(q.thread, q.block) }, el("span", { class: "kennung", text: q.thread.nummer }), ` Frage: ${kuerzen(q.f.frage, 90)}`)));
  }
  for (const { punkt } of aufgaben) {
    dir.push(el("li", {}, icon(Object.prototype.hasOwnProperty.call(WER_ICON, punkt.wer) ? WER_ICON[punkt.wer] : "info"),
      el("button", { type: "button", class: "ball-link", onclick: () => springenZu(`haken:${punkt.id}`) },
        el("span", { class: "kennung", text: punkt.id }), ` ${kuerzen(punkt.titel, 90)}`)));
  }
  for (const z of zusagenOffen()) {
    dir.push(el("li", {}, icon("notiz"),
      el("span", {}, el("span", { class: "kennung", text: z.paar.thread.nummer }), ` Deine Zusage: Ergebnis melden${z.frist ? ` · bis ${kurzDatum(z.frist)}` : ""}`),
      el("button", { type: "button", class: "knopf zweit klein-knopf", onclick: () => ergebnisMelden(z.paar.thread) }, "Ergebnis melden")));
  }
  for (const a of antraegeOhneAntwort()) {
    dir.push(el("li", {}, icon("threads"),
      el("a", { href: ankerLink(a.thread, a.block) }, el("span", { class: "kennung", text: a.thread.nummer }), ` ${a.block.sorte}: „${a.zitat}“`)));
  }
  const kis = [];
  for (const [id, { paar }] of beschluesse().nachzug) {
    kis.push(el("li", {}, icon("uhr"),
      el("a", { href: ankerLink(paar.thread, paar.antwort) }, el("span", { class: "kennung", text: id }),
        ` Nachzug laut ${paar.thread.nummer} · ${seitDauer(zeitPunkt(paar.antwort.zeit))}`)));
  }
  for (const a of auftraegeOffen()) {
    kis.push(el("li", {}, icon("code"),
      el("a", { href: ankerLink(a.paar.thread, a.paar.antwort) },
        a.punkt ? [el("span", { class: "kennung", text: a.punkt.id }), ` ${kuerzen(a.punkt.titel, 80)} (${a.paar.thread.nummer})`]
          : [el("span", { class: "kennung", text: a.paar.thread.nummer }), ` „${kuerzen(a.satz, 110)}“`])));
  }
  const knopf = (art, text, n, klasse) => {
    const b = el("button", {
      type: "button", class: `ball-knopf ${klasse}`, "aria-expanded": offen === art ? "true" : "false", "aria-controls": "ball-liste",
      "data-fokus": `ball:${art}`,
      onclick: () => {
        zustand.offen.set("ball", offen === art ? "" : art);
        mitFokus(() => lageZeichnen(meineAufgaben()), `ball:${art}`);
      },
    }, el("span", { class: "ball-text", text }), " ", el("span", { class: "ball-zahl", text: String(n) }));
    b.style.flexGrow = String(Math.max(1, n));
    return b;
  };
  const liste = offen === "dir" ? dir : offen === "kis" ? kis : null;
  return [
    el("div", { class: "ball", role: "group", "aria-label": "Wer ist am Zug" },
      knopf("dir", "Bei dir", dir.length, "dir"), knopf("kis", "Bei den KIs", kis.length, "kis")),
    liste ? el("ul", { class: "ball-liste", id: "ball-liste", "aria-label": offen === "dir" ? "Bei dir" : "Bei den KIs" },
      liste.length ? liste : el("li", { class: "hinweis", text: "Nichts offen." })) : null,
  ];
}
/* Feste Rollen, höchstens drei Zeilen: Termin, Zusage mit naher Frist, Hebel. */
function lageHinweise() {
  const zeilen = [];
  const termin = termineAktiv()[0];
  if (termin) {
    const g = zustand.roadmap ? flussGraph(zustand.roadmap) : null;
    const vor = g && termin.ms ? vorfahrenVon(g, termin.ms) : new Set();
    const offen = roadmapPunkte().filter(({ meilenstein, punkt }) => vor.has(meilenstein.id) && istBeiDir(punkt)).map(({ punkt }) => punkt.id);
    const quelle = termin.paar.wahl === "eigen" ? termin.paar.wahlText : termin.paar.angaben.Termin || termin.paar.zusatz;
    zeilen.push(el("li", { class: "hinweis-termin", "data-rolle": "termin", title: `aus ${termin.paar.antwort.sorte} ${termin.paar.thread.nummer}: „${kuerzen(quelle, 60)}“` },
      icon("uhr"),
      el("span", {},
        el("span", {}, `${kurzDatum(termin.tag)} · ${terminEtikett(termin)} (${termin.paar.thread.nummer}) · `),
        el("span", { class: "termin-rel", text: relativ(termin.tage) }),
        offen.length ? el("span", { class: "termin-vor" }, "bis dahin bei dir offen: ",
          offen.flatMap((id, i) => [i ? " · " : "", el("span", { class: "am-stueck", text: id })])) : null)));
  }
  const zusage = zusagenOffen().filter((z) => z.frist && tageBis(z.frist) <= 3).sort((a, b) => a.frist - b.frist)[0];
  if (zusage) {
    const t = zusage.paar.thread;
    zeilen.push(el("li", { class: "hinweis-zusage", "data-rolle": "zusage" },
      icon("notiz"),
      el("span", {},
        el("span", {}, `Deine Zusage aus ${t.nummer}: Ergebnis melden · bis ${kurzDatum(zusage.frist)} · `),
        el("span", { class: "termin-rel", text: relativ(tageBis(zusage.frist)) }),
        zusage.abgehakt ? el("span", { class: "termin-vor", text: `${zusage.abgehakt.id} ist schon abgehakt – das Ergebnis fehlt noch im Thread.` }) : null),
      el("button", { type: "button", class: "knopf zweit klein-knopf", "data-fokus": `zusage:${t.slug}`, onclick: () => ergebnisMelden(t) }, "Ergebnis melden")));
  }
  const besterHebel = [...hebelBeiDir(meineAufgaben().filter(({ punkt }) => istBeiDir(punkt))).values()].sort(hebelRang)[0];
  if (besterHebel && besterHebel.gibtFrei.length) {
    const st = graphStand(zustand.roadmap);
    const { punkt, ms, gibtFrei } = besterHebel;
    const art = punkt.wer === "betreiber" ? "eine Entscheidung" : "ein Handlauf";
    const wartet = st.vor.get(ms).filter((v) => !st.fertig(v))
      .map((v) => `${v}: ${st.zahl.get(v).offen.map((q) => `${q.id}, ${q.wer === "code" ? "KI" : "du"}`).join(" · ")}`);
    zeilen.push(el("li", { class: "hinweis-hebel", "data-rolle": "hebel", title: st.g.ausJson ? null : "Abhängigkeiten laut Forum-README" },
      icon("hebel"),
      el("span", {},
        el("b", { text: `Dein größter Hebel: ${punkt.id}` }),
        ` – ${art}. Schließt ${ms}; danach hängen ${aufzaehlen(gibtFrei)} nicht mehr an ${ms}.`,
        wartet.length ? el("span", { class: "termin-vor", text: `(${ms} wartet selbst noch auf ${wartet.join("; ")})` }) : null),
      el("button", { type: "button", class: "knopf zweit klein-knopf", "data-fokus": "hebel:hin", onclick: () => springenZu(`haken:${punkt.id}`) }, icon("pfeil"), "Hinspringen")));
  }
  return zeilen.length ? el("ul", { class: "lage-hinweise" }, zeilen) : null;
}
function antraegeZeichnen() {
  const antraege = antraegeOhneAntwort();
  if (!antraege.length) return null;
  return el("section", { class: "antraege", "aria-labelledby": "antraege-titel" },
    el("h3", { id: "antraege-titel" }, icon("threads"), "Anträge ohne Antwort"),
    el("ul", { class: "karte antraege-liste" }, antraege.map((a) =>
      el("li", { class: "antrag" },
        el("div", { class: "antrag-haupt" },
          el("div", { class: "antrag-kopf" }, el("span", { class: "kennung", text: a.thread.nummer }),
            ` · ${a.block.sorte} · ${a.block.ki}/${a.block.chat} · ${zeitLesbar(a.block.zeit)}`),
          el("p", { class: "antrag-zitat", text: `„${a.zitat}“` })),
        el("a", { class: "knopf zweit klein-knopf", href: ankerLink(a.thread, a.block) }, icon("pfeil"), "Im Thread antworten")))));
}

/* --- Dein Zug --- */

function meineAufgaben() {
  const offeneSlugs = new Set(offeneFragen().map((q) => q.thread.slug));
  const { nachzug } = beschluesse();
  return roadmapPunkte().filter(({ punkt }) => istMeins(punkt)
    && (punkt.status !== "x" || zustand.laufend.get(punkt.id) === "x")
    && !nachzug.has(punkt.id)
    && !(punkt.frage && offeneSlugs.has(punkt.frage)));
}

function zaehlerSetzen() {
  const fragen = offeneFragen().length;
  const aufgaben = meineAufgaben().length;
  const z = $("zaehler-zug");
  z.textContent = String(fragen + aufgaben);
  z.classList.toggle("heiss", fragen > 0);
  z.classList.toggle("leise", fragen + aufgaben === 0);
  $("zaehler-fragen").textContent = String(fragen);
  $("zaehler-fragen").classList.toggle("heiss", fragen > 0);
  $("zaehler-aufgaben").textContent = String(aufgaben);
  const alle = roadmapPunkte().map((x) => x.punkt);
  $("zaehler-roadmap").textContent = alle.length ? `${alle.filter((p) => p.status === "x").length}/${alle.length}` : "";
  $("zaehler-threads").textContent = String(zustand.threads.filter((t) => !t.geschlossen).length);
  document.title = fragen + aufgaben ? `(${fragen + aufgaben}) ${SEITENTITEL}` : SEITENTITEL;
  abzeichenSetzen(fragen + aufgaben);
  faviconSetzen(fragen > 0);
}

/* --- Als App: Zahl am Symbol (Taskleiste, Home-Bildschirm), Punkt im Favicon --- */

/* Zahl wie am Reiter. Nicht installiert oder nicht erlaubt: der Browser lehnt ab, still übergehen. */
function abzeichenSetzen(n) {
  if (!("setAppBadge" in navigator)) return;
  try { Promise.resolve(n ? navigator.setAppBadge(n) : navigator.clearAppBadge()).catch(() => {}); } catch (_) { /* gesperrt */ }
}

/* Das Logo aus index.html; bei offenen Fragen mit Punkt oben rechts. Die Farbe steht fest
 * (= --zug-voll hell), weil ein data-URL kein CSS kennt. href nur bei Wechsel setzen. */
const FAVICON = $("favicon") ? $("favicon").getAttribute("href") || "" : "";
let faviconPunkt = false;
function faviconSetzen(punkt) {
  const link = $("favicon");
  if (!link || !FAVICON.startsWith("data:image/svg+xml,") || punkt === faviconPunkt) return;
  faviconPunkt = punkt;
  if (!punkt) { link.setAttribute("href", FAVICON); return; }
  const svg = decodeURIComponent(FAVICON.slice(FAVICON.indexOf(",") + 1)).replace("</svg>",
    "<circle cx='25' cy='7' r='7' fill='#fff'/><circle cx='25' cy='7' r='6' fill='#b25e00'/></svg>");
  link.setAttribute("href", "data:image/svg+xml," + encodeURIComponent(svg));
}

/* „Als App installieren“: unter der Anmeldung und im Fuß (dort nur im Browser-Tab). */
function appHinweis() {
  return el("details", { class: "mehr app-hinweis" },
    el("summary", {}, icon("runter", "chevron"), "Als App installieren"),
    el("ul", { class: "app-schritte" },
      el("li", {}, el("b", { text: "iPhone: " }), "Teilen → „Zum Home-Bildschirm“. Die App hat einen eigenen Speicher: das Token dort einmal neu eingeben und „merken“ anhaken."),
      el("li", {}, el("b", { text: "Edge: " }), "Menü … → Apps → „Diese Website als App installieren“."),
      el("li", {}, el("b", { text: "Chrome: " }), "Menü → Streamen, speichern und teilen → „Seite als App installieren“.")));
}

function fragenZeichnen() {
  warnungZeichnen();
  const fragen = offeneFragen();
  const fl = $("fragen-liste");
  fl.replaceChildren();
  if (!fragen.length) fl.append(leer("ok", "Keine offene Frage.", "Die KIs fragen mit: python forum.py frage …"));
  for (const q of fragen) fl.append(frageKarte(q));
  const antraege = antraegeZeichnen();
  if (antraege) fl.append(antraege);
}

function zugRoadmapZeichnen() {
  neuZeichnen();
  const aufgaben = meineAufgaben();
  lageZeichnen(aufgaben);

  const al = $("aufgaben-liste");
  al.replaceChildren();
  if (!zustand.roadmap) al.append(leer("info", "Keine roadmap.json im Forum gefunden."));
  else if (!aufgaben.length) al.append(leer("ok", "Nichts offen, das bei dir liegt.", "Alles abgehakt. Neue Punkte erscheinen hier, sobald eine KI sie in roadmap.json einträgt."));
  else {
    const hebelMap = hebelBeiDir(aufgaben);
    const termine = terminePunkte();
    const nachWirkung = sortierung() === "wirkung";
    const knopf = (wert, text) => el("button", {
      type: "button", class: "knopf zweit klein-knopf", "aria-pressed": sortierung() === wert ? "true" : "false", "data-fokus": `sortierung:${wert}`,
      onclick: () => { sortierungSetzen(wert); mitFokus(zugRoadmapZeichnen, `sortierung:${wert}`); },
    }, text);
    al.append(el("div", { class: "sortierung", role: "group", "aria-label": "Sortierung" },
      el("span", { class: "sortierung-name", text: "Sortieren:" }), knopf("meilenstein", "nach Meilenstein"), knopf("wirkung", "nach Wirkung")));
    const karte = el("div", { class: "karte checkliste-karte", "data-hakenliste": "aufgaben" });
    if (nachWirkung) {
      // Wirkung zuerst; ein Termin steht nie unter Punkten ohne Wirkung.
      const gruppe = (a) => { const h = hebelMap.get(a.punkt.id); return h && (h.gibtFrei.length || h.schliesst) ? 2 : termine.has(a.punkt.id) ? 1 : 0; };
      const leer0 = { gibtFrei: [], schliesst: false, kritisch: false, ebene: 99 };
      const sortiert = [...aufgaben].sort((a, b) => gruppe(b) - gruppe(a)
        || hebelRang({ ...leer0, ...hebelMap.get(a.punkt.id), punkt: a.punkt }, { ...leer0, ...hebelMap.get(b.punkt.id), punkt: b.punkt }));
      karte.append(el("ul", { class: "checkliste" }, sortiert.map((a) => aufgabeZeile(a, { hebel: hebelMap.get(a.punkt.id), termin: termine.get(a.punkt.id), msZeigen: true }))));
    } else {
      let gruppe = null;
      let liste = null;
      for (const a of aufgaben) {
        if (a.meilenstein !== gruppe) {
          gruppe = a.meilenstein;
          karte.append(el("div", { class: "gruppe" }, el("span", { class: "gruppe-id", text: gruppe.id }), gruppe.titel));
          liste = el("ul", { class: "checkliste" });
          karte.append(liste);
        }
        liste.append(aufgabeZeile(a, { hebel: hebelMap.get(a.punkt.id), termin: termine.get(a.punkt.id) }));
      }
    }
    al.append(karte);
  }
  nachzugZeichnen();
  zuletztZeichnen();
}

function readyMarke() {
  const stand = readyStand();
  if (!stand.length) return null;
  const abhakbar = stand.filter((x) => x.abhakbar).length;
  return el("a", { class: "marke" + (abhakbar ? " zug" : " leise"), href: "#roadmap", title: "Ready-Stand in der Roadmap" },
    icon("ready"), `Ready ${stand.filter((x) => x.r.status === "x").length}/${stand.length}${abhakbar ? ` · ${abhakbar} abhakbar` : ""}`);
}

function lageZeichnen(aufgaben) {
  const box = $("zug-lage");
  box.replaceChildren();
  const rm = zustand.roadmap;
  if (!rm) { box.hidden = true; return; }
  box.hidden = false;
  const alle = roadmapPunkte().map((x) => x.punkt);
  const fertig = alle.filter((p) => p.status === "x").length;
  const anteil = alle.length ? fertig / alle.length : 0;
  const fragen = offeneFragen().length;
  const entscheidungen = aufgaben.filter((a) => a.punkt.wer === "betreiber").length;
  const handlaeufe = aufgaben.filter((a) => a.punkt.wer === "betrieb").length;
  const offenBeiDir = fragen + aufgaben.length;
  box.append(
    ringBox(anteil, `${fertig} von ${alle.length} Roadmap-Punkten fertig`),
    el("div", { class: "lage-text" },
      el("div", { class: "lage-ziel", text: rm.ziel || "Roadmap" }),
      el("div", { class: "lage-titel" }, offenBeiDir
        ? `${anzahl(offenBeiDir, "Punkt wartet", "Punkte warten")} auf dich`
        : "Bei dir ist gerade nichts offen."),
      el("div", { class: "lage-zeile" },
        el("span", { class: "marke" + (fragen ? " zug" : " leise") }, icon("rueckfrage"), anzahl(fragen, "Frage", "Fragen")),
        el("span", { class: "marke" + (entscheidungen ? " zug" : " leise") }, icon("entscheidung"), anzahl(entscheidungen, "Entscheidung", "Entscheidungen")),
        el("span", { class: "marke" + (handlaeufe ? " zug" : " leise") }, icon("handlauf"), anzahl(handlaeufe, "Handlauf", "Handläufe")),
        el("span", { class: "marke ok" }, icon("ok"), `${fertig}/${alle.length} fertig`),
        readyMarke()),
      ...ballZeichnen(aufgaben),
      lageHinweise(),
      rm.kritischer_pfad ? el("p", { class: "lage-pfad" }, icon("roadmap"), el("span", { text: rm.kritischer_pfad })) : null),
  );
}

const SORTIERUNG_SCHLUESSEL = "core-pult-sortierung";
function sortierung() {
  try { return localStorage.getItem(SORTIERUNG_SCHLUESSEL) === "wirkung" ? "wirkung" : "meilenstein"; } catch (_) { return "meilenstein"; }
}
function sortierungSetzen(wert) {
  try { if (wert === "wirkung") localStorage.setItem(SORTIERUNG_SCHLUESSEL, wert); else localStorage.removeItem(SORTIERUNG_SCHLUESSEL); } catch (_) { /* gesperrt */ }
}
/* Chip „schließt M1 · gibt 4 frei“ / „M4: danach noch 3 offen“ / Termin, mit vollem Satz für Screenreader. */
function wirkungChip(id, h, termin) {
  let chip = null;
  let satz = "";
  if (termin) {
    chip = el("span", { class: "marke zug" }, icon("uhr"), `Termin ${kurzDatum(termin.tag)}`);
    satz = `Termin ${langDatum(termin.tag)} (${termin.paar.thread.nummer}).`;
  } else if (h && h.schliesst) {
    chip = el("span", { class: "marke zug hebel-chip" }, icon("hebel"), `schließt ${h.ms}${h.gibtFrei.length ? ` · gibt ${h.gibtFrei.length} frei` : ""}`);
    satz = `Schließt ${h.ms}${h.gibtFrei.length ? ` und gibt ${aufzaehlen(h.gibtFrei)} frei` : ""}.`;
  } else if (h) {
    chip = el("span", { class: "marke leise hebel-chip" }, `${h.ms}: danach noch ${h.rest} offen`);
    satz = `${h.ms}: danach noch ${h.rest} offen.`;
  }
  return chip ? { chip, satz: el("span", { class: "sr-nur", id: `hebel-${id}`, text: satz }) } : null;
}

function aufgabeZeile({ punkt, meilenstein }, wirkung = {}) {
  const id = punkt.id;
  const status = anzeigeStatus(punkt);
  const notizSchluessel = `notiz:${id}`;
  const feldSchluessel = `notizfeld:${id}`;
  const notizOffen = zustand.offen.has(feldSchluessel) ? zustand.offen.get(feldSchluessel) : !!entwurf(notizSchluessel);
  const verweis = punkt.frage || punkt.thread;
  const t = verweis ? threadZuSlug(verweis) : null;

  let notizFeld = null;
  if (notizOffen) {
    notizFeld = el("textarea", {
      class: "notiz-feld", rows: 2, "data-fokus": `notiztext:${id}`, "aria-label": `Notiz zu ${id}`,
      placeholder: "Was wurde gemacht, Datum, Protokoll-Pfad … (optional, geht beim Abhaken mit)",
    });
    notizFeld.value = entwurf(notizSchluessel);
    notizFeld.addEventListener("input", () => entwurfSetzen(notizSchluessel, notizFeld.value));
  }
  const notizKnopf = el("button", {
    type: "button", class: "knopf-icon klein" + (notizOffen ? " an" : ""),
    "aria-expanded": notizOffen ? "true" : "false", "aria-label": `Notiz zu ${id}`,
    title: "Notiz, die beim Abhaken mitgeschrieben wird", "data-fokus": `notizknopf:${id}`,
    onclick: () => {
      zustand.offen.set(feldSchluessel, !notizOffen);
      roadmapTeileZeichnen(notizOffen ? `notizknopf:${id}` : `notiztext:${id}`);
    },
  }, icon("notiz"));

  const chip = status === "x" ? null : wirkungChip(id, wirkung.hebel, wirkung.termin);
  const haken = hakenKnopf(punkt, "punkt");
  if (chip) haken.setAttribute("aria-describedby", `hebel-${id}`);
  return el("li", { class: "aufgabe" + (status === "x" ? " ist-fertig" : ""), "data-zeile": id },
    haken,
    el("div", { class: "aufgabe-haupt" },
      el("div", { class: "aufgabe-titel" },
        wirkung.msZeigen && meilenstein ? el("span", { class: "gruppe-id", text: meilenstein.id }) : null,
        wirkung.msZeigen && meilenstein ? " " : null,
        el("span", { class: "kennung", text: id }), " ", punkt.titel),
      chip ? chip.satz : null,
      punkt.notiz ? el("p", { class: "aufgabe-notiz", text: punkt.notiz }) : null,
      t ? threadVerweis(t) : null,
      notizFeld),
    el("div", { class: "aufgabe-rechts" },
      punkt.status === "~" ? el("span", { class: "marke teil", text: "teilweise" }) : null,
      chip ? chip.chip : null,
      werMarke(punkt.wer, false),
      notizKnopf),
  );
}

function zuletztZeichnen() {
  const box = $("zuletzt-box");
  box.replaceChildren();
  const fertige = roadmapPunkte()
    .filter(({ punkt }) => istMeins(punkt) && punkt.status === "x" && punkt.erledigt && zustand.laufend.get(punkt.id) !== "x")
    .sort((a, b) => String(b.punkt.erledigt).localeCompare(String(a.punkt.erledigt)))
    .slice(0, 12);
  if (!fertige.length) return;
  const details = el("details", { class: "karte zuletzt" },
    el("summary", {}, icon("ok", "zuletzt-ic"), el("span", { text: "Zuletzt erledigt" }),
      el("span", { class: "zaehler leise", text: String(fertige.length) }), icon("runter", "chevron")),
    el("ul", { class: "checkliste", "data-hakenliste": "zuletzt" }, fertige.map(({ meilenstein, punkt }) =>
      el("li", { class: "aufgabe ist-fertig" + (anzeigeStatus(punkt) === "x" ? "" : " wird-offen"), "data-zeile": punkt.id },
        hakenKnopf(punkt, "punkt"),
        el("div", { class: "aufgabe-haupt" },
          el("div", { class: "aufgabe-titel" }, el("span", { class: "kennung", text: punkt.id }), " ", punkt.titel),
          el("p", { class: "aufgabe-notiz" }, icon("uhr"),
            ` ${datumLesbar(punkt.erledigt)}${punkt.von ? " · " + punkt.von : ""} · ${meilenstein.id} ${meilenstein.titel}`)),
        el("div", { class: "aufgabe-rechts" }, werMarke(punkt.wer, true))))));
  box.append(aufklappen(details, "zuletzt", false));
}

/* --- Wächter beim Anhängen ---
 * Das Forum ist anhängend und wird von KIs dreier Anbieter gelesen; Git vergisst nichts.
 * Vor jedem eigenen Text: Geheimnis-Muster prüfen und nachfragen. Ein Fund ist ein Verdacht,
 * kein Beweis: „Trotzdem senden“ bleibt immer möglich. */
const GEHEIM_MUSTER = [
  { name: "GitHub-Token", re: /\b(github_pat_[A-Za-z0-9_]{20,})/g },
  { name: "GitHub-Token", re: /\b(gh[pousr]_[A-Za-z0-9]{30,})/g },
  { name: "Anthropic-Schlüssel", re: /\b(sk-ant-[A-Za-z0-9_-]{16,})/g },
  { name: "Google-API-Schlüssel", re: /\b(AIza[0-9A-Za-z_-]{30,})/g },
  { name: "Google-API-Schlüssel", re: /\b(AQ\.[0-9A-Za-z_-]{20,})/g },
  { name: "Server-Token", re: /\bBSVP_[A-Z_]*(?:TOKEN|KEY)\s*=\s*(\S+)/g },
  { name: "Zugangscode", re: /\b(PE\d{2},\d{2})\b/g },
  // Stichwort + Wert mit Ziffer: trifft „pin ab1234“, nicht „PIN vor dem Beta-Start“
  { name: "PIN/Passwort", re: /\b(?:pin|passwort|kennwort|password|token|geheimnis|schl(?:ü|ue)ssel|key)\b[ \t]*[:=]?[ \t]*(\S{4,})/gi, wert: true },
];
const ERSATZ = "‹gesetzt, Wert nicht im Forum›";

/* Fundstellen [{start, ende, wert, name}] – markiert wird immer nur der Wert. */
function geheimnisFinden(text) {
  const t = String(text || "");
  const funde = [];
  const dazu = (start, wert, name) => {
    const ende = start + wert.length;
    if (!funde.some((f) => start < f.ende && ende > f.start)) funde.push({ start, ende, wert, name });
  };
  if (zustand.token && zustand.token.length >= 8) {
    for (let i = t.indexOf(zustand.token); i >= 0; i = t.indexOf(zustand.token, i + 1)) dazu(i, zustand.token, "dein GitHub-Token");
  }
  for (const { name, re, wert: nurMitZiffer } of GEHEIM_MUSTER) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(t))) {
      let w = m[1];
      const start = m.index + m[0].length - w.length;
      w = w.replace(/[.,;:!?)»“"']+$/, "");
      if (w.length < 4 || w === ERSATZ || w.includes("‹")) continue;
      if (nurMitZiffer) {
        if (!/\d/.test(w)) continue;
        if (/^\d{4}-\d{2}-\d{2}/.test(w) || /^v?\d+(\.\d+)+$/i.test(w) || /^#\d+/.test(w)) continue;
      }
      dazu(start, w, name);
    }
  }
  return funde.sort((a, b) => a.start - b.start);
}
const maskiert = (wert) => `${String(wert).slice(0, 2)}••••`;
function geheimnisseErsetzen(text, funde) {
  let aus = String(text);
  for (const f of [...funde].sort((a, b) => b.start - a.start)) aus = aus.slice(0, f.start) + ERSATZ + aus.slice(f.ende);
  return aus;
}

function waechterDialog(funde) {
  return new Promise((fertig) => {
    const dialog = $("waechter");
    const ersetzen = el("button", { type: "submit", value: "ersetzen", class: "knopf", autofocus: true }, icon("schild"), "Wert ersetzen");
    dialog.replaceChildren(el("form", { method: "dialog", class: "dialog-inhalt" },
      el("div", { class: "dialog-kopf" }, el("span", { class: "dialog-ic", "aria-hidden": "true" }, icon("schild")),
        el("h2", { id: "waechter-titel", text: "Sieht nach einem Geheimnis aus" })),
      el("p", { text: "Das Forum lesen KIs von drei Anbietern, und Git vergisst nichts. Was angehängt ist, lässt sich nicht mehr entfernen." }),
      el("ul", { class: "dialog-funde" }, funde.map((f) => el("li", {}, el("b", { text: `${f.name}: ` }), el("code", { text: maskiert(f.wert) })))),
      el("div", { class: "dialog-knoepfe" },
        el("button", { type: "submit", value: "senden", class: "knopf zweit" }, "Trotzdem senden"),
        el("button", { type: "submit", value: "bearbeiten", class: "knopf zweit" }, icon("notiz"), "Bearbeiten"),
        ersetzen)));
    dialog.returnValue = "";
    const zu = () => { dialog.removeEventListener("close", zu); fertig(dialog.returnValue || "bearbeiten"); };
    dialog.addEventListener("close", zu);
    dialog.showModal();
    ersetzen.focus();
  });
}

/* felder: [{el, entwurf}] · knopf: bekommt den Fokus nach „Wert ersetzen“. 'senden' | 'abbrechen' */
async function pruefeVorSenden(felder, knopf) {
  const funde = [];
  for (const feld of felder) if (feld.el) for (const f of geheimnisFinden(feld.el.value)) funde.push({ ...f, feld });
  if (!funde.length) return "senden";
  const dialog = $("waechter");
  if (!dialog || typeof dialog.showModal !== "function") {
    return window.confirm(`Sieht nach einem Geheimnis aus (${funde.map((f) => maskiert(f.wert)).join(", ")}). Das Forum lesen alle KIs. Trotzdem senden?`) ? "senden" : "abbrechen";
  }
  const wahl = await waechterDialog(funde);
  if (wahl === "senden") return "senden";
  if (wahl === "ersetzen") {
    for (const feld of felder) {
      const eigene = funde.filter((f) => f.feld === feld);
      if (!eigene.length) continue;
      feld.el.value = geheimnisseErsetzen(feld.el.value, eigene);
      if (feld.entwurf) entwurfSetzen(feld.entwurf, feld.el.value);
    }
    if (knopf) knopf.focus();
    melden("Ersetzt. Prüfen und noch einmal senden.");
    return "abbrechen";
  }
  const erster = funde[0];
  erster.feld.el.focus();
  try { erster.feld.el.setSelectionRange(erster.start, erster.ende); } catch (_) { /* Feldart ohne Auswahl */ }
  return "abbrechen";
}

/* Altlast: was schon in eigenen Beiträgen oder Notizen steht. Nur maskiert zeigen; löschen
 * kann das Pult nichts (anhängend, Git-Historie) – ehrlich bleibt nur: Wert wechseln. */
const ALTLAST_SCHLUESSEL = `core-pult-altlast:${ZWEIG}`;
function altlastQuittiert() {
  try { const a = JSON.parse(localStorage.getItem(ALTLAST_SCHLUESSEL) || "[]"); return new Set(Array.isArray(a) ? a : []); } catch (_) { return new Set(); }
}
function altlastQuittieren(schluessel) {
  const neu = altlastQuittiert();
  neu.add(schluessel);
  try { localStorage.setItem(ALTLAST_SCHLUESSEL, JSON.stringify([...neu])); } catch (_) { /* gesperrt */ }
  mitFokus(warnungZeichnen, "zug-waechter-titel");
  melden("Gemerkt. Dieser Hinweis kommt nicht wieder.");
}
function warnungZeichnen() {
  const box = $("zug-waechter");
  box.replaceChildren();
  const ok = altlastQuittiert();
  const funde = [];
  for (const t of zustand.threads) {
    const anker = blockAnker(t);
    for (const b of t.bloecke) {
      const schl = `${t.slug}|${b.zeit}`;
      if (b.ki !== ICH.ki || ok.has(schl)) continue;
      const f = geheimnisFinden(b.text);
      if (f.length) funde.push({ schl, titel: `${t.nummer} · ${b.sorte} · ${zeitLesbar(b.zeit)}`, href: `#t/${encodeURIComponent(t.slug)}~${anker.get(b)}`, f });
    }
  }
  for (const { punkt } of roadmapPunkte()) {
    const schl = `roadmap|${punkt.id}`;
    if (!punkt.notiz || ok.has(schl)) continue;
    const f = geheimnisFinden(punkt.notiz);
    if (f.length) funde.push({ schl, titel: `roadmap.json · ${punkt.id} · Notiz`, href: "#roadmap", f });
  }
  if (!funde.length) { box.hidden = true; return; }
  box.hidden = false;
  box.append(
    el("div", { class: "neu-kopf" },
      el("span", { class: "warn-ic", "aria-hidden": "true" }, icon("warnung")),
      el("div", { class: "neu-kopf-text" },
        el("h2", { id: "zug-waechter-titel", tabindex: "-1", "data-fokus": "zug-waechter-titel", text: "Vermutlich ein Geheimnis im Forum" }),
        el("p", { class: "hinweis", text: "Löschen kann das Pult nichts: Die Datei ist anhängend, und Git behält jede Fassung. Sicher ist nur, den Wert zu ändern. Beim PIN: Server-Fenster → Zugang → PIN neu setzen." }))),
    el("ul", { class: "neu-liste" }, funde.map((x) => el("li", { class: "waechter-zeile" }, icon("schild", "neu-ic"),
      el("a", { class: "neu-text", href: x.href },
        el("span", { class: "neu-titel", text: x.titel }),
        el("span", { class: "neu-zusatz", text: x.f.map((g) => `${g.name} „${maskiert(g.wert)}“`).join(", ") })),
      el("span", { class: "waechter-knoepfe" },
        el("button", { type: "button", class: "knopf zweit klein-knopf", onclick: () => altlastQuittieren(x.schl) }, icon("haken"), "Wert ist geändert"),
        el("button", { type: "button", class: "knopf zweit klein-knopf", onclick: () => altlastQuittieren(x.schl) }, "Kein Geheimnis"))))),
  );
}

/* --- Angaben „im Feld“: echte, typisierte Felder statt Freitext --- */
const ANGABE = {
  pfad: { etikett: "Pfad (UNC oder Laufwerk, z. B. \\\\nas\\bsvp)", kurz: "Pfad", zeile: "Pfad" },
  datum: { etikett: "Datum", kurz: "Datum", zeile: "Termin" },
  zahl: { etikett: "Anzahl", kurz: "Anzahl", zeile: "Anzahl" },
  text: { etikett: "Angabe", kurz: "Angabe", zeile: "Angabe" },
};
function angabeArt(text) {
  const t = String(text || "");
  if (!/im Feld/i.test(t)) return null;
  if (/\b(Datum|Termin|Tag)\b/i.test(t)) return "datum";
  if (/UNC-Pfad|Pfad|Laufwerk|Ordner|Freigabe/i.test(t)) return "pfad";
  if (/\b(Anzahl|Zahl)\b/i.test(t)) return "zahl";
  return "text";
}
/* {art, pflicht, optional} für eine Wahl ('A' …, 'eigen' oder '') oder null */
function angabeFuer(f, wahl) {
  const v = f.vorschlaege.find((x) => x.buchstabe === wahl);
  const ausVorschlag = v ? angabeArt(v.text) : null;
  const art = ausVorschlag || angabeArt(`${f.kontext}\n${f.frage}`);
  if (art) return { art, pflicht: !!v };
  if (/^Wann\b/i.test(f.frage)) return { art: "datum", pflicht: false, termin: true };
  return null;
}
function angabeFeld(a, schluessel, fokus) {
  const art = a.art;
  const attrs = { id: fokus, "data-fokus": fokus, name: "angabe" };
  let feld;
  if (art === "datum") feld = el("input", { ...attrs, type: "date" });
  else if (art === "pfad") feld = el("input", { ...attrs, type: "text", class: "mono", autocapitalize: "off", autocorrect: "off", spellcheck: "false", placeholder: "\\\\server\\freigabe oder E:\\…" });
  else if (art === "zahl") feld = el("input", { ...attrs, type: "text", inputmode: "numeric", pattern: "[0-9]*" });
  else feld = el("input", { ...attrs, type: "text" });
  feld.value = entwurf(schluessel);
  feld.addEventListener("input", () => entwurfSetzen(schluessel, feld.value));
  const etikett = a.termin ? "Termin (optional)" : ANGABE[art].etikett + (a.pflicht ? "" : " (optional)");
  return { feld, label: el("label", { for: fokus, text: etikett }) };
}
const pfadSiehtAus = (w) => /^\\\\[^\\\s]+\\\S/.test(w) || /^[A-Za-z]:\\/.test(w) || /^\//.test(w);
/* Fehlertext oder "" – wert ist getrimmt */
function angabeFehler(a, wert) {
  if (!wert) return a.pflicht ? `Die Frage bittet um eine Angabe im Feld: ${ANGABE[a.art].kurz}.` : "";
  if (a.art === "zahl" && !/^\d{1,4}$/.test(wert)) return "Anzahl bitte als Zahl (z. B. 4).";
  if (a.art === "datum" && !/^\d{4}-\d{2}-\d{2}$/.test(wert)) return "Datum bitte vollständig wählen.";
  return "";
}

/* „Zu FRAGE [ki/chat] zeit“ → die FRAGE im selben Thread */
function frageZuAntwort(t, b) {
  const m = /^Zu FRAGE \[([a-z0-9_-]+)\/([a-z0-9_-]+)\] (\S+)$/.exec(String(b.text).split("\n")[0]);
  if (!m) return null;
  return t.bloecke.find((x) => x.sorte === "FRAGE" && x.ki === m[1] && x.chat === m[2] && x.zeit === m[3]) || null;
}
/* Beschlüsse ohne die verlangte Angabe (heute 057: Pfad, 059: Anzahl) */
function angabenFehlen(t) {
  const aus = [];
  const letzte = new Map();
  for (const b of t.bloecke) {
    if (b.ki !== ICH.ki || (b.sorte !== "ANTWORT" && b.sorte !== "BESCHLUSS")) continue;
    const frage = frageZuAntwort(t, b);
    if (frage) letzte.set(frage, b);
  }
  for (const [frage, b] of letzte) {
    if (/^(Pfad|Termin|Anzahl|Angabe): /m.test(b.text)) continue;
    const wahlZeile = (String(b.text).split("\n").find((z) => z.startsWith("Wahl: ")) || "");
    const m = /^Wahl: Vorschlag ([A-Z]):/.exec(wahlZeile);
    const a = angabeFuer(frageParsen(frage), m ? m[1] : "eigen");
    if (a && a.pflicht) aus.push({ b, frage, a, wahlZeile, bezug: String(b.text).split("\n")[0] });
  }
  return aus;
}
function angabenFehltZeichnen(t, anker) {
  for (const x of angabenFehlen(t)) {
    const a = anker.get(x.b);
    const ziel = document.getElementById(`anker-${a}`);
    if (!ziel) continue;
    const schl = `nachreichen:${t.slug}:${a}`;
    const quelle = `nachreichen:${a}`;
    const { feld, label } = angabeFeld(x.a, `${schl}:angabe`, `${schl}:feld`);
    const knopf = el("button", { type: "submit", class: "knopf", "data-fokus": `${schl}:senden`, "aria-keyshortcuts": "Control+Enter Meta+Enter", title: "Senden (Strg+Enter)" }, icon("senden"), "Nachreichen");
    const form = el("form", { class: "karte angabe-fehlt", "data-quelle": quelle, novalidate: true },
      el("p", {}, icon("warnung"), el("b", { text: ` Angabe fehlt: ${ANGABE[x.a.art].kurz}.` }), " Ohne sie kann die KI nicht weitermachen."),
      el("div", { class: "angabe" }, label, feld),
      atempauseZeile(t.pfad, quelle),
      el("div", { class: "antwort-knoepfe" }, knopf));
    tastenSenden(form, [feld], t.pfad, quelle);
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (zustand.wartet.has(t.pfad)) { atempauseJetzt(t.pfad); return; }
      const wert = feld.value.trim();
      const fehler = angabeFehler(x.a, wert) || (!wert ? `Die Frage bittet um eine Angabe im Feld: ${ANGABE[x.a.art].kurz}.` : "");
      if (fehler) { melden(fehler, true); feld.focus(); return; }
      if ((await pruefeVorSenden([{ el: feld, entwurf: `${schl}:angabe` }], knopf)) !== "senden") return;
      const text = `${x.bezug}\n${x.wahlZeile}\n${ANGABE[x.a.art].zeile}: ${feld.value.trim()}\n\nNachtrag: Angabe nachgereicht.`;
      atempauseStarten(t.pfad, {
        sorte: x.b.sorte, nummer: t.nummer, slug: t.slug, quelle, fokus: `${schl}:senden`,
        knoepfe: [knopf],
        arbeit: async () => {
          const r = await anhaengen(t.pfad, x.b.sorte, text, `${t.slug}: ${x.b.sorte} [${ICH.ki}/${ICH.chat}]`);
          return () => {
            entwuerfeLoeschen(schl + ":");
            threadErsetzen(t.pfad, r.text, r.sha);
            melden(`Angabe in ${t.nummer} nachgereicht.`);
          };
        },
      });
    });
    sperrenWennSchreibt(t.pfad, [knopf]);
    ziel.after(form);
  }
}

/* --- Atempause: 5 s zwischen Klick und Anhängen, mit Rückgängig ---
 * Anhängen ist endgültig. Haken in roadmap.json brauchen das nicht, sie haben Rückgängig. */
const ATEMPAUSE_MS = 5000;
const NICHT_GESENDET = "core-pult-nicht-gesendet";

function atempauseRest(pfad) {
  const w = zustand.wartet.get(pfad);
  return w ? Math.max(0, Math.ceil((w.bis - Date.now()) / 1000)) : 0;
}
/* Statuszeile in der Karte, die den Anhang ausgelöst hat; überlebt jedes Neuzeichnen. */
function atempauseZeile(pfad, quelle) {
  const w = zustand.wartet.get(pfad);
  if (!w || w.quelle !== quelle) return null;
  return el("p", { class: "atempause", role: "status" },
    el("span", {}, `${w.sorte} an ${w.nummer} geht in `),
    el("span", { class: "atempause-sek", "data-pfad": pfad, "aria-hidden": "true", text: String(atempauseRest(pfad)) }),
    el("span", { class: "sr-nur", text: "5" }),
    el("span", { text: " s raus." }),
    el("span", { class: "atempause-knoepfe" },
      el("button", { type: "button", class: "knopf zweit klein-knopf", "data-fokus": `wartet-rueck:${pfad}`, onclick: () => atempauseAbbrechen(pfad) }, icon("undo"), "Rückgängig"),
      el("button", { type: "button", class: "knopf klein-knopf", "data-fokus": `wartet-jetzt:${pfad}`, onclick: () => atempauseJetzt(pfad) }, icon("senden"), "Jetzt senden")));
}
function atempauseStarten(pfad, info) {
  if (zustand.wartet.has(pfad) || zustand.schreibt.has(pfad)) return;
  const w = { ...info, bis: Date.now() + ATEMPAUSE_MS };
  w.timer = setTimeout(() => atempauseJetzt(pfad), ATEMPAUSE_MS);
  w.takt = setInterval(() => {
    for (const s of document.querySelectorAll(".atempause-sek")) if (s.dataset.pfad === pfad) s.textContent = String(atempauseRest(pfad));
  }, 250);
  zustand.wartet.set(pfad, w);
  allesZeichnenMitFokus(`wartet-rueck:${pfad}`);
  melden(`${w.sorte} an ${w.nummer} wird in 5 s angehängt.`, { aktion: { text: "Rückgängig", label: `${w.sorte} an ${w.nummer} nicht senden`, tun: () => atempauseAbbrechen(pfad) } });
}
function atempauseAufloesen(pfad) {
  const w = zustand.wartet.get(pfad);
  if (!w) return null;
  clearTimeout(w.timer);
  clearInterval(w.takt);
  zustand.wartet.delete(pfad);
  return w;
}
function atempauseAbbrechen(pfad, still) {
  const w = atempauseAufloesen(pfad);
  if (!w) return;
  allesZeichnenMitFokus(w.fokus);
  if (!still) melden("Nicht gesendet. Der Entwurf bleibt.", { fokus: w.fokus });
}
function atempauseJetzt(pfad) {
  const w = atempauseAufloesen(pfad);
  if (!w) return;
  if (!$("meldung").hidden && /angehängt/.test($("meldung").textContent)) meldungZu();
  threadSchreiben(pfad, w.knoepfe || [], w.arbeit);
  allesZeichnen();
}
/* Seite verdeckt: nichts halb senden (iOS schneidet Lesen+Schreiben ab). Abbrechen ist der sichere Fehler. */
function atempausenVerwerfen() {
  if (!zustand.wartet.size) return;
  const liste = [];
  for (const pfad of [...zustand.wartet.keys()]) {
    const w = atempauseAufloesen(pfad);
    liste.push({ slug: w.slug, nummer: w.nummer, sorte: w.sorte, quelle: w.quelle, fokus: w.fokus });
  }
  try { sessionStorage.setItem(NICHT_GESENDET, JSON.stringify(liste)); } catch (_) { /* gesperrt */ }
  allesZeichnen();
}
function nichtGesendetMelden() {
  let liste = [];
  try { liste = JSON.parse(sessionStorage.getItem(NICHT_GESENDET) || "[]"); sessionStorage.removeItem(NICHT_GESENDET); } catch (_) { liste = []; }
  if (!Array.isArray(liste) || !liste.length) return;
  const w = liste[0];
  melden(`${w.sorte} an ${w.nummer} nicht gesendet (Seite war verdeckt). Der Entwurf liegt in der Karte.`, {
    fehler: true,
    aktion: {
      text: "Zur Karte", icon: "pfeil",
      tun: () => {
        location.hash = String(w.quelle).startsWith("frage:") ? "#zug" : `#t/${encodeURIComponent(w.slug)}`;
        route();
        const k = sichtbarFinden(w.fokus);
        if (k) { k.scrollIntoView({ block: "center" }); k.focus(); }
      },
    },
  });
}
function allesZeichnenMitFokus(gewuenscht) {
  mitFokus(() => {
    kopfSetzen();
    fragenZeichnen();
    zugRoadmapZeichnen();
    roadmapZeichnen();
    threadListeZeichnen();
    zaehlerSetzen();
    route();
  }, gewuenscht);
}

/* Strg/⌘+Enter in Textfeldern sendet; während der Atempause heißt es „Jetzt senden“. */
function tastenSenden(form, felder, pfad, quelle) {
  for (const f of felder) {
    f.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" || !(e.ctrlKey || e.metaKey) || e.isComposing) return;
      e.preventDefault();
      const w = zustand.wartet.get(pfad);
      if (w && w.quelle === quelle) { atempauseJetzt(pfad); return; }
      if (typeof form.requestSubmit === "function") form.requestSubmit();
      else { const k = form.querySelector("button[type=submit]"); if (k) k.click(); }
    });
  }
  form.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    const w = zustand.wartet.get(pfad);
    if (w && w.quelle === quelle) { e.stopPropagation(); atempauseAbbrechen(pfad); }
  });
}

/* --- Seit deinem letzten Besuch --- */

/* Gemerkt wird nur der Commit (und wann), nie Inhalt. Je Gerät/Browser ein eigener Stempel. */
const GESEHEN_SCHLUESSEL = `core-pult-gesehen:${ZWEIG}`;
function gesehenLesen() {
  try {
    const g = JSON.parse(localStorage.getItem(GESEHEN_SCHLUESSEL) || "null");
    return g && typeof g.sha === "string" && /^[0-9a-f]{40}$/.test(g.sha) ? g : null;
  } catch (_) { return null; }
}
function gesehenSetzen(sha) {
  if (!sha) return;
  try { localStorage.setItem(GESEHEN_SCHLUESSEL, JSON.stringify({ sha, zeit: new Date().toISOString() })); } catch (_) { /* gesperrt */ }
}

const EIGENE_MARKE = `[${ICH.ki}/${ICH.chat}]`;

/* Ein Commit in lesbarer Form. Die Nachrichten sind dank forum.py und Pult schon strukturiert:
 *   „037-arbeitsteilung…: ANTRAG [grok/lesart-029]“, „054: BEFUND Altzweige … [claude/x]“,
 *   „roadmap: M4-V19 erledigt [betreiber/dashboard]“, „Gate: grok/lesart-029“. */
function commitLesen(c, threads) {
  const nachricht = String((c.commit && c.commit.message) || "").split("\n")[0].trim();
  const autor = (c.commit && c.commit.author && c.commit.author.name) || "";
  const zeit = (c.commit && c.commit.author && c.commit.author.date) || "";
  const eigen = nachricht.endsWith(EIGENE_MARKE) || nachricht === `Gate: ${ICH.ki}/${ICH.chat}`;
  let m;
  if ((m = /^roadmap: (\S+) /.exec(nachricht))) return { art: "roadmap", id: m[1], eigen, nachricht, zeit };
  if ((m = /^(\d{3})[a-z0-9-]*: ([A-Z]+)\b ?(.*?)\s*\[([a-z0-9_-]+)\/([a-z0-9_-]+)\]$/.exec(nachricht)) && SORTEN.includes(m[2])) {
    const thread = threads.find((t) => t.nummer === m[1]) || null;
    return { art: "beitrag", nummer: m[1], sorte: m[2], zusatz: m[3], wer: `${m[4]}/${m[5]}`, thread, eigen, zeit };
  }
  if ((m = /^Gate: ([a-z0-9_-]+\/[a-z0-9_-]+)$/.exec(nachricht))) return { art: "gate", wer: m[1], eigen, zeit };
  return { art: "sonst", text: nachricht, wer: autor, eigen, zeit };
}

/* Punkte, Ready und Stand id-genau vergleichen. ausnehmen: IDs, die der Betreiber selbst geändert hat. */
function roadmapUnterschiede(altRoh, neuRoh, ausnehmen) {
  const alt = roadmapSauber(altRoh);
  const neu = roadmapSauber(neuRoh);
  if (!alt || !neu) return [];
  const karte = (rm) => {
    const k = new Map();
    for (const ms of rm.meilensteine) for (const p of ms.punkte) k.set(p.id, { p, ms: ms.id });
    for (const r of rm.ready) k.set(r.id, { p: r, ms: "Ready" });
    return k;
  };
  const ka = karte(alt);
  const kn = karte(neu);
  const aus = [];
  if (alt.stand !== neu.stand) aus.push({ art: "stand", von: alt.stand, nach: neu.stand });
  for (const [id, { p, ms }] of kn) {
    if (ausnehmen.has(id)) continue;
    const vor = ka.get(id);
    if (!vor) aus.push({ art: "punkt-neu", id, titel: p.titel, ms });
    else if (vor.p.status !== p.status) aus.push({ art: "status", id, titel: p.titel, von: vor.p.status, nach: p.status, wer: p.von, ms });
    else if (p.wer !== undefined && vor.p.wer !== p.wer) aus.push({ art: "wer", id, titel: p.titel, von: vor.p.wer, nach: p.wer, ms });
    else if (p.fehlt !== undefined && vor.p.fehlt !== p.fehlt) aus.push({ art: "fehlt", id, titel: p.titel, fehlt: p.fehlt, ms });
  }
  for (const [id, { p, ms }] of ka) if (!kn.has(id) && !ausnehmen.has(id)) aus.push({ art: "punkt-weg", id, titel: p.titel, ms });
  return aus;
}

async function neuesErmitteln(kopf, threads, roadmapJetzt) {
  const g = gesehenLesen();
  if (!g) { gesehenSetzen(kopf); return { erstesMal: true, seit: null, eintraege: [], roadmap: [], pfade: new Set() }; }
  if (g.sha === kopf) return { seit: g, eintraege: [], roadmap: [], pfade: new Set() };
  let vergleich;
  try {
    vergleich = await gh(`/compare/${g.sha}...${kopf}`);
  } catch (e) {
    // Alter Commit unbekannt (Force-Push o. ä.): Stempel still neu setzen.
    if (e instanceof GitHubFehler && (e.status === 404 || e.status === 422)) { gesehenSetzen(kopf); return null; }
    throw e;
  }
  const commits = (vergleich.commits || []).map((c) => commitLesen(c, threads));
  const eigeneIds = new Set(commits.filter((c) => c.art === "roadmap" && c.eigen).map((c) => c.id));
  const fremd = commits.filter((c) => !c.eigen);
  // Beiträge je Thread und Sorte bündeln: „029: 2× FRAGE von grok/lesart-029“
  const eintraege = [];
  const buendel = new Map();
  for (const c of fremd) {
    if (c.art === "roadmap") continue;
    if (c.art === "beitrag") {
      const k = `${c.nummer}|${c.sorte}|${c.wer}`;
      if (buendel.has(k)) { buendel.get(k).anzahl++; buendel.get(k).zeit = c.zeit; continue; }
      const e = { ...c, anzahl: 1 };
      buendel.set(k, e);
      eintraege.push(e);
    } else {
      eintraege.push(c);
    }
  }
  const pfade = new Set(eintraege.filter((e) => e.thread).map((e) => e.thread.pfad));
  let roadmap = [];
  const dateien = (vergleich.files || []).map((f) => f.filename);
  if (dateien.includes("roadmap.json") && roadmapJetzt && fremd.length) {
    try {
      const alt = JSON.parse((await dateiLesen("roadmap.json", g.sha)).text);
      roadmap = roadmapUnterschiede(alt, roadmapJetzt, eigeneIds);
    } catch (_) {
      roadmap = [{ art: "geaendert" }];
    }
  }
  return {
    seit: g, eintraege, roadmap, pfade,
    mehr: (vergleich.total_commits || 0) > (vergleich.commits || []).length,
  };
}

function seitWann(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return "";
  const min = Math.round((Date.now() - d.getTime()) / 60000);
  if (min < 2) return "gerade eben";
  if (min < 60) return `vor ${min} Min.`;
  const std = Math.round(min / 60);
  if (std < 24) return `vor ${std} Std.`;
  const tage = Math.round(std / 24);
  return tage < 7 ? `vor ${tage} ${tage === 1 ? "Tag" : "Tagen"}` : `seit ${d.toLocaleDateString("de-DE")}`;
}

/* Ein Block ist „neu“, wenn er nach dem Stempel kam und nicht vom Betreiber stammt.
 * Blockzeiten kommen von der Uhr der KI – reicht zum Markieren, nicht zum Rechnen. */
function istNeuerBlock(b) {
  const seit = zustand.neu && zustand.neu.seit;
  if (!seit || b.ki === ICH.ki) return false;
  const t = new Date(String(b.zeit).replace(/Z$/, ":00Z")).getTime();
  return !isNaN(t) && t > new Date(seit.zeit).getTime();
}
function threadIstNeu(t) {
  return !!(zustand.neu && zustand.neu.seit) && (zustand.neu.pfade.has(t.pfad) || t.bloecke.some(istNeuerBlock));
}
function meilensteinIstNeu(id) {
  return !!(zustand.neu && zustand.neu.roadmap.some((r) => r.ms === id));
}

const STATUS_WORT = { x: "erledigt", "~": "teilweise", ".": "offen" };

function neuZeile(e) {
  if (e.art === "beitrag") {
    const t = e.thread;
    const titel = t ? t.titel : `Thread ${e.nummer}`;
    const inhalt = [el("span", { class: "neu-wer", text: e.wer }), " ",
      el("span", { class: `marke ${e.sorte === "FRAGE" ? "zug" : e.sorte === "BESCHLUSS" || e.sorte === "ANTWORT" ? "ok" : ""}`.trim(), text: e.anzahl > 1 ? `${e.anzahl}× ${e.sorte}` : e.sorte }),
      " ", el("span", { class: "neu-titel", text: `${e.nummer} · ${titel}` }),
      e.zusatz ? el("span", { class: "neu-zusatz", text: e.zusatz }) : null];
    return el("li", {}, icon(e.sorte === "FRAGE" ? "rueckfrage" : "threads", "neu-ic"),
      t ? el("a", { class: "neu-text", href: ankerLink(t, t.bloecke.find(istNeuerBlock)) }, inhalt) : el("span", { class: "neu-text" }, inhalt));
  }
  if (e.art === "gate") return el("li", {}, icon("person", "neu-ic"), el("span", { class: "neu-text" }, el("span", { class: "neu-wer", text: e.wer }), " hat sich am Forum angemeldet"));
  if (e.art === "status") {
    return el("li", {}, icon(e.nach === "x" ? "ok" : "roadmap", "neu-ic"), el("a", { class: "neu-text", href: "#roadmap" },
      el("span", { class: "kennung", text: e.id }), " ", e.titel, " ",
      el("span", { class: `marke ${e.nach === "x" ? "ok" : e.nach === "~" ? "teil" : "offen"}`, text: `${STATUS_WORT[e.von]} → ${STATUS_WORT[e.nach]}` }),
      e.wer ? el("span", { class: "neu-zusatz", text: e.wer }) : null));
  }
  if (e.art === "wer") {
    const zuDir = e.nach === "betreiber" || e.nach === "betrieb";
    return el("li", {}, icon(zuDir ? WER_ICON[e.nach] : "code", "neu-ic"), el("a", { class: "neu-text", href: zuDir ? "#zug" : "#roadmap" },
      el("span", { class: "kennung", text: e.id }), " ", e.titel, " ",
      el("span", { class: `marke ${zuDir ? "zug" : ""}`.trim(), text: zuDir ? `liegt jetzt bei dir: ${werText(e.nach)}` : `jetzt: ${werText(e.nach)}` })));
  }
  if (e.art === "punkt-neu") return el("li", {}, icon("plus", "neu-ic"), el("a", { class: "neu-text", href: "#roadmap" }, "Neuer Punkt ", el("span", { class: "kennung", text: e.id }), " ", e.titel));
  if (e.art === "punkt-weg") return el("li", {}, icon("minus", "neu-ic"), el("span", { class: "neu-text" }, "Punkt entfernt: ", el("span", { class: "kennung", text: e.id }), " ", e.titel));
  if (e.art === "fehlt") return el("li", {}, icon("ready", "neu-ic"), el("a", { class: "neu-text", href: "#roadmap" }, el("span", { class: "kennung", text: e.id }), " fehlt jetzt: ", e.fehlt));
  if (e.art === "stand") return el("li", {}, icon("roadmap", "neu-ic"), el("span", { class: "neu-text", text: `Roadmap-Stand ${datumLesbar(e.von)} → ${datumLesbar(e.nach)}` }));
  if (e.art === "geaendert") return el("li", {}, icon("roadmap", "neu-ic"), el("span", { class: "neu-text", text: "roadmap.json wurde geändert" }));
  return el("li", {}, icon("info", "neu-ic"), el("span", { class: "neu-text" }, e.text, e.wer ? el("span", { class: "neu-zusatz", text: e.wer }) : null));
}

let neuSichtbarSeit = 0;
function neuZeichnen() {
  const box = $("zug-neu");
  box.replaceChildren();
  const n = zustand.neu;
  const alle = n && n.seit ? [...n.eintraege, ...n.roadmap] : [];
  if (!alle.length) { box.hidden = true; neuSichtbarSeit = 0; return; }
  box.hidden = false;
  const zeilen = alle.map(neuZeile);
  const sofort = zeilen.slice(0, 6);
  const rest = zeilen.slice(6);
  const fragen = n.eintraege.filter((e) => e.sorte === "FRAGE").reduce((a, e) => a + e.anzahl, 0);
  const beitraege = n.eintraege.filter((e) => e.art === "beitrag").reduce((a, e) => a + e.anzahl, 0);
  const teile = [beitraege && anzahl(beitraege, "Beitrag", "Beiträge"), fragen && anzahl(fragen, "Frage", "Fragen"), n.roadmap.length && anzahl(n.roadmap.length, "Roadmap-Änderung", "Roadmap-Änderungen")].filter(Boolean);
  box.append(
    el("div", { class: "neu-kopf" },
      el("span", { class: "neu-funke", "aria-hidden": "true" }, icon("funke")),
      el("div", { class: "neu-kopf-text" },
        el("h2", { text: "Seit deinem letzten Besuch" }),
        el("p", { class: "hinweis", text: `${seitWann(n.seit.zeit)} · ${teile.join(" · ")}${n.mehr ? " · und weitere" : ""}` })),
      el("button", { type: "button", class: "knopf zweit klein-knopf", "data-fokus": "neu-gesehen", onclick: neuGesehen }, icon("haken"), "Gesehen")),
    el("ul", { class: "neu-liste" }, sofort),
    rest.length ? aufklappen(el("details", { class: "neu-mehr" }, el("summary", {}, icon("runter", "chevron"), `alle ${zeilen.length} zeigen`), el("ul", { class: "neu-liste" }, rest)), "neu-mehr", false) : null,
  );
  if (!neuSichtbarSeit && document.visibilityState === "visible" && !$("ansicht-zug").hidden) neuSichtbarSeit = Date.now();
}

function neuGesehen() {
  gesehenSetzen(zustand.kopf);
  zustand.neu = { seit: gesehenLesen(), eintraege: [], roadmap: [], pfade: new Set() };
  neuSichtbarSeit = 0;
  allesZeichnen();
  $("inhalt").focus({ preventScroll: true });
  melden("Als gesehen gemerkt. Neues erscheint hier wieder.");
}

/* --- Puls: beim Zurückkommen und alle 90 s nachsehen, ob es Neues gibt --- */

/* Beim stillen Neuladen bleibt das oberste sichtbare Element an seiner Stelle. */
function scrollHaltMerken() {
  const kopf = document.querySelector(".kopf").getBoundingClientRect().bottom;
  for (const e of document.querySelectorAll("main [data-anker], main [data-zeile], main [data-fokus]")) {
    const r = e.getBoundingClientRect();
    if (!r.height || r.bottom <= kopf) continue;
    const [attr, wert] = e.dataset.anker ? ["data-anker", e.dataset.anker] : e.dataset.zeile ? ["data-zeile", e.dataset.zeile] : ["data-fokus", e.dataset.fokus];
    return { wahl: `main [${attr}="${CSS.escape(wert)}"]`, top: r.top };
  }
  return null;
}
function scrollHaltAnwenden(halt) {
  if (!halt) return;
  for (const e of document.querySelectorAll(halt.wahl)) {
    const r = e.getBoundingClientRect();
    if (r.height) { window.scrollBy(0, r.top - halt.top); return; }
  }
}

let pulsLaeuft = false;
function beschaeftigt() {
  const a = document.activeElement;
  return zustand.laufend.size > 0 || zustand.schreibt.size > 0 || zustand.wartet.size > 0
    || (a && /^(TEXTAREA|INPUT|SELECT)$/.test(a.tagName) && a.type !== "checkbox" && a.type !== "radio" && !!a.value);
}
async function puls() {
  if (pulsLaeuft || !zustand.token || !hatDaten() || document.visibilityState !== "visible") return;
  if ($("neu-laden").disabled) return;
  pulsLaeuft = true;
  try {
    const kopf = await kopfLesen(zustand.kopfEtag);
    if (!kopf) return;                       // 304: nichts Neues
    zustand.kopfEtag = kopf.etag;
    if (kopf.sha === zustand.kopf) return;   // nur der eigene Commit
    if (beschaeftigt()) { $("neu-balken").hidden = false; return; }
    const halt = scrollHaltMerken();
    await starten();
    scrollHaltAnwenden(halt);
  } catch (_) {
    /* Puls ist Kür: Netzfehler still übergehen, der Knopf „Neu laden“ bleibt */
  } finally {
    pulsLaeuft = false;
  }
}

function frageKarte({ thread, block, f }) {
  const schl = `frage:${thread.slug}:${block.zeit}`;
  const name = `wahl-${thread.slug}-${block.zeit}`;
  const istErste = thread.bloecke[0] === block;

  const notiz = el("textarea", {
    placeholder: "Ergänzung, Bedingung oder eigene Antwort (optional)", "aria-label": "Ergänzung",
    rows: 3, "data-fokus": `${schl}:text`,
  });
  notiz.value = entwurf(`${schl}:text`);
  notiz.addEventListener("input", () => entwurfSetzen(`${schl}:text`, notiz.value));

  const beschluss = el("input", { type: "checkbox", class: "schalter", "data-fokus": `${schl}:beschluss` });
  const gemerkt = entwurf(`${schl}:beschluss`);
  beschluss.checked = gemerkt ? gemerkt === "ja" : istErste;

  const quelle = `frage:${schl}`;
  const senden = el("button", { type: "submit", class: "knopf", "data-fokus": `${schl}:senden`, "aria-keyshortcuts": "Control+Enter Meta+Enter", title: "Senden (Strg+Enter)" });
  const zurueck = el("button", { type: "button", class: "knopf zweit" }, icon("undo"), "Rückfrage");
  const sendenText = () => senden.replaceChildren(icon(beschluss.checked ? "haken" : "senden"), beschluss.checked ? "Beschließen" : "Antworten");
  sendenText();
  beschluss.addEventListener("change", () => {
    entwurfSetzen(`${schl}:beschluss`, beschluss.checked ? "ja" : "nein");
    sendenText();
  });

  const wahl = entwurf(`${schl}:wahl`);
  const etiketten = [];
  const markieren = () => { for (const l of etiketten) l.classList.toggle("gewaehlt", l.querySelector("input").checked); };
  // Angabe „im Feld“: Art hängt an der Wahl, der Wert bleibt beim Wechsel stehen
  const angabeBox = el("div", { class: "angabe" });
  let angabeEl = null;
  let pfadBestaetigt = false;
  const angabeZeichnen = () => {
    const w = entwurf(`${schl}:wahl`);
    const a = angabeFuer(f, w);
    angabeBox.replaceChildren();
    angabeEl = null;
    angabeBox.hidden = !a;
    if (!a) return null;
    const { feld, label } = angabeFeld(a, `${schl}:angabe`, `${schl}:angabe`);
    feld.addEventListener("input", () => { pfadBestaetigt = false; });
    tastenSenden(form, [feld], thread.pfad, quelle);
    angabeEl = feld;
    angabeBox.append(label, feld);
    return a;
  };
  const option = (wert, buchstabe, inhalt, empfohlen) => {
    const r = el("input", { type: "radio", name, value: wert, class: "vorschlag-radio", "data-fokus": `${schl}:wahl:${wert}` });
    r.checked = wahl === wert;
    r.addEventListener("change", () => { entwurfSetzen(`${schl}:wahl`, wert); markieren(); angabeZeichnen(); });
    const l = el("label", { class: "vorschlag" + (empfohlen ? " ist-empfohlen" : "") + (r.checked ? " gewaehlt" : "") },
      r, el("span", { class: "vorschlag-buchstabe", text: buchstabe }),
      el("span", { class: "vorschlag-text" }, inhalt,
        empfohlen ? el("span", { class: "empfohlen" }, icon("stern"), "Empfehlung") : null));
    etiketten.push(l);
    return l;
  };
  const optionen = f.vorschlaege.map((v) => option(v.buchstabe, v.buchstabe, v.text, v.buchstabe === f.empfohlen));
  if (f.vorschlaege.length) optionen.push(option("eigen", "–", "Eigene Antwort (im Feld unten)", false));

  const pfadHinweis = el("p", { class: "pfad-hinweis", role: "alert", hidden: true });
  // novalidate: wir prüfen selbst und sagen warum; die Browser-Blase (pattern) blockierte stumm
  const form = el("form", { class: "antwort-form", "data-quelle": quelle, novalidate: true },
    f.vorschlaege.length ? el("fieldset", { class: "vorschlaege" }, el("legend", { text: "Vorschläge" }), optionen) : null,
    angabeBox,
    pfadHinweis,
    f.empfehlung ? el("p", { class: "empfehlung" }, icon("stern"), el("span", {}, el("b", { text: "Empfehlung: " }), f.empfehlung)) : null,
    notiz,
    atempauseZeile(thread.pfad, quelle),
    el("div", { class: "antwort-zeile" },
      el("label", { class: "haken-text" }, beschluss, el("span", {}, "als ", el("b", { text: "BESCHLUSS" }), " (schließt den Thread)")),
      el("div", { class: "antwort-knoepfe" }, zurueck, senden)),
  );

  // Doppelantwort-Sperre: steht nach dieser FRAGE schon ein eigener Block (anderer Tab, anderes Gerät)?
  const schonBeantwortet = (frisch) => {
    const t2 = threadParsen(thread.slug, frisch);
    const i = t2.bloecke.findIndex((b) => b.sorte === "FRAGE" && b.ki === block.ki && b.chat === block.chat && b.zeit === block.zeit);
    const spaeter = i >= 0 ? t2.bloecke.slice(i + 1).find((b) => b.ki === ICH.ki) : null;
    if (spaeter) throw new Hinweis(`${thread.nummer} ist schon beantwortet (${spaeter.sorte} ${zeitLesbar(spaeter.zeit)}). Nichts geschrieben – „Neu laden“ zeigt den Stand.`);
  };

  const absenden = async (sorte) => {
    if (zustand.wartet.has(thread.pfad)) { atempauseJetzt(thread.pfad); return; }
    const gewaehlt = form.querySelector(`input[name="${CSS.escape(name)}"]:checked`);
    const buchstabe = gewaehlt && gewaehlt.value !== "eigen" ? gewaehlt.value : "";
    const zusatz = notiz.value.trim();
    if (sorte !== "ZURUECK" && f.vorschlaege.length && !gewaehlt) { melden("Bitte einen Vorschlag wählen oder „Eigene Antwort“.", true); return; }
    if ((sorte === "ZURUECK" || !buchstabe) && !zusatz) { melden("Bitte im Feld schreiben, was du willst.", true); notiz.focus(); return; }
    const a = sorte === "ZURUECK" ? null : angabeFuer(f, gewaehlt ? gewaehlt.value : "");
    const angabeWert = a && angabeEl ? angabeEl.value.trim() : "";
    if (a) {
      const fehler = angabeFehler(a, angabeWert);
      if (fehler) { melden(fehler, true); if (angabeEl) angabeEl.focus(); return; }
      if (a.art === "pfad" && angabeWert && !pfadSiehtAus(angabeWert) && !pfadBestaetigt) {
        pfadHinweis.replaceChildren("Sieht nicht wie ein Pfad aus (\\\\server\\freigabe oder E:\\…). Trotzdem senden? ",
          el("button", { type: "button", class: "knopf zweit klein-knopf", onclick: () => { pfadBestaetigt = true; pfadHinweis.hidden = true; absenden(sorte); } }, "Trotzdem senden"));
        pfadHinweis.hidden = false;
        return;
      }
    }
    pfadHinweis.hidden = true;
    const felder = [{ el: notiz, entwurf: `${schl}:text` }];
    if (angabeEl && a && a.art !== "datum") felder.push({ el: angabeEl, entwurf: `${schl}:angabe` });
    if ((await pruefeVorSenden(felder, senden)) !== "senden") return;
    const bezug = `Zu FRAGE [${block.ki}/${block.chat}] ${block.zeit}`;
    const zusatzJetzt = notiz.value.trim();
    let text;
    if (sorte === "ZURUECK") {
      text = `${bezug}\nRückfrage\n\n${zusatzJetzt}`;
    } else {
      const v = f.vorschlaege.find((x) => x.buchstabe === buchstabe);
      const angabeZeile = a && angabeEl && angabeEl.value.trim() ? `\n${ANGABE[a.art].zeile}: ${angabeEl.value.trim()}` : "";
      text = `${bezug}\nWahl: ${v ? `Vorschlag ${v.buchstabe}: ${v.text}` : "eigene Antwort"}${angabeZeile}` + (zusatzJetzt ? `\n\n${zusatzJetzt}` : "");
      sorte = beschluss.checked ? "BESCHLUSS" : "ANTWORT";
    }
    atempauseStarten(thread.pfad, {
      sorte, nummer: thread.nummer, slug: thread.slug, quelle, fokus: `${schl}:senden`,
      knoepfe: [senden, zurueck],
      arbeit: async () => {
        const r = await anhaengen(thread.pfad, sorte, text, `${thread.slug}: ${sorte} [${ICH.ki}/${ICH.chat}]`, schonBeantwortet);
        return () => {
          entwuerfeLoeschen(schl + ":");
          threadErsetzen(thread.pfad, r.text, r.sha);
          melden(r.schonDa ? `${sorte} stand schon in ${thread.slug} (früherer Versuch kam an).` : `${sorte} in ${thread.slug} geschrieben.`);
        };
      },
    });
  };
  sperrenWennSchreibt(thread.pfad, [senden, zurueck]);
  tastenSenden(form, [notiz], thread.pfad, quelle);
  angabeZeichnen();
  form.addEventListener("submit", (e) => { e.preventDefault(); absenden("ANTWORT"); });
  zurueck.addEventListener("click", () => absenden("ZURUECK"));

  return el("article", { class: "karte frage" },
    el("div", { class: "frage-kopf" },
      threadVerweis(thread),
      el("span", { class: "meta" }, `${block.ki}/${block.chat} · `, el("time", { text: zeitLesbar(block.zeit) }))),
    el("h3", { class: "frage-titel", text: f.frage || thread.titel }),
    f.roadmap.length ? el("div", { class: "marken" }, f.roadmap.map((r) => el("span", { class: "marke", text: r }))) : null,
    f.kontext ? aufklappen(el("details", { class: "mehr" }, el("summary", {}, icon("runter", "chevron"), "Hintergrund"),
      el("p", { class: "kontext", text: f.kontext })), `${schl}:hintergrund`, false) : null,
    form,
  );
}

/* Knöpfe einer Karte, deren Thread gerade beschrieben wird, bleiben gesperrt – auch wenn die
 * Karte zwischendurch neu gezeichnet wird (sonst ginge ein zweiter Klick durch). */
function sperrenWennSchreibt(pfad, knoepfe) {
  for (const k of knoepfe) {
    k.dataset.schreibt = pfad;
    if (zustand.schreibt.has(pfad) || zustand.wartet.has(pfad)) knopfWartet(k, true);
  }
}

/* arbeit() schreibt und gibt zurück, was danach passieren soll (Entwurf löschen, neu zeichnen …). */
async function threadSchreiben(pfad, knoepfe, arbeit) {
  if (zustand.schreibt.has(pfad)) return;
  const token = zustand.token;
  zustand.schreibt.add(pfad);
  for (const k of knoepfe) knopfWartet(k, true);
  let danach = null;
  try {
    await gateSicherstellen();
    danach = await arbeit();
  } catch (e) {
    if (zustand.token === token) schreibFehler(e);
  } finally {
    zustand.schreibt.delete(pfad);
    for (const k of document.querySelectorAll("[data-schreibt]")) {
      if (k.dataset.schreibt === pfad) knopfWartet(k, false);
    }
  }
  if (danach && zustand.token === token) danach();
}

/* --- Bis zum Tag: Ready-Rechner ---
 * Die Ready-Kacheln tragen Freitext („fehlt: V-19, V-22, Anhang B 9“), der veraltet. Hier wird
 * jedes R mit den Punkten verknüpft, die es belegen, und daraus ein Zustand abgeleitet. Nur
 * Anzeige: den R-Haken setzt der Betreiber selbst, er ist sein Urteil. */

/* „V-22“ statt „M4-V22“, wo der Titel eine Kennung trägt. */
function kurzName(p) {
  const m = TITEL_KENNUNG.exec(String(p.titel || ""));
  return m ? m[1] : p.id;
}
function releaseVersion() {
  const rm = zustand.roadmap;
  if (!rm) return "";
  const kette = flussGraph(rm).kette;
  const ziel = kette.length ? (rm.meilensteine || []).find((m) => m.id === kette[kette.length - 1]) : null;
  for (const t of [ziel && ziel.titel, rm.ziel, rm.produkt]) {
    const m = /\d+\.\d+\.\d+\w*/.exec(String(t || ""));
    if (m) return m[0];
  }
  return "";
}
/* Teile von „fehlt“, die noch etwas fehlen lassen („Golden 5/5 ist fertig“ fällt weg). */
const fehltTeile = (fehlt) => String(fehlt || "").split(/[,;]/).map((s) => s.trim())
  .filter((s) => s && !/fertig|ist da|sind da|geübt|existier|liegen|liegt/i.test(s));

/* Welche Punkte belegen r? Vier Quellen, die erste gewinnt; doppelte Treffer zusammengefasst. */
function readyBezug(r, rm, b = beschluesse()) {
  const aus = [];
  const dazu = (punkt, ms, weil, vermutet, ausFehlt) => {
    const da = aus.find((x) => x.punkt === punkt);
    if (da) { da.ausFehlt = da.ausFehlt || ausFehlt; da.vermutet = da.vermutet && vermutet; return; }
    aus.push({ punkt, ms, weil, vermutet, ausFehlt });
  };
  const nr = String(r.id).replace(/^R/, "");
  const alle = roadmapPunkte();
  for (const { meilenstein, punkt } of alle) if ((punkt.ready || []).includes(r.id)) dazu(punkt, meilenstein, "roadmap.json: ready", false, false);
  for (const { meilenstein, punkt } of alle) {
    const re = /\bR(\d+)\b/g;
    let m;
    while ((m = re.exec(`${punkt.titel} ${punkt.notiz || ""}`))) {
      if (m[1] === nr) { dazu(punkt, meilenstein, `${punkt.id} nennt (${r.id})`, false, false); break; }
    }
  }
  if (r.status !== "x" || r.fehlt) {
    for (const teil of fehltTeile(r.fehlt)) {
      for (const k of teil.match(/Anhang B \d+|Anh\.?\s?B \d+|\b[A-Z]-\d+\b/g) || []) {
        const n = kennungNorm(k);
        for (const { meilenstein, punkt } of alle) if (punktSchluessel(punkt).has(n)) dazu(punkt, meilenstein, `${r.id} nennt ${k}`, true, true);
      }
    }
  }
  for (const f of b.fragenRoadmap) {
    if (!f.f.roadmap.includes(r.id)) continue;
    for (const t of f.punkte) dazu(t.punkt, t.ms, `FRAGE ${f.thread.nummer} nennt ${t.weil} und ${r.id}`, true, false);
  }
  return aus;
}
/* Je R: Bezug, abgeleiteter Zustand, Widerspruch, offene Melde-Zusage. */
function readyStand() {
  const rm = zustand.roadmap;
  if (!rm || !(rm.ready || []).length) return [];
  const b = beschluesse();
  const zusagen = zusagenOffen();
  return rm.ready.map((r) => {
    const bezug = readyBezug(r, rm, b);
    const offen = bezug.filter((x) => x.punkt.status !== "x");
    const art = !bezug.length ? "ohne"
      : !offen.length ? "erfuellt"
        : offen.every((x) => { const n = b.nachzug.get(x.punkt.id); return n && n.paar.klasse === "erledigt"; }) ? "beschluss" : "offen";
    const zusage = zusagen.find((z) => z.paar.rTokens.includes(r.id)) || null;
    return {
      r, bezug, offen, art, zusage,
      widerspruch: bezug.filter((x) => x.ausFehlt && x.punkt.status === "x"),
      abweichend: art !== "ohne" && (r.status === "x") !== (art === "erfuellt"),
      abhakbar: r.status !== "x" && art === "erfuellt" && !zusage,
    };
  });
}
function readyTitel(x) {
  if (x.r.status === "x") return `${x.r.id}: erfüllt laut roadmap.json`;
  if (x.art === "ohne") return `${x.r.id}: kein Punkt in roadmap.json verknüpft`;
  const n = x.bezug.length;
  return `${x.r.id}: ${n - x.offen.length} von ${n} ${n === 1 ? "Punkt" : "Punkten"} erledigt${x.offen.length ? `, fehlt ${x.offen.map((q) => kurzName(q.punkt)).join(", ")}` : ""}`;
}
function readyChip(x) {
  const p = x.punkt;
  const fertig = p.status === "x";
  return el("span", {
    class: `marke ready-chip${fertig ? " ok erledigt" : " leise"}${x.vermutet ? " vermutet" : ""}`,
    title: x.vermutet ? `vermutet: ${x.weil}` : x.weil,
  }, fertig ? icon("haken") : null, kurzName(p), fertig ? el("span", { class: "sr-nur", text: " erledigt" }) : null);
}
function widerspruchSatz(liste) {
  return liste.map((x) => `Der Text nennt ${kurzName(x.punkt)} als fehlend – ${x.punkt.id} ist erledigt (${datumLesbar(x.punkt.erledigt) || "?"}${x.punkt.von ? `, ${x.punkt.von}` : ""}).`).join(" ");
}
function widerspruchMelden(x) {
  const ziel = anstossZiel();
  if (!ziel) return;
  const namen = x.widerspruch.map((w) => kurzName(w.punkt));
  const tage = [...new Set(x.widerspruch.map((w) => datumLesbar(w.punkt.erledigt)).filter(Boolean))];
  entwurfVorbereiten(ziel, "BEFUND",
    `Ready ${x.r.id}: ‚fehlt‘ ist veraltet – ${aufzaehlen(namen)} ${namen.length === 1 ? "ist" : "sind"} erledigt${tage.length ? ` (${tage.join(", ")})` : ""}. Bitte fehlt in roadmap.json nachziehen.`);
  melden(`Entwurf in ${ziel.nummer} vorbereitet – prüfen und anhängen.`);
}
function punktVorschlagen(x) {
  const ziel = anstossZiel();
  if (!ziel) return;
  const st = graphStand(zustand.roadmap);
  const kette = st.g.kette;
  const rel = kette.length ? kette[kette.length - 1] : "";
  // Vorschlag: der offene Vorgänger des Release-Meilensteins mit dem meisten Rest.
  const ms = (rel ? st.vor.get(rel) || [] : []).filter((v) => !st.fertig(v))
    .sort((a, b) => st.zahl.get(b).offen.length - st.zahl.get(a).offen.length)[0] || rel || "?";
  const fehlt = fehltTeile(x.r.fehlt).join(", ");
  const wer = /Probe|Lauf|Handlauf|prüfen|testen/i.test(fehlt) ? "betrieb" : "code";
  entwurfVorbereiten(ziel, "ANTRAG",
    `Für ${x.r.id} (${x.r.titel}) steht kein Punkt in roadmap.json.${fehlt ? ` Laut Ready fehlt: ${fehlt}.` : ""} Vorschlag: neuer Punkt in ${ms}, wer: ${wer}.`);
  melden(`Entwurf in ${ziel.nummer} vorbereitet – prüfen und anhängen.`);
}

function readyKarteZeichnen(stand) {
  const n = stand.length;
  const deklariert = stand.filter((x) => x.r.status === "x").length;
  const erfuellt = stand.filter((x) => x.r.status !== "x" && x.art === "erfuellt").map((x) => x.r.id);
  const beschluss = stand.filter((x) => x.r.status !== "x" && x.art === "beschluss").map((x) => x.r.id);
  const version = releaseVersion();

  const leiste = el("ol", { class: "ready-leiste", "aria-label": "Ready R1 bis R10" }, stand.map((x) => {
    const titel = readyTitel(x);
    return el("li", { class: `rl-${x.r.status === "x" ? "ok" : x.r.status === "~" ? "teil" : "offen"}${x.abweichend ? " abweichend" : ""}`, title: titel },
      el("span", { class: "rl-id", "aria-hidden": "true", text: x.r.id.replace(/^R/, "") }), el("span", { class: "sr-nur", text: titel }));
  }));
  const satz = [`Ready ${deklariert}/${n} laut roadmap.json`];
  if (erfuellt.length) satz.push(`laut Punkten erfüllt: ${erfuellt.join(", ")}`);
  if (beschluss.length) satz.push(`per Beschluss erledigbar: ${beschluss.join(", ")}`);

  let banner = null;
  if (n && deklariert === n) {
    const regel = beschluesse().paare.find((p) => p.klasse === "regel");
    banner = el("p", { class: "ready-banner ok", role: "status" }, icon("ok"), el("span", {},
      "Ready komplett. ", regel ? ["Laut ", el("a", { href: ankerLink(regel.thread, regel.antwort), text: `Beschluss ${regel.thread.nummer}` }), " "] : "",
      "meldet jetzt eine KI ‚Tag jetzt?‘ als Frage – du gibst frei."));
  } else if (n && stand.every((x) => x.r.status === "x" || x.art === "erfuellt")) {
    banner = el("p", { class: "ready-banner", role: "status" }, icon("ready"), "Alle Ready-Punkte sind laut Punkten erfüllt. R-Haken setzen?");
  }

  const gruppe = (titel, ic, zeilen) => (zeilen.length ? el("div", { class: "ready-gruppe" },
    el("h3", {}, icon(ic), titel, el("span", { class: "zaehler leise", text: String(zeilen.length) })),
    el("ul", { class: "ready-zeilen" }, zeilen)) : null);

  const abhaken = stand.filter((x) => x.r.status !== "x" && x.art === "erfuellt").map((x) => {
    const belegt = x.bezug.map((q) => `${q.punkt.id} erledigt ist (${datumLesbar(q.punkt.erledigt) || "?"})`);
    if (x.zusage) {
      const t = x.zusage.paar.thread;
      return el("li", { class: "ready-zeile", "data-zeile": `ready:${x.r.id}` },
        el("div", { class: "ready-zeile-text" },
          el("div", {}, el("span", { class: "kennung", text: x.r.id }), " ", x.r.titel),
          el("p", { class: "hinweis" }, el("b", { text: `erst Ergebnis melden (${t.nummer})` }), ` – ${aufzaehlen(x.bezug.map((q) => q.punkt.id))} ist abgehakt, das Ergebnis fehlt noch im Thread.`)),
        el("button", { type: "button", class: "knopf zweit klein-knopf", "data-fokus": `ready-melden:${x.r.id}`, onclick: () => ergebnisMelden(t) }, "Ergebnis melden"));
    }
    return el("li", { class: "ready-zeile", "data-zeile": `ready:${x.r.id}` },
      hakenKnopf(x.r, "ready", true),
      el("div", { class: "ready-zeile-text" },
        el("div", {}, el("span", { class: "kennung", text: x.r.id }), " ", x.r.titel),
        el("p", { class: "hinweis", text: `weil ${aufzaehlen(belegt)}` }),
        el("p", { class: "hinweis klein", text: `Ein R-Haken ist dein Urteil – prüfe, ob der Punkt die Bedingung wirklich belegt (${x.r.id}: „${x.r.titel}“).` })));
  });
  // Punkte, die ein noch offenes R aufhalten, mit den R dazu
  const halten = new Map();
  for (const x of stand) {
    if (x.r.status === "x") continue;
    for (const q of x.offen) {
      if (!halten.has(q.punkt)) halten.set(q.punkt, []);
      halten.get(q.punkt).push(x.r.id);
    }
  }
  const nachzug = beschluesse().nachzug;
  const beiDir = [];
  const beiKis = [];
  for (const [p, rs] of halten) {
    const nz = nachzug.get(p.id);
    const zeile = (zusatz) => el("li", { class: "ready-zeile kurz" },
      el("span", {}, el("span", { class: "kennung", text: kurzName(p) }), ` → ${rs.join(", ")}`, zusatz ? el("span", { class: "hinweis", text: `: ${zusatz}` }) : null));
    if (nz) beiKis.push(zeile(`Nachzug aus ${nz.paar.thread.nummer}`));
    else if (p.wer === "code") beiKis.push(zeile(""));
    else if (istBeiDir(p)) beiDir.push(zeile(""));
  }
  const ohne = stand.filter((x) => x.r.status !== "x" && x.art === "ohne").map((x) => el("li", { class: "ready-zeile" },
    el("div", { class: "ready-zeile-text" },
      el("div", {}, el("span", { class: "kennung", text: x.r.id }), " ", x.r.titel),
      x.r.fehlt ? el("p", { class: "hinweis", text: `fehlt laut Ready: ${x.r.fehlt}` }) : null),
    anstossZiel() ? el("button", { type: "button", class: "knopf zweit klein-knopf", "data-fokus": `ready-vorschlag:${x.r.id}`, onclick: () => punktVorschlagen(x) }, icon("plus"), "Punkt vorschlagen") : null));

  return el("section", { class: "karte ready-karte", "aria-labelledby": "ready-karte-titel" },
    el("h3", { id: "ready-karte-titel", class: "ready-karte-titel" }, icon("ready"), version ? `Bis v${version}` : "Bis zum Tag"),
    leiste,
    el("p", { class: "ready-satz", text: satz.join(" · ") }),
    banner,
    el("div", { class: "ready-gruppen" },
      gruppe("Kannst du abhaken", "ok", abhaken),
      gruppe("Bei dir", "handlauf", beiDir),
      gruppe("Bei den KIs", "code", beiKis),
      gruppe("Ohne Punkt", "info", ohne)));
}

/* --- Beschlussbuch: alle Entscheidungen an einem Ort --- */
/* Geheimnisse (PIN in einer eigenen Antwort) auch hier nur maskiert zeigen. */
function ohneGeheimnis(text) {
  const funde = geheimnisFinden(text);
  return funde.length ? geheimnisseErsetzen(text, funde) : String(text || "");
}
function beruehrtNichtVorReady(paar) {
  const rm = zustand.roadmap;
  for (const eintrag of (rm && rm.nicht_vor_ready) || []) {
    const kopf = eintrag.split(" (")[0].trim();
    if (kopf.length >= 5 && paar.f.frage.includes(kopf)) return eintrag;
    const k = kennungNorm(eintrag);
    if (k && paar.f.roadmap.some((t) => kennungNorm(t) === k)) return eintrag;
  }
  return "";
}
function beschlussbuchZeichnen() {
  const { paare } = beschluesse();
  if (!paare.length) return null;
  const gefolgt = paare.filter((p) => p.wahl && p.wahl !== "eigen" && p.wahl === p.empfohlen).length;
  const eigen = paare.filter((p) => p.wahl === "eigen").length;
  const abweichend = paare.filter((p) => p.wahl && p.wahl !== "eigen" && p.empfohlen && p.wahl !== p.empfohlen);
  const kopf = [`${anzahl(paare.length, "Beschluss", "Beschlüsse")}`, `Empfehlung gefolgt ${gefolgt}×`, `eigene Antwort ${eigen}×`,
    `abweichend ${abweichend.length}×${abweichend.length ? ` (${abweichend.map((p) => p.thread.nummer).join(", ")})` : ""}`].join(" · ");
  const ready = new Map(((zustand.roadmap && zustand.roadmap.ready) || []).map((r) => [r.id, r]));
  const fehlen = new Map();
  for (const t of new Set(paare.map((p) => p.thread))) for (const x of angabenFehlen(t)) fehlen.set(x.frage, x);
  const zelle = (name, ...inhalt) => el("td", {}, el("span", { class: "spalte", "aria-hidden": "true", text: name }), ...inhalt);
  const zeilen = [...paare].sort((a, b) => b.antwort.zeit.localeCompare(a.antwort.zeit) || b.thread.slug.localeCompare(a.thread.slug)).map((p) => {
    const wahl = p.wahl === "eigen" ? `eigene Antwort: ${kuerzen(ohneGeheimnis(p.wahlText), 80)}`
      : p.wahl === p.empfohlen ? `${p.wahl} ★ Empfehlung` : p.empfohlen ? `${p.wahl} – Empfehlung war ${p.empfohlen}` : p.wahl || "–";
    const bezug = [
      ...p.punkte.map((t) => (t.punkt.status === "x" ? `✓ ${t.punkt.id}` : `offen: ${t.punkt.id}`)),
      ...p.rTokens.map((id) => (ready.has(id) && ready.get(id).status === "x" ? `✓ ${id}` : id)),
    ];
    const fehlt = fehlen.get(p.frage);
    const angabe = fehlt
      ? el("a", { href: ankerLink(p.thread, fehlt.b), class: "angabe-fehlt-link" }, icon("warnung"), `fehlt: ${ANGABE[fehlt.a.art].kurz}`)
      : Object.keys(p.angaben).length ? `${Object.keys(p.angaben).join(", ")} ✓` : "";
    const nvr = beruehrtNichtVorReady(p);
    return el("tr", { "data-zeile": `buch:${p.thread.nummer}` },
      zelle("Datum", datumLesbar(p.antwort.zeit)),
      zelle("Thread", el("a", { href: ankerLink(p.thread, p.antwort), class: "kennung", text: p.thread.nummer })),
      zelle("Frage", kuerzen(ohneGeheimnis(p.f.frage), 80),
        nvr ? el("span", { class: "marke leise nvr", title: "Bewusst geparkt bis 0.9.0b1 – der Beschluss berührt das Thema" }, `berührt ‚Nicht vor Ready‘: ${nvr}`) : null),
      zelle("Wahl", wahl),
      zelle("Bezug", bezug.length ? bezug.join(" · ") : "–"),
      zelle("Angabe", angabe));
  });
  const tabelle = el("div", { class: "tabelle buch-tabelle", tabindex: "0", role: "region", "aria-label": "Beschlussbuch" },
    el("table", {},
      el("thead", {}, el("tr", {}, ["Datum", "Thread", "Frage", "Wahl", "Bezug", "Angabe"].map((s) => el("th", { scope: "col", text: s })))),
      el("tbody", {}, zeilen)));
  return aufklappen(el("details", { class: "karte beschlussbuch" },
    el("summary", {}, icon("entscheidung", "buch-ic"), el("span", { class: "buch-name", text: "Beschlussbuch" }),
      el("span", { class: "zaehler leise", text: String(paare.length) }), icon("runter", "chevron")),
    el("p", { class: "buch-kopf", text: kopf }),
    tabelle), "beschlussbuch", false);
}

/* --- Roadmap --- */

/* --- Statusübersicht: ein Blick auf alle Punkte --- */

/* Art eines Punkts für Raster und Legende: fertig, teilweise, wartet auf Nachzug, bei dir, bei den KIs. */
function punktArt(p) {
  const s = anzeigeStatus(p);
  if (s === "x") return "ok";
  if (s === "~") return "teil";
  if (istMeins(p)) return beschluesse().nachzug.has(p.id) ? "nachzug" : "dir";
  return "ki";
}
const PUNKT_ART = { ok: "fertig", teil: "teilweise", dir: "offen bei dir", nachzug: "wartet auf Nachzug", ki: "offen bei KI" };

function statusKarte(rm) {
  const alle = roadmapPunkte().map((x) => x.punkt);
  const zahl = (f) => alle.filter(f).length;
  const fertig = zahl((p) => anzeigeStatus(p) === "x");
  const fragen = offeneFragen().length;
  const ready = rm.ready || [];
  const rFertig = ready.filter((q) => anzeigeStatus(q) === "x").length;
  const chips = [
    { wert: zahl((p) => p.wer === "betreiber" && istBeiDir(p)), name: "Entscheidungen bei dir", ic: "entscheidung", link: "#zug" },
    { wert: zahl((p) => p.wer === "betrieb" && istBeiDir(p)), name: "Handläufe bei dir", ic: "handlauf", link: "#zug" },
    { wert: fragen, name: fragen === 1 ? "offene Frage" : "offene Fragen", ic: "rueckfrage", link: "#zug" },
    { wert: zahl((p) => p.wer === "code" && anzeigeStatus(p) !== "x"), name: "bei den KIs", ic: "code" },
  ];
  const ms = (rm.meilensteine || []).filter((m) => (m.punkte || []).length);
  const raster = el("div", { class: "raster", role: "list", "aria-label": "Alle Punkte nach Meilenstein" }, ms.map((m) => {
    const z = meilensteinZahlen(m);
    const extra = z.beiDir ? `, ${z.beiDir} bei dir` : "";
    return el("button", {
      type: "button", class: `raster-gruppe ms-${z.stufe}`, role: "listitem",
      "aria-label": `${m.id} ${m.titel}: ${z.x} von ${z.n} fertig${extra}`,
      title: `${m.id} · ${m.titel} · ${z.x}/${z.n}${extra}`,
      onclick: () => meilensteinZeigen(m.id),
    },
    el("span", { class: "raster-zellen", "aria-hidden": "true" },
      m.punkte.map((p) => el("span", { class: `raster-zelle rz-${punktArt(p)}`, title: `${p.id} · ${p.titel} · ${PUNKT_ART[punktArt(p)]}` }))),
    el("span", { class: "raster-id", text: m.id }));
  }));
  const vorhanden = new Set(alle.map(punktArt));
  return el("div", { class: "karte status-karte" },
    el("div", { class: "status-oben" },
      ringBox(alle.length ? fertig / alle.length : 0, `${fertig} von ${alle.length} Punkten fertig`),
      el("div", { class: "rm-kopf-text" },
        el("div", { class: "lage-ziel", text: rm.produkt ? `${rm.produkt} · ${rm.ziel || ""}` : rm.ziel || "Roadmap" }),
        el("div", { class: "lage-titel" }, `${fertig} von ${alle.length} Punkten fertig`,
          ready.length ? el("span", { class: "status-ready", text: `Ready ${rFertig}/${ready.length}` }) : null))),
    el("div", { class: "status-chips" }, chips.map((c) => el(c.link ? "a" : "span", {
      class: `status-chip${c.link && c.wert ? " zug" : ""}`, href: c.link,
    }, icon(c.ic), el("b", { text: String(c.wert) }), c.name))),
    raster,
    el("div", { class: "raster-legende", "aria-hidden": "true" }, Object.keys(PUNKT_ART).filter((a) => vorhanden.has(a)).map((a) =>
      el("span", {}, el("span", { class: `raster-zelle rz-${a}` }), PUNKT_ART[a]))),
  );
}

/* Wer hält was in einem Meilenstein: je Zuständigkeit fertig/alle. */
function werAnteile(punkte) {
  const teile = ["code", "betreiber", "betrieb"].map((w) => {
    const p = punkte.filter((q) => q.wer === w);
    if (!p.length) return null;
    const x = p.filter((q) => anzeigeStatus(q) === "x").length;
    const art = x === p.length ? "ok" : w === "code" ? "" : "zug";
    return el("span", { class: `wer-anteil ${art}`.trim(), title: `${werText(w)}: ${x} von ${p.length} fertig` },
      icon(WER_ICON[w]), `${x}/${p.length}`);
  }).filter(Boolean);
  return el("span", { class: "wer-anteile" }, teile);
}

function roadmapZeichnen() {
  const rm = zustand.roadmap;
  const gesamt = $("roadmap-gesamt");
  const ms = $("roadmap-meilensteine");
  const readyBox = $("roadmap-ready-box");
  const extra = $("roadmap-extra");
  for (const b of [gesamt, $("roadmap-fluss"), $("roadmap-probe"), ms, readyBox, extra]) b.replaceChildren();
  if (!rm) {
    $("roadmap-stand").textContent = "";
    ms.append(leer("info", "Keine roadmap.json im Forum."));
    return;
  }
  $("roadmap-stand").textContent = `Stand ${datumLesbar(rm.stand) || "?"} · ${rm.basis || ""} · Quelle: ${rm.quelle || "roadmap.json"}`;

  gesamt.append(statusKarte(rm));

  flussZeichnen();
  probeListeZeichnen();

  const offeneSlugs = new Set(offeneFragen().map((q) => q.thread.slug));
  for (const m of rm.meilensteine || []) {
    const p = m.punkte || [];
    const { x, t, beiDir, stufe } = meilensteinZahlen(m);
    const breite = (n) => (p.length ? `${(n / p.length) * 100}%` : "0");
    const f1 = el("div", { class: "f-x" }); f1.style.width = breite(x);
    const f2 = el("div", { class: "f-t" }); f2.style.width = breite(t);
    const details = el("details", { class: `karte meilenstein ms-${stufe}`, "data-ms": m.id },
      el("summary", {},
        el("span", { class: "ms-id", text: m.id }),
        el("span", { class: "ms-titel" }, el("span", { text: m.titel }),
          beiDir ? el("span", { class: "marke zug", text: `${beiDir} bei dir` }) : null,
          stufe === "fertig" ? el("span", { class: "marke ok" }, icon("haken"), "fertig") : null),
        werAnteile(p),
        el("div", { class: "fortschritt", role: "img", "aria-label": `${x} von ${p.length} fertig` }, f1, f2),
        el("span", { class: "ms-zahl", text: `${x}/${p.length}` }),
        icon("runter", "chevron")),
      el("ul", { class: "checkliste punkte", "data-hakenliste": `ms-${m.id}` }, p.map((q) => punktZeile(q, offeneSlugs))),
    );
    ms.append(aufklappen(details, `ms:${m.id}`, beiDir > 0));
  }

  if ((rm.ready || []).length) {
    const r = rm.ready;
    const rFertig = r.filter((q) => q.status === "x").length;
    const stand = readyStand();
    const ziel = anstossZiel();
    readyBox.append(
      el("div", { class: "abschnitt-kopf" },
        el("h2", {}, icon("ready"), `„Ready“ für ${releaseVersion() || "den Tag"}`, el("span", { class: "zaehler leise", text: `${rFertig}/${r.length}` })),
        el("p", { class: "hinweis", text: "Die Eintrittskarten für die Beta. Auch hier: Kreis anklicken = erfüllt." })),
      readyKarteZeichnen(stand),
      el("div", { class: "ready", "data-hakenliste": "ready" }, stand.map((x) => {
        const q = x.r;
        const s = anzeigeStatus(q);
        return el("div", { class: "karte ready-kachel" + (s === "x" ? " ist-fertig" : ""), "data-zeile": q.id },
          hakenKnopf(q, "ready", true),
          el("div", {},
            el("div", { class: "ready-titel" }, el("span", { class: "kennung", text: q.id }), " ", q.titel),
            q.fehlt && q.status !== "x" ? el("p", { class: "fehlt" }, el("b", { text: "fehlt: " }), q.fehlt) : null,
            q.status !== "x" && x.bezug.length ? el("div", { class: "ready-chips" }, x.bezug.map(readyChip)) : null,
            q.status !== "x" && x.widerspruch.length ? el("div", { class: "widerspruch-box" },
              el("p", { class: "hinweis widerspruch", role: "note", text: widerspruchSatz(x.widerspruch) }),
              ziel ? el("button", { type: "button", class: "knopf zweit klein-knopf", "data-fokus": `ready-widerspruch:${q.id}`, onclick: () => widerspruchMelden(x) },
                icon("senden"), `An ${ziel.nummer} melden`) : null) : null));
      })),
    );
  }

  const buch = beschlussbuchZeichnen();
  if (buch) extra.append(buch);
  if ((rm.risiken || []).length) {
    extra.append(el("div", { class: "abschnitt-kopf" }, el("h2", {}, icon("warnung"), "Risiken")),
      el("ul", { class: "karte risiken" }, rm.risiken.map((r) => el("li", {}, icon("warnung"), el("span", { text: r })))));
  }
  if ((rm.nicht_vor_ready || []).length) {
    extra.append(el("div", { class: "abschnitt-kopf" }, el("h2", {}, icon("pause"), "Nicht vor „Ready“"),
      el("p", { class: "hinweis", text: "Bewusst geparkt, bis 0.9.0b1 steht." })),
      el("div", { class: "marken park" }, rm.nicht_vor_ready.map((r) => el("span", { class: "marke leise", text: r }))));
  }
}

/* --- Roadmap als Flussdiagramm --- */

/* Abhängigkeiten der Meilensteine. roadmap.json kann sie selbst tragen
 * (meilensteine[].nach = ["M1", …]); trägt kein Meilenstein ein „nach“, gilt der
 * Stand aus dem Diagramm „Kritischer Pfad“ im Forum-README (03.10.2026). */
const FLUSS_VORGABE = { M1: ["M0"], M2: ["M1"], M3: ["M1"], M4: ["M1"], M6: ["M1"], M5: ["M2", "M3", "M4"], M7: ["M5"] };
const FLUSS = { hoehe: 126, zeilenAbstand: 16, spaltenAbstand: 44, minBreite: 148, maxBreite: 240, stufenUnter: 720 };

function meilensteinZahlen(m) {
  const p = m.punkte || [];
  const x = p.filter((q) => q.status === "x").length;
  const t = p.filter((q) => q.status === "~").length;
  const beiDir = p.filter(istBeiDir).length;
  const stufe = p.length && x === p.length ? "fertig" : x || t ? "teil" : "offen";
  return { n: p.length, x, t, beiDir, stufe };
}

/* Kette aus „M0 → M1 → M2 → M5. Engpass …“: die längste Folge bekannter IDs. */
function kritischeKette(text, ids) {
  const teile = String(text || "").split("→");
  let beste = [];
  let jetzt = [];
  teile.forEach((teil, i) => {
    const woerter = teil.trim().split(/\s+/);
    const wort = (i === 0 ? woerter[woerter.length - 1] : woerter[0]) || "";
    const id = wort.replace(/[^\w-]+$/, "").replace(/^[^\w-]+/, "");
    jetzt = ids.has(id) ? [...jetzt, id] : [];
    if (jetzt.length > beste.length) beste = jetzt.slice();
  });
  return beste.length > 1 ? beste : [];
}

function flussGraph(rm) {
  const ms = (rm.meilensteine || []).filter((m) => m && m.id);
  const ids = new Set(ms.map((m) => m.id));
  const ausJson = ms.some((m) => Array.isArray(m.nach));
  const kanten = [];
  const schon = new Set();
  const kante = (von, nach) => {
    if (!ids.has(von) || !ids.has(nach) || von === nach || schon.has(von + ">" + nach)) return;
    schon.add(von + ">" + nach);
    kanten.push({ von, nach, kritisch: false });
  };
  const vorgabe = (id) => (Object.prototype.hasOwnProperty.call(FLUSS_VORGABE, id) ? FLUSS_VORGABE[id] : []);
  for (const m of ms) for (const v of (ausJson ? m.nach : vorgabe(m.id)) || []) kante(String(v), m.id);
  const kette = kritischeKette(rm.kritischer_pfad, ids);
  for (let i = 0; i + 1 < kette.length; i++) kante(kette[i], kette[i + 1]);
  for (const k of kanten) {
    const i = kette.indexOf(k.von);
    k.kritisch = i >= 0 && kette[i + 1] === k.nach;
  }

  // Spalten: längster Weg von einem Anfang. Begrenzte Runden, damit ein Kreis nicht hängt.
  const ebene = new Map(ms.map((m) => [m.id, 0]));
  for (let runde = 0; runde < ms.length; runde++) {
    let geaendert = false;
    for (const k of kanten) {
      if (ebene.get(k.nach) < ebene.get(k.von) + 1) { ebene.set(k.nach, ebene.get(k.von) + 1); geaendert = true; }
    }
    if (!geaendert) break;
  }
  // Zeilen: der kritische Knoten einer Spalte auf der Hauptlinie (0), der erste andere darüber, der Rest darunter.
  const zeile = new Map();
  const spalten = new Map();
  for (const m of ms) {
    const e = ebene.get(m.id);
    if (!spalten.has(e)) spalten.set(e, []);
    spalten.get(e).push(m.id);
  }
  for (const liste of spalten.values()) {
    const krit = liste.find((id) => kette.includes(id));
    const rest = liste.filter((id) => id !== krit);
    if (krit) {
      zeile.set(krit, 0);
      rest.forEach((id, i) => zeile.set(id, i === 0 ? -1 : i));
    } else {
      rest.forEach((id, i) => zeile.set(id, i));
    }
  }
  return { knoten: ms, kanten, kette, ebene, zeile, ausJson };
}

/* Stand des Graphen, rein und ohne DOM. Punkte in „gedacht“ zählen als erledigt
 * (Hebel, Probe). Ein leerer Meilenstein ist nie fertig, wie in meilensteinZahlen. */
function graphStand(rm, gedacht = new Set()) {
  const g = flussGraph(rm);
  const zahl = new Map();
  for (const m of g.knoten) {
    const p = m.punkte || [];
    const offen = p.filter((q) => q.status !== "x" && !gedacht.has(q.id));
    zahl.set(m.id, { n: p.length, x: p.length - offen.length, t: p.filter((q) => q.status === "~" && !gedacht.has(q.id)).length, offen, fertig: p.length > 0 && !offen.length });
  }
  const vor = new Map(g.knoten.map((m) => [m.id, []]));
  const nach = new Map(g.knoten.map((m) => [m.id, []]));
  for (const k of g.kanten) { vor.get(k.nach).push(k.von); nach.get(k.von).push(k.nach); }
  const fertig = (id) => !!(zahl.get(id) && zahl.get(id).fertig);
  return {
    g, zahl, vor, nach, fertig,
    frei: (id) => (vor.get(id) || []).every(fertig),
    vorfahren: (id) => vorfahrenVon(g, id),
  };
}
/* Was ein Haken an punkt (in Meilenstein ms) auslöst. */
function hebel(rm, punkt, ms, st0 = graphStand(rm)) {
  const st1 = graphStand(rm, new Set([punkt.id]));
  return {
    punkt, ms,
    schliesst: !st0.fertig(ms) && st1.fertig(ms),
    gibtFrei: (st0.nach.get(ms) || []).filter((s) => !st0.frei(s) && st1.frei(s)),
    rest: st1.zahl.get(ms) ? st1.zahl.get(ms).offen.length : 0,
    kritisch: st0.g.kette.includes(ms),
    ebene: st0.g.ebene.get(ms) || 0,
  };
}
const hebelRang = (a, b) => b.gibtFrei.length - a.gibtFrei.length || Number(b.schliesst) - Number(a.schliesst)
  || Number(b.kritisch) - Number(a.kritisch) || Number(a.punkt.wer !== "betreiber") - Number(b.punkt.wer !== "betreiber")
  || a.ebene - b.ebene;
/* „M2, M3, M4 und M6“ */
function aufzaehlen(liste) {
  return liste.length < 2 ? liste.join("") : `${liste.slice(0, -1).join(", ")} und ${liste[liste.length - 1]}`;
}
/* Hebel aller Punkte bei dir, gemeinsam gerechnet (ein Ausgangsstand). */
function hebelBeiDir(aufgaben) {
  const rm = zustand.roadmap;
  const aus = new Map();
  if (!rm) return aus;
  const st0 = graphStand(rm);
  for (const { meilenstein, punkt } of aufgaben) if (punkt.status !== "x") aus.set(punkt.id, hebel(rm, punkt, meilenstein.id, st0));
  return aus;
}
/* Punkte mit Termin: getroffen vom Beschluss, sonst die bei dir offenen im Ziel-Meilenstein. */
function terminePunkte() {
  const aus = new Map();
  for (const x of termineAktiv()) {
    const ids = x.paar.punkte.length ? x.paar.punkte.map((t) => t.punkt.id)
      : roadmapPunkte().filter(({ meilenstein, punkt }) => meilenstein.id === x.ms && istBeiDir(punkt)).map(({ punkt }) => punkt.id);
    for (const id of ids) if (!aus.has(id)) aus.set(id, x);
  }
  return aus;
}
/* Folgesatz nach einem Haken: was ist dadurch frei geworden? */
function folgeSatz(id, st0, st1) {
  const ms = (roadmapPunkte().find(({ punkt }) => punkt.id === id) || {}).meilenstein;
  if (!ms || !st1.zahl.has(ms.id)) return { text: `${id} abgehakt.`, fertig: null };
  if (st0.fertig(ms.id) || !st1.fertig(ms.id)) {
    const rest = st1.zahl.get(ms.id).offen.length;
    return { text: `${id} abgehakt. ${ms.id}: ${rest ? `noch ${rest} offen` : "nichts mehr offen"}.`, fertig: null };
  }
  const nach = st1.nach.get(ms.id) || [];
  const frei = nach.filter((s) => !st0.frei(s) && st1.frei(s));
  const teile = [];
  if (frei.length) teile.push(`${aufzaehlen(frei)} ${frei.length === 1 ? "hat" : "haben"} jetzt keine offenen Vorgänger mehr`);
  for (const s of nach.filter((x) => !st1.frei(x))) teile.push(`${s} wartet jetzt nur noch auf ${aufzaehlen(st1.vor.get(s).filter((v) => !st1.fertig(v)))}`);
  return { text: `${id} abgehakt. ${ms.id} fertig${teile.length ? ` – ${teile.join("; ")}` : ""}.`, fertig: ms.id };
}

/* --- Fluss lebt: Perlen je offenem Punkt, Engpass nach Restpunkten, Vorschau, Probe ---
 * Alles hier ist Darstellung: mermaidText und roadmap.json bleiben beim deklarierten Pfad,
 * und die Probe schreibt nichts. Bewegung nur über CSS-Keyframes, damit die reduced-motion-
 * Regel in style.css sie abschaltet. */
let flussAnimation = "";   // "pfad": beim nächsten Zeichnen neue kritische Kanten einzeichnen

function perlenSvg(m, gedacht) {
  const offen = (m.punkte || []).filter((p) => p.status !== "x");
  if (!offen.length) return null;
  const mehr = offen.length > 9;
  const zeigen = mehr ? offen.slice(0, 8) : offen;
  const breite = zeigen.length * 11 + (mehr ? 24 : 0);
  const svg = svgEl("svg", { class: "perlen", width: breite, height: 10, viewBox: `0 0 ${breite} 10`, "aria-hidden": "true", focusable: "false" });
  const { nachzug } = beschluesse();
  zeigen.forEach((p, i) => {
    const cx = 5 + i * 11;
    const art = gedacht.has(p.id) ? "gedacht" : nachzug.has(p.id) ? "nachzug" : istMeins(p) ? "dir" : "ki";
    const gruppe = svgEl("g", { class: `perle ${art}${p.status === "~" && art !== "gedacht" ? " teil" : ""}` });
    gruppe.append(svgEl("circle", { cx, cy: 5, r: 4 }));
    if (p.status === "~" && art !== "gedacht") gruppe.append(svgEl("path", { class: "perle-halb", d: `M${cx - 4} 5A4 4 0 0 0 ${cx + 4} 5Z` }));
    if (art === "gedacht") gruppe.append(svgEl("path", { class: "perle-haken", d: `M${cx - 2} 5.2l1.4 1.4 2.8-3` }));
    svg.append(gruppe);
  });
  if (mehr) {
    const t = svgEl("text", { x: 8 * 11 + 2, y: 9, class: "perlen-mehr" });
    t.textContent = `+${offen.length - 8}`;
    svg.append(t);
  }
  return svg;
}

/* Bis zum Ziel der Kette: Restpunkte, gemessener Pfad (meiste Restpunkte) und Engpass. */
function engpassRechnen(rm, st) {
  const g = st.g;
  const ziel = g.kette.length ? g.kette[g.kette.length - 1] : "";
  if (!ziel || !st.zahl.has(ziel)) return null;
  const pfade = [];
  const suchen = (id, pfad) => {
    if (pfade.length >= 64) return;
    if (id === ziel) { pfade.push([...pfad, id]); return; }
    for (const n of st.nach.get(id) || []) if (!pfad.includes(n) && n !== id) suchen(n, [...pfad, id]);
  };
  for (const m of g.knoten) if (!(st.vor.get(m.id) || []).length) suchen(m.id, []);
  if (!pfade.length) return null;
  const offen = (id) => st.zahl.get(id).offen.length;
  const rest = (pfad) => pfad.reduce((s, id) => s + offen(id), 0);
  const deklariert = g.kette.join(">");
  let gemessen = pfade[0];
  for (const p of pfade) {
    const d = rest(p) - rest(gemessen);
    if (d > 0 || (d === 0 && p.join(">") === deklariert)) gemessen = p;
  }
  const kandidat = gemessen.filter((id) => id !== ziel).sort((a, b) => offen(b) - offen(a))[0];
  const { nachzug } = beschluesse();
  let n = 0;
  let dir = 0;
  let nz = 0;
  for (const id of [ziel, ...st.vorfahren(ziel)]) {
    for (const p of st.zahl.get(id).offen) {
      n++;
      if (istMeins(p)) { dir++; if (nachzug.has(p.id)) nz++; }
    }
  }
  const ms = (rm.meilensteine || []).find((m) => m.id === ziel);
  const v = /\d+\.\d+\.\d+\w*/.exec(ms ? ms.titel : "");
  return {
    ziel, version: v ? v[0] : "", gemessen, n, dir, nz,
    engpass: kandidat && offen(kandidat) ? kandidat : "",
    kanten: new Set(gemessen.slice(1).map((id, i) => `${gemessen[i]}>${id}`)),
  };
}

/* Hover/Fokus auf einem offenen Punkt: was sein Haken frei machen würde. Nur Klassen, kein Neuzeichnen. */
function vorschauWeg() {
  for (const e of document.querySelectorAll("#roadmap-fluss .vorschau-fertig, #roadmap-fluss .vorschau-frei, #roadmap-fluss .vorschau")) {
    e.classList.remove("vorschau-fertig", "vorschau-frei", "vorschau");
  }
}
function vorschauZeigen(punktId) {
  vorschauWeg();
  const rm = zustand.roadmap;
  if (!rm) return;
  const gedacht = new Set(zustand.probe || []);
  const st0 = graphStand(rm, gedacht);
  gedacht.add(punktId);
  const st1 = graphStand(rm, gedacht);
  const ms = (roadmapPunkte().find(({ punkt }) => punkt.id === punktId) || {}).meilenstein;
  if (!ms || st0.fertig(ms.id) || !st1.fertig(ms.id)) return;
  const knoten = (id) => document.querySelector(`#roadmap-fluss [data-fokus="fluss:${CSS.escape(id)}"]`);
  const k = knoten(ms.id);
  if (k) k.classList.add("vorschau-fertig");
  for (const s of st1.nach.get(ms.id) || []) {
    if (st0.frei(s) || !st1.frei(s)) continue;
    const n = knoten(s);
    if (n) n.classList.add("vorschau-frei");
    const kante = document.querySelector(`#roadmap-fluss path[data-von="${CSS.escape(ms.id)}"][data-nach="${CSS.escape(s)}"]`);
    if (kante) kante.classList.add("vorschau");
  }
}

/* Probe: gedachte Haken, nichts wird geschrieben. Endet mit Esc, Knopf, Reiterwechsel, Abmelden. */
function probeUmschalten() {
  zustand.probe = zustand.probe ? null : new Set();
  roadmapTeileZeichnen("fluss:probe");
}
function probeBeenden(fokus) {
  if (!zustand.probe) return;
  zustand.probe = null;
  roadmapTeileZeichnen(fokus);
}
function probeListeZeichnen() {
  const box = $("roadmap-probe");
  box.replaceChildren();
  if (!zustand.probe || !zustand.roadmap) return;
  const liste = el("fieldset", { class: "karte probe-liste" }, el("legend", {}, icon("fluss"), "Gedacht erledigt"));
  for (const m of zustand.roadmap.meilensteine || []) {
    const offen = (m.punkte || []).filter((p) => p.status !== "x");
    if (!offen.length) continue;
    liste.append(el("div", { class: "probe-gruppe" }, el("span", { class: "gruppe-id", text: m.id }), ` ${m.titel}`));
    for (const p of offen) {
      const kasten = el("input", { type: "checkbox", "data-fokus": `probe:${p.id}` });
      kasten.checked = zustand.probe.has(p.id);
      kasten.addEventListener("change", () => {
        if (!zustand.probe) return;
        if (kasten.checked) zustand.probe.add(p.id); else zustand.probe.delete(p.id);
        flussZeichnen();
      });
      liste.append(el("label", { class: "probe-zeile" }, kasten, el("span", { class: "kennung", text: p.id }), el("span", { text: p.titel })));
    }
  }
  box.append(liste);
}

function flussZeichnen() {
  const box = $("roadmap-fluss");
  box.replaceChildren();
  const rm = zustand.roadmap;
  if (!rm || !(rm.meilensteine || []).length) return;
  const gedacht = zustand.probe || new Set();
  const st0 = graphStand(rm);
  const st = zustand.probe ? graphStand(rm, gedacht) : st0;
  const g = st0.g;
  const nachRest = zustand.offen.get("fluss:pfad") === "rest";
  const eng = engpassRechnen(rm, st);
  const kritischeKnoten = nachRest && eng ? eng.gemessen : g.kette;
  const istKritisch = (k) => (nachRest && eng ? eng.kanten.has(`${k.von}>${k.nach}`) : k.kritisch);
  const warKritisch = (k) => (nachRest || !eng ? k.kritisch : eng.kanten.has(`${k.von}>${k.nach}`));
  const animieren = flussAnimation;
  flussAnimation = "";
  const zuendung = zustand.zuendung && zustand.zuendung.bis > Date.now() ? zustand.zuendung.ms : "";
  zustand.zuendung = null;
  const { nachzug } = beschluesse();

  const zahlen = new Map(g.knoten.map((m) => [m.id, meilensteinZahlen(m)]));
  const termine = new Map();
  for (const x of termineAktiv()) if (x.ms && !termine.has(x.ms)) termine.set(x.ms, x);
  const vorgaenger = (id) => st0.vor.get(id) || [];
  const siegel = (m) => {
    const tage = (m.punkte || []).map((p) => p.erledigt || "").filter(Boolean).sort();
    const d = tagAus(tage.length ? tage[tage.length - 1] : rm.stand);
    return d ? `${zweistellig(d.getDate())}.${zweistellig(d.getMonth() + 1)}.` : "";
  };
  const knoten = (m) => {
    const z = zahlen.get(m.id);
    const f1 = el("span", { class: "f-x" }); f1.style.width = z.n ? `${(z.x / z.n) * 100}%` : "0";
    const f2 = el("span", { class: "f-t" }); f2.style.width = z.n ? `${(z.t / z.n) * 100}%` : "0";
    const vor = vorgaenger(m.id);
    const termin = termine.get(m.id);
    const offen = (m.punkte || []).filter((p) => p.status !== "x");
    const nz = offen.filter((p) => nachzug.has(p.id)).length;
    const wirdFrei = zustand.probe && !st0.frei(m.id) && st.frei(m.id);
    const istEngpass = nachRest && eng && eng.engpass === m.id;
    let marke = null;
    if (meilensteinIstNeu(m.id)) marke = el("span", { class: "marke neu", title: "seit deinem letzten Besuch geändert" }, icon("funke"), "neu");
    else if (wirdFrei) marke = el("span", { class: "marke ok probe-frei", title: "in der Probe ohne offene Vorgänger" }, icon("haken"), "frei");
    else if (istEngpass) marke = el("span", { class: "marke zug" }, icon("warnung"), "Engpass");
    else if (z.stufe === "fertig") marke = el("span", { class: "marke ok", title: "fertig seit" }, icon("haken"), `fertig ${siegel(m)}`.trim());
    else if (z.beiDir) marke = el("span", { class: "marke zug", text: `${z.beiDir} bei dir` });
    const k = el("button", {
      type: "button",
      class: `fluss-knoten ms-${z.stufe}${kritischeKnoten.includes(m.id) ? " kritisch" : ""}${zuendung === m.id ? " zuendet" : ""}${istEngpass && animieren === "pfad" ? " engpass-blitz" : ""}`,
      "aria-label": `${m.id} ${m.titel}: ${z.x} von ${z.n} fertig${offen.length ? `, ${offen.length} offen` : ""}${z.beiDir ? `, ${z.beiDir} bei dir` : ""}${nz ? `, ${nz} ${nz === 1 ? "wartet" : "warten"} auf Nachzug` : ""}${vor.length ? `, nach ${vor.join(", ")}` : ""}${termin ? `, Termin ${langDatum(termin.tag)}` : ""}${istEngpass ? ", Engpass" : ""}${wirdFrei ? ", in der Probe frei" : ""}. Punkte zeigen`,
      title: `${m.id} ${m.titel} · ${z.x}/${z.n} fertig`,
      "data-fokus": `fluss:${m.id}`,
      onclick: () => meilensteinZeigen(m.id),
    },
    el("span", { class: "fluss-kopf" }, el("span", { class: "ms-id", text: m.id }), marke),
    el("span", { class: "fluss-titel", text: m.titel }),
    termin ? el("span", { class: "fluss-termin" }, icon("uhr"), `Termin ${kurzDatum(termin.tag)}`) : null,
    vor.length ? el("span", { class: "fluss-nach", text: `nach ${vor.join(" · ")}` }) : null,
    el("span", { class: "fluss-fuss" },
      el("span", { class: "fortschritt" }, f1, f2),
      el("span", { class: "fluss-zahl", text: `${z.x}/${z.n}` })),
    el("span", { class: "perlen-zeile" }, perlenSvg(m, gedacht)));
    return k;
  };

  const spalten = Math.max(...g.knoten.map((m) => g.ebene.get(m.id))) + 1;
  // Breite aus dem Platz in <main>; die Ansicht kann gerade versteckt sein, <main> nie.
  const main = $("inhalt");
  const stil = getComputedStyle(main);
  const platz = main.clientWidth - parseFloat(stil.paddingLeft) - parseFloat(stil.paddingRight) - 38;
  // Stufen nur, wo es eng ist; bei vielen Spalten auf breitem Schirm lieber quer scrollen.
  const breit = platz >= Math.min(spalten * FLUSS.minBreite + (spalten - 1) * FLUSS.spaltenAbstand, FLUSS.stufenUnter);

  let bild;
  const gezuendet = [];
  if (breit) {
    const zeilen = g.knoten.map((m) => g.zeile.get(m.id));
    const oben = Math.min(...zeilen);
    const reihen = Math.max(...zeilen) - oben + 1;
    const breite = Math.max(FLUSS.minBreite, Math.min(FLUSS.maxBreite,
      Math.floor((platz - (spalten - 1) * FLUSS.spaltenAbstand) / spalten)));
    const gesamtB = spalten * breite + (spalten - 1) * FLUSS.spaltenAbstand;
    const gesamtH = reihen * FLUSS.hoehe + (reihen - 1) * FLUSS.zeilenAbstand;
    const lage = new Map(g.knoten.map((m) => [m.id, {
      x: g.ebene.get(m.id) * (breite + FLUSS.spaltenAbstand),
      y: (g.zeile.get(m.id) - oben) * (FLUSS.hoehe + FLUSS.zeilenAbstand),
    }]));

    const flaeche = el("div", { class: "fluss-flaeche" });
    flaeche.style.width = `${gesamtB}px`;
    flaeche.style.height = `${gesamtH}px`;

    const svg = svgEl("svg", { class: "fluss-kanten", width: gesamtB, height: gesamtH, viewBox: `0 0 ${gesamtB} ${gesamtH}`, "aria-hidden": "true", focusable: "false" });
    const defs = svgEl("defs");
    for (const art of ["normal", "kritisch", "fertig"]) {
      const marker = svgEl("marker", { id: `fluss-spitze-${art}`, viewBox: "0 0 10 10", refX: 9, refY: 5, markerWidth: 9, markerHeight: 9, markerUnits: "userSpaceOnUse", orient: "auto" });
      marker.append(svgEl("path", { d: "M0 0L10 5L0 10z", class: `fluss-spitze ${art}` }));
      defs.append(marker);
    }
    svg.append(defs);
    for (const k of g.kanten) {
      const a = lage.get(k.von);
      const b = lage.get(k.nach);
      const x1 = a.x + breite;
      const y1 = a.y + FLUSS.hoehe / 2;
      const x2 = b.x - 2;
      const y2 = b.y + FLUSS.hoehe / 2;
      const knick = Math.max(x1, x2 - FLUSS.spaltenAbstand);
      const d = y1 === y2
        ? `M${x1} ${y1}H${x2}`
        : `M${x1} ${y1}H${knick}C${knick + FLUSS.spaltenAbstand / 2} ${y1} ${x2 - FLUSS.spaltenAbstand / 2} ${y2} ${x2} ${y2}`;
      const kritisch = istKritisch(k);
      const art = zahlen.get(k.von).stufe === "fertig" ? "fertig" : kritisch ? "kritisch" : "normal";
      const einzeichnen = animieren === "pfad" && kritisch && !warKritisch(k);
      const puls = zuendung === k.von;
      const pfad = svgEl("path", {
        d, class: `fluss-kante ${art}${kritisch ? " ist-kritisch" : ""}${einzeichnen ? " einzeichnen" : ""}${puls ? " puls" : ""}`,
        "marker-end": `url(#fluss-spitze-${art})`, "data-von": k.von, "data-nach": k.nach,
        pathLength: einzeichnen || puls ? 100 : null,
      });
      if (puls) gezuendet.push(pfad);
      svg.append(pfad);
    }
    flaeche.append(svg);

    for (const m of g.knoten) {
      const pos = lage.get(m.id);
      const k = knoten(m);
      k.style.left = `${pos.x}px`;
      k.style.top = `${pos.y}px`;
      k.style.width = `${breite}px`;
      k.style.height = `${FLUSS.hoehe}px`;
      flaeche.append(k);
    }
    bild = el("div", { class: "fluss-rahmen" }, flaeche);
  } else {
    // Schmal (Handy): Stufen von oben nach unten, parallele Meilensteine nebeneinander.
    bild = el("ol", { class: "fluss-stufen" });
    for (let e = 0; e < spalten; e++) {
      const hier = g.knoten.filter((m) => g.ebene.get(m.id) === e)
        .sort((a, b) => g.zeile.get(a.id) - g.zeile.get(b.id));
      if (!hier.length) continue;
      bild.append(el("li", { class: "fluss-stufe" + (hier.length > 1 ? " parallel" : "") },
        el("span", { class: "stufe-name", text: `Stufe ${e + 1}${hier.length > 1 ? " · parallel" : ""}` }),
        el("div", { class: "stufe-knoten" }, hier.map(knoten))));
    }
  }
  if (zuendung) {
    // Nach dem Glühen wieder ruhig; die Klassen sollen beim nächsten Zeichnen nicht wiederkommen.
    setTimeout(() => {
      const k = document.querySelector(`#roadmap-fluss [data-fokus="fluss:${CSS.escape(zuendung)}"]`);
      if (k) k.classList.remove("zuendet");
      for (const p of gezuendet) { p.classList.remove("puls"); p.removeAttribute("pathLength"); }
    }, 950);
  }

  const quelltext = mermaidText(rm, g);
  const mermaidPre = el("pre", { class: "text breit mermaid-text", text: quelltext, tabindex: "0", "aria-label": "Mermaid-Quelltext" });
  const mermaidBox = aufklappen(el("details", { class: "mermaid-box" },
    el("summary", {}, icon("runter", "chevron"), "Mermaid-Quelltext (für GitHub, Forum, Doku)"), mermaidPre), "mermaid", false);
  const kopieren = el("button", { type: "button", class: "knopf zweit klein-knopf", onclick: () => mermaidKopieren(quelltext, mermaidBox, mermaidPre) },
    icon("kopieren"), "Mermaid kopieren");
  const pfadKnopf = (wert, text) => el("button", {
    type: "button", class: "knopf zweit klein-knopf", "aria-pressed": (wert === "rest") === nachRest ? "true" : "false", "data-fokus": `fluss:pfad:${wert}`,
    onclick: () => {
      if ((wert === "rest") === nachRest) return;
      zustand.offen.set("fluss:pfad", wert);
      flussAnimation = "pfad";
      mitFokus(flussZeichnen, `fluss:pfad:${wert}`);
    },
  }, text);
  const probeKnopf = el("button", {
    type: "button", class: "knopf zweit klein-knopf probe-knopf", "aria-pressed": zustand.probe ? "true" : "false", "data-fokus": "fluss:probe",
    title: "Gedachte Haken ausprobieren – nichts wird geschrieben", onclick: probeUmschalten,
  }, icon("fluss"), "Probe");

  let satz = null;
  if (eng) {
    const zielName = eng.version ? `v${eng.version}` : eng.ziel;
    const msKnopf = (id) => el("button", { type: "button", class: "ms-link", onclick: () => meilensteinZeigen(id), "aria-label": `${id}: Punkte zeigen` }, id);
    satz = el("div", { class: "engpass" },
      el("p", { class: "engpass-satz" },
        zustand.probe ? el("b", { text: "In der Probe: " }) : null,
        eng.n ? `Bis ${zielName} fehlen ${anzahl(eng.n, "Punkt", "Punkte")}, ${eng.dir} bei dir${eng.nz ? ` (${eng.nz} davon nur noch Nachzug)` : ""}.` : `Bis ${zielName} fehlt kein Punkt mehr.`,
        eng.engpass ? [" Engpass nach Restpunkten: ", msKnopf(eng.engpass), "."] : null),
      el("p", { class: "engpass-fuss", text: "Jeder Punkt zählt 1 – ein PR und ein Handlauf sind nicht gleich groß." }));
  }

  box.append(el("section", { class: "karte fluss" + (zustand.probe ? " in-probe" : ""), "aria-label": "Roadmap als Flussdiagramm" },
    el("div", { class: "fluss-leiste" },
      el("h2", {}, icon("fluss"), "Flussdiagramm"),
      el("div", { class: "fluss-schalter", role: "group", "aria-label": "Kritischer Pfad" },
        pfadKnopf("json", "Pfad laut roadmap.json"), pfadKnopf("rest", "nach Restpunkten")),
      probeKnopf,
      kopieren),
    zustand.probe ? el("p", { class: "probe-banner", role: "status" }, icon("info"),
      el("span", { text: "Probe – nichts wird geschrieben. Die Haken unten sind nur gedacht. Esc oder „Probe beenden“ beendet." }),
      el("button", { type: "button", class: "knopf zweit klein-knopf", "data-fokus": "fluss:probe-ende", onclick: () => probeBeenden("fluss:probe") }, icon("x"), "Probe beenden")) : null,
    rm.kritischer_pfad ? el("p", { class: "lage-pfad" }, icon("roadmap"), el("span", {}, el("b", { text: "Kritischer Pfad: " }), rm.kritischer_pfad)) : null,
    satz,
    bild,
    el("div", { class: "fluss-legende", "aria-hidden": "true" },
      el("span", {}, el("i", { class: "strich kritisch" }), nachRest ? "Pfad nach Restpunkten" : "kritischer Pfad"),
      el("span", {}, el("i", { class: "strich fertig" }), "Vorgänger fertig"),
      el("span", {}, el("i", { class: "strich normal" }), "hängt ab von"),
      el("span", {}, el("i", { class: "punkt-farbe fertig" }), "fertig"),
      el("span", {}, el("i", { class: "punkt-farbe teil" }), "teilweise"),
      el("span", {}, el("i", { class: "punkt-farbe offen" }), "offen"),
      el("span", {}, el("i", { class: "perle-muster dir" }), "offen bei dir"),
      el("span", {}, el("i", { class: "perle-muster ki" }), "offen bei KI"),
      el("span", {}, el("i", { class: "perle-muster nachzug" }), "wartet auf Nachzug"),
      g.ausJson ? null : el("span", { class: "fluss-quelle", text: "Abhängigkeiten: Forum-README (roadmap.json trägt kein „nach“)" })),
    mermaidBox));
}

function meilensteinZeigen(id) {
  zustand.offen.set(`ms:${id}`, true);
  const d = document.querySelector(`#roadmap-meilensteine details[data-ms="${CSS.escape(id)}"]`);
  if (!d) return;
  d.open = true;
  d.scrollIntoView({ behavior: bewegungAus() ? "auto" : "smooth", block: "start" });
  const s = d.querySelector("summary");
  if (s) s.focus({ preventScroll: true });
}

function mermaidText(rm, g) {
  const label = (t) => String(t).replace(/#/g, "#35;").replace(/"/g, "#quot;").replace(/</g, "#lt;").replace(/>/g, "#gt;");
  const knotenId = (id) => String(id).replace(/[^A-Za-z0-9_]/g, "_");
  const z = [
    `%% Roadmap ${rm.produkt || ""} · Stand ${rm.stand || "?"} · erzeugt vom CORE Betreiber-Pult aus roadmap.json`.replace(/\s+·/g, " ·"),
    "flowchart LR",
  ];
  for (const m of g.knoten) {
    const zahl = meilensteinZahlen(m);
    const extra = zahl.beiDir ? ` · ${zahl.beiDir} bei dir` : "";
    z.push(`  ${knotenId(m.id)}["${label(m.id)} · ${label(m.titel)}<br/>${zahl.x}/${zahl.n} fertig${label(extra)}"]:::${zahl.stufe}`);
  }
  for (const k of g.kanten) z.push(`  ${knotenId(k.von)} ${k.kritisch ? "==>" : "-->"} ${knotenId(k.nach)}`);
  z.push(
    "  classDef fertig fill:#e1f3e8,stroke:#1f8a50,color:#17202c",
    "  classDef teil fill:#fbefd6,stroke:#8a5a06,color:#17202c",
    "  classDef offen fill:#edf0f4,stroke:#5f6876,color:#17202c",
  );
  return z.join("\n") + "\n";
}

async function mermaidKopieren(text, box, pre) {
  try {
    if (!navigator.clipboard || !window.isSecureContext) throw new Error("keine Zwischenablage");
    await navigator.clipboard.writeText(text);
    melden("Mermaid-Quelltext kopiert. In GitHub als ```mermaid-Block einfügen.");
  } catch (_) {
    box.open = true;
    const auswahl = window.getSelection();
    const bereich = document.createRange();
    bereich.selectNodeContents(pre);
    auswahl.removeAllRanges();
    auswahl.addRange(bereich);
    pre.focus();
    melden("Quelltext ist markiert – mit Strg+C kopieren.");
  }
}

function punktZeile(q, offeneSlugs) {
  const status = anzeigeStatus(q);
  const frageOffen = q.frage && offeneSlugs.has(q.frage);
  const nachzug = beschluesse().nachzug.get(q.id);
  const verweis = q.frage || q.thread;
  const t = verweis ? threadZuSlug(verweis) : null;
  const zeile = el("li", { class: "punkt" + (status === "x" ? " ist-fertig" : ""), "data-zeile": q.id },
    hakenKnopf(q, "punkt", true),
    el("div", { class: "punkt-haupt" },
      el("div", { class: "punkt-titel" }, el("span", { class: "kennung", text: q.id }), " ", q.titel),
      q.notiz ? el("p", { class: "punkt-notiz", text: q.notiz }) : null,
      q.erledigt ? el("p", { class: "punkt-notiz" }, icon("uhr"), ` erledigt ${datumLesbar(q.erledigt)}${q.von ? " · " + q.von : ""}`) : null),
    el("div", { class: "punkt-rechts" },
      frageOffen ? el("a", { class: "marke zug", href: "#zug" }, icon("rueckfrage"), "Frage offen") : null,
      nachzug ? el("a", { class: "marke leise", href: ankerLink(nachzug.paar.thread, nachzug.paar.antwort), title: `entschieden in ${nachzug.paar.thread.nummer} – roadmap.json zieht noch nach` }, icon("uhr"), "wartet auf Nachzug") : null,
      t ? threadVerweis(t, true) : null,
      werMarke(q.wer, q.status === "x")),
  );
  if (q.status !== "x") {
    zeile.addEventListener("pointerenter", () => vorschauZeigen(q.id));
    zeile.addEventListener("pointerleave", vorschauWeg);
    zeile.addEventListener("focusin", () => vorschauZeigen(q.id));
    zeile.addEventListener("focusout", (e) => { if (!zeile.contains(e.relatedTarget)) vorschauWeg(); });
  }
  return zeile;
}

/* --- Threads --- */

/* Was die Seite aus Forum-Text ableitet (Archiv-Teile, Suchtexte), liegt je Blob-sha nur im
 * Speicher: kein localStorage, Abmelden leert beides. */
const archivSpeicher = new Map();
const suchSpeicher = new Map();
function speicherKappen(speicher) {
  if (speicher.size < zustand.threads.length + 20) return;
  const lebend = new Set(zustand.threads.map((t) => t.sha));
  for (const k of [...speicher.keys()]) if (!lebend.has(k)) speicher.delete(k);
}

/* Textsuche: Wörter mit UND, "Phrase" in Anführungszeichen. Je Wort ein RegExp, umlaut-tolerant
 * („loeschen“ trifft „löschen“ und umgekehrt). */
function suchMuster(eingabe) {
  const woerter = [];
  const teile = /"([^"]*)"?|(\S+)/g;
  let m;
  while ((m = teile.exec(String(eingabe || "")))) {
    const w = (m[1] !== undefined ? m[1] : m[2].replace(/"/g, "")).trim();
    if (w) woerter.push(w);
  }
  return woerter.slice(0, 12).map((w) => {
    let s = w.toLowerCase().replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss");
    s = s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    s = s.replace(/ae/g, "(?:ae|ä)").replace(/oe/g, "(?:oe|ö)").replace(/ue/g, "(?:ue|ü)").replace(/ss/g, "(?:ss|ß)");
    s = s.replace(/\s+/g, "\\s+");
    return { wort: w, re: new RegExp(s, "iu"), alle: new RegExp(s, "giu") };
  });
}

/* Jede Stelle, an der ein Thread Text trägt, mit Sprungmarke (Archiv-Teil oder Block). */
function suchQuellen(t) {
  if (t.sha && suchSpeicher.has(t.sha)) return suchSpeicher.get(t.sha);
  const quellen = [];
  const teile = archivTeile(t);
  if (teile) {
    for (const x of teile) if (x.roh) quellen.push({ text: x.roh, anker: x.anker, wo: `${x.name} · Archiv · ${datumLesbar(x.zeit)}` });
  } else if (t.vorgeschichte) {
    quellen.push({ text: t.vorgeschichte, anker: null, wo: "Archiv" });
  }
  const anker = blockAnker(t);
  for (const b of t.bloecke) quellen.push({ text: b.text, anker: anker.get(b), wo: `${b.ki}/${b.chat} · ${b.sorte} · ${datumLesbar(b.zeit)}` });
  const aus = { kopf: Object.entries(t.kopf).map(([k, v]) => `${k}: ${v}`).join("\n"), quellen };
  if (t.sha) { speicherKappen(suchSpeicher); suchSpeicher.set(t.sha, aus); }
  return aus;
}

function threadSuchen(t, muster) {
  const { kopf, quellen } = suchQuellen(t);
  const titel = `${t.slug} ${t.titel}`;
  for (const mu of muster) {
    if (!mu.re.test(titel) && !mu.re.test(kopf) && !quellen.some((q) => mu.re.test(q.text))) return null;
  }
  let stellen = 0;
  for (const text of [kopf, ...quellen.map((q) => q.text)]) {
    for (const mu of muster) {
      mu.alle.lastIndex = 0;
      while (mu.alle.exec(text)) stellen++;
    }
  }
  // Ausschnitte: zuerst Stellen mit allen Wörtern, dann mit dem ersten; je Thread höchstens zwei
  const mitAllen = quellen.filter((q) => muster.every((mu) => mu.re.test(q.text)));
  const mitErstem = quellen.filter((q) => !mitAllen.includes(q) && muster[0].re.test(q.text));
  return { t, titelTreffer: muster.every((mu) => mu.re.test(titel)), stellen, ausschnitte: mitAllen.concat(mitErstem).slice(0, 2) };
}

/* ±60 Zeichen um die erste Stelle des ersten Worts, an Wortgrenzen geschnitten. */
function ausschnitt(text, muster) {
  const m0 = muster[0].re.exec(text);
  if (!m0) return "";
  const von = Math.max(0, m0.index - 200);
  const bis = Math.min(text.length, m0.index + m0[0].length + 200);
  // Fett- und Code-Zeichen stören im Ausschnitt nur; ohne sie bleibt der Treffer aber auffindbar
  const fenster = text.slice(von, bis).replace(/\s+/g, " ");
  const ohneZeichen = fenster.replace(/\*\*|`+/g, "");
  const flach = muster[0].re.test(ohneZeichen) ? ohneZeichen : fenster;
  const m = muster[0].re.exec(flach);
  if (!m) return "";
  let a = Math.max(0, m.index - 60);
  let e = Math.min(flach.length, m.index + m[0].length + 60);
  if (a > 0) { const l = flach.indexOf(" ", a); if (l >= 0 && l < m.index) a = l + 1; }
  if (e < flach.length) { const l = flach.lastIndexOf(" ", e); if (l > m.index + m[0].length) e = l; }
  return `${von > 0 || a > 0 ? "…" : ""}${flach.slice(a, e).trim()}${bis < text.length || e < flach.length ? "…" : ""}`;
}

/* Suchwörter als <mark>, gebaut aus Textknoten. */
function markiert(text, muster) {
  if (!muster || !muster.length) return [text];
  const bereiche = [];
  for (const mu of muster) {
    mu.alle.lastIndex = 0;
    let m;
    while ((m = mu.alle.exec(text))) bereiche.push([m.index, m.index + m[0].length]);
  }
  bereiche.sort((x, y) => x[0] - y[0]);
  const aus = [];
  let pos = 0;
  for (const [a, e] of bereiche) {
    if (e <= pos) continue;
    const start = Math.max(a, pos);
    const letzte = aus[aus.length - 1];
    if (start === pos && letzte instanceof Node && letzte.nodeName === "MARK") letzte.textContent += text.slice(start, e);
    else {
      if (start > pos) aus.push(text.slice(pos, start));
      aus.push(el("mark", { text: text.slice(start, e) }));
    }
    pos = e;
  }
  if (pos < text.length) aus.push(text.slice(pos));
  return aus;
}

function threadZeile(t, muster) {
  const l = t.letzter;
  return el("a", { class: "thread-zeile" + (t.offen.length ? " hat-frage" : "") + (t.geschlossen ? " ist-zu" : ""), href: `#t/${encodeURIComponent(t.slug)}` },
    el("span", { class: "thread-nr", text: t.nummer || "–" }),
    el("span", { class: "thread-haupt" },
      el("span", { class: "thread-titel" }, markiert(t.titel, muster)),
      el("span", { class: "thread-letzt", text: l ? `zuletzt ${l.sorte} · ${l.ki}/${l.chat} · ${zeitLesbar(l.zeit)}` : (t.kopf.Aktualisiert ? `Archiv · ${t.kopf.Aktualisiert.slice(0, 10)}` : "Archiv") })),
    el("span", { class: "thread-rechts" },
      threadIstNeu(t) ? el("span", { class: "marke neu" }, icon("funke"), "neu") : null,
      t.offen.length ? el("span", { class: "marke zug" }, icon("rueckfrage"), "Frage an dich") : null,
      t.art ? el("span", { class: "marke", text: t.art }) : null,
      el("span", { class: `marke ${t.geschlossen ? "ok" : "offen"}`, text: t.geschlossen ? "geschlossen" : "offen" })));
}

/* Links in Links sind nicht erlaubt: Zeile und Ausschnitte stehen nebeneinander in einem div. */
function trefferZeile(r, muster) {
  return el("div", { class: "thread-treffer" }, threadZeile(r.t, muster),
    r.ausschnitte.length ? el("ul", { class: "treffer-stellen" }, r.ausschnitte.map((q) => el("li", {},
      el("a", { class: "treffer-stelle", href: `#t/${encodeURIComponent(r.t.slug)}${q.anker ? "~" + q.anker : ""}` },
        el("span", { class: "treffer-wo", text: `${q.wo} – ` }),
        el("span", { class: "treffer-text" }, markiert(ausschnitt(q.text, muster), muster)))))) : null);
}

let suchTimer = null;
function anzahlSetzen(text) {
  const z = $("thread-anzahl");
  if (z.textContent !== text) z.textContent = text;   // aria-live: nur echte Änderungen ansagen
}

function threadListeZeichnen() {
  const muster = suchMuster($("thread-suche").value);
  const nurOffene = $("nur-offene").checked;
  const liste = $("thread-liste");
  liste.replaceChildren();
  const sichtbar = (t) => !nurOffene || !t.geschlossen || t.offen.length > 0;
  if (!muster.length) {
    const treffer = zustand.threads.filter(sichtbar);
    anzahlSetzen(anzahl(treffer.length, "Thread", "Threads"));
    if (!treffer.length) liste.append(leer("suche", "Kein Thread passt.", nurOffene ? "„nur offene“ abschalten zeigt auch geschlossene." : null));
    for (const t of treffer) liste.append(threadZeile(t));
    return;
  }
  const alle = [];
  for (const t of zustand.threads) {
    const r = threadSuchen(t, muster);
    if (r) alle.push(r);
  }
  alle.sort((a, b) => (b.titelTreffer - a.titelTreffer) || (b.stellen - a.stellen) || ((Number(b.t.nummer) || 0) - (Number(a.t.nummer) || 0)));
  const treffer = alle.filter((r) => sichtbar(r.t));
  const verborgen = alle.length - treffer.length;
  anzahlSetzen(`${anzahl(treffer.length, "Thread", "Threads")}, ${anzahl(treffer.reduce((s, r) => s + r.stellen, 0), "Stelle", "Stellen")}`);
  if (verborgen) {
    liste.append(el("p", { class: "treffer-zu" }, icon("info"), el("span", {}, `+${verborgen} Treffer in geschlossenen Threads · `,
      el("button", {
        type: "button", class: "knopf-link", "data-fokus": "treffer-zu",
        onclick: () => { $("nur-offene").checked = false; threadListeZeichnen(); $("nur-offene").focus(); },
      }, "zeigen"))));
  }
  if (!treffer.length) liste.append(leer("suche", "Nichts gefunden.", "Wörter gelten mit UND, \"in Anführungszeichen\" als Phrase."));
  for (const r of treffer.slice(0, 60)) liste.append(trefferZeile(r, muster));
  if (treffer.length > 60) liste.append(el("p", { class: "hinweis", text: `60 von ${treffer.length} Threads gezeigt – Suche eingrenzen.` }));
}

/* Rahmen, Spalten, Einzug: als Monospace stehen lassen. Zeilen über 400 Zeichen sind nie
 * Tabellen; der Rest linear prüfen (kein .*\s{3,} mehr). */
function istBreit(zeilen) {
  return zeilen.some((z) => z.length <= 400
    && (/[┌└│─+|]{3,}/.test(z) || (/^\s{2,}\S/.test(z) && /\S\s{3,}\S/.test(z.trimStart()))));
}
function textBlock(text) {
  return el("pre", { class: "text" + (istBreit(text.split("\n")) ? " breit" : ""), text });
}

/* ---------- Lesemodus: Markdown der KIs als gesetzter Text ----------
 * Nur el() und Textknoten, nie innerHTML. Block-Regeln gelten am Zeilenanfang; jede Regel
 * läuft linear (fremde Inhalte dürfen das Pult nicht einfrieren). */

let lesemodus = (() => { try { return localStorage.getItem(LESEMODUS_SCHLUESSEL) === "roh" ? "roh" : "gesetzt"; } catch (_) { return "gesetzt"; } })();

const MD_ZAUN = /^( {0,3})(`{3,})(.*)$/;
const MD_TITEL = /^ {0,3}(#{1,6})[ \t]+(\S.*)$/;
const MD_PUNKT = /^( {0,3})([-*])[ \t]+(\S.*)$/;
const MD_NUMMER = /^( {0,3})(\d{1,9})([.)])[ \t]+(\S.*)$/;
const MD_ZITAT = /^ {0,3}>/;
const MD_LINIE = /^ {0,3}(?:-{3,}|\*{3,}|_{3,})[ \t]*$/;
const MD_LINK = /\[([^[\]\n]{1,300})\]\((https:\/\/[^\s()<>"]{1,2000})\)/y;
const NACKT_URL = /https:\/\/[^\s<>"`]{1,2000}/y;
const LESE_TIEFE = 6;   // Listen und Zitate in Listen und Zitaten: höchstens so tief

function urlGeprueft(u) {
  try { return new URL(u).protocol === "https:"; } catch (_) { return false; }
}
/* Schließende Satzzeichen gehören nicht zur Adresse; eine Klammer nur, wenn sie offen war. */
function urlKuerzen(u) {
  let e = u.length;
  while (e > 8) {
    const c = u[e - 1];
    if (".,;:!?'\"»«“”„‘’*_".includes(c)) { e--; continue; }
    const auf = c === ")" ? "(" : c === "]" ? "[" : c === "}" ? "{" : "";
    if (auf) {
      const s = u.slice(0, e);
      if (s.split(auf).length < s.split(c).length) { e--; continue; }
    }
    break;
  }
  return u.slice(0, e);
}
function verweisAussen(href, text) {
  return el("a", { href, target: "_blank", rel: "noopener noreferrer" }, text);
}

/* Inline: `code`, **fett**, [Text](https://…), https://…. Kein Kursiv: ein * im Fließtext ist zu
 * oft wörtlich gemeint. Ein Zeichen ohne Gegenstück merkt sich das, damit nichts quadratisch sucht. */
function inline(text, ohneFett) {
  const frag = document.createDocumentFragment();
  const s = String(text);
  const n = s.length;
  const ohneGegenstueck = new Set();
  let i = 0;
  let rest = 0;
  const roh = (bis) => { if (bis > rest) frag.append(document.createTextNode(s.slice(rest, bis))); };
  while (i < n) {
    const c = s.charCodeAt(i);
    if (c === 96) {
      let j = i + 1;
      while (j < n && s.charCodeAt(j) === 96) j++;
      const zu = ohneGegenstueck.has(j - i) ? -1 : s.indexOf(s.slice(i, j), j);
      if (zu < 0) { ohneGegenstueck.add(j - i); i = j; continue; }
      let code = s.slice(j, zu);
      if (code.length > 2 && code[0] === " " && code[code.length - 1] === " " && code.trim()) code = code.slice(1, -1);
      roh(i);
      frag.append(el("code", { text: code }));
      i = rest = zu + (j - i);
      continue;
    }
    if (c === 42 && !ohneFett && s.charCodeAt(i + 1) === 42) {
      const zu = ohneGegenstueck.has("**") ? -1 : s.indexOf("**", i + 2);
      if (zu < 0) { ohneGegenstueck.add("**"); i += 2; continue; }
      const innen = s.slice(i + 2, zu);
      if (innen.trim() && innen === innen.trim()) {
        roh(i);
        frag.append(el("strong", {}, inline(innen, true)));
        i = rest = zu + 2;
        continue;
      }
      i += 2;
      continue;
    }
    if (c === 91) {
      MD_LINK.lastIndex = i;
      const m = MD_LINK.exec(s);
      if (m && urlGeprueft(m[2])) {
        roh(i);
        frag.append(verweisAussen(m[2], m[1]));
        i = rest = i + m[0].length;
        continue;
      }
    } else if (c === 104 && s.startsWith("https://", i)) {
      NACKT_URL.lastIndex = i;
      const m = NACKT_URL.exec(s);
      const url = m ? urlKuerzen(m[0]) : "";
      if (url.length > 8 && urlGeprueft(url)) {
        roh(i);
        frag.append(verweisAussen(url, url));
        i = rest = i + url.length;
        continue;
      }
    }
    i++;
  }
  roh(n);
  return frag;
}
/* Mehrzeilig: die KIs schreiben zeilenweise, also wird jeder Umbruch ein <br>. */
function zeilenSetzen(text) {
  const frag = document.createDocumentFragment();
  String(text).split("\n").forEach((z, k) => {
    if (k) frag.append(el("br"));
    frag.append(inline(z.trim()));
  });
  return frag;
}

function einzugWeg(z, k) {
  let i = 0;
  while (i < k && i < z.length && z[i] === " ") i++;
  return z.slice(i);
}
const tabsWeg = (z) => z.replace(/^\t+/, (t) => "    ".repeat(t.length));
const einzugVon = (z) => z.length - z.trimStart().length;

function zellenTeilen(z) {
  const s = z.trim();
  const zellen = [];
  let akt = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "\\" && s[i + 1] === "|") { akt += "|"; i++; } else if (c === "|") { zellen.push(akt); akt = ""; } else akt += c;
  }
  zellen.push(akt);
  if (s.startsWith("|")) zellen.shift();
  if (s.length > 1 && s.endsWith("|") && !s.endsWith("\\|")) zellen.pop();
  return zellen;
}
function istTrennzeile(z) {
  if (z.indexOf("|") < 0 || z.indexOf("-") < 0) return false;
  const zellen = zellenTeilen(z);
  return zellen.length > 0 && zellen.every((c) => /^:?-+:?$/.test(c.trim()));
}
const istTabellenStart = (zeilen, i) => /^ {0,3}\|/.test(zeilen[i]) && i + 1 < zeilen.length && istTrennzeile(zeilen[i + 1]);
function istZaun(z) {
  const m = MD_ZAUN.exec(z);
  return m && !m[3].includes("`") ? m : null;
}
function unterbricht(zeilen, i, tiefe) {
  const z = zeilen[i];
  if (istZaun(z) || MD_LINIE.test(z) || MD_TITEL.test(z) || istTabellenStart(zeilen, i)) return true;
  if (tiefe >= LESE_TIEFE) return false;
  const nr = MD_NUMMER.exec(z);
  return MD_ZITAT.test(z) || MD_PUNKT.test(z) || (!!nr && nr[2] === "1");
}

function absatzSetzen(zeilen) {
  if (istBreit(zeilen)) return el("pre", { class: "text breit", text: zeilen.join("\n") });
  if (zeilen.every((z) => /^(?: {4}|\t)/.test(z))) return el("pre", { class: "text breit", text: zeilen.map((z) => einzugWeg(tabsWeg(z), 4)).join("\n") });
  const p = el("p");
  zeilen.forEach((z, k) => {
    if (k) p.append(el("br"));
    p.append(inline(z.trim()));
  });
  return p;
}

function tabelleSetzen(zeilen, i, ziel) {
  const kopf = zellenTeilen(zeilen[i]);
  const ausrichtung = zellenTeilen(zeilen[i + 1]).map((c) => {
    const s = c.trim();
    return s.endsWith(":") ? (s.startsWith(":") ? "mitte" : "rechts") : null;
  });
  i += 2;
  const reihen = [];
  while (i < zeilen.length && /^ {0,3}\|/.test(zeilen[i])) reihen.push(zellenTeilen(zeilen[i++]));
  const zelle = (tag, inhalt, k) => el(tag, { class: ausrichtung[k] || null, scope: tag === "th" ? "col" : null }, inline(inhalt.trim()));
  const tabelle = el("table", {},
    el("thead", {}, el("tr", {}, kopf.map((c, k) => zelle("th", c, k)))),
    reihen.length ? el("tbody", {}, reihen.map((r) => {
      while (r.length < kopf.length) r.push("");
      return el("tr", {}, r.map((c, k) => zelle("td", c, k)));
    })) : null);
  // Es scrollt nur die Tabelle, nie die Seite; tabindex, damit die Tastatur mitscrollt.
  ziel.append(el("div", { class: "tabelle", tabindex: "0", role: "region", "aria-label": "Tabelle" }, tabelle));
  return i;
}

function listeSetzen(zeilen, i, ziel, tiefe) {
  const n = zeilen.length;
  const erste = MD_NUMMER.exec(zeilen[i]);
  const muster = erste ? MD_NUMMER : MD_PUNKT;
  const liste = el(erste ? "ol" : "ul");
  if (erste && erste[2] !== "1") liste.setAttribute("start", String(parseInt(erste[2], 10)));
  while (i < n) {
    const m = muster.exec(zeilen[i]);
    if (!m) break;
    const text = m[m.length - 1];
    const basis = m[1].length;
    const inhaltAb = zeilen[i].length - text.length;
    const gehoertDazu = (z) => einzugVon(tabsWeg(z)) >= basis + 2;
    const inhalt = [text];
    i++;
    // Folgezeilen mit mindestens 2 Leerzeichen Einzug gehören zum Punkt, auch nach einer Leerzeile
    while (i < n) {
      if (zeilen[i].trim()) {
        if (!gehoertDazu(zeilen[i])) break;
        inhalt.push(einzugWeg(tabsWeg(zeilen[i]), inhaltAb));
        i++;
        continue;
      }
      let j = i;
      while (j < n && !zeilen[j].trim()) j++;
      if (j >= n || !gehoertDazu(zeilen[j])) break;
      for (; i < j; i++) inhalt.push("");
    }
    const li = el("li");
    bloeckeSetzen(inhalt, li, tiefe + 1);
    if (li.childNodes.length === 1 && li.firstChild.nodeName === "P") li.replaceChildren(...li.firstChild.childNodes);
    liste.append(li);
    let j = i;
    while (j < n && !zeilen[j].trim()) j++;
    if (j > i && j < n && muster.test(zeilen[j])) i = j;
  }
  ziel.append(liste);
  return i;
}

function bloeckeSetzen(zeilen, ziel, tiefe) {
  const n = zeilen.length;
  let i = 0;
  while (i < n) {
    const z = zeilen[i];
    if (!z.trim()) { i++; continue; }
    let m;
    if ((m = istZaun(z))) {
      const laenge = m[2].length;
      const inhalt = [];
      for (i++; i < n; i++) {
        const t = zeilen[i].trim();
        if (t.length >= laenge && /^`+$/.test(t) && einzugVon(zeilen[i]) < 4) break;
        inhalt.push(einzugWeg(zeilen[i], m[1].length));
      }
      i++;
      ziel.append(el("pre", { class: "text breit", text: inhalt.join("\n") }));
      continue;
    }
    if (MD_LINIE.test(z)) { ziel.append(el("hr")); i++; continue; }
    if ((m = MD_TITEL.exec(z))) {
      // „## Titel ##“: schließende Rauten weg (von Hand, ohne Regex mit Rückschritten)
      let t = m[2].trimEnd();
      let e = t.length;
      while (e > 0 && t[e - 1] === "#") e--;
      if (e < t.length && (e === 0 || t[e - 1] === " " || t[e - 1] === "\t")) t = t.slice(0, e).trimEnd();
      // # → h3, ## und tiefer → h4: die h2 bleibt dem Thread-Titel
      ziel.append(el(m[1].length === 1 ? "h3" : "h4", {}, inline(t || m[2])));
      i++;
      continue;
    }
    if (istTabellenStart(zeilen, i)) { i = tabelleSetzen(zeilen, i, ziel); continue; }
    if (tiefe < LESE_TIEFE && MD_ZITAT.test(z)) {
      const innen = [];
      while (i < n && MD_ZITAT.test(zeilen[i])) innen.push(zeilen[i++].replace(/^ {0,3}> ?/, ""));
      const zitat = el("blockquote");
      bloeckeSetzen(innen, zitat, tiefe + 1);
      ziel.append(zitat);
      continue;
    }
    if (tiefe < LESE_TIEFE && (MD_PUNKT.test(z) || MD_NUMMER.test(z))) { i = listeSetzen(zeilen, i, ziel, tiefe); continue; }
    const absatz = [];
    while (i < n && zeilen[i].trim() && !(absatz.length && unterbricht(zeilen, i, tiefe))) absatz.push(zeilen[i++]);
    ziel.append(absatzSetzen(absatz));
  }
}

function lesetext(text) {
  const frag = document.createDocumentFragment();
  bloeckeSetzen(String(text).replace(/\r\n?/g, "\n").split("\n"), frag, 0);
  return frag;
}
const lesetextBox = (text) => el("div", { class: "lesetext" }, lesetext(text));

/* ---------- Archiv in Beiträgen ----------
 * Die Vorgeschichte (Import aus bsvp-forum-zugang) trennt Kommentare mit
 *   ---
 *   Kommentar: <name> <zeit>
 *   <https-Link>
 * Ein Teil beginnt meist mit der Signatur **[perplexity]** <Rest der Zeile>. */
const ARCHIV_TRENNER = /^---\nKommentar: (\S+) (\S+)\n(https:\/\/\S+)\n/m;
const ARCHIV_SIGNATUR = /^\*\*\[([^\]\n]+)\]\*\*[ \t]*(.*)$/;

function archivTeil(stueck, name, zeit, link) {
  const roh = stueck.replace(/^(?:[ \t]*\n)+/, "").trimEnd();
  const zeilen = roh.split("\n");
  const sig = ARCHIV_SIGNATUR.exec(zeilen[0] || "");
  return {
    name: sig ? sig[1].trim() : name || "Eröffnung",
    untertitel: sig ? sig[2].replace(/^[·\s]+/, "").trim() : "",
    zeit: String(zeit || ""),
    link: urlGeprueft(link) ? link : "",
    roh,
    text: sig ? zeilen.slice(1).join("\n").replace(/^(?:[ \t]*\n)+/, "") : roh,
    signiert: !!sig,
  };
}

/* null = Muster passt nicht (dann bleibt der Kasten „Vorgeschichte“). */
function archivTeile(t) {
  if (!t.vorgeschichte) return null;
  if (t.sha && archivSpeicher.has(t.sha)) return archivSpeicher.get(t.sha);
  const stuecke = t.vorgeschichte.split(ARCHIV_TRENNER);   // [Eröffnung, name, zeit, link, Teil 1, …]
  const teile = [archivTeil(stuecke[0], "", t.kopf.Angelegt, t.kopf.Quelle)];
  for (let k = 1; k + 3 < stuecke.length; k += 4) teile.push(archivTeil(stuecke[k + 3], stuecke[k], stuecke[k + 1], stuecke[k + 2]));
  teile.forEach((x, n) => { x.anker = `a${n}`; });
  const aus = teile.length > 1 || teile[0].signiert ? teile : null;
  if (t.sha) { speicherKappen(archivSpeicher); archivSpeicher.set(t.sha, aus); }
  return aus;
}

function avatarKlasse(ki) {
  if (ki === ICH.ki) return "av-ich";
  let h = 0;
  for (const c of ki) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return `av-${h % 6}`;
}
function sorteMarke(sorte) {
  const art = sorte === "FRAGE" ? "zug"
    : sorte === "BESCHLUSS" || sorte === "ANTWORT" || sorte === "ZUSTIMMUNG" ? "ok"
      : sorte === "EINWAND" || sorte === "ZURUECK" ? "teil" : "";
  return el("span", { class: `marke ${art}`.trim(), text: sorte });
}

/* Ein Beitrag im Verlauf. „Rohtext“ zeigt das textBlock-<pre> byte-gleich; Zustand je Anker
 * in zustand.offen, sonst gilt der Lesemodus aus dem Thread-Kopf. */
function blockArtikel({ t, anker, klasse, avatar, kuerzel, kopf, werkzeug, roh, gesetzt, name }) {
  const schl = `roh:${t.slug}~${anker}`;
  const istRoh = () => (zustand.offen.has(schl) ? zustand.offen.get(schl) : lesemodus === "roh");
  const inhalt = el("div", { class: "block-text" });
  const knopf = el("button", {
    type: "button", class: "roh-knopf", "data-fokus": schl,
    "aria-label": `Rohtext: ${name}`, title: "So zeigen, wie es in der Datei steht",
  }, icon("code"), "Rohtext");
  const fuellen = () => {
    const r = istRoh();
    knopf.setAttribute("aria-pressed", r ? "true" : "false");
    inhalt.replaceChildren(r ? textBlock(roh) : gesetzt());
  };
  knopf.addEventListener("click", () => { zustand.offen.set(schl, !istRoh()); fuellen(); });
  fuellen();
  return el("article", { class: `block ${klasse}`, "data-anker": anker, id: `anker-${anker}`, tabindex: "-1" },
    el("span", { class: `block-avatar ${avatar}`, "aria-hidden": "true", text: kuerzel }),
    el("div", { class: "karte block-inhalt" },
      el("div", { class: "block-kopf" }, kopf, el("span", { class: "block-werkzeug" }, werkzeug, knopf)),
      inhalt));
}

function archivBlock(t, x) {
  return blockArtikel({
    t, anker: x.anker, klasse: "s-archiv", name: `${x.name}, Archiv ${zeitLesbar(x.zeit)}`,
    avatar: avatarKlasse(x.name.toLowerCase().replace(/[\s·]+/g, "-")), kuerzel: x.name.slice(0, 1).toUpperCase(),
    kopf: [
      el("span", { class: "block-sig", text: x.name }),
      el("span", { class: "marke leise", text: "Archiv" }),
      x.zeit ? el("time", { class: "meta", title: "Zeit der Übertragung ins alte Forum, nicht der Schreibzeit", text: zeitLesbar(x.zeit) }) : null,
    ],
    werkzeug: x.link ? el("a", { class: "block-quelle", href: x.link, target: "_blank", rel: "noopener noreferrer" }, "auf GitHub") : null,
    roh: x.roh,
    gesetzt: () => el("div", { class: "lesetext" },
      x.untertitel ? el("p", { class: "block-untertitel" }, inline(x.untertitel)) : null,
      lesetext(x.text)),
  });
}

/* Betreiber-Antworten beginnen mit „Zu FRAGE [ki/chat] zeit“. Gibt es mehrere FRAGEn mit
 * gleicher Zeit (029: drei um 02:31), entscheidet der Text der gewählten Vorschlags-Zeile. */
const ZU_FRAGE = /^Zu FRAGE \[([a-z0-9_-]+)\/([a-z0-9_-]+)\] (\S+)\s*$/;
const WAHL = /^Wahl: (?:Vorschlag ([A-Z]): (.*)|eigene Antwort)\s*$/;
function antwortenZuordnen(t) {
  const frageVon = new Map();    // Betreiber-Block -> FRAGE-Block (null: nicht gefunden)
  const antwortZu = new Map();   // FRAGE-Block -> letzte Wahl {block, buchstabe, eigen}
  t.bloecke.forEach((b, i) => {
    if (b.ki !== ICH.ki) return;
    const zeilen = b.text.split("\n");
    const m = ZU_FRAGE.exec(zeilen[0] || "");
    if (!m) return;
    const w = WAHL.exec(zeilen[1] || "");
    let kandidaten = t.bloecke.slice(0, i).filter((x) => x.sorte === "FRAGE" && x.ki === m[1] && x.chat === m[2] && x.zeit === m[3]);
    if (kandidaten.length > 1 && w && w[1]) {
      const passend = kandidaten.filter((x) => frageParsen(x).vorschlaege.some((v) => v.buchstabe === w[1] && v.text.trim() === w[2].trim()));
      if (passend.length) kandidaten = passend;
    }
    const frage = kandidaten.length ? kandidaten[kandidaten.length - 1] : null;
    frageVon.set(b, frage);
    if (frage && w) antwortZu.set(frage, { block: b, buchstabe: w[1] || "", eigen: !w[1] });
  });
  return { frageVon, antwortZu };
}

function frageLesen(t, b, anker, bezug) {
  const f = frageParsen(b);
  const antwort = bezug.antwortZu.get(b);
  const aus = el("div", { class: "lesetext frage-lese" },
    el("h3", { class: "frage-lese-titel" }, zeilenSetzen(f.frage || t.titel)),
    f.kontext ? lesetext(f.kontext) : null,
    f.roadmap.length ? el("div", { class: "marken" }, f.roadmap.map((r) => el("span", { class: "marke", text: r }))) : null);
  if (t.offen.includes(b)) {
    // Die Vorschläge stehen in der Antwortkarte darunter: hier nicht noch einmal.
    aus.append(el("p", { class: "frage-offen" }, icon("rueckfrage"),
      el("span", {}, "Offen – die Antwortkarte steht unten. ",
        el("a", { href: `#t/${encodeURIComponent(t.slug)}~${anker}-antwort` }, "Zur Antwortkarte"))));
    return aus;
  }
  if (f.vorschlaege.length) {
    aus.append(el("ol", { class: "vorschlaege-lese" }, f.vorschlaege.map((v) => {
      const gewaehlt = !!antwort && antwort.buchstabe === v.buchstabe;
      const empfohlen = v.buchstabe === f.empfohlen;
      return el("li", { class: "vorschlag-lese" + (gewaehlt ? " ist-gewaehlt" : "") + (empfohlen ? " ist-empfohlen" : "") },
        el("span", { class: "vorschlag-buchstabe", text: v.buchstabe }),
        el("span", { class: "vorschlag-text" }, inline(v.text),
          empfohlen || gewaehlt ? el("span", { class: "vorschlag-marken" },
            empfohlen ? el("span", { class: "empfohlen" }, icon("stern"), "Empfehlung") : null,
            gewaehlt ? el("span", { class: "marke ok" }, icon("haken"), "gewählt") : null) : null));
    })));
  }
  if (antwort && antwort.eigen) aus.append(el("p", { class: "wahl-eigen" }, icon("notiz"), "eigene Antwort"));
  if (f.empfehlung) aus.append(el("p", { class: "empfehlung" }, icon("stern"), el("span", {}, el("b", { text: "Empfehlung: " }), inline(f.empfehlung))));
  if (antwort) {
    aus.append(el("p", { class: "frage-bezug" },
      el("a", { href: ankerLink(t, antwort.block) }, `↓ zur Antwort (${antwort.block.sorte}, ${zeitLesbar(antwort.block.zeit)})`)));
  }
  return aus;
}

function antwortLesen(t, b, frage) {
  const zeilen = b.text.split("\n");
  const aus = el("div", { class: "lesetext antwort-lese" },
    el("p", { class: "frage-bezug" }, frage
      ? el("a", { href: ankerLink(t, frage) }, `↑ zur Frage (${frage.ki}/${frage.chat}, ${zeitLesbar(frage.zeit)})`)
      : zeilen[0]));
  let i = 1;
  let m;
  if ((m = /^Wahl: (.+)$/.exec(zeilen[i] || ""))) { aus.append(el("p", { class: "wahl" }, "Wahl: ", el("strong", {}, inline(m[1])))); i++; }
  else if ((zeilen[i] || "").trim() === "Rückfrage") { aus.append(el("p", { class: "wahl" }, el("strong", { text: "Rückfrage" }))); i++; }
  // Angabe-Zeilen (Pfad:, Termin:, Anzahl:, Angabe:) direkt nach der Wahl
  const angaben = [];
  while (i < zeilen.length && (m = /^(Pfad|Termin|Anzahl|Angabe): (.*)$/.exec(zeilen[i]))) {
    angaben.push(el("dt", { text: m[1] }), el("dd", { class: m[1] === "Pfad" ? "mono" : null, text: m[2] }));
    i++;
  }
  if (angaben.length) aus.append(el("dl", { class: "angaben" }, angaben));
  const rest = zeilen.slice(i).join("\n").trim();
  if (rest) aus.append(lesetext(rest));
  return aus;
}

function neuerBlock(t, b, anker, bezug) {
  const neu = istNeuerBlock(b);
  const gesetzt = b.sorte === "FRAGE" ? () => frageLesen(t, b, anker, bezug)
    : bezug.frageVon.has(b) ? () => antwortLesen(t, b, bezug.frageVon.get(b))
      : () => lesetextBox(b.text);
  return blockArtikel({
    t, anker, klasse: `s-${b.sorte}${neu ? " ist-neu" : ""}`, name: `${b.ki}/${b.chat}, ${b.sorte} ${zeitLesbar(b.zeit)}`,
    avatar: avatarKlasse(b.ki), kuerzel: b.ki.slice(0, 1).toUpperCase(),
    kopf: [
      el("span", { class: "block-sig", text: `${b.ki}/${b.chat}` }),
      sorteMarke(b.sorte),
      neu ? el("span", { class: "marke neu" }, icon("funke"), "neu") : null,
      el("time", { class: "meta", text: zeitLesbar(b.zeit) }),
    ],
    roh: b.text,
    gesetzt,
  });
}

function threadDetailZeichnen(slug) {
  const ziel = $("thread-detail");
  ziel.replaceChildren();
  const t = threadZuSlug(slug);
  if (!t) { ziel.append(leer("suche", `Thread ${slug} nicht gefunden.`)); return; }

  const kopfzeilen = el("dl", { class: "kopfzeilen" });
  for (const [k, v] of Object.entries(t.kopf)) {
    if (k === "Titel") continue;
    kopfzeilen.append(el("dt", { text: k }), el("dd", { text: v }));
  }
  const rohSchalter = el("input", { type: "checkbox", class: "schalter", "data-fokus": "lesemodus" });
  rohSchalter.checked = lesemodus === "roh";
  rohSchalter.addEventListener("change", () => {
    lesemodus = rohSchalter.checked ? "roh" : "gesetzt";
    try { localStorage.setItem(LESEMODUS_SCHLUESSEL, lesemodus); } catch (_) { /* gesperrt: gilt bis zum Neuladen */ }
    for (const k of [...zustand.offen.keys()]) if (k.startsWith("roh:")) zustand.offen.delete(k);
    mitFokus(() => threadDetailZeichnen(slug));
  });
  ziel.append(el("div", { class: "karte thread-kopf" },
    el("div", { class: "thread-kopf-zeile" },
      el("span", { class: "thread-nr", text: t.nummer || "–" }),
      el("h2", { text: t.titel }),
      el("span", { class: `marke ${t.geschlossen ? "ok" : "offen"}`, text: t.geschlossen ? "geschlossen" : "offen" })),
    kopfzeilen,
    el("div", { class: "lese-leiste" }, el("label", { class: "haken-text" }, rohSchalter, "Alles als Rohtext"))));

  const teile = archivTeile(t);
  if (t.vorgeschichte && !teile) {
    const d = el("details", { class: "karte mehr" },
      el("summary", {}, icon("runter", "chevron"), t.bloecke.length ? "Vorgeschichte (Archiv aus bsvp-forum-zugang)" : "Inhalt (Archiv aus bsvp-forum-zugang)"),
      lesemodus === "roh" ? textBlock(t.vorgeschichte) : lesetextBox(t.vorgeschichte));
    ziel.append(aufklappen(d, `vorgeschichte:${t.slug}`, !t.bloecke.length));
  }
  const verlauf = el("div", { class: "verlauf" });
  if (teile) {
    const artikel = teile.filter((x) => x.roh).map((x) => archivBlock(t, x));
    if (artikel.length >= 8) {
      const n = artikel.length - 5;
      verlauf.append(aufklappen(el("details", { class: "aeltere" },
        el("summary", {},
          el("span", { class: "aeltere-punkt", "aria-hidden": "true" }, icon("runter", "chevron")),
          el("span", {}, `Ältere ${n} Beiträge `, el("span", { class: "wenn-zu", text: "zeigen" }), el("span", { class: "wenn-offen", text: "ausblenden" }))),
        el("div", { class: "aeltere-liste" }, artikel.slice(0, n))), `aeltere:${t.slug}`, false), ...artikel.slice(n));
    } else {
      verlauf.append(...artikel);
    }
  }
  const anker = blockAnker(t);
  const bezug = antwortenZuordnen(t);
  for (const b of t.bloecke) verlauf.append(neuerBlock(t, b, anker.get(b), bezug));
  if (verlauf.childNodes.length) ziel.append(verlauf);
  for (const q of offeneFragen().filter((x) => x.thread === t)) {
    const karte = frageKarte(q);
    const a = `${anker.get(q.block)}-antwort`;
    karte.id = `anker-${a}`;
    karte.dataset.anker = a;
    karte.tabIndex = -1;
    ziel.append(karte);
  }
  angabenFehltZeichnen(t, anker);
  const fehlt = pflichtOffen(t);
  if (fehlt.length) ziel.append(el("p", { class: "pfad-hinweis", role: "status", text: `${pflichtText(fehlt)} Die Getaggten schreiben nichts im Forum, bevor sie es gelesen haben.` }));
  ziel.append(beitragForm(t));
}

function beitragForm(t) {
  const schl = `beitrag:${t.slug}`;
  const sorte = el("select", { "aria-label": "Sorte", "data-fokus": `${schl}:sorte` },
    ["BEFUND", "ANTWORT", "ANTRAG", "EINWAND", "ZUSTIMMUNG", "ZURUECK", "BESCHLUSS"].map((s) => el("option", { value: s, text: s })));
  if (entwurf(`${schl}:sorte`)) sorte.value = entwurf(`${schl}:sorte`);
  sorte.addEventListener("change", () => entwurfSetzen(`${schl}:sorte`, sorte.value));
  const text = el("textarea", { placeholder: "Dein Beitrag …", "aria-label": "Beitrag", required: true, rows: 4, "data-fokus": `${schl}:text` });
  text.value = entwurf(`${schl}:text`);
  text.addEventListener("input", () => entwurfSetzen(`${schl}:text`, text.value));
  const quelle = `beitrag:${t.slug}`;
  const knopf = el("button", { type: "submit", class: "knopf", "data-fokus": `${schl}:senden`, "aria-keyshortcuts": "Control+Enter Meta+Enter", title: "Senden (Strg+Enter)" }, icon("senden"), "Anhängen");
  const form = el("form", { class: "karte antwort-form beitrag", "data-quelle": quelle },
    el("h3", {}, icon("notiz"), "Beitrag als betreiber/dashboard"),
    el("p", { class: "hinweis", text: "Wird unten an die Datei angehängt. BESCHLUSS schließt den Thread." }),
    el("div", { class: "beitrag-zeile" }, sorte), text, atempauseZeile(t.pfad, quelle), el("div", { class: "antwort-knoepfe" }, knopf));
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (zustand.wartet.has(t.pfad)) { atempauseJetzt(t.pfad); return; }
    if (!text.value.trim()) return;
    if ((await pruefeVorSenden([{ el: text, entwurf: `${schl}:text` }], knopf)) !== "senden") return;
    const geschrieben = sorte.value;
    const inhalt = text.value;
    atempauseStarten(t.pfad, {
      sorte: geschrieben, nummer: t.nummer, slug: t.slug, quelle, fokus: `${schl}:senden`,
      knoepfe: [knopf],
      arbeit: async () => {
        const r = await anhaengen(t.pfad, geschrieben, inhalt, `${t.slug}: ${geschrieben} [${ICH.ki}/${ICH.chat}]`);
        return () => {
          entwuerfeLoeschen(schl + ":");
          threadErsetzen(t.pfad, r.text, r.sha);
          melden(r.schonDa ? `${geschrieben} stand schon in ${t.slug} (früherer Versuch kam an).` : `${geschrieben} in ${t.slug} geschrieben.`);
        };
      },
    });
  });
  sperrenWennSchreibt(t.pfad, [knopf]);
  tastenSenden(form, [text], t.pfad, quelle);
  return form;
}

/* ---------- Farbschema ---------- */

const THEMEN = [
  { wert: "auto", name: "wie das System", ic: "auto" },
  { wert: "hell", name: "hell", ic: "sonne" },
  { wert: "dunkel", name: "dunkel", ic: "mond" },
];
let thema = (() => { try { return localStorage.getItem(THEMA_SCHLUESSEL) || "auto"; } catch (_) { return "auto"; } })();
function themaAnwenden() {
  const root = document.documentElement;
  queueMicrotask(wartePalettenNachziehen);
  if (thema === "hell") root.setAttribute("data-theme", "light");
  else if (thema === "dunkel") root.setAttribute("data-theme", "dark");
  else root.removeAttribute("data-theme");
  // Fensterleiste der App (theme-color) folgt dem Schalter, nicht nur dem System.
  const grund = thema === "auto" ? "" : getComputedStyle(root).getPropertyValue("--flaeche").trim();
  for (const m of document.querySelectorAll('meta[name="theme-color"]')) {
    if (!m.dataset.vorgabe) m.dataset.vorgabe = m.getAttribute("content");
    m.setAttribute("content", grund || m.dataset.vorgabe);
  }
  const t = THEMEN.find((x) => x.wert === thema) || THEMEN[0];
  const k = $("thema");
  k.replaceChildren(icon(t.ic));
  k.setAttribute("aria-label", `Farbschema: ${t.name} (klicken zum Wechseln)`);
  k.title = `Farbschema: ${t.name}`;
}

/* ---------- Start ---------- */

async function starten() {
  try {
    await laden();
  } catch (e) {
    const f = $("anmeldung-fehler");
    if (e instanceof GitHubFehler && e.status === 401) {
      // Nur ein abgelehntes Token wird gelöscht; ein fine-grained Token zeigt GitHub nur einmal.
      speicherLoeschen(TOKEN_SCHLUESSEL);
      zustand.token = "";
      f.textContent = "GitHub kennt dieses Token nicht (abgelaufen oder vertippt).";
      f.hidden = false;
      zeigen("anmeldung");
    } else if (hatDaten()) {
      melden("Neu laden fehlgeschlagen: " + e.message, true);
    } else if (e instanceof GitHubFehler && (e.status === 403 || e.status === 404)) {
      f.textContent = e.status === 404 && ZWEIG !== "main"
        ? `Den Zweig „${ZWEIG}“ gibt es im Forum nicht (oder das Token sieht ihn nicht).`
        : `Kein Zugriff auf ${OWNER}/${REPO}: ${e.message}. Das gespeicherte Token bleibt; ein neues hier ersetzt es.`;
      f.hidden = false;
      zeigen("anmeldung");
    } else {
      zeigen("anmeldung");
      melden("Laden fehlgeschlagen: " + e.message, true);
    }
  }
}

/* Fassung: steht gleich in index.html (meta + ?v= an jeder Datei), style.css (--pult-version)
 * und hier. Neue Fassung ausliefern: python fassung.py (setzt alle Stellen).
 * Grund: GitHub Pages und Browser halten Dateien bis zu 10 Minuten. Ohne ?v= kam direkt nach
 * einem Update die neue index.html mit dem alten app.js/style.css an und zerlegte die Seite. */
const FASSUNG = "2026.10.04-2";

function fassungStimmt() {
  const meta = document.querySelector('meta[name="pult-version"]');
  let css = "";
  try { css = getComputedStyle(document.documentElement).getPropertyValue("--pult-version").trim(); } catch (_) { /* egal */ }
  return !!meta && meta.content === FASSUNG && css === `"${FASSUNG}"`;
}

/* Passt etwas nicht zusammen: einmal mit frischer Adresse laden (umgeht den Cache für
 * index.html). Steht die Marke schon in der Adresse, nicht noch einmal, sondern sagen, was los ist. */
function fassungPruefen() {
  const adresse = new URL(location.href);
  if (fassungStimmt()) {
    if (adresse.searchParams.has("neu")) {
      adresse.searchParams.delete("neu");
      try { history.replaceState(null, "", adresse.pathname + adresse.search + adresse.hash); } catch (_) { /* egal */ }
    }
    return true;
  }
  if (adresse.searchParams.get("neu") !== FASSUNG) {
    adresse.searchParams.set("neu", FASSUNG);
    location.replace(adresse.href);
    return false;
  }
  // Ohne passendes Stylesheet: Hinweis über CSSOM gestalten (CSP verbietet style-Attribute).
  const hinweis = document.createElement("div");
  hinweis.id = "fassung-hinweis";
  hinweis.setAttribute("role", "alert");
  Object.assign(hinweis.style, {
    margin: "16px", padding: "16px", borderRadius: "12px", background: "#fdebe1", color: "#5a1d05",
    font: "15px/1.5 'Segoe UI', system-ui, sans-serif", border: "1px solid #f3b79a",
  });
  const knopf = document.createElement("button");
  knopf.type = "button";
  knopf.textContent = "Neu laden";
  Object.assign(knopf.style, { marginTop: "10px", padding: "8px 16px", font: "inherit", fontWeight: "600", cursor: "pointer" });
  knopf.addEventListener("click", () => location.reload());
  const text = document.createElement("div");
  text.textContent = "Das Pult wurde gerade aktualisiert, dein Browser hat aber noch Teile der alten Fassung. "
    + "Bitte in ein paar Minuten neu laden. Hilft das nicht: Website-Daten für benedictcberg-hue.github.io löschen.";
  hinweis.append(text, knopf);
  document.body.prepend(hinweis);
  return false;
}

function verdrahten() {
  for (const e of document.querySelectorAll("[data-icon]")) {
    const ic = icon(e.dataset.icon);
    if (e.tagName === "SPAN" && !e.childNodes.length) e.replaceWith(ic); else e.prepend(ic);
  }
  for (const e of document.querySelectorAll("[data-icon-nach]")) e.append(icon(e.dataset.iconNach));
  themaAnwenden();
  // Unter file:// teilen sich alle lokalen Dateien einen Speicher: Token dort nicht merken.
  if (location.protocol === "file:") $("token-merken").checked = false;

  // Als App läuft das Pult schon: dann kein Hinweis im Fuß. Installiert man aus dem Tab heraus,
  // wechselt der Modus im laufenden Fenster.
  $("anmeldung-fehler").after(appHinweis());
  const fussHinweis = appHinweis();
  $("fuss").append(fussHinweis);
  const alsApp = window.matchMedia ? matchMedia("(display-mode: standalone)") : null;
  const fussHinweisZeigen = () => { fussHinweis.hidden = !!(alsApp && alsApp.matches) || navigator.standalone === true; };
  fussHinweisZeigen();
  if (alsApp && alsApp.addEventListener) alsApp.addEventListener("change", fussHinweisZeigen);
  else if (alsApp && alsApp.addListener) alsApp.addListener(fussHinweisZeigen);

  $("thema").addEventListener("click", () => {
    const i = THEMEN.findIndex((x) => x.wert === thema);
    thema = THEMEN[(i + 1) % THEMEN.length].wert;
    try {
      if (thema === "auto") localStorage.removeItem(THEMA_SCHLUESSEL); else localStorage.setItem(THEMA_SCHLUESSEL, thema);
    } catch (_) { /* gesperrt: gilt nur bis zum Neuladen */ }
    themaAnwenden();
  });
  $("token-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const wert = $("token-eingabe").value.trim();
    if (!wert) return;
    zustand.token = wert;
    zustand.gateOk = false;
    speicherSchreiben(TOKEN_SCHLUESSEL, wert, $("token-merken").checked);
    $("token-eingabe").value = "";
    $("anmeldung-fehler").hidden = true;
    starten();
  });
  $("abmelden").addEventListener("click", () => {
    speicherLoeschen(TOKEN_SCHLUESSEL);
    speicherLoeschen(ENTWURF_SCHLUESSEL);
    // Alle Pult-Schlüssel (Stempel, Quittungen, Einstellungen) außer dem Farbschema
    for (const speicher of [() => localStorage, () => sessionStorage]) {
      try {
        const sp = speicher();
        for (const k of Object.keys(sp)) if (k.startsWith("core-pult-") && k !== THEMA_SCHLUESSEL) sp.removeItem(k);
      } catch (_) { /* gesperrt */ }
    }
    for (const k of Object.keys(entwuerfe)) delete entwuerfe[k];
    archivSpeicher.clear();
    suchSpeicher.clear();
    clearTimeout(suchTimer);
    lesemodus = "gesetzt";
    zustand.token = "";
    zustand.threads = [];
    zustand.roadmap = null;
    zustand.gateOk = false;
    for (const pfad of [...zustand.wartet.keys()]) atempauseAbbrechen(pfad, true);
    zustand.laufend.clear();
    zustand.schreibt.clear();
    zustand.neu = null;
    zustand.kopf = null;
    zustand.kopfEtag = null;
    $("neu-balken").hidden = true;
    // Die Seite verspricht „keine Forum-Inhalte“: Blob-Kopien und gezeichnete Ansichten mit weg.
    try {
      for (const k of Object.keys(sessionStorage)) if (k.startsWith("blob:")) sessionStorage.removeItem(k);
    } catch (_) { /* gesperrt */ }
    zustand.probe = null;
    for (const id of ["zug-neu", "zug-waechter", "zug-lage", "fragen-liste", "aufgaben-liste", "nachzug-box", "zuletzt-box", "roadmap-gesamt", "roadmap-fluss", "roadmap-probe",
      "roadmap-meilensteine", "roadmap-ready-box", "roadmap-extra", "thread-liste", "thread-detail"]) $(id).replaceChildren();
    document.title = SEITENTITEL;
    abzeichenSetzen(0);
    faviconSetzen(false);
    $("kopf-unter").textContent = "CORE-Forum · Roadmap 0.9.0b1 → 1.0";
    for (const id of ["verbindung", "neu-laden", "abmelden", "reiter", "fuss"]) $(id).hidden = true;
    meldungZu();
    zeigen("anmeldung");
  });
  $("neu-laden").addEventListener("click", () => starten());
  // Textsuche: 150 ms Ruhe nach dem letzten Zeichen; Enter oder Leeren (×) sofort
  $("thread-suche").addEventListener("input", () => {
    clearTimeout(suchTimer);
    suchTimer = setTimeout(threadListeZeichnen, 150);
  });
  $("thread-suche").addEventListener("search", () => { clearTimeout(suchTimer); threadListeZeichnen(); });
  $("nur-offene").addEventListener("change", threadListeZeichnen);
  // Ein Sprunglink auf die Adresse, die schon gilt, löst kein hashchange aus: trotzdem springen.
  document.addEventListener("click", (e) => {
    const a = e.target && e.target.closest ? e.target.closest('a[href^="#t/"]') : null;
    if (!a || e.defaultPrevented || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
    if (a.hash !== location.hash || !a.hash.includes("~")) return;
    e.preventDefault();
    ankerSpringen(decodeURIComponent(a.hash.slice(1)).split("~")[1]);
  });
  window.addEventListener("hashchange", () => {
    // Dieselbe Frage-Karte steht auch in der Thread-Ansicht: Entwürfe von dort mitnehmen.
    if (hatDaten()) mitFokus(fragenZeichnen);
    angesprungen = null;
    route();
    if (!location.hash.includes("~")) window.scrollTo(0, 0);
  });
  // Puls: beim Zurückkommen (Tab, Fenster, iOS-Rückkehr aus dem Speicher) und alle 90 s.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") { nichtGesendetMelden(); puls(); return; }
    atempausenVerwerfen();
    // Verlassen nach ≥ 5 s mit sichtbarer Karte „Seit deinem letzten Besuch“: als gesehen merken.
    if (neuSichtbarSeit && Date.now() - neuSichtbarSeit >= 5000) gesehenSetzen(zustand.kopf);
  });
  window.addEventListener("focus", () => puls());
  window.addEventListener("pageshow", (e) => { if (e.persisted) { nichtGesendetMelden(); puls(); } });
  window.addEventListener("pagehide", () => atempausenVerwerfen());
  const pulsTakt = () => { puls(); setTimeout(pulsTakt, 90000); };
  setTimeout(pulsTakt, 90000);
  $("neu-anzeigen").addEventListener("click", () => { $("neu-balken").hidden = true; starten(); });

  let flussTimer = null;
  window.addEventListener("resize", () => {
    clearTimeout(flussTimer);
    flussTimer = setTimeout(() => { if (zustand.roadmap) mitFokus(flussZeichnen); }, 150);
  });

  const meldung = $("meldung");
  meldung.addEventListener("mouseenter", () => clearTimeout(meldungTimer));
  meldung.addEventListener("focusin", () => clearTimeout(meldungTimer));
  meldung.addEventListener("mouseleave", () => { if (!meldung.contains(document.activeElement)) meldungSpaeterZu(4000); });
  meldung.addEventListener("focusout", (e) => { if (!meldung.contains(e.relatedTarget)) meldungSpaeterZu(4000); });

  /* „/“ springt in die Thread-Suche, Esc schließt die Meldung. */
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && zustand.probe && !document.querySelector("dialog[open]")) { probeBeenden("fluss:probe"); return; }
    if (e.key === "Escape" && !meldung.hidden) { meldungZu(); return; }
    if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey) return;
    const z = e.target;
    if (z && (z.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(z.tagName))) return;
    if (!zustand.token || !hatDaten()) return;
    e.preventDefault();
    if (location.hash !== "#threads") { location.hash = "#threads"; route(); }
    $("thread-suche").focus();
  });

  zustand.token = speicherLesen(TOKEN_SCHLUESSEL);
  if (zustand.token) starten().then(nichtGesendetMelden); else zeigen("anmeldung");
}

if (fassungPruefen()) verdrahten();
