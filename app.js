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
const SORTEN = ["BEFUND", "ANTRAG", "EINWAND", "ZUSTIMMUNG", "ZURUECK", "BESCHLUSS", "FRAGE", "ANTWORT"];
const NICHT_THREADS = ["LESE-MICH.txt", "werkstatt.txt", "INDEX.txt"];
const KOPF = /^\*\*\[([a-z0-9_-]+)\/([a-z0-9_-]+)\]\*\* (\S+)$/;
const TOKEN_SCHLUESSEL = "core-pult-token";
const THEMA_SCHLUESSEL = "core-pult-thema";
const ENTWURF_SCHLUESSEL = "core-pult-entwuerfe";
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
  for (const [k, v] of Object.entries(attrs || {})) knoten.setAttribute(k, String(v));
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
  const d = new Date(iso.replace(/Z$/, ":00Z"));
  if (isNaN(d)) return iso;
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
  else { knopf.setAttribute("aria-busy", "true"); knopf.disabled = true; }
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
    knopf.removeAttribute("aria-busy");
    knopf.disabled = false;
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

async function abhaken(eintrag, art) {
  const id = eintrag.id;
  const notizSchluessel = `notiz:${id}`;
  let notiz = art === "punkt" ? notizBereit(id) : "";
  if (notiz) {
    // Die Notiz landet in roadmap.json – auch die lesen alle KIs.
    const feld = sichtbarFinden(`notiztext:${id}`);
    if (feld && (await pruefeVorSenden([{ el: feld, entwurf: notizSchluessel }], sichtbarFinden(`haken:${id}`))) !== "senden") return;
    notiz = notizBereit(id);
  }
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
      if (notiz) { entwurfSetzen(notizSchluessel, ""); zustand.offen.delete(`notizfeld:${id}`); roadmapTeileZeichnen(); }
      const text = ergebnis.vorher.status === "x" ? `${id} war schon erledigt – Notiz ergänzt.` : `${id} abgehakt.`;
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
    title: laeuft ? "wird gespeichert …" : fertig ? "erledigt · klicken öffnet wieder" : "als erledigt abhaken",
    "data-fokus": `haken:${eintrag.id}`,
  }, svg);
  knopf.addEventListener("click", () => {
    if (zustand.laufend.has(eintrag.id)) return;
    if (fertig) wiederOeffnen(eintrag, art); else abhaken(eintrag, art);
  });
  return knopf;
}

/* --- Dein Zug --- */

function meineAufgaben() {
  const offeneSlugs = new Set(offeneFragen().map((q) => q.thread.slug));
  return roadmapPunkte().filter(({ punkt }) => istMeins(punkt)
    && (punkt.status !== "x" || zustand.laufend.get(punkt.id) === "x")
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
}

function fragenZeichnen() {
  warnungZeichnen();
  const fragen = offeneFragen();
  const fl = $("fragen-liste");
  fl.replaceChildren();
  if (!fragen.length) fl.append(leer("ok", "Keine offene Frage.", "Die KIs fragen mit: python forum.py frage …"));
  for (const q of fragen) fl.append(frageKarte(q));
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
    const karte = el("div", { class: "karte checkliste-karte", "data-hakenliste": "aufgaben" });
    let gruppe = null;
    let liste = null;
    for (const a of aufgaben) {
      if (a.meilenstein !== gruppe) {
        gruppe = a.meilenstein;
        karte.append(el("div", { class: "gruppe" }, el("span", { class: "gruppe-id", text: gruppe.id }), gruppe.titel));
        liste = el("ul", { class: "checkliste" });
        karte.append(liste);
      }
      liste.append(aufgabeZeile(a));
    }
    al.append(karte);
  }
  zuletztZeichnen();
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
        el("span", { class: "marke ok" }, icon("ok"), `${fertig}/${alle.length} fertig`)),
      rm.kritischer_pfad ? el("p", { class: "lage-pfad" }, icon("roadmap"), el("span", { text: rm.kritischer_pfad })) : null),
  );
}

function aufgabeZeile({ punkt }) {
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

  return el("li", { class: "aufgabe" + (status === "x" ? " ist-fertig" : ""), "data-zeile": id },
    hakenKnopf(punkt, "punkt"),
    el("div", { class: "aufgabe-haupt" },
      el("div", { class: "aufgabe-titel" }, el("span", { class: "kennung", text: id }), " ", punkt.titel),
      punkt.notiz ? el("p", { class: "aufgabe-notiz", text: punkt.notiz }) : null,
      t ? threadVerweis(t) : null,
      notizFeld),
    el("div", { class: "aufgabe-rechts" },
      punkt.status === "~" ? el("span", { class: "marke teil", text: "teilweise" }) : null,
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
    if (zustand.schreibt.has(pfad) || zustand.wartet.has(pfad)) { k.disabled = true; k.setAttribute("aria-busy", "true"); }
  }
}

/* arbeit() schreibt und gibt zurück, was danach passieren soll (Entwurf löschen, neu zeichnen …). */
async function threadSchreiben(pfad, knoepfe, arbeit) {
  if (zustand.schreibt.has(pfad)) return;
  const token = zustand.token;
  zustand.schreibt.add(pfad);
  for (const k of knoepfe) { k.disabled = true; k.setAttribute("aria-busy", "true"); }
  let danach = null;
  try {
    await gateSicherstellen();
    danach = await arbeit();
  } catch (e) {
    if (zustand.token === token) schreibFehler(e);
  } finally {
    zustand.schreibt.delete(pfad);
    for (const k of document.querySelectorAll("[data-schreibt]")) {
      if (k.dataset.schreibt === pfad) { k.disabled = false; k.removeAttribute("aria-busy"); }
    }
  }
  if (danach && zustand.token === token) danach();
}

/* --- Roadmap --- */

function roadmapZeichnen() {
  const rm = zustand.roadmap;
  const gesamt = $("roadmap-gesamt");
  const ms = $("roadmap-meilensteine");
  const readyBox = $("roadmap-ready-box");
  const extra = $("roadmap-extra");
  for (const b of [gesamt, $("roadmap-fluss"), ms, readyBox, extra]) b.replaceChildren();
  if (!rm) {
    $("roadmap-stand").textContent = "";
    ms.append(leer("info", "Keine roadmap.json im Forum."));
    return;
  }
  $("roadmap-stand").textContent = `Stand ${datumLesbar(rm.stand) || "?"} · ${rm.basis || ""} · Quelle: ${rm.quelle || "roadmap.json"}`;

  const alle = roadmapPunkte().map((x) => x.punkt);
  const zahl = (f) => alle.filter(f).length;
  const fertig = zahl((p) => p.status === "x");
  const fragen = offeneFragen().length;
  const kacheln = [
    { wert: `${fertig}/${alle.length}`, name: "Punkte fertig", ic: "ok", art: "ok" },
    { wert: String(zahl((p) => p.wer === "betreiber" && p.status !== "x")), name: "Entscheidungen bei dir", ic: "entscheidung", art: "zug", link: "#zug" },
    { wert: String(zahl((p) => p.wer === "betrieb" && p.status !== "x")), name: "Handläufe bei dir", ic: "handlauf", art: "zug", link: "#zug" },
    { wert: String(fragen), name: "offene Fragen", ic: "rueckfrage", art: fragen ? "zug" : "", link: "#zug" },
  ];
  gesamt.append(
    el("div", { class: "karte rm-kopf" },
      ringBox(alle.length ? fertig / alle.length : 0, `${fertig} von ${alle.length} Punkten fertig`),
      el("div", { class: "rm-kopf-text" },
        el("div", { class: "lage-ziel", text: rm.produkt ? `${rm.produkt} · ${rm.ziel || ""}` : rm.ziel || "Roadmap" }),
        el("div", { class: "lage-titel", text: `${fertig} von ${alle.length} Punkten fertig` }),
        el("p", { class: "hinweis", text: "Das Flussdiagramm zeigt, welcher Meilenstein auf welchem aufbaut. Klick auf einen Knoten öffnet seine Punkte." }))),
    el("div", { class: "kennzahlen" }, kacheln.map((k) => el(k.link ? "a" : "div", { class: "karte kennzahl", href: k.link },
      el("span", { class: `kennzahl-ic ${k.art}`.trim() }, icon(k.ic)),
      el("span", {}, el("span", { class: "kennzahl-wert", text: k.wert }), el("span", { class: "kennzahl-name", text: k.name }))))),
  );

  flussZeichnen();

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
    readyBox.append(
      el("div", { class: "abschnitt-kopf" },
        el("h2", {}, icon("ready"), "„Ready“ für 0.9.0b1", el("span", { class: "zaehler leise", text: `${rFertig}/${r.length}` })),
        el("p", { class: "hinweis", text: "Die Eintrittskarten für die Beta. Auch hier: Kreis anklicken = erfüllt." })),
      el("div", { class: "ready", "data-hakenliste": "ready" }, r.map((q) => {
        const s = anzeigeStatus(q);
        return el("div", { class: "karte ready-kachel" + (s === "x" ? " ist-fertig" : ""), "data-zeile": q.id },
          hakenKnopf(q, "ready", true),
          el("div", {},
            el("div", { class: "ready-titel" }, el("span", { class: "kennung", text: q.id }), " ", q.titel),
            q.fehlt && q.status !== "x" ? el("p", { class: "fehlt" }, el("b", { text: "fehlt: " }), q.fehlt) : null));
      })),
    );
  }

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
const FLUSS = { hoehe: 112, zeilenAbstand: 16, spaltenAbstand: 44, minBreite: 148, maxBreite: 240, stufenUnter: 720 };

function meilensteinZahlen(m) {
  const p = m.punkte || [];
  const x = p.filter((q) => q.status === "x").length;
  const t = p.filter((q) => q.status === "~").length;
  const beiDir = p.filter((q) => istMeins(q) && q.status !== "x").length;
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

function flussZeichnen() {
  const box = $("roadmap-fluss");
  box.replaceChildren();
  const rm = zustand.roadmap;
  if (!rm || !(rm.meilensteine || []).length) return;
  const g = flussGraph(rm);

  const zahlen = new Map(g.knoten.map((m) => [m.id, meilensteinZahlen(m)]));
  const vorgaenger = (id) => g.kanten.filter((k) => k.nach === id).map((k) => k.von);
  const knoten = (m) => {
    const z = zahlen.get(m.id);
    const f1 = el("span", { class: "f-x" }); f1.style.width = z.n ? `${(z.x / z.n) * 100}%` : "0";
    const f2 = el("span", { class: "f-t" }); f2.style.width = z.n ? `${(z.t / z.n) * 100}%` : "0";
    const vor = vorgaenger(m.id);
    return el("button", {
      type: "button",
      class: `fluss-knoten ms-${z.stufe}${g.kette.includes(m.id) ? " kritisch" : ""}`,
      "aria-label": `${m.id} ${m.titel}: ${z.x} von ${z.n} fertig${z.beiDir ? `, ${z.beiDir} bei dir` : ""}${vor.length ? `, nach ${vor.join(", ")}` : ""}. Punkte zeigen`,
      title: `${m.id} ${m.titel} · ${z.x}/${z.n} fertig`,
      "data-fokus": `fluss:${m.id}`,
      onclick: () => meilensteinZeigen(m.id),
    },
    el("span", { class: "fluss-kopf" },
      el("span", { class: "ms-id", text: m.id }),
      meilensteinIstNeu(m.id) ? el("span", { class: "marke neu", title: "seit deinem letzten Besuch geändert" }, icon("funke"), "neu")
        : z.stufe === "fertig" ? el("span", { class: "marke ok" }, icon("haken"), "fertig")
          : z.beiDir ? el("span", { class: "marke zug", text: `${z.beiDir} bei dir` }) : null),
    el("span", { class: "fluss-titel", text: m.titel }),
    vor.length ? el("span", { class: "fluss-nach", text: `nach ${vor.join(" · ")}` }) : null,
    el("span", { class: "fluss-fuss" },
      el("span", { class: "fortschritt" }, f1, f2),
      el("span", { class: "fluss-zahl", text: `${z.x}/${z.n}` })));
  };

  const spalten = Math.max(...g.knoten.map((m) => g.ebene.get(m.id))) + 1;
  // Breite aus dem Platz in <main>; die Ansicht kann gerade versteckt sein, <main> nie.
  const main = $("inhalt");
  const stil = getComputedStyle(main);
  const platz = main.clientWidth - parseFloat(stil.paddingLeft) - parseFloat(stil.paddingRight) - 38;
  // Stufen nur, wo es eng ist; bei vielen Spalten auf breitem Schirm lieber quer scrollen.
  const breit = platz >= Math.min(spalten * FLUSS.minBreite + (spalten - 1) * FLUSS.spaltenAbstand, FLUSS.stufenUnter);

  let bild;
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
      const art = zahlen.get(k.von).stufe === "fertig" ? "fertig" : k.kritisch ? "kritisch" : "normal";
      svg.append(svgEl("path", { d, class: `fluss-kante ${art}${k.kritisch ? " ist-kritisch" : ""}`, "marker-end": `url(#fluss-spitze-${art})` }));
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

  const quelltext = mermaidText(rm, g);
  const mermaidPre = el("pre", { class: "text breit mermaid-text", text: quelltext, tabindex: "0", "aria-label": "Mermaid-Quelltext" });
  const mermaidBox = aufklappen(el("details", { class: "mermaid-box" },
    el("summary", {}, icon("runter", "chevron"), "Mermaid-Quelltext (für GitHub, Forum, Doku)"), mermaidPre), "mermaid", false);
  const kopieren = el("button", { type: "button", class: "knopf zweit klein-knopf", onclick: () => mermaidKopieren(quelltext, mermaidBox, mermaidPre) },
    icon("kopieren"), "Mermaid kopieren");

  box.append(el("section", { class: "karte fluss", "aria-label": "Roadmap als Flussdiagramm" },
    el("div", { class: "fluss-leiste" },
      el("h2", {}, icon("fluss"), "Flussdiagramm"),
      kopieren),
    rm.kritischer_pfad ? el("p", { class: "lage-pfad" }, icon("roadmap"), el("span", {}, el("b", { text: "Kritischer Pfad: " }), rm.kritischer_pfad)) : null,
    bild,
    el("div", { class: "fluss-legende", "aria-hidden": "true" },
      el("span", {}, el("i", { class: "strich kritisch" }), "kritischer Pfad"),
      el("span", {}, el("i", { class: "strich fertig" }), "Vorgänger fertig"),
      el("span", {}, el("i", { class: "strich normal" }), "hängt ab von"),
      el("span", {}, el("i", { class: "punkt-farbe fertig" }), "fertig"),
      el("span", {}, el("i", { class: "punkt-farbe teil" }), "teilweise"),
      el("span", {}, el("i", { class: "punkt-farbe offen" }), "offen"),
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
  const verweis = q.frage || q.thread;
  const t = verweis ? threadZuSlug(verweis) : null;
  return el("li", { class: "punkt" + (status === "x" ? " ist-fertig" : ""), "data-zeile": q.id },
    hakenKnopf(q, "punkt", true),
    el("div", { class: "punkt-haupt" },
      el("div", { class: "punkt-titel" }, el("span", { class: "kennung", text: q.id }), " ", q.titel),
      q.notiz ? el("p", { class: "punkt-notiz", text: q.notiz }) : null,
      q.erledigt ? el("p", { class: "punkt-notiz" }, icon("uhr"), ` erledigt ${datumLesbar(q.erledigt)}${q.von ? " · " + q.von : ""}`) : null),
    el("div", { class: "punkt-rechts" },
      frageOffen ? el("a", { class: "marke zug", href: "#zug" }, icon("rueckfrage"), "Frage offen") : null,
      t ? threadVerweis(t, true) : null,
      werMarke(q.wer, q.status === "x")),
  );
}

/* --- Threads --- */

function threadListeZeichnen() {
  const suche = $("thread-suche").value.trim().toLowerCase();
  const nurOffene = $("nur-offene").checked;
  const liste = $("thread-liste");
  liste.replaceChildren();
  const treffer = zustand.threads.filter((t) =>
    (!nurOffene || !t.geschlossen || t.offen.length)
    && (!suche || (t.slug + " " + t.titel).toLowerCase().includes(suche)));
  $("thread-anzahl").textContent = anzahl(treffer.length, "Thread", "Threads");
  if (!treffer.length) liste.append(leer("suche", "Kein Thread passt.", nurOffene ? "„nur offene“ abschalten zeigt auch geschlossene." : null));
  for (const t of treffer) {
    const l = t.letzter;
    liste.append(el("a", { class: "thread-zeile" + (t.offen.length ? " hat-frage" : "") + (t.geschlossen ? " ist-zu" : ""), href: `#t/${encodeURIComponent(t.slug)}` },
      el("span", { class: "thread-nr", text: t.nummer || "–" }),
      el("span", { class: "thread-haupt" },
        el("span", { class: "thread-titel", text: t.titel }),
        el("span", { class: "thread-letzt", text: l ? `zuletzt ${l.sorte} · ${l.ki}/${l.chat} · ${zeitLesbar(l.zeit)}` : (t.kopf.Aktualisiert ? `Archiv · ${t.kopf.Aktualisiert.slice(0, 10)}` : "Archiv") })),
      el("span", { class: "thread-rechts" },
        threadIstNeu(t) ? el("span", { class: "marke neu" }, icon("funke"), "neu") : null,
        t.offen.length ? el("span", { class: "marke zug" }, icon("rueckfrage"), "Frage an dich") : null,
        t.art ? el("span", { class: "marke", text: t.art }) : null,
        el("span", { class: `marke ${t.geschlossen ? "ok" : "offen"}`, text: t.geschlossen ? "geschlossen" : "offen" }))));
  }
}

function textBlock(text) {
  // Zeilen über 400 Zeichen sind nie Tabellen; der Rest linear prüfen (kein .*\s{3,} mehr).
  const breit = text.split("\n").some((z) => z.length <= 400
    && (/[┌└│─+|]{3,}/.test(z) || (/^\s{2,}\S/.test(z) && /\S\s{3,}\S/.test(z.trimStart()))));
  return el("pre", { class: "text" + (breit ? " breit" : ""), text });
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
  ziel.append(el("div", { class: "karte thread-kopf" },
    el("div", { class: "thread-kopf-zeile" },
      el("span", { class: "thread-nr", text: t.nummer || "–" }),
      el("h2", { text: t.titel }),
      el("span", { class: `marke ${t.geschlossen ? "ok" : "offen"}`, text: t.geschlossen ? "geschlossen" : "offen" })),
    kopfzeilen));

  if (t.vorgeschichte) {
    const d = el("details", { class: "karte mehr" },
      el("summary", {}, icon("runter", "chevron"), t.bloecke.length ? "Vorgeschichte (Archiv aus bsvp-forum-zugang)" : "Inhalt (Archiv aus bsvp-forum-zugang)"),
      textBlock(t.vorgeschichte));
    ziel.append(aufklappen(d, `vorgeschichte:${t.slug}`, !t.bloecke.length));
  }
  if (t.bloecke.length) {
    const anker = blockAnker(t);
    ziel.append(el("div", { class: "verlauf" }, t.bloecke.map((b) =>
      el("article", {
        class: `block s-${b.sorte}${istNeuerBlock(b) ? " ist-neu" : ""}`,
        "data-anker": anker.get(b), id: `anker-${anker.get(b)}`, tabindex: "-1",
      },
        el("span", { class: `block-avatar ${avatarKlasse(b.ki)}`, "aria-hidden": "true", text: b.ki.slice(0, 1).toUpperCase() }),
        el("div", { class: "karte block-inhalt" },
          el("div", { class: "block-kopf" },
            el("span", { class: "block-sig", text: `${b.ki}/${b.chat}` }),
            sorteMarke(b.sorte),
            istNeuerBlock(b) ? el("span", { class: "marke neu" }, icon("funke"), "neu") : null,
            el("time", { class: "meta", text: zeitLesbar(b.zeit) })),
          textBlock(b.text))))));
  }
  angabenFehltZeichnen(t, blockAnker(t));
  for (const q of offeneFragen().filter((x) => x.thread === t)) ziel.append(frageKarte(q));
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
  if (thema === "hell") root.setAttribute("data-theme", "light");
  else if (thema === "dunkel") root.setAttribute("data-theme", "dark");
  else root.removeAttribute("data-theme");
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
const FASSUNG = "2026.10.03-13";

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
    for (const id of ["zug-neu", "zug-waechter", "zug-lage", "fragen-liste", "aufgaben-liste", "zuletzt-box", "roadmap-gesamt", "roadmap-fluss",
      "roadmap-meilensteine", "roadmap-ready-box", "roadmap-extra", "thread-liste", "thread-detail"]) $(id).replaceChildren();
    document.title = SEITENTITEL;
    $("kopf-unter").textContent = "CORE-Forum · Roadmap 0.9.0b1 → 1.0";
    for (const id of ["verbindung", "neu-laden", "abmelden", "reiter", "fuss"]) $(id).hidden = true;
    meldungZu();
    zeigen("anmeldung");
  });
  $("neu-laden").addEventListener("click", () => starten());
  $("thread-suche").addEventListener("input", threadListeZeichnen);
  $("nur-offene").addEventListener("change", threadListeZeichnen);
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
