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
const ZWEIG = new URLSearchParams(location.search).get("branch") || "main";

const zustand = {
  token: "",
  threads: [],          // {slug, pfad, sha, text, kopf, titel, bloecke, vorgeschichte, offen, geschlossen}
  roadmap: null,        // geparstes roadmap.json
  roadmapSha: null,
};

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

function jetzt() {
  return new Date().toISOString().slice(0, 16) + "Z";
}
function heute() {
  return new Date().toISOString().slice(0, 10);
}
function zeitLesbar(iso) {
  const d = new Date(iso.replace(/Z$/, ":00Z"));
  if (isNaN(d)) return iso;
  return d.toLocaleString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

let meldungTimer = null;
function melden(text, fehler) {
  const m = $("meldung");
  m.textContent = text;
  m.classList.toggle("fehler", !!fehler);
  m.hidden = false;
  clearTimeout(meldungTimer);
  meldungTimer = setTimeout(() => { m.hidden = true; }, fehler ? 9000 : 4000);
}

/* ---------- GitHub ---------- */

class GitHubFehler extends Error {
  constructor(status, text) { super(`${status}: ${text}`); this.status = status; }
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
  if (!antwort.ok) {
    let text = antwort.statusText;
    try { text = (await antwort.json()).message || text; } catch (_) { /* kein JSON */ }
    throw new GitHubFehler(antwort.status, text);
  }
  return antwort.status === 204 ? null : antwort.json();
}

async function dateiLesen(pfad) {
  const d = await gh(`/contents/${encodeURI(pfad)}?ref=${encodeURIComponent(ZWEIG)}`);
  return { text: b64ZuText(d.content), sha: d.sha };
}

async function dateiSchreiben(pfad, text, sha, meldung) {
  const koerper = { message: meldung, content: textZuB64(text), branch: ZWEIG };
  if (sha) koerper.sha = sha;
  const r = await gh(`/contents/${encodeURI(pfad)}`, { method: "PUT", body: JSON.stringify(koerper) });
  return r.content.sha;
}

/* Liest frisch, hängt an, schreibt. Bei Konflikt (jemand schrieb dazwischen) einmal neu. */
async function anhaengen(pfad, block, meldung) {
  for (let versuch = 0; versuch < 3; versuch++) {
    const { text, sha } = await dateiLesen(pfad);
    const neu = (text.endsWith("\n") ? text : text + "\n") + block;
    try {
      const neuSha = await dateiSchreiben(pfad, neu, sha, meldung);
      return { text: neu, sha: neuSha };
    } catch (e) {
      if (!(e instanceof GitHubFehler) || (e.status !== 409 && e.status !== 422) || versuch === 2) throw e;
    }
  }
  throw new Error("nicht geschrieben");
}

async function gateSicherstellen() {
  const pfad = "gate/anmeldungen.txt";
  const zeile = `\t${ICH.ki}\t${ICH.chat}`;
  const { text, sha } = await dateiLesen(pfad);
  if (text.split("\n").some((z) => z.endsWith(zeile))) return;
  const neu = (text.endsWith("\n") ? text : text + "\n") + `${jetzt()}${zeile}\n`;
  await dateiSchreiben(pfad, neu, sha, `Gate: ${ICH.ki}/${ICH.chat}`);
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
    else if ((m = /^Roadmap: (.+)$/.exec(zeile))) roadmap.push(...m[1].split(/\s*[·,]\s*/).filter(Boolean));
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

async function laden() {
  zeigen("lade");
  $("lade-balken").style.width = "5%";
  $("lade-text").textContent = "Lade Verzeichnis …";
  const baum = await gh(`/git/trees/${encodeURIComponent(ZWEIG)}?recursive=1`);
  const dateien = baum.tree.filter((e) => e.type === "blob");
  const threadDateien = dateien.filter((e) => /^threads\/[^/]+\.txt$/.test(e.path)
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
  zustand.threads = (await alles(auftraege, 8)).sort((a, b) => b.slug.localeCompare(a.slug));

  zustand.roadmap = null;
  if (roadmapDatei) {
    try {
      zustand.roadmap = JSON.parse(await blobLesen(roadmapDatei.sha));
      zustand.roadmapSha = roadmapDatei.sha;
    } catch (e) {
      melden("roadmap.json ist kein gültiges JSON: " + e.message, true);
    }
    fortschritt();
  }

  $("verbindung").textContent = ZWEIG === "main" ? "verbunden" : `Zweig ${ZWEIG}`;
  $("verbindung").className = "pille " + (ZWEIG === "main" ? "ok" : "zweig");
  for (const id of ["verbindung", "neu-laden", "abmelden", "reiter"]) $(id).hidden = false;
  if (zustand.roadmap) {
    $("kopf-unter").textContent = `CORE-Forum · Roadmap-Stand ${zustand.roadmap.stand || "?"} · ${zustand.roadmap.basis || ""}`;
  }
  allesZeichnen();
}

function threadErsetzen(pfad, text, sha) {
  const slug = pfad.slice("threads/".length, -4);
  const neu = { ...threadParsen(slug, text), pfad, sha };
  blobMerken(sha, text);
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

function route() {
  if (!zustand.token) { zeigen("anmeldung"); return; }
  if (!zustand.threads.length && !zustand.roadmap) return;
  const h = decodeURIComponent(location.hash.slice(1)) || "zug";
  let reiter = h;
  if (h.startsWith("t/")) {
    reiter = "threads";
    threadDetailZeichnen(h.slice(2));
    zeigen("ansicht-thread");
  } else if (["zug", "roadmap", "threads"].includes(h)) {
    zeigen("ansicht-" + h);
  } else {
    reiter = "zug";
    zeigen("ansicht-zug");
  }
  for (const a of document.querySelectorAll("#reiter a")) {
    a.classList.toggle("aktiv", a.dataset.reiter === reiter);
  }
}

function allesZeichnen() {
  zugZeichnen();
  roadmapZeichnen();
  threadListeZeichnen();
  route();
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
const STATUS = { x: ["fertig", "ok", "x"], "~": ["teilweise", "teil", "t"], ".": ["offen", "offen", "o"] };

/* --- Dein Zug --- */

function zugZeichnen() {
  const fragen = offeneFragen();
  const offeneSlugs = new Set(fragen.map((q) => q.thread.slug));
  const aufgaben = roadmapPunkte().filter(({ punkt }) =>
    (punkt.wer === "betreiber" || punkt.wer === "betrieb") && punkt.status !== "x"
    && !(punkt.frage && offeneSlugs.has(punkt.frage)));

  const zaehler = $("zaehler-zug");
  zaehler.textContent = String(fragen.length + aufgaben.length);
  zaehler.classList.toggle("heiss", fragen.length > 0);

  const fl = $("fragen-liste");
  fl.replaceChildren();
  if (!fragen.length) fl.append(el("p", { class: "leer", text: "Keine offene Frage. Die KIs fragen mit: python forum.py frage …" }));
  for (const q of fragen) fl.append(frageKarte(q));

  const al = $("aufgaben-liste");
  al.replaceChildren();
  if (!zustand.roadmap) al.append(el("p", { class: "leer", text: "Keine roadmap.json im Forum gefunden." }));
  else if (!aufgaben.length) al.append(el("p", { class: "leer", text: "Nichts offen, das bei dir liegt." }));
  for (const a of aufgaben) al.append(aufgabeKarte(a));
}

function frageKarte({ thread, block, f }) {
  const name = `wahl-${thread.slug}-${block.zeit}`;
  const notiz = el("textarea", { placeholder: "Ergänzung, Bedingung oder eigene Antwort (optional)", "aria-label": "Ergänzung" });
  const istErste = thread.bloecke[0] === block;
  const beschluss = el("input", { type: "checkbox" });
  beschluss.checked = istErste;

  const optionen = f.vorschlaege.map((v) => el("label", { class: "vorschlag" },
    el("input", { type: "radio", name, value: v.buchstabe }),
    el("span", { class: "vorschlag-buchstabe", text: v.buchstabe }),
    el("span", {}, v.text, v.buchstabe === f.empfohlen ? el("span", { class: "empfohlen", text: "★ empfohlen" }) : null),
  ));
  if (f.vorschlaege.length) {
    optionen.push(el("label", { class: "vorschlag" },
      el("input", { type: "radio", name, value: "" }),
      el("span", { class: "vorschlag-buchstabe", text: "–" }),
      el("span", { text: "Eigene Antwort (im Feld unten)" })));
  }

  const senden = el("button", { type: "submit", class: "knopf", text: "Antworten" });
  const zurueck = el("button", { type: "button", class: "knopf leise", text: "Rückfrage (ZURUECK)" });

  const form = el("form", { class: "antwort-form" },
    f.vorschlaege.length ? el("fieldset", { class: "vorschlaege" }, el("legend", { text: "Vorschläge" }), optionen) : null,
    f.empfehlung ? el("p", { class: "empfehlung" }, el("b", { text: "Empfehlung: " }), f.empfehlung) : null,
    notiz,
    el("div", { class: "antwort-zeile" },
      el("label", { class: "haken" }, beschluss, " als BESCHLUSS (schließt den Thread)"),
      el("div", { class: "antwort-knoepfe" }, zurueck, senden)),
  );

  const absenden = async (sorte) => {
    const gewaehlt = form.querySelector(`input[name="${CSS.escape(name)}"]:checked`);
    const buchstabe = gewaehlt ? gewaehlt.value : "";
    const zusatz = notiz.value.trim();
    if (sorte !== "ZURUECK" && f.vorschlaege.length && !gewaehlt) { melden("Bitte einen Vorschlag wählen oder „Eigene Antwort“.", true); return; }
    if ((sorte === "ZURUECK" || !buchstabe) && !zusatz) { melden("Bitte im Feld schreiben, was du willst.", true); return; }
    const bezug = `Zu FRAGE [${block.ki}/${block.chat}] ${block.zeit}`;
    let text;
    if (sorte === "ZURUECK") {
      text = `${bezug}\nRückfrage\n\n${zusatz}`;
    } else {
      const v = f.vorschlaege.find((x) => x.buchstabe === buchstabe);
      text = `${bezug}\nWahl: ${v ? `Vorschlag ${v.buchstabe}: ${v.text}` : "eigene Antwort"}` + (zusatz ? `\n\n${zusatz}` : "");
      sorte = beschluss.checked ? "BESCHLUSS" : "ANTWORT";
    }
    await schreibenMitKnopf([senden, zurueck], async () => {
      await gateSicherstellen();
      const r = await anhaengen(thread.pfad, blockText(sorte, text), `${thread.slug}: ${sorte} [${ICH.ki}/${ICH.chat}]`);
      threadErsetzen(thread.pfad, r.text, r.sha);
      melden(`${sorte} in ${thread.slug} geschrieben.`);
    });
  };
  form.addEventListener("submit", (e) => { e.preventDefault(); absenden("ANTWORT"); });
  zurueck.addEventListener("click", () => absenden("ZURUECK"));

  return el("article", { class: "karte frage" },
    el("div", { class: "frage-kopf" },
      el("a", { href: `#t/${encodeURIComponent(thread.slug)}`, class: "meta", text: thread.slug }),
      el("span", { class: "meta", text: `[${block.ki}/${block.chat}] · ${zeitLesbar(block.zeit)}` })),
    el("h3", { class: "frage-titel", text: f.frage || thread.titel }),
    f.roadmap.length ? el("div", { class: "marken" }, f.roadmap.map((r) => el("span", { class: "marke", text: r }))) : null,
    f.kontext ? el("details", { class: "mehr" }, el("summary", { text: "Hintergrund" }), el("p", { class: "kontext", text: f.kontext })) : null,
    form,
  );
}

function aufgabeKarte({ meilenstein, punkt }) {
  const notiz = el("textarea", { placeholder: "Was wurde gemacht, Datum, Protokoll-Pfad … (optional)", "aria-label": "Notiz" });
  const knopf = el("button", { type: "submit", class: "knopf klein", text: "als erledigt melden" });
  const form = el("form", { class: "aufgabe-form" }, notiz, el("div", { class: "antwort-knoepfe" }, knopf));
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    await schreibenMitKnopf([knopf], () => punktErledigt(punkt.id, notiz.value.trim()));
  });
  const status = STATUS[punkt.status] || STATUS["."];
  const verweis = punkt.frage || punkt.thread;
  return el("article", { class: "karte aufgabe" },
    el("div", { class: "aufgabe-zeile" },
      el("span", { class: "aufgabe-titel" }, `${punkt.id} · ${punkt.titel}`),
      el("span", { class: "marken" },
        el("span", { class: "marke zug", text: WER[punkt.wer] || punkt.wer }),
        el("span", { class: `marke ${status[1]}`, text: status[0] }))),
    el("span", { class: "meta", text: `${meilenstein.id} ${meilenstein.titel}` }),
    punkt.notiz ? el("span", { class: "meta", text: punkt.notiz }) : null,
    verweis && threadZuSlug(verweis) ? el("a", { href: `#t/${encodeURIComponent(verweis)}`, class: "meta", text: `→ Thread ${verweis}` }) : null,
    el("details", { class: "mehr" }, el("summary", { text: "erledigt?" }), form),
  );
}

async function punktErledigt(id, notiz) {
  for (let versuch = 0; versuch < 3; versuch++) {
    const { text, sha } = await dateiLesen("roadmap.json");
    const rm = JSON.parse(text);
    let gefunden = null;
    for (const m of rm.meilensteine || []) for (const p of m.punkte || []) if (p.id === id) gefunden = p;
    if (!gefunden) throw new Error(`Punkt ${id} nicht mehr in roadmap.json`);
    gefunden.status = "x";
    gefunden.erledigt = heute();
    gefunden.von = `${ICH.ki}/${ICH.chat}`;
    if (notiz) gefunden.notiz = gefunden.notiz ? `${gefunden.notiz} · ${notiz}` : notiz;
    const neu = JSON.stringify(rm, null, 2) + "\n";
    try {
      await gateSicherstellen();
      await dateiSchreiben("roadmap.json", neu, sha, `roadmap: ${id} erledigt [${ICH.ki}/${ICH.chat}]`);
      zustand.roadmap = rm;
      allesZeichnen();
      melden(`${id} als erledigt eingetragen.`);
      return;
    } catch (e) {
      if (!(e instanceof GitHubFehler) || (e.status !== 409 && e.status !== 422) || versuch === 2) throw e;
    }
  }
}

async function schreibenMitKnopf(knoepfe, arbeit) {
  for (const k of knoepfe) k.disabled = true;
  try {
    await arbeit();
  } catch (e) {
    const hinweis = e instanceof GitHubFehler && (e.status === 403 || e.status === 404)
      ? " — hat das Token „Contents: Read and write“ auf CORE-Forum-?" : "";
    melden("Nicht geschrieben: " + e.message + hinweis, true);
  } finally {
    for (const k of knoepfe) k.disabled = false;
  }
}

/* --- Roadmap --- */

function roadmapZeichnen() {
  const rm = zustand.roadmap;
  const ms = $("roadmap-meilensteine");
  ms.replaceChildren();
  $("roadmap-gesamt").replaceChildren();
  $("roadmap-ready").replaceChildren();
  if (!rm) {
    ms.append(el("p", { class: "leer", text: "Keine roadmap.json im Forum." }));
    return;
  }
  $("roadmap-stand").textContent = `Stand ${rm.stand || "?"} · ${rm.basis || ""} · Quelle: ${rm.quelle || "roadmap.json"}`;

  const alle = roadmapPunkte().map((x) => x.punkt);
  const zahl = (f) => alle.filter(f).length;
  const kennzahlen = [
    [`${zahl((p) => p.status === "x")}/${alle.length}`, "Punkte fertig"],
    [String(zahl((p) => p.wer === "betreiber" && p.status !== "x")), "Entscheidungen bei dir"],
    [String(zahl((p) => p.wer === "betrieb" && p.status !== "x")), "Handläufe bei dir"],
    [String(offeneFragen().length), "offene Fragen"],
  ];
  for (const [wert, name] of kennzahlen) {
    $("roadmap-gesamt").append(el("div", { class: "kennzahl" },
      el("div", { class: "kennzahl-wert", text: wert }), el("div", { class: "kennzahl-name", text: name })));
  }

  const offeneSlugs = new Set(offeneFragen().map((q) => q.thread.slug));
  for (const m of rm.meilensteine || []) {
    const p = m.punkte || [];
    const x = p.filter((q) => q.status === "x").length;
    const t = p.filter((q) => q.status === "~").length;
    const beiDir = p.filter((q) => (q.wer === "betreiber" || q.wer === "betrieb") && q.status !== "x").length;
    const breite = (n) => (p.length ? `${(n / p.length) * 100}%` : "0");
    const f1 = el("div", { class: "f-x" }); f1.style.width = breite(x);
    const f2 = el("div", { class: "f-t" }); f2.style.width = breite(t);
    const details = el("details", { class: "karte meilenstein" },
      el("summary", {},
        el("span", { class: "ms-id", text: m.id }),
        el("span", { class: "ms-titel" }, m.titel, beiDir ? el("span", { class: "marke zug", text: `${beiDir} bei dir` }) : null),
        el("div", { class: "fortschritt", role: "img", "aria-label": `${x} von ${p.length} fertig` }, f1, f2),
        el("span", { class: "ms-zahl", text: `${x}/${p.length}` })),
      el("ul", { class: "punkte" }, p.map((q) => {
        const s = STATUS[q.status] || STATUS["."];
        const frageOffen = q.frage && offeneSlugs.has(q.frage);
        return el("li", { class: "punkt" },
          el("span", { class: `glyphe ${s[2]}`, title: s[0], text: q.status === "x" ? "✓" : q.status === "~" ? "~" : "·" }),
          el("span", {}, `${q.id} ${q.titel}`,
            q.notiz ? el("span", { class: "punkt-notiz", text: q.notiz }) : null,
            q.erledigt ? el("span", { class: "punkt-notiz", text: `erledigt ${q.erledigt}${q.von ? " · " + q.von : ""}` }) : null),
          el("span", { class: "marken" },
            frageOffen ? el("a", { class: "marke zug", href: "#zug", text: "Frage offen" }) : null,
            el("span", { class: `marke ${q.wer === "code" ? "" : q.status === "x" ? "ok" : "zug"}`.trim(), text: WER[q.wer] || q.wer })));
      })),
    );
    details.open = beiDir > 0;
    ms.append(details);
  }

  for (const r of rm.ready || []) {
    const s = STATUS[r.status] || STATUS["."];
    $("roadmap-ready").append(el("div", { class: "ready-zeile" },
      el("span", { class: "ms-id", text: r.id }),
      el("span", { class: `glyphe ${s[2]}`, title: s[0], text: r.status === "x" ? "✓" : r.status === "~" ? "~" : "·" }),
      el("span", {}, r.titel, r.fehlt && r.status !== "x" ? el("span", { class: "fehlt", text: `fehlt: ${r.fehlt}` }) : null)));
  }
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
  if (!treffer.length) liste.append(el("p", { class: "leer", text: "Kein Thread passt." }));
  for (const t of treffer) {
    const l = t.letzter;
    liste.append(el("a", { class: "thread-zeile", href: `#t/${encodeURIComponent(t.slug)}` },
      el("span", { class: "thread-nr", text: t.nummer || "–" }),
      el("span", { class: "thread-titel" }, t.titel,
        el("span", { class: "thread-letzt", text: l ? `zuletzt ${l.sorte} · [${l.ki}/${l.chat}] · ${zeitLesbar(l.zeit)}` : (t.kopf.Aktualisiert ? `Archiv · ${t.kopf.Aktualisiert.slice(0, 10)}` : "Archiv") })),
      el("span", { class: "thread-rechts" },
        t.offen.length ? el("span", { class: "marke zug", text: "Frage an dich" }) : null,
        t.art ? el("span", { class: "marke", text: t.art }) : null,
        el("span", { class: `marke ${t.geschlossen ? "ok" : "offen"}`, text: t.geschlossen ? "geschlossen" : "offen" }))));
  }
}

function textBlock(text) {
  const breit = text.split("\n").some((z) => /[┌└│─+|]{3,}|^\s{2,}\S.*\s{3,}\S/.test(z));
  return el("pre", { class: "text" + (breit ? " breit" : ""), text });
}

function threadDetailZeichnen(slug) {
  const ziel = $("thread-detail");
  ziel.replaceChildren();
  const t = threadZuSlug(slug);
  if (!t) { ziel.append(el("p", { class: "leer", text: `Thread ${slug} nicht gefunden.` })); return; }

  const kopfzeilen = el("dl", { class: "kopfzeilen" });
  for (const [k, v] of Object.entries(t.kopf)) {
    if (k === "Titel") continue;
    kopfzeilen.append(el("dt", { text: k }), el("dd", { text: v }));
  }
  ziel.append(el("div", { class: "karte thread-kopf" }, el("h2", { text: t.titel }), kopfzeilen));

  if (t.vorgeschichte) {
    const d = el("details", { class: "karte mehr" },
      el("summary", { text: t.bloecke.length ? "Vorgeschichte (Archiv aus bsvp-forum-zugang)" : "Inhalt (Archiv aus bsvp-forum-zugang)" }),
      textBlock(t.vorgeschichte));
    d.open = !t.bloecke.length;
    ziel.append(d);
  }
  for (const b of t.bloecke) {
    ziel.append(el("article", { class: `karte block s-${b.sorte}` },
      el("div", { class: "block-kopf" },
        el("span", { class: "block-sig", text: `[${b.ki}/${b.chat}]` }),
        el("span", { class: `marke ${b.sorte === "FRAGE" ? "zug" : b.sorte === "BESCHLUSS" || b.sorte === "ANTWORT" ? "ok" : ""}`.trim(), text: b.sorte }),
        el("span", { class: "meta", text: zeitLesbar(b.zeit) })),
      textBlock(b.text)));
  }
  for (const q of offeneFragen().filter((x) => x.thread === t)) ziel.append(frageKarte(q));
  ziel.append(beitragForm(t));
}

function beitragForm(t) {
  const sorte = el("select", { "aria-label": "Sorte" },
    ["BEFUND", "ANTWORT", "ANTRAG", "EINWAND", "ZUSTIMMUNG", "ZURUECK", "BESCHLUSS"].map((s) => el("option", { value: s, text: s })));
  const text = el("textarea", { placeholder: "Dein Beitrag …", "aria-label": "Beitrag", required: true });
  const knopf = el("button", { type: "submit", class: "knopf", text: "Anhängen" });
  const form = el("form", { class: "karte antwort-form" },
    el("h3", { text: "Beitrag als betreiber/dashboard" }),
    el("p", { class: "hinweis", text: "Wird unten an die Datei angehängt. BESCHLUSS schließt den Thread." }),
    sorte, text, el("div", { class: "antwort-knoepfe" }, knopf));
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!text.value.trim()) return;
    await schreibenMitKnopf([knopf], async () => {
      await gateSicherstellen();
      const r = await anhaengen(t.pfad, blockText(sorte.value, text.value), `${t.slug}: ${sorte.value} [${ICH.ki}/${ICH.chat}]`);
      threadErsetzen(t.pfad, r.text, r.sha);
      melden(`${sorte.value} in ${t.slug} geschrieben.`);
    });
  });
  return form;
}

/* ---------- Start ---------- */

async function starten() {
  try {
    await laden();
  } catch (e) {
    if (e instanceof GitHubFehler && (e.status === 401 || e.status === 403 || e.status === 404)) {
      speicherLoeschen(TOKEN_SCHLUESSEL);
      zustand.token = "";
      const f = $("anmeldung-fehler");
      f.textContent = e.status === 401
        ? "GitHub kennt dieses Token nicht (abgelaufen oder vertippt)."
        : `Kein Zugriff auf ${OWNER}/${REPO}${ZWEIG !== "main" ? " (Zweig " + ZWEIG + ")" : ""}: ${e.message}`;
      f.hidden = false;
      zeigen("anmeldung");
    } else {
      zeigen("anmeldung");
      melden("Laden fehlgeschlagen: " + e.message, true);
    }
  }
}

$("token-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const wert = $("token-eingabe").value.trim();
  if (!wert) return;
  zustand.token = wert;
  speicherSchreiben(TOKEN_SCHLUESSEL, wert, $("token-merken").checked);
  $("token-eingabe").value = "";
  $("anmeldung-fehler").hidden = true;
  starten();
});
$("abmelden").addEventListener("click", () => {
  speicherLoeschen(TOKEN_SCHLUESSEL);
  zustand.token = "";
  zustand.threads = [];
  zustand.roadmap = null;
  for (const id of ["verbindung", "neu-laden", "abmelden", "reiter"]) $(id).hidden = true;
  zeigen("anmeldung");
});
$("neu-laden").addEventListener("click", () => starten());
$("thread-suche").addEventListener("input", threadListeZeichnen);
$("nur-offene").addEventListener("change", threadListeZeichnen);
window.addEventListener("hashchange", () => { route(); window.scrollTo(0, 0); });

zustand.token = speicherLesen(TOKEN_SCHLUESSEL);
if (zustand.token) starten(); else zeigen("anmeldung");
