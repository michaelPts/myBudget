/* =========================================================================
   BUDGETRECHNER – LOGIK
   Diese Datei wird von allen 3 Seiten eingebunden (index.html, kategorien.html,
   sonstige.html) und kümmert sich um:
   - Laden/Speichern der Daten im localStorage des Browsers (inkl. Migration
     alter Datensätze ohne Kategorien)
   - Berechnen und Anzeigen des Saldos
   - Anlegen, Bearbeiten und Löschen von Ausgaben je Kategorie
   - Zeichnen des Balkendiagramms auf der Startseite
   - Navigation (aktiver Menüpunkt) und Dunkelmodus
   Jede Render-/Init-Funktion prüft zuerst, ob die benötigten Elemente auf der
   aktuellen Seite überhaupt vorhanden sind – so kann dieselbe Datei überall
   eingebunden werden, ohne Fehler zu werfen.
   ========================================================================= */

// Unter diesem Namen werden alle Daten im localStorage abgelegt.
const SPEICHER_SCHLUESSEL = "budgetrechnerDaten";
const MODUS_SCHLUESSEL = "budgetrechnerModus";

// Die 6 festen Kategorien für laufende Ausgaben (Reihenfolge = Anzeigereihenfolge
// auf kategorien.html; im Diagramm werden sie nach Betrag sortiert).
const KATEGORIEN = [
  { key: "wohnen", label: "Wohnen" },
  { key: "energie", label: "Energie" },
  { key: "arbeit", label: "Arbeit" },
  { key: "lebensmittel", label: "Lebensmittel" },
  { key: "kind", label: "Kind" },
  { key: "multimedia", label: "Multimedia" },
  { key: "versicherungen", label: "Versicherungen" },
];

// "daten" ist unser zentraler Zustand (State). Alles, was die App anzeigt,
// kommt aus diesem einen Objekt:
//   {
//     einkommen: 2400,
//     naechsteId: 4,
//     kategorien: { wohnen: [{id, name, betrag}], energie: [...], ... },
//     sonstige: [{id, name, betrag}]
//   }
let daten = ladeDaten();
speichereDaten(); // persistiert eine eventuelle Migration sofort im neuen Format

// Merkt sich, welche Ausgabe gerade im Bearbeiten-Modus ist: "bearbeitenZiel"
// ist entweder ein Kategorie-Key (z. B. "wohnen") oder "sonstige", kombiniert
// mit der ID der Ausgabe. Beides null, wenn gerade nichts bearbeitet wird.
let bearbeitenZiel = null;
let bearbeitenId = null;

/* =========================================================================
   DATEN LADEN, SPEICHERN & MIGRIEREN
   ========================================================================= */

// Erzeugt ein leeres Kategorien-Objekt mit allen festen Kategorien als leere Arrays.
function leereKategorien() {
  const objekt = {};
  KATEGORIEN.forEach((kategorie) => {
    objekt[kategorie.key] = [];
  });
  return objekt;
}

// Liest die gespeicherten Daten aus dem localStorage.
// Gibt es noch keine gespeicherten Daten, wird ein leerer Startzustand zurückgegeben.
function ladeDaten() {
  const gespeichertesJson = localStorage.getItem(SPEICHER_SCHLUESSEL);

  if (!gespeichertesJson) {
    return { einkommen: 0, naechsteId: 1, kategorien: leereKategorien(), sonstige: [] };
  }

  return migriereFallsNoetig(JSON.parse(gespeichertesJson));
}

// Wandelt ältere Datensätze in das aktuelle Format { einkommen, naechsteId,
// kategorien, sonstige } um, damit bereits gespeicherte Ausgaben nicht
// verloren gehen.
function migriereFallsNoetig(rohdaten) {
  // Ganz altes Format (vor den Kategorien): eine einzige flache "ausgaben"-Liste.
  // Diese wird komplett unter "Sonstige" übernommen.
  const istAltesFormat = Array.isArray(rohdaten.ausgaben) && !rohdaten.kategorien;

  if (istAltesFormat) {
    const alteAusgaben = rohdaten.ausgaben;
    const groessteId = alteAusgaben.reduce((max, ausgabe) => Math.max(max, ausgabe.id), 0);

    return {
      einkommen: rohdaten.einkommen || 0,
      naechsteId: groessteId + 1,
      kategorien: leereKategorien(),
      sonstige: alteAusgaben,
    };
  }

  // Aktuelles Format: fehlende Kategorien defensiv ergänzen (z. B. falls die
  // App später um weitere Kategorien erweitert wird).
  const kategorien = rohdaten.kategorien || {};
  KATEGORIEN.forEach((kategorie) => {
    if (!Array.isArray(kategorien[kategorie.key])) {
      kategorien[kategorie.key] = [];
    }
  });
  const sonstige = Array.isArray(rohdaten.sonstige) ? rohdaten.sonstige : [];

  return {
    einkommen: rohdaten.einkommen || 0,
    naechsteId: rohdaten.naechsteId || ermittleNeueIdAusDaten(kategorien, sonstige),
    kategorien: kategorien,
    sonstige: sonstige,
  };
}

// Fallback, falls ein Datensatz keinen "naechsteId"-Zähler besitzt:
// ermittelt die nächste freie ID anhand aller vorhandenen Ausgaben.
function ermittleNeueIdAusDaten(kategorien, sonstige) {
  const alleIds = Object.values(kategorien)
    .flat()
    .concat(sonstige)
    .map((ausgabe) => ausgabe.id);

  if (alleIds.length === 0) {
    return 1;
  }
  return Math.max(...alleIds) + 1;
}

// Schreibt den aktuellen Zustand "daten" zurück in den localStorage.
// Wird nach jeder Änderung aufgerufen, damit nichts verloren geht.
function speichereDaten() {
  localStorage.setItem(SPEICHER_SCHLUESSEL, JSON.stringify(daten));
}

// Liefert eine neue, noch nicht verwendete ID für eine neue Ausgabe
// (global eindeutig über alle Kategorien und "Sonstige" hinweg).
function ermittleNeueId() {
  const id = daten.naechsteId;
  daten.naechsteId += 1;
  return id;
}

/* =========================================================================
   HILFSFUNKTIONEN
   ========================================================================= */

// Wandelt eine Zahl in deutsches Geld-Format um, z. B. 1587.01 -> "1.587,01 €"
function formatiereEuro(zahl) {
  return new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: "EUR",
  }).format(zahl);
}

// Wandelt einen eingegebenen Text in eine Zahl um.
// Erlaubt sowohl Komma als auch Punkt als Dezimaltrennzeichen (z. B. "12,99" oder "12.99").
// Gibt null zurück, wenn der Text keine gültige Zahl ergibt.
function leseZahlAusText(text) {
  const bereinigterText = text.trim().replace(",", ".");

  if (bereinigterText === "") {
    return null;
  }

  const zahl = Number(bereinigterText);

  if (isNaN(zahl) || !isFinite(zahl)) {
    return null;
  }

  return zahl;
}

// Verhindert, dass Sonderzeichen in Namen (z. B. "<script>") als HTML interpretiert werden.
function escapeHtml(text) {
  const hilfsElement = document.createElement("div");
  hilfsElement.textContent = text;
  return hilfsElement.innerHTML;
}

// Liefert die Ausgaben-Liste zu einem "Ziel": entweder ein Kategorie-Key
// (z. B. "wohnen") oder "sonstige".
function holeListe(ziel) {
  return ziel === "sonstige" ? daten.sonstige : daten.kategorien[ziel];
}

// Summiert die Beträge einer Ausgaben-Liste.
function summeListe(liste) {
  return liste.reduce((summe, ausgabe) => summe + ausgabe.betrag, 0);
}

// Liefert alle Ausgaben aus allen Kategorien plus "Sonstige" als eine flache Liste
// (wird für den Gesamt-Saldo auf der Startseite benötigt).
function alleAusgaben() {
  const listen = KATEGORIEN.map((kategorie) => daten.kategorien[kategorie.key]);
  listen.push(daten.sonstige);
  return listen.flat();
}

/* =========================================================================
   ZAHLEN-HOCHZÄHL-ANIMATION (wiederverwendbar, z. B. für den Saldo)
   Zählt einen angezeigten Wert per requestAnimationFrame weich abbremsend
   (ease-out) von einem Start- zu einem Zielwert. Läuft bereits eine
   Animation auf demselben Element, wird sie zuerst abgebrochen, damit sich
   schnelle Änderungen (z. B. beim Tippen) nicht überlagern.
   ========================================================================= */

const ZAHL_ANIMATION_DAUER_MS = 800;

// Merkt sich pro Element die laufende Animation (requestAnimationFrame-ID),
// um sie bei einer neuen Änderung sauber abbrechen zu können.
const laufendeZahlAnimationen = new WeakMap();

// ease-out cubic: startet schnell, bremst weich zum Zielwert hin ab.
function easeOutKubisch(t) {
  return 1 - Math.pow(1 - t, 3);
}

// Zählt den Inhalt von "element" von "vonWert" zu "bisWert" hoch/runter.
// "formatFn" wandelt den jeweils aktuellen Zwischenwert in den Anzeigetext
// um (z. B. formatiereEuro). "beiFrame" ist optional und wird bei jedem
// Frame mit dem aktuellen Zwischenwert aufgerufen (z. B. um sich den zuletzt
// angezeigten Wert für die nächste Animation zu merken).
function animiereZahlAuf(element, vonWert, bisWert, formatFn, beiFrame) {
  const laufendeId = laufendeZahlAnimationen.get(element);
  if (laufendeId !== undefined) {
    cancelAnimationFrame(laufendeId);
  }

  const startZeit = performance.now();

  function frame(jetzt) {
    const verlauf = Math.min((jetzt - startZeit) / ZAHL_ANIMATION_DAUER_MS, 1);
    const aktuellerWert = vonWert + (bisWert - vonWert) * easeOutKubisch(verlauf);

    element.textContent = formatFn(aktuellerWert);
    if (beiFrame) {
      beiFrame(aktuellerWert);
    }

    if (verlauf < 1) {
      const id = requestAnimationFrame(frame);
      laufendeZahlAnimationen.set(element, id);
    } else {
      laufendeZahlAnimationen.delete(element);
    }
  }

  const id = requestAnimationFrame(frame);
  laufendeZahlAnimationen.set(element, id);
}

/* =========================================================================
   SALDO (Startseite)
   ========================================================================= */

// Merkt sich den zuletzt angezeigten (nicht zwingend fertig animierten)
// Saldo-Wert, damit eine neue Änderung weich von dort aus weiterzählt statt
// wieder bei 0 zu beginnen. "undefined" bedeutet: noch nie gerendert (Start).
let saldoAngezeigterWert;

// Berechnet den Saldo (Einkommen minus ALLE Ausgaben) und zeigt ihn groß +
// farbig in der Saldo-Karte an, wobei der angezeigte Wert weich zum neuen
// Saldo hochzählt. Tut nichts, falls die Karte auf der aktuellen Seite nicht
// existiert.
function rendereSaldo() {
  const saldoAnzeige = document.getElementById("saldo-anzeige");
  const saldoKarte = document.getElementById("saldo-karte");

  if (!saldoAnzeige || !saldoKarte) {
    return;
  }

  const summeAusgaben = summeListe(alleAusgaben());
  const saldo = daten.einkommen - summeAusgaben;

  // Die Farbe richtet sich nach dem Zielwert, damit sie während der
  // Animation nicht beim Durchlaufen der 0 hin- und herwechselt.
  if (saldo >= 0) {
    saldoKarte.classList.add("positiv");
    saldoKarte.classList.remove("negativ");
  } else {
    saldoKarte.classList.add("negativ");
    saldoKarte.classList.remove("positiv");
  }

  const vonWert = saldoAngezeigterWert === undefined ? 0 : saldoAngezeigterWert;

  animiereZahlAuf(saldoAnzeige, vonWert, saldo, formatiereEuro, (aktuellerWert) => {
    saldoAngezeigterWert = aktuellerWert;
  });
}

/* =========================================================================
   EINKOMMEN (Startseite)
   ========================================================================= */

const einkommenInput = document.getElementById("einkommen-input");
const einkommenFehler = document.getElementById("einkommen-fehler");

if (einkommenInput) {
  // Beim Tippen wird das Einkommen direkt geprüft, gespeichert und der Saldo aktualisiert.
  einkommenInput.addEventListener("input", () => {
    const eingegebenerText = einkommenInput.value;

    // Leeres Feld wird als Einkommen 0 behandelt (kein Fehler nötig)
    if (eingegebenerText.trim() === "") {
      einkommenFehler.textContent = "";
      daten.einkommen = 0;
      speichereDaten();
      rendereSaldo();
      return;
    }

    const zahl = leseZahlAusText(eingegebenerText);

    if (zahl === null) {
      einkommenFehler.textContent = "Bitte gib eine gültige Zahl ein.";
      return;
    }

    if (zahl < 0) {
      einkommenFehler.textContent = "Das Einkommen darf nicht negativ sein.";
      return;
    }

    einkommenFehler.textContent = "";
    daten.einkommen = zahl;
    speichereDaten();
    rendereSaldo();
  });
}

/* =========================================================================
   TORTENDIAGRAMM (Startseite)
   Reines SVG ohne externe Bibliothek: ein Kreissegment pro Kategorie mit
   Ausgaben (plus "Sonstige"), Größe = Anteil an den Gesamtausgaben. Die Farbe
   ist an die Kategorie-Identität gekoppelt (feste Reihenfolge = KATEGORIEN +
   "Sonstige"), nicht an ihre Größe/Position in der (nach Betrag sortierten)
   Anzeige. Beim ersten Laden der Seite fahren die Segmente einmalig
   nacheinander im Kreis auf (siehe animiereTorteAuf); bei allen späteren
   Aktualisierungen (Ausgabe hinzugefügt/geändert/gelöscht) wird nur noch
   der Endzustand direkt gezeichnet.
   ========================================================================= */

const TORTE_RADIUS = 90;
const TORTE_MITTE = 100;
const TORTE_GESAMTDAUER_MS = 900;

// Merkt sich die laufende Aufbau-Animation, um sie bei einem erneuten
// Rendern (z. B. sehr schnell hintereinander) sauber abbrechen zu können.
let torteAnimationId = null;

// Liefert Punkt auf dem Torten-Kreis für einen Winkel in Grad (0° = oben,
// im Uhrzeigersinn), Radius r um den Mittelpunkt.
function tortePunkt(winkelGrad, r) {
  const winkelRad = ((winkelGrad - 90) * Math.PI) / 180;
  return {
    x: TORTE_MITTE + r * Math.cos(winkelRad),
    y: TORTE_MITTE + r * Math.sin(winkelRad),
  };
}

// Baut den SVG-Pfad ("d"-Attribut) eines Kreissegments von startGrad bis
// endGrad. Deckt das Segment (fast) die volle 360° ab, wird stattdessen ein
// Vollkreis gezeichnet (ein einzelnes A-Segment kann keine 360° darstellen).
function torteSegmentPfad(startGrad, endGrad) {
  if (endGrad - startGrad >= 359.99) {
    return `M ${TORTE_MITTE} ${TORTE_MITTE - TORTE_RADIUS}
            A ${TORTE_RADIUS} ${TORTE_RADIUS} 0 1 1 ${TORTE_MITTE - 0.01} ${TORTE_MITTE - TORTE_RADIUS}
            Z`;
  }

  const start = tortePunkt(startGrad, TORTE_RADIUS);
  const ende = tortePunkt(endGrad, TORTE_RADIUS);
  const grossBogen = endGrad - startGrad > 180 ? 1 : 0;

  return `M ${TORTE_MITTE} ${TORTE_MITTE}
          L ${start.x} ${start.y}
          A ${TORTE_RADIUS} ${TORTE_RADIUS} 0 ${grossBogen} 1 ${ende.x} ${ende.y}
          Z`;
}

function rendereDiagramm(animiert) {
  const flaeche = document.getElementById("diagramm-flaeche");
  const leerHinweis = document.getElementById("diagramm-leer-hinweis");
  const gesamtBetragEl = document.getElementById("ausgaben-gesamt-betrag");

  if (!flaeche) {
    return;
  }

  if (torteAnimationId !== null) {
    cancelAnimationFrame(torteAnimationId);
    torteAnimationId = null;
  }

  const gesamtAusgaben = summeListe(alleAusgaben());

  if (gesamtBetragEl) {
    gesamtBetragEl.textContent = formatiereEuro(gesamtAusgaben);
  }

  // Feste Farbzuordnung je Kategorie (Position in diesem Array = Farbindex),
  // unabhängig von der späteren Sortierung nach Betrag.
  const segmenteMitFarbe = KATEGORIEN.map((kategorie, index) => ({
    label: kategorie.label,
    betrag: summeListe(daten.kategorien[kategorie.key]),
    farbe: `var(--torte-farbe-${index + 1})`,
  }));
  segmenteMitFarbe.push({
    label: "Sonstige",
    betrag: summeListe(daten.sonstige),
    farbe: `var(--torte-farbe-${KATEGORIEN.length + 1})`,
  });

  // Kategorien ohne Ausgaben ausblenden; Rest nach Betrag absteigend sortiert
  // (bestimmt Reihenfolge in Torte UND Legende).
  const sichtbareSegmente = segmenteMitFarbe
    .filter((segment) => segment.betrag > 0)
    .sort((a, b) => b.betrag - a.betrag);

  flaeche.innerHTML = "";

  if (sichtbareSegmente.length === 0 || gesamtAusgaben <= 0) {
    if (leerHinweis) {
      leerHinweis.style.display = "block";
    }
    return;
  }

  if (leerHinweis) {
    leerHinweis.style.display = "none";
  }

  // Start-/Endwinkel je Segment (kumulativ, 0° = oben, im Uhrzeigersinn) vorab
  // berechnen – sowohl für die Legende (Prozentwerte) als auch fürs Zeichnen.
  let laufenderWinkel = 0;
  const segmenteMitWinkel = sichtbareSegmente.map((segment) => {
    const anteil = segment.betrag / gesamtAusgaben;
    const startGrad = laufenderWinkel;
    const endGrad = laufenderWinkel + anteil * 360;
    laufenderWinkel = endGrad;
    return { ...segment, anteil, startGrad, endGrad };
  });

  const svgNs = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNs, "svg");
  svg.setAttribute("viewBox", "0 0 200 200");
  svg.setAttribute("class", "torte-svg");
  svg.setAttribute("role", "img");
  svg.setAttribute(
    "aria-label",
    "Tortendiagramm der monatlichen Ausgaben: " +
      segmenteMitWinkel
        .map((s) => `${s.label} ${formatiereEuro(s.betrag)}`)
        .join(", ")
  );

  const pfadElemente = segmenteMitWinkel.map((segment) => {
    const pfad = document.createElementNS(svgNs, "path");
    pfad.setAttribute("class", "torte-segment");
    pfad.setAttribute("fill", segment.farbe);
    svg.appendChild(pfad);
    return pfad;
  });

  flaeche.appendChild(svg);

  const legende = document.createElement("ul");
  legende.className = "torte-legende";
  segmenteMitWinkel.forEach((segment) => {
    const eintrag = document.createElement("li");
    eintrag.className = "torte-legende-eintrag";
    eintrag.innerHTML = `
      <span class="torte-punkt" style="background: ${segment.farbe}"></span>
      <span class="torte-name">${escapeHtml(segment.label)}</span>
      <span class="torte-betrag">${formatiereEuro(segment.betrag)}</span>
      <span class="torte-prozent">${(segment.anteil * 100).toFixed(1).replace(".", ",")} %</span>
    `;
    legende.appendChild(eintrag);
  });
  flaeche.appendChild(legende);

  if (animiert) {
    animiereTorteAuf(pfadElemente, segmenteMitWinkel);
  } else {
    pfadElemente.forEach((pfad, index) => {
      const segment = segmenteMitWinkel[index];
      pfad.setAttribute("d", torteSegmentPfad(segment.startGrad, segment.endGrad));
    });
  }
}

// Lässt die Segmente einmalig nacheinander im Kreis "auffahren": jedes
// Segment wächst von seinem Startwinkel bis zu seinem vollen Endwinkel,
// bevor das nächste Segment startet. Die Gesamtdauer wird proportional zur
// Größe der Segmente verteilt (größere Segmente animieren etwas länger).
function animiereTorteAuf(pfadElemente, segmenteMitWinkel) {
  // Noch nicht an der Reihe befindliche Segmente vorab unsichtbar (Länge 0)
  // an ihrer Startposition zeichnen, damit nichts "vorzeitig" aufblitzt.
  pfadElemente.forEach((pfad, index) => {
    const segment = segmenteMitWinkel[index];
    pfad.setAttribute("d", torteSegmentPfad(segment.startGrad, segment.startGrad));
  });

  const MIN_DAUER_MS = 60;
  let segmentIndex = 0;

  function animiereSegment() {
    if (segmentIndex >= segmenteMitWinkel.length) {
      torteAnimationId = null;
      return;
    }

    const segment = segmenteMitWinkel[segmentIndex];
    const pfad = pfadElemente[segmentIndex];
    const segmentDauer = Math.max(
      MIN_DAUER_MS,
      TORTE_GESAMTDAUER_MS * (segment.anteil || 0)
    );
    const startZeit = performance.now();

    function frame(jetzt) {
      const verlauf = Math.min((jetzt - startZeit) / segmentDauer, 1);
      const aktuellesEnde =
        segment.startGrad + (segment.endGrad - segment.startGrad) * easeOutKubisch(verlauf);

      pfad.setAttribute("d", torteSegmentPfad(segment.startGrad, aktuellesEnde));

      if (verlauf < 1) {
        torteAnimationId = requestAnimationFrame(frame);
      } else {
        segmentIndex += 1;
        animiereSegment();
      }
    }

    torteAnimationId = requestAnimationFrame(frame);
  }

  animiereSegment();
}

/* =========================================================================
   HORIZONTALES BALKENDIAGRAMM (in jeder Ausgaben-Karte)
   Reines HTML/CSS: pro Ausgabe eine Zeile mit einem horizontalen Balken,
   dessen Breite proportional zum größten Betrag der Kategorie ist. Größter
   Betrag oben, kleinster unten. Wird bei leerer Liste ausgeblendet.
   ========================================================================= */

function rendereKategorieBalken(liste, container) {
  if (!container) {
    return;
  }

  container.innerHTML = "";

  if (liste.length === 0) {
    container.style.display = "none";
    return;
  }

  container.style.display = "flex";

  const sortiert = [...liste].sort((a, b) => b.betrag - a.betrag);
  const maxWert = sortiert[0].betrag;

  sortiert.forEach((ausgabe) => {
    const breiteProzent = (ausgabe.betrag / maxWert) * 100;

    const zeile = document.createElement("div");
    zeile.className = "hbalken-zeile";
    zeile.innerHTML = `
      <div class="hbalken-info">
        <span class="hbalken-label">${escapeHtml(ausgabe.name)}</span>
        <span class="hbalken-wert">${formatiereEuro(ausgabe.betrag)}</span>
      </div>
      <div class="hbalken-huelle">
        <div class="hbalken" style="width: ${breiteProzent}%"></div>
      </div>
    `;
    container.appendChild(zeile);
  });
}

/* =========================================================================
   ÜBERSICHTSTABELLE (kategorien.html & sonstige.html)
   Zeigt alle Ausgaben gruppiert nach Kategorie mit Zwischensumme an. Auf
   kategorien.html werden alle festen Kategorien gruppiert, auf sonstige.html
   nur die eine Gruppe "Sonstige Ausgaben". Kategorien ohne Ausgaben werden
   nicht angezeigt.
   ========================================================================= */

function rendereUebersichtstabelle() {
  const karte = document.querySelector(".uebersicht-karte[data-tabelle-modus]");

  if (!karte) {
    return;
  }

  const modus = karte.dataset.tabelleModus;
  const wrapper = karte.querySelector(".tabelle-wrapper");
  const body = karte.querySelector(".uebersicht-tabelle-body");
  const leerHinweis = karte.querySelector(".leer-hinweis");

  const gruppen = modus === "sonstige"
    ? [{ label: "Sonstige Ausgaben", liste: daten.sonstige }]
    : KATEGORIEN.map((kategorie) => ({ label: kategorie.label, liste: daten.kategorien[kategorie.key] }));

  const sichtbareGruppen = gruppen.filter((gruppe) => gruppe.liste.length > 0);

  body.innerHTML = "";

  if (sichtbareGruppen.length === 0) {
    wrapper.style.display = "none";
    if (leerHinweis) {
      leerHinweis.style.display = "block";
    }
    return;
  }

  wrapper.style.display = "block";
  if (leerHinweis) {
    leerHinweis.style.display = "none";
  }

  // Die Jahreswerte-Spalte (Monatsbetrag × 12) gibt es nur in der Übersicht
  // der laufenden Ausgaben (kategorien.html), nicht bei "Sonstige".
  const mitJahresspalte = modus !== "sonstige";

  sichtbareGruppen.forEach((gruppe) => {
    const summeMonat = summeListe(gruppe.liste);
    const kopfZeile = document.createElement("tr");
    kopfZeile.className = "uebersicht-gruppen-zeile";
    kopfZeile.innerHTML = mitJahresspalte
      ? `
        <th scope="col">${escapeHtml(gruppe.label)}</th>
        <th scope="col" class="spalte-zahl">${formatiereEuro(summeMonat)}</th>
        <th scope="col" class="spalte-zahl">${formatiereEuro(summeMonat * 12)}</th>
      `
      : `
        <th scope="col">${escapeHtml(gruppe.label)}</th>
        <th scope="col" class="spalte-zahl">${formatiereEuro(summeMonat)}</th>
      `;
    body.appendChild(kopfZeile);

    gruppe.liste.forEach((ausgabe) => {
      const zeile = document.createElement("tr");
      zeile.innerHTML = mitJahresspalte
        ? `
          <td>${escapeHtml(ausgabe.name)}</td>
          <td class="spalte-zahl">${formatiereEuro(ausgabe.betrag)}</td>
          <td class="spalte-zahl">${formatiereEuro(ausgabe.betrag * 12)}</td>
        `
        : `
          <td>${escapeHtml(ausgabe.name)}</td>
          <td class="spalte-zahl">${formatiereEuro(ausgabe.betrag)}</td>
        `;
      body.appendChild(zeile);
    });
  });
}

/* =========================================================================
   EXPORT / IMPORT – Laufende Ausgaben (kategorien.html)
   Reiner Text-/Datei-Austausch ohne Server oder Konto, funktioniert
   identisch auf Android und iOS: Export als Datei-Download ODER als Text
   zum Kopieren (falls der Datei-Download im jeweiligen Browser/Kontext
   nicht verfügbar ist, z. B. bei manchen file://-Aufrufen). Der Import
   ERSETZT alle laufenden Ausgaben (alle 7 Kategorien) auf diesem Gerät.
   IDs werden bewusst nicht mit exportiert/übernommen, da auf dem Zielgerät
   eigene, kollisionsfreie IDs vergeben werden müssen.
   ========================================================================= */

const EXPORT_TYP = "budgetrechner-laufende-ausgaben";

// Baut die Export-Datenstruktur aus dem aktuellen Zustand.
function erzeugeExportDaten() {
  const kategorienExport = {};

  KATEGORIEN.forEach((kategorie) => {
    kategorienExport[kategorie.key] = daten.kategorien[kategorie.key].map((ausgabe) => ({
      name: ausgabe.name,
      betrag: ausgabe.betrag,
    }));
  });

  return {
    typ: EXPORT_TYP,
    version: 1,
    exportiertAm: new Date().toISOString(),
    kategorien: kategorienExport,
  };
}

// Erzeugt einen Dateinamen-Zeitstempel im Format JJJJ-MM-TT.
function erzeugeDateistempel() {
  const jetzt = new Date();
  const zweistellig = (zahl) => String(zahl).padStart(2, "0");
  return `${jetzt.getFullYear()}-${zweistellig(jetzt.getMonth() + 1)}-${zweistellig(jetzt.getDate())}`;
}

// Prüft importierte Rohdaten und ERSETZT alle laufenden Ausgaben (alle 7
// Kategorien) auf diesem Gerät. Ungültige Einzel-Einträge werden übersprungen.
// Wirft einen Error mit verständlicher Meldung, wenn das Format nicht passt.
// Gibt die Anzahl der übernommenen Ausgaben zurück.
function importiereLaufendeAusgaben(rohdaten) {
  if (!rohdaten || typeof rohdaten !== "object" || typeof rohdaten.kategorien !== "object") {
    throw new Error("Das ist keine gültige Export-Datei für laufende Ausgaben.");
  }

  const neueKategorien = leereKategorien();
  let anzahlUebernommen = 0;

  KATEGORIEN.forEach((kategorie) => {
    const eintraege = rohdaten.kategorien[kategorie.key];

    if (!Array.isArray(eintraege)) {
      return;
    }

    eintraege.forEach((eintrag) => {
      const name = eintrag && typeof eintrag.name === "string" ? eintrag.name.trim() : "";
      const betrag = eintrag ? Number(eintrag.betrag) : NaN;

      if (name === "" || !isFinite(betrag) || betrag <= 0) {
        return;
      }

      neueKategorien[kategorie.key].push({ id: ermittleNeueId(), name, betrag });
      anzahlUebernommen += 1;
    });
  });

  daten.kategorien = neueKategorien;
  speichereDaten();

  return anzahlUebernommen;
}

// Kopiert Text in die Zwischenablage, mit Fallback für Browser/Kontexte ohne
// Clipboard-API (z. B. beim direkten Öffnen der Seite über file:// auf iOS).
function kopiereTextInZwischenablage(text, textareaElement) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    return navigator.clipboard.writeText(text);
  }

  return new Promise((resolve, reject) => {
    textareaElement.focus();
    textareaElement.select();
    const erfolgreich = document.execCommand("copy");
    if (erfolgreich) {
      resolve();
    } else {
      reject(new Error("Kopieren nicht möglich"));
    }
  });
}

// Verbindet die Export/Import-Karte auf kategorien.html mit den Funktionen
// oben. Tut nichts, falls die Karte auf der aktuellen Seite nicht existiert.
function initialisiereExportImport() {
  const exportDateiButton = document.getElementById("export-datei-button");

  if (!exportDateiButton) {
    return;
  }

  const exportTextButton = document.getElementById("export-text-button");
  const exportTextBereich = document.getElementById("export-text-bereich");
  const exportTextFeld = document.getElementById("export-text-feld");
  const exportKopierenButton = document.getElementById("export-kopieren-button");
  const exportKopierenErfolg = document.getElementById("export-kopieren-erfolg");
  const exportKopierenFehler = document.getElementById("export-kopieren-fehler");
  const importDateiInput = document.getElementById("import-datei-input");
  const importTextFeld = document.getElementById("import-text-feld");
  const importTextButton = document.getElementById("import-text-button");
  const importErfolg = document.getElementById("import-erfolg");
  const importFehler = document.getElementById("import-fehler");

  exportDateiButton.addEventListener("click", () => {
    const text = JSON.stringify(erzeugeExportDaten(), null, 2);
    const blob = new Blob([text], { type: "application/json" });
    const url = URL.createObjectURL(blob);

    const link = document.createElement("a");
    link.href = url;
    link.download = `laufende-ausgaben-${erzeugeDateistempel()}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    // Object-URL erst zeitversetzt freigeben, damit der Download sicher startet.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });

  exportTextButton.addEventListener("click", () => {
    const wirdEingeblendet = exportTextBereich.hidden;
    if (wirdEingeblendet) {
      exportTextFeld.value = JSON.stringify(erzeugeExportDaten(), null, 2);
      exportKopierenErfolg.textContent = "";
      exportKopierenFehler.textContent = "";
    }
    exportTextBereich.hidden = !wirdEingeblendet;
  });

  exportKopierenButton.addEventListener("click", () => {
    kopiereTextInZwischenablage(exportTextFeld.value, exportTextFeld)
      .then(() => {
        exportKopierenErfolg.textContent = "In die Zwischenablage kopiert.";
        exportKopierenFehler.textContent = "";
      })
      .catch(() => {
        exportKopierenFehler.textContent = "Kopieren nicht möglich – bitte Text oben manuell markieren und kopieren.";
        exportKopierenErfolg.textContent = "";
      });
  });

  // Führt den Import anhand eines rohen JSON-Textes aus: parsen, per
  // Rückfrage bestätigen lassen (da alle laufenden Ausgaben ersetzt werden)
  // und anschließend übernehmen.
  function fuehreImportAus(rohtext) {
    importErfolg.textContent = "";
    importFehler.textContent = "";

    let rohdaten;
    try {
      rohdaten = JSON.parse(rohtext);
    } catch (fehler) {
      importFehler.textContent = "Der Text/die Datei enthält kein gültiges JSON.";
      return;
    }

    const bestaetigt = confirm(
      "Alle laufenden Ausgaben auf diesem Gerät werden durch die importierten Daten ersetzt. Fortfahren?"
    );
    if (!bestaetigt) {
      return;
    }

    try {
      const anzahl = importiereLaufendeAusgaben(rohdaten);
      importErfolg.textContent = `${anzahl} Ausgabe(n) erfolgreich importiert. Seite wird neu geladen …`;
      setTimeout(() => location.reload(), 1200);
    } catch (fehler) {
      importFehler.textContent = fehler.message;
    }
  }

  importDateiInput.addEventListener("change", () => {
    const datei = importDateiInput.files[0];
    if (!datei) {
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      fuehreImportAus(String(reader.result));
      importDateiInput.value = "";
    };
    reader.onerror = () => {
      importFehler.textContent = "Datei konnte nicht gelesen werden.";
      importDateiInput.value = "";
    };
    reader.readAsText(datei);
  });

  importTextButton.addEventListener("click", () => {
    fuehreImportAus(importTextFeld.value);
  });
}

/* =========================================================================
   AUSGABEN-KARTEN (kategorien.html & sonstige.html)
   Eine "Ausgaben-Karte" ist ein Kartenblock mit data-ziel (Kategorie-Key oder
   "sonstige"), eigenem Formular, eigener Liste und optionaler Zwischensumme.
   Diese Funktionen werden generisch für jede gefundene Karte aufgerufen –
   so entsteht kein doppelter Code für die 6 Kategorien und "Sonstige".
   ========================================================================= */

// Sucht alle Ausgaben-Karten auf der aktuellen Seite und initialisiert sie.
function initialisiereAusgabenKarten() {
  document.querySelectorAll(".ausgaben-karte[data-ziel]").forEach((karte) => {
    initialisiereAusgabenKarte(karte);
  });
}

function initialisiereAusgabenKarte(karte) {
  const ziel = karte.dataset.ziel;
  const formular = karte.querySelector(".ausgabe-formular");
  const nameInput = karte.querySelector(".ausgabe-name-input");
  const betragInput = karte.querySelector(".ausgabe-betrag-input");
  const nameFehler = karte.querySelector(".name-fehler");
  const betragFehler = karte.querySelector(".betrag-fehler");
  const liste = karte.querySelector(".ausgaben-liste");
  const leerHinweis = karte.querySelector(".leer-hinweis");
  const zwischensummeEl = karte.querySelector(".zwischensumme-betrag");
  const balkenContainer = karte.querySelector(".kategorie-balken");

  // Zeichnet die Liste dieser einen Karte neu, je nach Zustand von
  // "holeListe(ziel)" und "bearbeitenZiel"/"bearbeitenId".
  function rendereKarte() {
    const eintraege = holeListe(ziel);

    liste.innerHTML = "";
    leerHinweis.style.display = eintraege.length === 0 ? "block" : "none";

    if (zwischensummeEl) {
      zwischensummeEl.textContent = formatiereEuro(summeListe(eintraege));
    }

    rendereKategorieBalken(eintraege, balkenContainer);

    eintraege.forEach((ausgabe) => {
      const eintrag = document.createElement("li");
      eintrag.className = "ausgabe-eintrag";
      eintrag.dataset.id = ausgabe.id;

      if (bearbeitenZiel === ziel && bearbeitenId === ausgabe.id) {
        // ---- Bearbeiten-Modus: Eingabefelder statt reinem Text ----
        const betragAlsText = String(ausgabe.betrag).replace(".", ",");
        eintrag.innerHTML = `
          <div class="ausgabe-bearbeiten">
            <input type="text" class="edit-name-input" value="${escapeHtml(ausgabe.name)}">
            <input type="text" class="edit-betrag-input" value="${betragAlsText}" inputmode="decimal">
            <div class="ausgabe-buttons">
              <button type="button" class="btn btn-speichern">Speichern</button>
              <button type="button" class="btn btn-abbrechen">Abbrechen</button>
            </div>
            <p class="fehler-text edit-fehler"></p>
          </div>
        `;
      } else {
        // ---- Normale Ansicht ----
        eintrag.innerHTML = `
          <span class="ausgabe-name">${escapeHtml(ausgabe.name)}</span>
          <span class="ausgabe-betrag">${formatiereEuro(ausgabe.betrag)}</span>
          <div class="ausgabe-buttons">
            <button type="button" class="btn btn-bearbeiten">Bearbeiten</button>
            <button type="button" class="btn btn-loeschen">Löschen</button>
          </div>
        `;
      }

      liste.appendChild(eintrag);
    });
  }

  formular.addEventListener("submit", (event) => {
    // Verhindert, dass die Seite neu geladen wird (Standardverhalten von Formularen)
    event.preventDefault();

    nameFehler.textContent = "";
    betragFehler.textContent = "";

    const name = nameInput.value.trim();
    const betrag = leseZahlAusText(betragInput.value);

    let eingabeIstGueltig = true;

    if (name === "") {
      nameFehler.textContent = "Bitte gib einen Namen ein.";
      eingabeIstGueltig = false;
    }

    if (betrag === null) {
      betragFehler.textContent = "Bitte gib eine gültige Zahl ein.";
      eingabeIstGueltig = false;
    } else if (betrag <= 0) {
      betragFehler.textContent = "Der Betrag muss größer als 0 sein.";
      eingabeIstGueltig = false;
    }

    if (!eingabeIstGueltig) {
      return;
    }

    holeListe(ziel).push({ id: ermittleNeueId(), name, betrag });

    speichereDaten();
    rendereKarte();
    rendereSaldo();
    rendereDiagramm();
    rendereUebersichtstabelle();

    // Formular für die nächste Eingabe zurücksetzen
    nameInput.value = "";
    betragInput.value = "";
    nameInput.focus();
  });

  // Ein einziger Klick-Listener auf der Liste kümmert sich um alle Buttons
  // (Bearbeiten, Löschen, Speichern, Abbrechen) – das nennt man "Event Delegation".
  liste.addEventListener("click", (event) => {
    const geklickterButton = event.target;
    const eintrag = geklickterButton.closest(".ausgabe-eintrag");

    if (!eintrag) {
      return;
    }

    const id = Number(eintrag.dataset.id);

    if (geklickterButton.classList.contains("btn-loeschen")) {
      loescheAusgabe(ziel, id, rendereKarte);
    } else if (geklickterButton.classList.contains("btn-bearbeiten")) {
      bearbeitenZiel = ziel;
      bearbeitenId = id;
      rendereKarte();
    } else if (geklickterButton.classList.contains("btn-abbrechen")) {
      bearbeitenZiel = null;
      bearbeitenId = null;
      rendereKarte();
    } else if (geklickterButton.classList.contains("btn-speichern")) {
      speichereBearbeiteteAusgabe(ziel, id, eintrag, rendereKarte);
    }
  });

  rendereKarte();
}

/* =========================================================================
   EIN-/AUSKLAPPBARE BEREICHE (Kategorie-Karten & Übersichtstabellen)
   Jeder Umschalt-Button (".kategorie-umschalten") steuert den direkt
   folgenden Bereich (".kategorie-details"). Generisch für Kacheln UND die
   Übersichtstabellen, damit dieselbe Klick-Logik nur einmal existiert.
   ========================================================================= */

function initialisiereAusklappBereiche() {
  document.querySelectorAll(".kategorie-umschalten").forEach((button) => {
    const bereich = button.nextElementSibling;

    if (!bereich || !bereich.classList.contains("kategorie-details")) {
      return;
    }

    const textEl = button.querySelector(".umschalten-text");
    const labelZu = button.dataset.labelZu || (textEl ? textEl.textContent : "");
    const labelOffen = button.dataset.labelOffen || labelZu;

    button.addEventListener("click", () => {
      const istOffen = bereich.classList.toggle("offen");
      button.setAttribute("aria-expanded", String(istOffen));
      if (textEl) {
        textEl.textContent = istOffen ? labelOffen : labelZu;
      }
    });
  });
}

// Löscht eine Ausgabe aus dem angegebenen Ziel, aber erst nach kurzer Rückfrage.
function loescheAusgabe(ziel, id, rendereKarte) {
  const ausgabe = holeListe(ziel).find((a) => a.id === id);
  if (!ausgabe) {
    return;
  }

  const bestaetigt = confirm(`"${ausgabe.name}" wirklich löschen?`);
  if (!bestaetigt) {
    return;
  }

  if (ziel === "sonstige") {
    daten.sonstige = daten.sonstige.filter((a) => a.id !== id);
  } else {
    daten.kategorien[ziel] = daten.kategorien[ziel].filter((a) => a.id !== id);
  }

  speichereDaten();
  rendereKarte();
  rendereSaldo();
  rendereDiagramm();
  rendereUebersichtstabelle();
}

// Liest die Eingabefelder im Bearbeiten-Modus aus, prüft sie und speichert die Änderung.
function speichereBearbeiteteAusgabe(ziel, id, eintragElement, rendereKarte) {
  const nameInput = eintragElement.querySelector(".edit-name-input");
  const betragInput = eintragElement.querySelector(".edit-betrag-input");
  const fehlerText = eintragElement.querySelector(".edit-fehler");

  const name = nameInput.value.trim();
  const betrag = leseZahlAusText(betragInput.value);

  if (name === "") {
    fehlerText.textContent = "Bitte gib einen Namen ein.";
    return;
  }

  if (betrag === null) {
    fehlerText.textContent = "Bitte gib eine gültige Zahl ein.";
    return;
  }

  if (betrag <= 0) {
    fehlerText.textContent = "Der Betrag muss größer als 0 sein.";
    return;
  }

  const ausgabe = holeListe(ziel).find((a) => a.id === id);
  ausgabe.name = name;
  ausgabe.betrag = betrag;

  bearbeitenZiel = null;
  bearbeitenId = null;
  speichereDaten();
  rendereKarte();
  rendereSaldo();
  rendereDiagramm();
  rendereUebersichtstabelle();
}

/* =========================================================================
   NAVIGATION
   ========================================================================= */

// Markiert den Navigationslink der aktuell geöffneten Seite als aktiv,
// indem der Dateiname aus der URL mit dem href jedes Links verglichen wird.
function markiereAktiveNavigation() {
  const aktuelleSeite = location.pathname.split("/").pop() || "index.html";

  document.querySelectorAll(".nav-link").forEach((link) => {
    if (link.getAttribute("href") === aktuelleSeite) {
      link.classList.add("aktiv");
    }
  });
}

/* =========================================================================
   DARK MODE / LIGHT MODE
   ========================================================================= */

const modusButton = document.getElementById("modus-umschalten");

// Schaltet die CSS-Klasse "dunkel-modus" am <html>-Element um und passt das
// Icon an. Die Klasse wird bewusst am <html>-Element (nicht am <body>)
// gesetzt, weil ein kleines Inline-Skript im <head> genau diese Klasse schon
// vor dem ersten Rendern setzt (siehe Kommentar dort) – das verhindert ein
// kurzes Aufblitzen des Hellmodus beim Seitenwechsel im Dunkelmodus.
function wendeModusAn(modus) {
  const istDunkel = modus === "dunkel";
  document.documentElement.classList.toggle("dunkel-modus", istDunkel);
  if (modusButton) {
    modusButton.textContent = istDunkel ? "☀️" : "🌙";
  }
}

if (modusButton) {
  modusButton.addEventListener("click", () => {
    const istAktuellDunkel = document.documentElement.classList.contains("dunkel-modus");
    const neuerModus = istAktuellDunkel ? "hell" : "dunkel";
    wendeModusAn(neuerModus);
    localStorage.setItem(MODUS_SCHLUESSEL, neuerModus);
  });
}

/* =========================================================================
   START
   ========================================================================= */

// Zeigt das gespeicherte Einkommen im Eingabefeld an (falls vorhanden),
// stellt den zuletzt gewählten Modus (hell/dunkel) wieder her und rendert
// alle Bereiche, die auf der aktuellen Seite existieren.
function initialisiere() {
  if (einkommenInput && daten.einkommen) {
    einkommenInput.value = String(daten.einkommen).replace(".", ",");
  }

  wendeModusAn(localStorage.getItem(MODUS_SCHLUESSEL) || "hell");
  markiereAktiveNavigation();
  initialisiereAusgabenKarten();
  initialisiereAusklappBereiche();
  initialisiereExportImport();
  rendereSaldo();
  rendereDiagramm(true);
  rendereUebersichtstabelle();
}

initialisiere();
