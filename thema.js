/* Farbschema setzen, bevor die Seite zeichnet (sonst blitzt sie kurz hell auf).
 * Der Schalter oben rechts speichert "hell" oder "dunkel"; ohne Eintrag gilt das System. */
(function () {
  "use strict";
  try {
    var wert = localStorage.getItem("core-pult-thema");
    if (wert === "hell") document.documentElement.setAttribute("data-theme", "light");
    else if (wert === "dunkel") document.documentElement.setAttribute("data-theme", "dark");
  } catch (e) { /* Speicher gesperrt: System entscheidet */ }
})();
