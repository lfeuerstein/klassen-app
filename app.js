/* Klassen-App – Sitzplan und Schnellbewertung der Projektkompetenz.
   Alle Daten (Klassen, Fotos, Bewertungen) bleiben auf dem Gerät (IndexedDB). Es wird nichts gesendet.
   Aufbau nach dem vom Lehrer abgenommenen Mockup (21.11.2026). */
(() => {
  'use strict';
  const STAND = '2026-11-27.19';
  // Moodle-Fassung: liegt die App als Datei in einem Moodle-Kurs, ist die Adresse …/pluginfile.php/…
  const IN_MOODLE = /\/pluginfile\.php\//.test(location.pathname);
  const WERT = { '++': 1, '+': 2, 'o': 3, '-': 4, '--': 5 };
  const WFARBE = { '++': 'var(--w1)', '+': 'var(--w2)', 'o': 'var(--w3)', '-': 'var(--w4)', '--': 'var(--w5)' };
  const ZEIG = (w) => w.replace(/-/g, '−');
  const $ = (id) => document.getElementById(id);

  // ---------- Speicher auf dem Gerät ----------
  const DB = (() => {
    let offen = null;
    const oeffne = () => offen || (offen = new Promise((ok, nein) => {
      const r = indexedDB.open('klassen-app', 1);
      r.onupgradeneeded = () => { r.result.createObjectStore('kv'); r.result.createObjectStore('fotos'); };
      r.onsuccess = () => ok(r.result);
      r.onerror = () => nein(r.error || new Error('Speicher nicht verfügbar'));
    }));
    const tx = async (store, art, f) => {
      const db = await oeffne();
      return new Promise((ok, nein) => {
        const t = db.transaction(store, art); const erg = f(t.objectStore(store));
        t.oncomplete = () => ok(typeof erg === 'function' ? erg() : erg && 'result' in erg ? erg.result : undefined);
        t.onerror = () => nein(t.error); t.onabort = () => nein(t.error || new Error('abgebrochen'));
      });
    };
    return {
      lies: (store, key) => tx(store, 'readonly', (s) => s.get(key)),
      schreib: (store, key, wert) => tx(store, 'readwrite', (s) => s.put(wert, key)),
      loesch: (store, key) => tx(store, 'readwrite', (s) => s.delete(key)),
      leeren: (store) => tx(store, 'readwrite', (s) => s.clear()),
      alle: (store) => tx(store, 'readonly', (s) => { const k = s.getAllKeys(), w = s.getAll(); return () => k.result.map((x, i) => [x, w.result[i]]); }),
    };
  })();

  const grundKriterien = () => [
    { id: 'k1', name: 'Selbstständigkeit', gewicht: 1 }, { id: 'k2', name: 'Teamarbeit', gewicht: 1 },
    { id: 'k3', name: 'Fachliche Umsetzung', gewicht: 2 }, { id: 'k4', name: 'Sorgfalt und Sicherheit', gewicht: 1 },
    { id: 'k5', name: 'Präsentation', gewicht: 1 }, { id: 'k6', name: 'Soziales Verhalten', gewicht: 1 }];
  const grund = () => ({ app: 'klassen-app', version: 2, klasse: null, kriterien: grundKriterien(), klassen: {}, letzteSicherung: null });
  // Daten aus älteren Ständen nachrüsten. Version 2 (Wunsch 27.11.2026): Kriterium „Soziales Verhalten“ einmalig dazu –
  // wer es danach im Menü löscht, bekommt es nicht wieder. Leere Kriterien zählen in der Note nicht mit (noteVon).
  function nachruesten() {
    if ((st.version || 1) < 2) {
      if (!st.kriterien.some((k) => /soziales\s+verhalten/i.test(k.name))) st.kriterien.push({ id: 'k6', name: 'Soziales Verhalten', gewicht: 1 });
      st.version = 2;
    }
  }
  let st = grund();
  const fotos = new Map();

  let schreibt = false, nochmal = false;
  async function sichern() {
    if (IN_MOODLE) { moodleMerken(); return; }
    if (schreibt) { nochmal = true; return; }
    schreibt = true;
    try { do { nochmal = false; await DB.schreib('kv', 'zustand', st); } while (nochmal); }
    catch (e) { banner('Speichern hat nicht geklappt (' + (e && e.message || e) + '). Bitte gleich eine Sicherung speichern.'); }
    finally { schreibt = false; }
  }
  const banner = (text) => { const b = $('banner'); b.textContent = text; b.hidden = !text; };

  // ---------- Hilfen ----------
  const neueId = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const kd = () => (st.klasse && st.klassen[st.klasse]) || null;
  const schueler = () => (kd() ? kd().schueler : []);
  const finde = (id) => schueler().find((s) => s.id === id);
  const farbe = (t) => { let h = 0; for (const c of t) h = (h * 31 + c.charCodeAt(0)) % 360; return 'hsl(' + h + ' 55% 45%)'; };
  const kuerzel = (n) => n.trim().split(/\s+/).map((x) => x[0] || '').join('').slice(0, 2).toUpperCase();
  const komma = (x) => x.toFixed(1).replace('.', ',');
  const tag = (d) => new Date(d).toDateString();
  const platzVon = (id) => { const d = kd(); return d ? Object.keys(d.plaetze).find((p) => d.plaetze[p] === id) : undefined; };

  // Anwesenheit (Wunsch 27.11.2026): je Klasse und Tag { schülerId: { s: 'da' | 'spaet' | 'weg', t: 'HH:MM' bei spaet } }.
  // Nur Notiz des Lehrers – offiziell bleibt WebUntis.
  const zwei = (n) => String(n).padStart(2, '0');
  const tagKey = (t = new Date()) => t.getFullYear() + '-' + zwei(t.getMonth() + 1) + '-' + zwei(t.getDate());
  const uhrzeit = (t = new Date()) => zwei(t.getHours()) + ':' + zwei(t.getMinutes());
  const anwTag = (d, tk = tagKey()) => ((d && d.anwesenheit) || {})[tk] || {};
  const anwHeute = (id) => anwTag(kd())[id] || null;
  function anwSetzen(id, s, t) {
    const d = kd(); if (!d) return;
    d.anwesenheit = d.anwesenheit || {}; const tk = tagKey(); const tg = (d.anwesenheit[tk] = d.anwesenheit[tk] || {});
    if (!s) delete tg[id]; else tg[id] = { s, t: s === 'spaet' ? (t || uhrzeit()) : null, um: Date.now() };
  }
  const anwSumme = (id) => {
    let weg = 0, spaet = 0;
    for (const tg of Object.values((kd() && kd().anwesenheit) || {})) { const e = tg[id]; if (e && e.s === 'weg') weg++; if (e && e.s === 'spaet') spaet++; }
    return { weg, spaet };
  };
  // Antippen in „Anwesenheit“: ? → ✓ → ✕ → 🕘 → wieder ? (Wunsch 27.11.2026: „auch wieder auf undefiniert zurückstellen können“)
  const ANW_FOLGE = { offen: 'da', da: 'weg', weg: 'spaet', spaet: null };
  const eintraege = (id, zeitraum) => {
    const l = (kd() && kd().protokoll[id]) || [];
    if (zeitraum === 'heute') return l.filter((e) => tag(e.zeit) === tag(Date.now()));
    if (zeitraum === '30') return l.filter((e) => Date.now() - e.zeit < 30 * 864e5);
    return l;
  };
  const noteVon = (id, zeitraum) => {
    let summe = 0, gew = 0; const je = {};
    for (const k of st.kriterien) {
      const w = eintraege(id, zeitraum).filter((e) => e.k === k.id && e.w).map((e) => WERT[e.w]);
      if (!w.length) continue;
      const m = w.reduce((a, b) => a + b, 0) / w.length; je[k.id] = { m, n: w.length };
      summe += m * k.gewicht; gew += k.gewicht;
    }
    return { note: gew ? summe / gew : null, je };
  };
  // Linearer Schlüssel des Lehrers (09.11.2026): Note 1,0 = 100 Punkte … Note 6,0 = 0 Punkte
  const punkte = (note) => Math.round((6 - note) / 5 * 100);
  const sauber = (t) => String(t).normalize('NFKC').replace(/[^\p{L}\p{N}._-]+/gu, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').toLowerCase();

  // Freie Plätze der Reihe nach füllen; wer keinen Platz findet, bleibt in der Ablage
  function freiSetzen(d, ids) {
    const belegt = new Set(Object.keys(d.plaetze));
    const frei = [];
    for (let r = 1; r <= d.reihen; r++) for (let c = 1; c <= d.spalten; c++) { const p = 'r' + r + 'p' + c; if (!belegt.has(p)) frei.push(p); }
    ids.forEach((id, i) => { if (frei[i]) d.plaetze[frei[i]] = id; });
  }
  function klasseAnlegen(name) {
    const id = neueId('k');
    st.klassen[id] = { name: name.trim() || 'Neue Klasse', reihen: 5, spalten: 6, schueler: [], plaetze: {}, protokoll: {}, anwesenheit: {}, gaenge: {} };
    st.klasse = id; return id;
  }
  const klassenSortiert = () => Object.keys(st.klassen).sort((a, b) => st.klassen[a].name.localeCompare(st.klassen[b].name, 'de'));

  // ---------- Zeichnen ----------
  let modus = 'bewerten', gewaehlt = null;
  const plaetzeEl = $('plaetze'), ablageEl = $('ablage'), seite = $('seite');

  function bildEl(s) {
    const b = document.createElement('div'); b.className = 'bild';
    const f = fotos.get(s.id) || s.profilbild;
    if (f) { const i = new Image(); i.src = f; i.alt = ''; b.append(i); b.style.background = 'var(--linie)'; }
    else { b.style.background = farbe(s.name); b.textContent = kuerzel(s.name); }
    return b;
  }
  // Name auf der Karte (Wunsch 27.11.2026): wahlweise nur der Vorname (st.nurVorname, Menü „Mehr …“). Doppelte Vornamen sind rot; bei ihnen
  // lässt sich der Nachname einzeln zuschalten (s.mitNachname, Seitenspalte). Vor-/Nachname kommen aus Moodle, sonst gilt das erste Wort.
  const vornameVon = (s) => s.vorname || String(s.name).trim().split(/\s+/)[0] || s.name;
  const nachnameVon = (s) => s.nachname || String(s.name).trim().split(/\s+/).slice(1).join(' ');
  const kartenName = (s) => (st.nurVorname ? (s.mitNachname ? (vornameVon(s) + ' ' + nachnameVon(s)).trim() : vornameVon(s)) : s.name);
  const gleicheVornamen = (s) => schueler().filter((x) => x.id !== s.id && vornameVon(x).toLowerCase() === vornameVon(s).toLowerCase()).length;
  const nameDoppelt = (s) => !!st.nurVorname && schueler().some((x) => x.id !== s.id && kartenName(x).toLowerCase() === kartenName(s).toLowerCase());
  function karte(s) {
    const k = document.createElement('div'); k.className = 'karte' + (s.id === gewaehlt ? ' gewaehlt' : ''); k.dataset.id = s.id; k.title = s.name;
    const n = document.createElement('div'); n.className = 'name' + (nameDoppelt(s) ? ' doppelt' : ''); n.textContent = kartenName(s);
    const heute = eintraege(s.id, 'heute'), a = anwHeute(s.id);
    k.classList.add('anw-' + (a ? a.s : 'offen'));
    // Punkt = Anwesenheit (grau offen, grün da, orange später, rot fehlt); blauer Haken = heute bewertet (Wunsch 27.11.2026)
    const p = document.createElement('div');
    p.className = 'punkt' + ((a && a.s === 'weg') || (!a && heute.some((e) => e.abw)) ? ' abwesend' : a && a.s === 'spaet' ? ' spaet' : a && a.s === 'da' ? ' da' : '');
    if (heute.some((e) => !e.abw)) { const h = document.createElement('div'); h.className = 'haken'; h.textContent = '✓'; k.append(h); }
    const no = document.createElement('div'); const nv = noteVon(s.id, 'alle').note;
    no.className = 'note' + (nv === null ? '' : ' da'); no.textContent = nv === null ? '' : komma(nv);
    const an = document.createElement('div'); an.className = 'anw';
    an.textContent = !a ? '?' : a.s === 'da' ? '✓' : a.s === 'weg' ? '✕' : '🕘 ' + a.t;
    k.append(bildEl(s), n, p, no, an); return k;
  }

  function zeichneKlassenwahl() {
    const sel = $('klasse'); sel.innerHTML = '';
    const ids = klassenSortiert();
    if (!ids.length) { const o = document.createElement('option'); o.textContent = '–'; sel.append(o); sel.disabled = true; return; }
    sel.disabled = false;
    for (const id of ids) { const o = document.createElement('option'); o.value = id; o.textContent = st.klassen[id].name; sel.append(o); }
    sel.value = st.klasse;
  }

  function zeichne() {
    nachruesten();
    zeichneKlassenwahl();
    const d = kd();
    $('start').hidden = !!d; $('sitzplan').hidden = !d;
    if (!d) { gewaehlt = null; document.body.classList.remove('seite-offen'); zeichneSeite(); zeichneFuss(); einpassen(); return; }
    $('reihen').value = d.reihen; $('spalten').value = d.spalten;
    // Jede Tischreihe hat ihre eigene Aufteilung: Zwischen zwei Tischen liegt ein breiter Durchgang nur dort, wo in DIESER Reihe ein
    // Gangstück eingetragen ist; sonst der normale schmale Abstand. Ein kleiner Versatz zwischen den Reihen ist gewollt (Wunsch
    // 27.11.2026). Gangstücke: 's<c>:<r>' = zwischen Platz c und c+1 in Reihe r; 'r<r>:<c>' = zwischen Reihe r und r+1 bei Platz c.
    // Sicht des Lehrers: Reihe 1 (vorn, an der Tafel) unten.
    const ga = gaengeVon(d);
    const spur = (gang) => (gang ? 'var(--gang-breit)' : modus === 'bearbeiten' ? 'var(--gang-tippen)' : 'var(--gang-schmal)');
    const vorlage = (r) => { const t = []; for (let c = 1; c <= d.spalten; c++) { t.push('minmax(70px, 1fr)'); if (c < d.spalten) t.push(spur(ga['s' + c + ':' + r])); } return t.join(' '); };
    plaetzeEl.style.gridTemplateColumns = ''; plaetzeEl.style.gridTemplateRows = '';
    plaetzeEl.innerHTML = '';
    for (const p of Object.keys(d.plaetze)) {
      const [r, c] = p.slice(1).split('p').map(Number);
      if (r > d.reihen || c > d.spalten || !finde(d.plaetze[p])) delete d.plaetze[p];
    }
    for (let r = d.reihen; r >= 1; r--) {
      const re = document.createElement('div'); re.className = 'reihe'; re.style.gridTemplateColumns = vorlage(r);
      for (let c = 1; c <= d.spalten; c++) {
        const id = 'r' + r + 'p' + c, el = document.createElement('div'); el.className = 'platz'; el.dataset.platz = id; el.style.gridColumn = String(2 * c - 1);
        const nr = document.createElement('span'); nr.className = 'nr'; nr.textContent = r + '.' + c; el.append(nr);
        const sid = d.plaetze[id]; if (sid && finde(sid)) el.append(karte(finde(sid)));
        re.append(el);
        if (c < d.spalten) { const k = 's' + c + ':' + r; re.append(gangEl(k, !!ga[k], String(2 * c), 'zwischen Platz ' + r + '.' + c + ' und ' + r + '.' + (c + 1))); }
      }
      plaetzeEl.append(re);
      if (r === 1) break;
      // Abstand zur Reihe davor (r-1, näher an der Tafel); breit, sobald dort irgendwo ein Gangstück liegt
      const v = r - 1, zg = document.createElement('div'); zg.className = 'reihen-gang'; zg.style.gridTemplateColumns = vorlage(v);
      // Reihenabstand: breit bei Durchgang, sonst kleiner fester Abstand (nebeneinander stehen die Tische dagegen ohne Abstand)
      const rg = Object.keys(ga).some((k) => k.startsWith('r' + v + ':'));
      zg.style.height = rg ? 'var(--gang-breit)' : modus === 'bearbeiten' ? 'var(--gang-tippen)' : 'var(--reihe-abstand)';
      for (let c = 1; c <= d.spalten; c++) {
        const k = 'r' + v + ':' + c; zg.append(gangEl(k, !!ga[k], String(2 * c - 1), 'zwischen Platz ' + v + '.' + c + ' und ' + r + '.' + c));
        if (c < d.spalten) {
          const n = ['s' + c + ':' + v, 's' + c + ':' + r, 'r' + v + ':' + c, 'r' + v + ':' + (c + 1)].filter((x) => ga[x]).length;
          const x = document.createElement('div'); x.className = 'gang kreuz' + (n >= 2 ? ' an' : ''); x.style.gridColumn = String(2 * c); zg.append(x);
        }
      }
      plaetzeEl.append(zg);
    }
    ablageEl.innerHTML = '';
    const frei = schueler().filter((s) => !platzVon(s.id)).sort((a, b) => a.name.localeCompare(b.name, 'de'));
    frei.forEach((s) => ablageEl.append(karte(s)));
    $('ablageTitel').textContent = 'Noch ohne Platz (' + frei.length + ') – hierher ziehen nimmt eine Karte vom Platz · zwischen zwei Tische tippen: Durchgang ein/aus';
    if (gewaehlt && !finde(gewaehlt)) gewaehlt = null;
    document.body.classList.toggle('seite-offen', !!gewaehlt);
    zeichneSeite(); zeichneFuss(); einpassen(); sichern();
  }

  // ---------- Sitzplan in die Höhe einpassen (iPad-Test 27.11.2026) ----------
  // Auf dem iPad quer (und am Notebook) ist der Raum niedriger als ein Sitzplan mit 120 Pixel hohen Plätzen: vorderste Reihe und Tafel
  // lagen unter dem Bildschirmrand. Passt er nicht, rückt alles enger zusammen und die Bilder werden kleiner, bis die Tafel zu sehen ist.
  // Gerechnet wird nur, wenn sich Größe, Klasse, Reihen, Plätze, Durchgänge oder Betriebsart geändert haben.
  let passSchluessel = '';
  function einpassen() {
    const raum = $('raum'), tafel = raum.querySelector('.tafel'), d = kd(), p = plaetzeEl.style;
    if (!d) { passSchluessel = ''; p.removeProperty('--platz-h'); p.removeProperty('--bild-max'); document.body.classList.remove('eng'); return; }
    const schluessel = [raum.clientWidth, raum.clientHeight, st.klasse, d.reihen, d.spalten, d.schueler.length, modus, JSON.stringify(d.gaenge || {})].join('|');
    if (schluessel === passSchluessel) return;
    passSchluessel = schluessel;
    p.removeProperty('--platz-h'); p.removeProperty('--bild-max'); document.body.classList.remove('eng');
    const imRaum = (y) => y - raum.getBoundingClientRect().top + raum.scrollTop;
    const nutzbar = () => raum.clientHeight - parseFloat(getComputedStyle(raum).paddingBottom);
    const passt = () => imRaum(tafel.getBoundingClientRect().bottom) <= nutzbar() + 0.5;
    if (passt()) return;
    document.body.classList.add('eng');
    const reihen = Math.max(1, plaetzeEl.querySelectorAll('.reihe').length);
    const tafelH = tafel.getBoundingClientRect().height + parseFloat(getComputedStyle(tafel).marginTop);
    const gaenge = [...plaetzeEl.querySelectorAll('.reihen-gang')].reduce((s, e) => s + e.getBoundingClientRect().height, 0);
    const proReihe = Math.floor((nutzbar() - imRaum(plaetzeEl.getBoundingClientRect().top) - tafelH - gaenge) / reihen);
    p.setProperty('--platz-h', Math.max(56, Math.min(120, proReihe)) + 'px');
    for (let b = 140; b >= 28 && !passt(); b -= 4) p.setProperty('--bild-max', b + 'px');
  }
  if (typeof ResizeObserver === 'function') new ResizeObserver(() => einpassen()).observe($('raum'));

  // Durchgänge je Klasse: { 's<c>:<r>': true } = zwischen Platz c und c+1 in Reihe r; { 'r<r>:<c>': true } = zwischen Reihe r und r+1 bei Platz c.
  function gaengeVon(d) {
    if (!d.gaenge) d.gaenge = {};
    for (const c of d.gangSpalten || []) for (let r = 1; r <= d.reihen; r++) d.gaenge['s' + c + ':' + r] = true; // Form vom Vormittag übernehmen
    for (const r of d.gangReihen || []) for (let c = 1; c <= d.spalten; c++) d.gaenge['r' + r + ':' + c] = true;
    delete d.gangSpalten; delete d.gangReihen;
    for (const k of Object.keys(d.gaenge)) {
      const m = /^([sr])(\d+):(\d+)$/.exec(k), a = m ? Number(m[2]) : 0, b = m ? Number(m[3]) : 0;
      const gilt = m && (m[1] === 's' ? a < d.spalten && b <= d.reihen : a < d.reihen && b <= d.spalten);
      if (!gilt) delete d.gaenge[k];
    }
    return d.gaenge;
  }
  // Streifenstück zwischen zwei Tischen; in „Sitzplan bearbeiten“ schaltet Antippen genau dieses Stück als Durchgang ein oder aus.
  function gangEl(schluessel, an, spalte, wo) {
    const g = document.createElement('div'); g.className = 'gang gang-' + schluessel[0] + (an ? ' an' : '');
    g.style.gridColumn = spalte; g.dataset.gang = schluessel;
    g.title = (an ? 'Durchgang entfernen: ' : 'Durchgang: ') + wo;
    return g;
  }
  plaetzeEl.addEventListener('click', (e) => {
    const g = e.target.closest('.gang[data-gang]'); if (!g || modus !== 'bearbeiten') return;
    const ga = gaengeVon(kd()), k = g.dataset.gang; if (ga[k]) delete ga[k]; else ga[k] = true;
    zeichne();
  });

  function zeichneFuss() {
    const heute = schueler().filter((s) => eintraege(s.id, 'heute').some((e) => e.w)).length;
    $('heuteZahl').textContent = kd() ? 'Heute bewertet: ' + heute + ' von ' + schueler().length : '';
    const tg = anwTag(kd()), zahl = { da: 0, spaet: 0, weg: 0 };
    for (const s of schueler()) { const e = tg[s.id]; if (e) zahl[e.s]++; }
    const offen = schueler().length - zahl.da - zahl.spaet - zahl.weg;
    // Zwei Fassungen: lang, und kurz mit den Zeichen der Karten, wenn der Platz knapp ist (body.eng, iPad-Test 27.11.2026)
    $('anwText').textContent = '';
    if (kd()) {
      const lang = document.createElement('span'), kurz = document.createElement('span');
      lang.className = 'anw-lang'; lang.textContent = zahl.da + ' anwesend · ' + zahl.spaet + ' später gekommen · ' + zahl.weg + ' fehlen · ' + offen + ' offen';
      kurz.className = 'anw-kurz'; kurz.textContent = '✓ ' + zahl.da + ' · 🕘 ' + zahl.spaet + ' · ✕ ' + zahl.weg + ' · ? ' + offen;
      $('anwText').append(lang, kurz);
    }
    $('anwDatum').textContent = new Date().toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' });
    const hatDaten = Object.values(st.klassen).some((k) => Object.values(k.protokoll).some((l) => l.length));
    const h = $('sicherungHinweis'); h.className = ''; h.textContent = '';
    if (hatDaten && !IN_MOODLE) { // in der Moodle-Fassung liegen die Daten schon in Moodle, eine Sicherungsdatei gibt es dort nicht
      const tage = st.letzteSicherung ? Math.floor((Date.now() - st.letzteSicherung) / 864e5) : null;
      if (tage === null || tage >= 7) { h.className = 'warn'; h.textContent = '⚠ Letzte Sicherung: ' + (tage === null ? 'noch nie' : 'vor ' + tage + ' Tagen') + ' (Mehr … › Sicherung speichern)'; }
      else h.textContent = 'Letzte Sicherung: ' + new Date(st.letzteSicherung).toLocaleDateString('de-DE');
    }
    $('stand').textContent = 'Stand ' + STAND;
  }

  const notenZeigen = () => document.body.classList.contains('noten-zeigen');
  const offeneKriterien = new Set(); // aufgeklappte Eintragslisten „<Schüler>:<Kriterium>“ (nur in dieser Sitzung)
  function zeichneSeite() {
    seite.innerHTML = '';
    const s = gewaehlt && finde(gewaehlt);
    if (!s) { seite.innerHTML = '<div class="leer">' + (kd() ? 'Ein Gesicht antippen,<br>um schnell zu bewerten.' : '') + '</div>'; return; }
    const nv = noteVon(s.id, 'alle');
    const kopf = document.createElement('div'); kopf.className = 'kopf';
    const b = bildEl(s); b.title = 'Foto aufnehmen oder ändern'; b.addEventListener('click', () => fotoOeffnen(s));
    const h = document.createElement('h2'); h.textContent = s.name;
    const g = document.createElement('div'); g.className = 'gesamt';
    g.innerHTML = '<span class="leise">Projektkompetenz</span><b></b>';
    g.querySelector('b').textContent = notenZeigen() ? (nv.note === null ? '–' : komma(nv.note)) : '•••';
    const zu = document.createElement('button'); zu.className = 'zu'; zu.textContent = '✕'; zu.title = 'Schließen';
    zu.addEventListener('click', () => { gewaehlt = null; zeichne(); });
    kopf.append(b, h, g, zu); seite.append(kopf);
    if (st.nurVorname && gleicheVornamen(s)) {
      const l = document.createElement('label'); l.className = 'schalter nachname-zeigen' + (nameDoppelt(s) ? ' doppelt' : '');
      const c = document.createElement('input'); c.type = 'checkbox'; c.checked = !!s.mitNachname;
      c.addEventListener('change', () => { if (c.checked) s.mitNachname = true; else delete s.mitNachname; zeichne(); });
      l.append(c, ' Den Vornamen „' + vornameVon(s) + '“ gibt es ' + (gleicheVornamen(s) + 1) + '× – Nachnamen auf der Karte zeigen');
      seite.append(l);
    }

    for (const k of st.kriterien) {
      const z = document.createElement('div'); z.className = 'kriterium';
      const t = document.createElement('div'); const je = nv.je[k.id];
      t.innerHTML = '<div class="kn"></div>';
      t.querySelector('.kn').textContent = k.name + (k.gewicht !== 1 ? ' (×' + k.gewicht + ')' : '');
      // Einträge je Kriterium aufklappen: Zeit, Wert, Bemerkung, löschen (Wunsch 27.11.2026)
      const liste = (kd().protokoll[s.id] || []).filter((e) => e.k === k.id && e.w);
      const schl = s.id + ':' + k.id, offen = liste.length > 0 && offeneKriterien.has(schl);
      let ks;
      if (liste.length) {
        ks = document.createElement('button'); ks.type = 'button'; ks.className = 'ks ks-knopf';
        ks.textContent = (offen ? '▾ ' : '▸ ') + liste.length + (liste.length === 1 ? ' Eintrag' : ' Einträge') + (je && notenZeigen() ? ' · Ø ' + komma(je.m) : '');
        ks.addEventListener('click', () => { if (offen) offeneKriterien.delete(schl); else offeneKriterien.add(schl); zeichneSeite(); });
      } else { ks = document.createElement('div'); ks.className = 'ks'; ks.textContent = 'noch nichts'; }
      t.append(ks);
      const w = document.createElement('div'); w.className = 'werte';
      for (const x of ['++', '+', 'o', '-', '--']) {
        const bt = document.createElement('button'); bt.className = 'wert'; bt.dataset.w = x; bt.textContent = ZEIG(x); bt.title = k.name + ': ' + ZEIG(x);
        // Steht etwas im Bemerkungsfeld, gehört es zu diesem Tipp (Wunsch 27.11.2026)
        bt.addEventListener('click', () => { const b = seite.querySelector('input.bemerkung'), v = b ? b.value.trim() : ''; eintragen(v ? { k: k.id, w: x, text: v } : { k: k.id, w: x }); });
        w.append(bt);
      }
      z.append(t, w);
      if (offen) {
        const kl = document.createElement('div'); kl.className = 'k-liste';
        for (const e of liste.slice().reverse()) {
          const r = document.createElement('div'); r.className = 'k-eintrag';
          const zt = document.createElement('span'); zt.className = 'zeit';
          zt.textContent = new Date(e.zeit).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
          const m = document.createElement('span'); m.className = 'marke'; m.style.background = WFARBE[e.w]; m.textContent = ZEIG(e.w);
          const tx = document.createElement('span'); tx.className = 'k-text'; tx.textContent = e.text || '';
          const x = document.createElement('button'); x.type = 'button'; x.textContent = '✕'; x.title = 'Eintrag löschen';
          x.addEventListener('click', () => {
            if (!confirm('Eintrag löschen?\n' + ZEIG(e.w) + ' ' + k.name + ' vom ' + zt.textContent + (e.text ? '\n„' + e.text + '“' : ''))) return;
            const l = kd().protokoll[s.id] || [], i = l.indexOf(e); if (i >= 0) l.splice(i, 1); zeichne();
          });
          r.append(zt, m, tx, x); kl.append(r);
        }
        z.append(kl);
      }
      seite.append(z);
    }
    const zb = document.createElement('div'); zb.className = 'zeile';
    zb.innerHTML = '<input type="text" class="bemerkung" placeholder="Bemerkung – kommt an den nächsten Tipp oder mit „Notieren“ allein" enterkeyhint="done"><button>Notieren</button>';
    const inp = zb.querySelector('input');
    const notiere = () => { const v = inp.value.trim(); if (v) eintragen({ text: v }); };
    zb.querySelector('button').addEventListener('click', notiere);
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') notiere(); });
    seite.append(zb);
    // Anwesenheit heute (ersetzt den alten Knopf „abwesend“); aktiven Knopf erneut tippen = zurück auf „offen“
    const a = anwHeute(s.id), sum = anwSumme(s.id);
    const aw = document.createElement('div'); aw.className = 'anw-wahl';
    const al = document.createElement('b'); al.textContent = 'Heute:'; aw.append(al);
    for (const [w, t] of [['da', 'anwesend'], ['spaet', 'später gekommen'], ['weg', 'abwesend']]) {
      const bt = document.createElement('button'); bt.textContent = t; bt.className = 'anw-' + w + (a && a.s === w ? ' an' : '');
      bt.addEventListener('click', () => { anwSetzen(s.id, a && a.s === w ? null : w); zeichne(); }); aw.append(bt);
    }
    if (a && a.s === 'spaet') {
      const lb = document.createElement('label'); lb.textContent = 'um ';
      const ti = document.createElement('input'); ti.type = 'time'; ti.value = a.t || ''; ti.id = 'anwZeit';
      ti.addEventListener('change', () => { if (ti.value) { anwSetzen(s.id, 'spaet', ti.value); zeichne(); } });
      lb.append(ti, ' Uhr'); aw.append(lb);
    }
    const as = document.createElement('div'); as.className = 'leise'; as.style.fontSize = '13px';
    as.textContent = 'Bisher ' + sum.weg + '× gefehlt, ' + sum.spaet + '× später gekommen' + (a ? '' : ' · heute noch nicht erfasst');
    seite.append(aw, as);
    const z2 = document.createElement('div'); z2.className = 'zeile';
    const fo = document.createElement('button'); fo.textContent = fotos.has(s.id) ? 'Foto ändern' : 'Foto aufnehmen'; fo.addEventListener('click', () => fotoOeffnen(s));
    const rk = document.createElement('button'); rk.textContent = '↶ Letzten Eintrag zurück'; rk.disabled = !(kd().protokoll[s.id] || []).length;
    rk.addEventListener('click', () => { const l = kd().protokoll[s.id]; if (l && l.length) l.pop(); zeichne(); });
    const en = document.createElement('button'); en.className = 'gefahr entfernen'; en.textContent = 'Aus der Klasse entfernen …';
    en.title = s.name + ' samt Bewertungen, Anwesenheit und Foto aus der Klasse nehmen'; en.addEventListener('click', () => schuelerEntfernen(s));
    z2.append(fo, rk, en); seite.append(z2);
    const pr = document.createElement('div'); pr.className = 'protokoll';
    const l = (kd().protokoll[s.id] || []).slice().reverse();
    if (!l.length) pr.innerHTML = '<span class="leise">Protokoll: noch keine Einträge.</span>';
    for (const e of l) {
      const d = document.createElement('div');
      const zeit = document.createElement('span'); zeit.className = 'zeit';
      zeit.textContent = new Date(e.zeit).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
      const inh = document.createElement('span');
      if (e.w) { const m = document.createElement('span'); m.className = 'marke'; m.style.background = WFARBE[e.w]; m.textContent = ZEIG(e.w); inh.append(m, ' ' + ((st.kriterien.find((k) => k.id === e.k) || {}).name || '(Kriterium entfernt)') + (e.text ? ' – ' + e.text : '')); }
      else inh.textContent = (e.abw ? '⦸ ' : '✎ ') + e.text;
      d.append(zeit, inh); pr.append(d);
    }
    seite.append(pr);
  }

  function eintragen(e) {
    const p = kd().protokoll; (p[gewaehlt] = p[gewaehlt] || []).push(Object.assign({ zeit: Date.now() }, e));
    zeichne();
    const k = document.querySelector('.karte[data-id="' + gewaehlt + '"]'); if (k) k.classList.add('blitz');
  }

  // ---------- Antippen und Ziehen ----------
  let zug = null, markiert = null;
  const zielUnter = (x, y) => { const e = document.elementFromPoint(x, y); return e ? e.closest('[data-platz], [data-ablage]') : null; };
  const markiere = (z) => { if (markiert) markiert.classList.remove('ziel'); markiert = z; if (z) z.classList.add('ziel'); };
  document.addEventListener('pointerdown', (e) => {
    const k = e.target.closest('.karte'); if (!k || e.button > 0 || k.closest('.seite')) return;
    zug = { k, id: k.dataset.id, x0: e.clientX, y0: e.clientY, bewegt: false };
  });
  document.addEventListener('pointermove', (e) => {
    if (!zug) return; // Ziehen geht in beiden Betriebsarten (Wunsch 27.11.): Bild auf Bild = Plätze tauschen
    if (!zug.bewegt && Math.hypot(e.clientX - zug.x0, e.clientY - zug.y0) < 8) return;
    if (!zug.bewegt) { zug.bewegt = true; zug.geist = zug.k.cloneNode(true); zug.geist.classList.add('geist'); document.body.append(zug.geist); zug.k.classList.add('wird-gezogen'); }
    zug.geist.style.left = e.clientX + 'px'; zug.geist.style.top = e.clientY + 'px'; markiere(zielUnter(e.clientX, e.clientY));
  });
  const ende = (e) => {
    if (!zug) return; const z = zug; zug = null;
    if (!z.bewegt) {
      if (e.type !== 'pointerup') return;
      if (modus === 'bewerten') { gewaehlt = z.id; zeichne(); }
      else if (modus === 'anwesenheit') {
        const a = anwHeute(z.id); anwSetzen(z.id, ANW_FOLGE[a ? a.s : 'offen']); zeichne();
        const k = document.querySelector('#plaetze .karte[data-id="' + z.id + '"], #ablage .karte[data-id="' + z.id + '"]'); if (k) k.classList.add('blitz');
      }
      return;
    }
    z.geist.remove(); z.k.classList.remove('wird-gezogen');
    const ziel = e.type === 'pointerup' ? zielUnter(e.clientX, e.clientY) : null; markiere(null);
    if (!ziel) return;
    const d = kd(), alt = platzVon(z.id);
    if (ziel.dataset.ablage) { if (alt) delete d.plaetze[alt]; }
    else {
      const neu = ziel.dataset.platz; if (neu === alt) return;
      const dort = d.plaetze[neu]; if (alt) delete d.plaetze[alt]; d.plaetze[neu] = z.id; if (dort && alt) d.plaetze[alt] = dort;
      const name = (id) => (d.schueler.find((s) => s.id === id) || {}).name || '?';
      if (dort) zeigeMeldung(alt ? name(z.id) + ' und ' + name(dort) + ' haben die Plätze getauscht.' : name(z.id) + ' sitzt jetzt auf dem Platz von ' + name(dort) + '; ' + name(dort) + ' liegt in der Ablage.');
    }
    zeichne();
  };
  document.addEventListener('pointerup', ende); document.addEventListener('pointercancel', ende);

  // ---------- Werkzeugleiste ----------
  $('klasse').addEventListener('change', (e) => { st.klasse = e.target.value; gewaehlt = null; zeichne(); });
  document.querySelectorAll('.modus button').forEach((b) => b.addEventListener('click', () => {
    modus = b.dataset.m; document.querySelectorAll('.modus button').forEach((x) => x.classList.toggle('an', x === b));
    document.body.classList.toggle('bearbeiten', modus === 'bearbeiten');
    document.body.classList.toggle('anwesenheit', modus === 'anwesenheit');
    if (modus !== 'bewerten') gewaehlt = null;
    zeichne();
  }));
  $('anwAlleDa').addEventListener('click', () => {
    const d = kd(); if (!d) return; let n = 0;
    for (const s of d.schueler) if (!anwHeute(s.id)) { anwSetzen(s.id, 'da'); n++; }
    zeichne(); zeigeMeldung(n + ' Schüler als anwesend eingetragen.');
  });

  // ---------- Liste für WebUntis (Wunsch 27.11.2026): Anwesenheit in der Reihenfolge von WebUntis, zum Übertragen von Hand ----------
  const nachname = (n) => { const t = n.trim().split(/\s+/); return t[t.length - 1] || n; };
  const vorname = (n) => n.trim().split(/\s+/).slice(0, -1).join(' ');
  const untisName = (s) => nachname(s.name) + (vorname(s.name) ? ', ' + vorname(s.name) : '');
  function untisFolge(d) {
    const nachN = d.schueler.slice().sort((a, b) => nachname(a.name).localeCompare(nachname(b.name), 'de') || a.name.localeCompare(b.name, 'de'));
    const eigen = (d.untisReihenfolge || []).map((id) => d.schueler.find((s) => s.id === id)).filter(Boolean);
    return eigen.concat(nachN.filter((s) => !eigen.includes(s)));
  }
  function untisZeilen() {
    const d = kd(), tg = anwTag(d, $('untisTag').value), nur = $('untisNurAbw').checked;
    return untisFolge(d).map((s, i) => {
      const e = tg[s.id];
      return { nr: i + 1, name: untisName(s), art: e ? e.s : 'offen', status: !e ? 'nicht erfasst' : e.s === 'da' ? 'anwesend' : e.s === 'weg' ? 'fehlt' : 'kam ' + e.t + ' Uhr' };
    }).filter((z) => !nur || z.art !== 'da');
  }
  function zeichneUntis() {
    const t = $('untisTabelle'), z = untisZeilen();
    t.innerHTML = '<tr><th>Nr.</th><th>Name</th><th>Anwesenheit</th></tr>';
    for (const r of z) { const tr = document.createElement('tr'); tr.className = 'u-' + r.art; for (const x of [r.nr, r.name, r.status]) { const td = document.createElement('td'); td.textContent = x; tr.append(td); } t.append(tr); }
    if (!z.length) t.insertAdjacentHTML('beforeend', '<tr><td colspan="3" class="leise">Alle anwesend – in WebUntis ist nichts zu ändern.</td></tr>');
  }
  function untisOeffnen() {
    const d = kd(); if (!d) return;
    const tage = Object.keys(d.anwesenheit || {}).filter((t) => Object.keys(d.anwesenheit[t]).length).sort().reverse();
    if (!tage.includes(tagKey())) tage.unshift(tagKey());
    const sel = $('untisTag'); sel.innerHTML = '';
    for (const t of tage) sel.append(new Option(new Date(t + 'T12:00').toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' }) + (t === tagKey() ? ' (heute)' : ''), t));
    $('untisNamen').value = '';
    $('untisInfo').textContent = (d.untisReihenfolge || []).length ? 'Reihenfolge aus WebUntis ist gespeichert.' : 'Sortiert nach Nachnamen.';
    zeichneUntis(); $('untisDlg').showModal();
  }
  $('untisKnopf').addEventListener('click', untisOeffnen);
  $('untisTag').addEventListener('change', zeichneUntis); $('untisNurAbw').addEventListener('change', zeichneUntis);
  $('untisKopieren').addEventListener('click', async () => {
    const text = untisZeilen().map((r) => r.nr + '. ' + r.name + ' – ' + r.status).join('\n') || 'Alle anwesend.';
    try { await navigator.clipboard.writeText(text); zeigeMeldung('Liste kopiert.'); } catch (e) { alert(text); }
  });
  $('untisUebernehmen').addEventListener('click', () => {
    const d = kd(), zeilen = $('untisNamen').value.split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
    const folge = [], rest = d.schueler.slice(); let unbekannt = 0;
    for (const z of zeilen) { const id = schuelerZuDatei(z, rest); if (id) { folge.push(id); rest.splice(rest.findIndex((s) => s.id === id), 1); } else unbekannt++; }
    if (!folge.length) { alert('Keinen Namen erkannt. Bitte je Zeile einen Namen einfügen, z. B. „Becker, Anna“.'); return; }
    d.untisReihenfolge = folge; zeichne(); zeichneUntis();
    $('untisInfo').textContent = folge.length + ' Namen erkannt' + (unbekannt ? ', ' + unbekannt + (unbekannt === 1 ? ' Zeile' : ' Zeilen') + ' ohne Treffer' : '') + (rest.length ? '; ' + rest.length + (rest.length === 1 ? ' Schüler fehlt' : ' Schüler fehlen') + ' in der Liste und ' + (rest.length === 1 ? 'steht' : 'stehen') + ' am Ende' : '') + '.';
  });
  $('untisZurueck').addEventListener('click', () => { const d = kd(); d.untisReihenfolge = []; zeichne(); zeichneUntis(); $('untisInfo').textContent = 'Sortiert nach Nachnamen.'; });
  const groesse = () => {
    const d = kd(); if (!d) return;
    d.reihen = Math.min(8, Math.max(1, Number($('reihen').value) || 5));
    d.spalten = Math.min(10, Math.max(2, Number($('spalten').value) || 6)); zeichne();
  };
  $('reihen').addEventListener('change', groesse); $('spalten').addEventListener('change', groesse);
  $('notenZeigen').addEventListener('change', (e) => { document.body.classList.toggle('noten-zeigen', e.target.checked); zeichneSeite(); });

  // Dialoge: Schließen-Knöpfe und Aktionen
  document.addEventListener('click', (e) => {
    const zu = e.target.closest('[data-zu]'); if (zu) { zu.closest('dialog').close(); return; }
    const a = e.target.closest('[data-aktion]'); if (!a) return;
    const offen = a.closest('dialog'); if (offen) offen.close();
    ({ import: importOeffnen, fotos: fotosOeffnen, klassen: klassenOeffnen, kriterien: kriterienOeffnen, sichern: sicherungSpeichern,
       laden: () => $('sicherungDatei').click(), beispiel: beispielAnlegen, moodleKlasse: mkOeffnen, shkKlasse: shkOeffnen })[a.dataset.aktion]();
  });
  $('menueKnopf').addEventListener('click', () => { $('nurVorname').checked = !!st.nurVorname; $('menueDlg').showModal(); });
  $('nurVorname').addEventListener('change', (e) => { if (e.target.checked) st.nurVorname = true; else delete st.nurVorname; zeichne(); });

  // ---------- Vollbild (Wunsch 27.11.2026) ----------
  // iPad-Safari kann Vollbild für die ganze Seite; der Knopf erscheint nur, wo der Browser es anbietet. Zweites Tippen beendet es.
  const vbAn = () => !!(document.fullscreenElement || document.webkitFullscreenElement);
  if (!(document.fullscreenEnabled || document.webkitFullscreenEnabled)) $('vollbildKnopf').hidden = true;
  $('vollbildKnopf').addEventListener('click', () => {
    const d = document, e = d.documentElement;
    if (vbAn()) { const x = d.exitFullscreen || d.webkitExitFullscreen; if (x) x.call(d); return; }
    const f = e.requestFullscreen || e.webkitRequestFullscreen; if (!f) return;
    const r = f.call(e); if (r && r.catch) r.catch(() => zeigeMeldung('Vollbild ist hier nicht möglich.'));
  });
  const vbStand = () => { const an = vbAn(); $('vollbildKnopf').classList.toggle('an', an); $('vollbildKnopf').title = an ? 'Vollbild beenden' : 'Vollbild'; };
  document.addEventListener('fullscreenchange', vbStand); document.addEventListener('webkitfullscreenchange', vbStand);

  // ---------- Klassen und Schüler ----------
  function klassenOeffnen() { zeichneKlassenDlg(); $('klassenDlg').showModal(); }
  function zeichneKlassenDlg() {
    const d = kd();
    $('klasseBereich').hidden = !d;
    if (!d) return;
    $('klasseTitel').textContent = d.name; $('klasseName').value = d.name;
    const t = $('schuelerListe'); t.innerHTML = '<tr><th>Name</th><th>E-Mail-Adresse (für den Export)</th><th></th></tr>';
    for (const s of d.schueler.slice().sort((a, b) => a.name.localeCompare(b.name, 'de'))) {
      const tr = document.createElement('tr');
      const n = document.createElement('td'); n.textContent = s.name;
      const m = document.createElement('td');
      const mi = document.createElement('input'); mi.type = 'email'; mi.value = s.mail || ''; mi.placeholder = 'fehlt';
      mi.addEventListener('change', () => { s.mail = mi.value.trim(); sichern(); }); m.append(mi);
      const x = document.createElement('td'); const xb = document.createElement('button'); xb.className = 'gefahr'; xb.textContent = 'entfernen';
      xb.addEventListener('click', () => { if (schuelerEntfernen(s)) zeichneKlassenDlg(); });
      x.append(xb); tr.append(n, m, x); t.append(tr);
    }
  }
  $('klasseAnlegen').addEventListener('click', () => {
    const n = $('neueKlasse').value.trim(); if (!n) { $('neueKlasse').focus(); return; }
    klasseAnlegen(n); $('neueKlasse').value = ''; gewaehlt = null; zeichneKlassenDlg(); zeichne();
  });
  $('klasseUmbenennen').addEventListener('click', () => { const d = kd(); const n = $('klasseName').value.trim(); if (d && n) { d.name = n; zeichneKlassenDlg(); zeichne(); } });
  $('klasseLoeschen').addEventListener('click', () => {
    const d = kd(); if (!d) return;
    if (!confirm('Klasse „' + d.name + '“ mit ' + d.schueler.length + ' Schülern, allen Bewertungen und Fotos löschen? Das lässt sich nicht rückgängig machen.')) return;
    for (const s of d.schueler) { if (fotos.has(s.id)) { moodleFoto(s.id, null); originalMerken(s.id, null); } fotos.delete(s.id); DB.loesch('fotos', s.id).catch(() => {}); }
    delete st.klassen[st.klasse]; st.klasse = klassenSortiert()[0] || null; gewaehlt = null; zeichneKlassenDlg(); zeichne();
  });
  // Einen Schüler mit Bewertungen, Anwesenheit und Foto aus der Klasse nehmen (Klassenliste und Seitenspalte); true = entfernt
  function schuelerEntfernen(s) {
    const d = kd(); if (!d || !confirm(s.name + ' mit allen Bewertungen, der Anwesenheit und dem Foto aus der Klasse „' + d.name + '“ entfernen?\nDas lässt sich nicht rückgängig machen.')) return false;
    d.schueler = d.schueler.filter((y) => y.id !== s.id); const p = platzVon(s.id); if (p) delete d.plaetze[p];
    delete d.protokoll[s.id]; for (const tag of Object.values(d.anwesenheit || {})) if (tag) delete tag[s.id];
    if (fotos.has(s.id)) { moodleFoto(s.id, null); originalMerken(s.id, null); } fotos.delete(s.id); DB.loesch('fotos', s.id).catch(() => {});
    if (gewaehlt === s.id) gewaehlt = null; zeichne(); zeigeMeldung(s.name + ' ist aus der Klasse „' + d.name + '“ entfernt.');
    return true;
  }
  // Einzelnen Schüler direkt aus „Sitzplan bearbeiten“ aufnehmen (Wunsch 27.11.2026: „zusätzlich einzelne Schüler anlegen oder auch löschen“)
  $('schuelerPlus').addEventListener('click', () => {
    const d = kd(); if (!d) return;
    $('sdKlasse').textContent = d.name; for (const f of ['sdVorname', 'sdNachname', 'sdMail']) $(f).value = '';
    $('schuelerDlg').showModal(); $('sdVorname').focus();
  });
  const sdAnlegen = () => {
    const d = kd(), v = $('sdVorname').value.trim(), n = $('sdNachname').value.trim(); if (!d) return;
    if (!v && !n) { $('sdVorname').focus(); return; }
    const s = { id: neueId('s'), name: (v + ' ' + n).trim(), mail: $('sdMail').value.trim() };
    if (v && n) { s.vorname = v; s.nachname = n; } // getrennt wie aus Moodle: auch Doppelvornamen stimmen bei „nur Vorname“
    d.schueler.push(s); freiSetzen(d, [s.id]); $('schuelerDlg').close(); zeichne();
    zeigeMeldung(s.name + (platzVon(s.id) ? ' sitzt jetzt auf dem ersten freien Tisch – zum Umsetzen hinziehen.' : ' liegt in „Noch ohne Platz“ – auf einen Tisch ziehen.'));
  };
  $('sdAnlegen').addEventListener('click', sdAnlegen);
  $('sdVorname').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('sdNachname').focus(); } });
  $('sdNachname').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('sdMail').focus(); } });
  $('sdMail').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); sdAnlegen(); } });
  $('schuelerAnlegen').addEventListener('click', () => {
    const d = kd(); const n = $('neuName').value.trim(); if (!d || !n) { $('neuName').focus(); return; }
    const s = { id: neueId('s'), name: n, mail: $('neuMail').value.trim() };
    d.schueler.push(s); freiSetzen(d, [s.id]); $('neuName').value = ''; $('neuMail').value = ''; zeichneKlassenDlg(); zeichne();
  });

  // ---------- Teilnehmer aus Moodle (CSV) ----------
  function csvLesen(text) {
    text = text.replace(/^﻿/, '');
    const erste = text.split(/\r?\n/)[0] || '';
    const trenn = [';', ',', '\t'].map((t) => [t, erste.split(t).length]).sort((a, b) => b[1] - a[1])[0][0];
    const zeilen = []; let feld = '', zeile = [], inQ = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQ) { if (c === '"') { if (text[i + 1] === '"') { feld += '"'; i++; } else inQ = false; } else feld += c; }
      else if (c === '"') inQ = true;
      else if (c === trenn) { zeile.push(feld); feld = ''; }
      else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; zeile.push(feld); zeilen.push(zeile); zeile = []; feld = ''; }
      else feld += c;
    }
    if (feld !== '' || zeile.length) { zeile.push(feld); zeilen.push(zeile); }
    return zeilen.filter((z) => z.some((f) => f.trim() !== ''));
  }
  function teilnehmerAusCsv(zeilen) {
    for (let kz = 0; kz < Math.min(5, zeilen.length); kz++) {
      const kopf = zeilen[kz].map((x) => x.trim().toLowerCase());
      const such = (re) => kopf.findIndex((x) => re.test(x));
      const vor = such(/^(vorname|first ?name)$/), nach = such(/^(nachname|last ?name|surname)$/);
      const voll = such(/^(?!.*(benutzer|user ?name|anmelde)).*name/);
      const mail = such(/mail/), rolle = such(/^(rolle|rollen|roles?)$/);
      if (vor < 0 && voll < 0) continue;
      const liste = [];
      for (const z of zeilen.slice(kz + 1)) {
        const name = (vor >= 0 && nach >= 0 ? (z[vor] || '').trim() + ' ' + (z[nach] || '').trim() : (z[voll >= 0 ? voll : vor] || '')).trim().replace(/\s+/g, ' ');
        if (!name) continue;
        const r = rolle >= 0 ? (z[rolle] || '') : '';
        liste.push({ name, mail: mail >= 0 ? (z[mail] || '').trim() : '', rolle: r, an: !/lehr|trainer|teacher|manager|leit/i.test(r) });
      }
      return { liste, mitMail: mail >= 0 };
    }
    return null;
  }
  let importListe = [];
  function importOeffnen() {
    importListe = []; $('importVorschau').innerHTML = ''; $('importUebernehmen').disabled = true;
    const z = $('importZiel'); z.innerHTML = '';
    for (const id of klassenSortiert()) { const o = document.createElement('option'); o.value = id; o.textContent = 'in Klasse ' + st.klassen[id].name; z.append(o); }
    const o = document.createElement('option'); o.value = '+neu'; o.textContent = 'als neue Klasse'; z.append(o);
    z.value = kd() ? st.klasse : '+neu'; $('importNeuName').hidden = z.value !== '+neu';
    $('importDlg').showModal();
  }
  $('importZiel').addEventListener('change', (e) => { $('importNeuName').hidden = e.target.value !== '+neu'; });
  $('csvWaehlen').addEventListener('click', () => $('csvDatei').click());
  $('csvDatei').addEventListener('change', async () => {
    const f = $('csvDatei').files[0]; $('csvDatei').value = ''; if (!f) return;
    const v = $('importVorschau');
    let erg = null;
    try { erg = teilnehmerAusCsv(csvLesen(await f.text())); } catch (e) { erg = null; }
    if (!erg || !erg.liste.length) { v.innerHTML = '<div class="meldung warn">In dieser Datei habe ich keine Spalte mit Namen gefunden. Bitte die CSV-Datei aus Moodle nehmen.</div>'; $('importUebernehmen').disabled = true; return; }
    importListe = erg.liste;
    v.innerHTML = '';
    if (!erg.mitMail) v.insertAdjacentHTML('beforeend', '<div class="meldung warn">Die Datei hat keine E-Mail-Spalte. Ohne E-Mail-Adresse lässt sich später nichts nach Moodle exportieren (von Hand ergänzbar).</div>');
    const t = document.createElement('table');
    t.innerHTML = '<tr><th>übernehmen</th><th>Name</th><th>E-Mail-Adresse</th><th>Rolle</th></tr>';
    for (const p of importListe) {
      const tr = document.createElement('tr');
      const c = document.createElement('td'); const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = p.an; cb.style.width = '22px'; cb.style.height = '22px';
      cb.addEventListener('change', () => { p.an = cb.checked; }); c.append(cb);
      tr.append(c); [p.name, p.mail || '–', p.rolle || ''].forEach((x) => { const td = document.createElement('td'); td.textContent = x; tr.append(td); });
      t.append(tr);
    }
    v.append(t); $('importUebernehmen').disabled = false;
  });
  $('importUebernehmen').addEventListener('click', () => {
    const wahl = importListe.filter((p) => p.an); if (!wahl.length) return;
    const ziel = $('importZiel').value;
    if (ziel === '+neu') { const n = $('importNeuName').value.trim(); if (!n) { $('importNeuName').focus(); return; } klasseAnlegen(n); }
    else st.klasse = ziel;
    const d = kd(); let neu = 0, da = 0; const neueIds = [];
    for (const p of wahl) {
      const m = p.mail.toLowerCase();
      const alt = d.schueler.find((s) => (m && (s.mail || '').toLowerCase() === m) || s.name.toLowerCase() === p.name.toLowerCase());
      if (alt) { alt.name = p.name; if (p.mail) alt.mail = p.mail; da++; }
      else { const s = { id: neueId('s'), name: p.name, mail: p.mail }; d.schueler.push(s); neueIds.push(s.id); neu++; }
    }
    freiSetzen(d, neueIds);
    $('importDlg').close(); gewaehlt = null; zeichne();
    banner(''); zeigeMeldung('Übernommen: ' + neu + ' neu' + (da ? ', ' + da + ' schon vorhanden (aktualisiert)' : '') + '.');
  });
  let meldungTimer = null;
  function zeigeMeldung(text) { const b = $('banner'); b.textContent = text; b.hidden = false; clearTimeout(meldungTimer); meldungTimer = setTimeout(() => { if (b.textContent === text) b.hidden = true; }, 5000); }

  // ---------- Kriterien ----------
  function kriterienOeffnen() { zeichneKriterien(); $('kriterienDlg').showModal(); }
  function zeichneKriterien() {
    const l = $('kriterienListe'); l.innerHTML = '';
    st.kriterien.forEach((k, i) => {
      const z = document.createElement('div'); z.className = 'zeile'; z.style.marginBottom = '6px';
      const n = document.createElement('input'); n.type = 'text'; n.value = k.name; n.addEventListener('input', () => { k.name = n.value; sichern(); });
      const g = document.createElement('input'); g.type = 'number'; g.min = 0; g.max = 5; g.value = k.gewicht; g.title = 'Gewicht'; g.inputMode = 'numeric';
      g.addEventListener('input', () => { k.gewicht = Math.max(0, Number(g.value) || 0); sichern(); });
      const x = document.createElement('button'); x.textContent = 'entfernen'; x.className = 'gefahr';
      x.addEventListener('click', () => { if (!confirm('Kriterium „' + k.name + '“ entfernen? Schon gegebene Bewertungen dazu zählen dann nicht mehr in die Note.')) return; st.kriterien.splice(i, 1); zeichneKriterien(); sichern(); });
      z.append(n, g, x); l.append(z);
    });
  }
  $('kritNeu').addEventListener('click', () => { st.kriterien.push({ id: neueId('k'), name: 'Neues Kriterium', gewicht: 1 }); zeichneKriterien(); sichern(); });
  $('kriterienDlg').addEventListener('close', () => zeichne());

  // ---------- Datei abgeben (iPad: Teilen-Menü → „In Dateien sichern“) ----------
  async function dateiAbgeben(name, inhalt, typ) {
    const datei = new File([inhalt], name, { type: typ });
    if (navigator.canShare && navigator.share) {
      let darf = false; try { darf = navigator.canShare({ files: [datei] }); } catch (e) { darf = false; }
      if (darf) {
        try { await navigator.share({ files: [datei], title: name }); return 'geteilt'; }
        catch (e) { if (e && e.name === 'AbortError') return 'abgebrochen'; }
      }
    }
    const a = document.createElement('a'); a.href = URL.createObjectURL(datei); a.download = name;
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    return 'geladen';
  }

  // ---------- Export nach Moodle ----------
  const exportZeilen = () => {
    const zr = $('zeitraum').value, datum = new Date().toLocaleDateString('de-DE');
    return schueler().map((s) => {
      const nv = noteVon(s.id, zr); if (nv.note === null && !eintraege(s.id, zr).some((e) => e.text)) return null;
      const teile = ['Projektkompetenz, Stand ' + datum + (nv.note === null ? '' : ': Note ' + komma(nv.note))];
      for (const k of st.kriterien) {
        const w = eintraege(s.id, zr).filter((e) => e.k === k.id && e.w).map((e) => ZEIG(e.w));
        if (w.length) teile.push(k.name + ': ' + w.join(' ') + ' (Ø ' + komma(nv.je[k.id].m) + ')');
      }
      const bem = eintraege(s.id, zr).filter((e) => e.text).map((e) => new Date(e.zeit).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' }) + ' ' + e.text);
      if (bem.length) teile.push('Bemerkungen: ' + bem.join('; '));
      return { s, note: nv.note, punkte: nv.note === null ? '' : punkte(nv.note), feedback: teile.join('\n') };
    }).filter(Boolean).sort((a, b) => a.s.name.localeCompare(b.s.name, 'de'));
  };
  function zeichneExport() {
    const t = $('exportTabelle'), z = exportZeilen();
    const ohne = z.filter((r) => !r.s.mail).length;
    $('exportWarnung').innerHTML = ohne ? '<div class="meldung warn">Bei ' + ohne + ' Schülern fehlt die E-Mail-Adresse. Sie fehlen in der Datei für Moodle (ergänzen unter Mehr … › Klassen und Schüler).</div>' : '';
    t.innerHTML = '<tr><th>Name</th><th>E-Mail-Adresse</th><th>Note</th><th>Punkte in Moodle*</th><th>Feedback (sieht der Schüler)</th></tr>';
    if (!z.length) t.insertAdjacentHTML('beforeend', '<tr><td colspan="5" class="leise">Im gewählten Zeitraum gibt es noch keine Bewertungen.</td></tr>');
    for (const r of z) {
      const tr = document.createElement('tr');
      [r.s.name, r.s.mail || 'fehlt', r.note === null ? '–' : komma(r.note), r.punkte, r.feedback].forEach((x, i) => { const td = document.createElement('td'); td.textContent = x; if (i === 4) td.style.whiteSpace = 'pre-line'; tr.append(td); });
      t.append(tr);
    }
    t.insertAdjacentHTML('beforeend', '<tr><td colspan="5" class="leise">* Linearer Schlüssel: Note 1,0 = 100 Punkte, 3,5 = 50 Punkte, 6,0 = 0 Punkte.</td></tr>');
    $('csvKnopf').disabled = !z.some((r) => r.s.mail);
  }
  $('exportKnopf').addEventListener('click', () => {
    if (!kd()) { (IN_MOODLE ? mkOeffnen : importOeffnen)(); return; }
    zeichneExport(); $('exportDlg').showModal(); if (IN_MOODLE) mdVorbereiten();
  });
  $('zeitraum').addEventListener('change', zeichneExport);
  $('csvKnopf').addEventListener('click', () => {
    const esc = (x) => '"' + String(x).replace(/"/g, '""') + '"';
    const sp = $('spalteName').value.trim() || 'Projektkompetenz';
    const zeilen = [['E-Mail-Adresse', sp, 'Feedback'].map(esc).join(';')]
      .concat(exportZeilen().filter((r) => r.s.mail).map((r) => [r.s.mail, r.punkte, r.feedback].map(esc).join(';')));
    const datum = new Date().toISOString().slice(0, 10);
    dateiAbgeben('moodle-' + sauber(kd().name) + '-' + sauber(sp) + '-' + datum + '.csv', '﻿' + zeilen.join('\r\n'), 'text/csv');
  });

  // ---------- Große Bilder gleich beim Einlesen verkleinern ----------
  // Zwischenablage, Kamera (12 Megapixel) oder große Dateien: längste Seite höchstens 1600 Pixel, sonst wird das iPad langsam.
  // Gespeichert wird ohnehin nur ein Ausschnitt mit 320 × 320 Pixeln.
  const MAX_KANTE = 1600, MAX_BYTES = 2 * 1024 * 1024;
  function bildVerkleinern(datei) {
    return new Promise((res) => {
      const url = URL.createObjectURL(datei), img = new Image();
      img.onload = () => {
        const w = img.naturalWidth, h = img.naturalHeight, k = Math.min(1, MAX_KANTE / Math.max(w, h));
        if (k === 1 && datei.size <= MAX_BYTES) { URL.revokeObjectURL(url); res(datei); return; }
        const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w * k)); c.height = Math.max(1, Math.round(h * k));
        const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); ctx.drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        c.toBlob((b) => res(b ? new File([b], String(datei.name || 'Bild').replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' }) : datei), 'image/jpeg', 0.9);
      };
      img.onerror = () => { URL.revokeObjectURL(url); res(datei); };
      img.src = url;
    });
  }

  // ---------- Foto aufnehmen, zuschneiden, speichern ----------
  const C = 600;
  const foto = { s: null, img: null, url: null, zoom: 1, ox: 0, oy: 0, origNeu: false };
  // Originale (höchstens 800 px) und die Zuschnitt-Einstellung s.zuschnitt = { zoom, ox, oy } merken, damit ein gespeichertes Foto später
  // neu verschoben und gezoomt werden kann (Wunsch 27.11.2026). Ablage: Gerät „fotos“ › Schlüssel „o:<id>“ (in Moodle nur bis zum Senden),
  // Moodle „Meine Dateien“ › klassen-app/fotos/original/<id>.jpg. Fotos von vorher haben kein Original: dann dient der Ausschnitt als Original.
  function originalVon(img) {
    const k = Math.min(1, 800 / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(img.naturalWidth * k)); c.height = Math.max(1, Math.round(img.naturalHeight * k));
    const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.85);
  }
  async function originalLaden(id) {
    try { const d = await DB.lies('fotos', 'o:' + id); if (d) return d; } catch (e) { /* weiter in Moodle */ }
    if (IN_MOODLE) {
      const u = MO.adresse(ORIG_ORDNER, id + '.jpg') + '?v=' + MO.rev;
      try { const r = await fetch(u, { credentials: 'same-origin' }); if (r.ok) return u; } catch (e) { /* kein Original */ }
    }
    return null;
  }
  function originalMerken(id, daten) { // daten = data-URL, null = löschen
    if (daten) DB.schreib('fotos', 'o:' + id, daten).catch(() => {}); else DB.loesch('fotos', 'o:' + id).catch(() => {});
    if (IN_MOODLE) { MO.origAuftraege.set(id, daten); moodleMerken(true); }
  }
  function fotoOeffnen(s) {
    foto.s = s; foto.img = null; foto.origNeu = false; $('fotoName').textContent = s.name; $('zuschnitt').hidden = true;
    $('fotoSpeichern').disabled = true; $('fotoLoeschen').hidden = !fotos.has(s.id); $('fotoDlg').showModal();
    if (fotos.has(s.id)) fotoBearbeiten(s);
  }
  // Vorhandenes Foto zum Verschieben/Zoomen öffnen: Original mit gemerkter Einstellung, sonst den gespeicherten Ausschnitt.
  async function fotoBearbeiten(s) {
    const orig = await originalLaden(s.id);
    const quelle = orig || fotos.get(s.id); if (!quelle || foto.s !== s) return;
    const z = (orig && s.zuschnitt) || { zoom: 1, ox: 0, oy: 0 };
    const img = new Image();
    img.onload = () => {
      if (foto.s !== s || foto.img) return; // inzwischen ein neues Bild gewählt
      foto.img = img; foto.origNeu = !orig; foto.zoom = z.zoom; foto.ox = z.ox; foto.oy = z.oy; $('fotoZoom').value = z.zoom;
      fotoBegrenzen(); $('zuschnitt').hidden = false; $('fotoSpeichern').disabled = false; fotoZeichnen();
    };
    img.src = quelle;
  }
  $('fotoKameraKnopf').addEventListener('click', () => $('fotoKamera').click());
  $('fotoDateiKnopf').addEventListener('click', () => $('fotoDatei').click());
  for (const inp of [$('fotoKamera'), $('fotoDatei')]) inp.addEventListener('change', () => { const f = inp.files && inp.files[0]; inp.value = ''; if (f) fotoLaden(f); });
  async function fotoLaden(datei) {
    datei = await bildVerkleinern(datei);
    if (foto.url) URL.revokeObjectURL(foto.url);
    foto.url = URL.createObjectURL(datei);
    const img = new Image();
    img.onload = () => { foto.img = img; foto.origNeu = true; foto.zoom = 1; foto.ox = 0; foto.oy = 0; $('fotoZoom').value = 1; $('zuschnitt').hidden = false; $('fotoSpeichern').disabled = false; fotoZeichnen(); };
    img.onerror = () => alert('Dieses Bild lässt sich nicht öffnen.');
    img.src = foto.url;
  }
  const fotoMass = () => { const i = foto.img, sc = Math.max(C / i.naturalWidth, C / i.naturalHeight) * foto.zoom; return { w: i.naturalWidth * sc, h: i.naturalHeight * sc }; };
  // Größer als der Kreis: Bild deckt das Feld immer ab. Kleiner (Regler unter 1, Wunsch 27.11.2026 „auch kleiner über den Bildrand hinaus“):
  // Bild bleibt ganz im Feld, der freie Rand wird weiß (auch im gespeicherten JPEG, sonst wäre er schwarz).
  const fotoBegrenzen = () => { const m = fotoMass(), mx = Math.abs(m.w - C) / 2, my = Math.abs(m.h - C) / 2; foto.ox = Math.max(-mx, Math.min(mx, foto.ox)); foto.oy = Math.max(-my, Math.min(my, foto.oy)); };
  const fotoMalen = (ctx, g) => { const m = fotoMass(), f = g / C; ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, g, g); ctx.drawImage(foto.img, (C / 2 - m.w / 2 + foto.ox) * f, (C / 2 - m.h / 2 + foto.oy) * f, m.w * f, m.h * f); };
  function fotoZeichnen() {
    const ctx = $('fotoCanvas').getContext('2d'); ctx.clearRect(0, 0, C, C); fotoMalen(ctx, C);
    ctx.save(); ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.beginPath(); ctx.rect(0, 0, C, C); ctx.arc(C / 2, C / 2, C / 2 - 4, 0, Math.PI * 2, true); ctx.fill('evenodd');
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(C / 2, C / 2, C / 2 - 4, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
  }
  const cv = $('fotoCanvas'); let fz = null;
  cv.addEventListener('pointerdown', (e) => { if (!foto.img) return; try { cv.setPointerCapture(e.pointerId); } catch (x) { /* egal */ } fz = { x: e.clientX, y: e.clientY }; });
  cv.addEventListener('pointermove', (e) => {
    if (!fz) return; const f = C / cv.getBoundingClientRect().width;
    foto.ox += (e.clientX - fz.x) * f; foto.oy += (e.clientY - fz.y) * f; fz = { x: e.clientX, y: e.clientY }; fotoBegrenzen(); fotoZeichnen();
  });
  const fzEnde = () => { fz = null; }; cv.addEventListener('pointerup', fzEnde); cv.addEventListener('pointercancel', fzEnde);
  $('fotoZoom').addEventListener('input', () => { if (!foto.img) return; foto.zoom = Number($('fotoZoom').value); fotoBegrenzen(); fotoZeichnen(); });
  $('fotoSpeichern').addEventListener('click', async () => {
    if (!foto.img || !foto.s) return;
    const out = document.createElement('canvas'); out.width = out.height = 320; fotoMalen(out.getContext('2d'), 320);
    const daten = out.toDataURL('image/jpeg', 0.85);
    try { await DB.schreib('fotos', foto.s.id, daten); } catch (e) { alert('Das Foto ließ sich nicht speichern: ' + (e && e.message || e)); return; }
    if (foto.origNeu) originalMerken(foto.s.id, originalVon(foto.img));
    foto.s.zuschnitt = { zoom: foto.zoom, ox: Math.round(foto.ox * 10) / 10, oy: Math.round(foto.oy * 10) / 10 };
    fotos.set(foto.s.id, daten); moodleFoto(foto.s.id, daten); $('fotoDlg').close(); zeichne();
  });
  $('fotoLoeschen').addEventListener('click', async () => {
    if (!foto.s || !confirm('Foto von ' + foto.s.name + ' entfernen?')) return;
    await DB.loesch('fotos', foto.s.id).catch(() => {}); fotos.delete(foto.s.id); moodleFoto(foto.s.id, null);
    originalMerken(foto.s.id, null); delete foto.s.zuschnitt; $('fotoDlg').close(); zeichne();
  });
  $('fotoDlg').addEventListener('close', () => { if (foto.url) { URL.revokeObjectURL(foto.url); foto.url = null; } foto.img = null; $('fotoCanvas').getContext('2d').clearRect(0, 0, C, C); });

  // ---------- Bilder aus der Zwischenablage ----------
  // Knopf: liest die Zwischenablage (Safari auf dem iPad fragt mit „Einsetzen“ nach). Strg+V: über das paste-Ereignis unten.
  async function bilderAusZwischenablage() {
    if (!navigator.clipboard || !navigator.clipboard.read) return [];
    const bilder = [];
    for (const t of await navigator.clipboard.read()) {
      const typ = t.types.find((x) => x.startsWith('image/'));
      if (typ) bilder.push(await t.getType(typ));
    }
    return bilder;
  }
  async function zwischenablageNach(ziel) {
    let bilder = [];
    try { bilder = await bilderAusZwischenablage(); } catch (e) { bilder = []; }
    if (!bilder.length) {
      alert('Kein Bild in der Zwischenablage gefunden.\n\nAm Notebook: Bild kopieren und hier Strg+V drücken.\nAm iPad: Foto in „Fotos“ öffnen, Teilen › „Kopieren“, dann hier „Aus Zwischenablage einfügen“ und „Einsetzen“ tippen.');
      return;
    }
    ziel(bilder);
  }
  const alsDatei = (b, i) => (b instanceof File ? b : new File([b], 'Zwischenablage ' + i + '.' + (String(b.type).split('/')[1] || 'png'), { type: b.type }));
  $('fotoEinfuegenKnopf').addEventListener('click', () => zwischenablageNach((b) => fotoLaden(b[0])));
  document.addEventListener('paste', (e) => {
    const cd = e.clipboardData; if (!cd) return;
    const dateien = [...(cd.items || [])].filter((i) => i.kind === 'file' && i.type.startsWith('image/')).map((i) => i.getAsFile()).filter(Boolean);
    if (!dateien.length) return;
    if ($('fotoDlg').open) { e.preventDefault(); fotoLaden(dateien[0]); } else if ($('fotosDlg').open) { e.preventDefault(); fotosHinzu(dateien.map((d, i) => alsDatei(d, fotosNeu.length + i + 1))); }
  });

  // ---------- Viele Fotos auf einmal hochladen und zuordnen ----------
  const falte = (t) => String(t).toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss').normalize('NFD').replace(/[̀-ͯ]/g, '');
  const woerter = (t) => falte(t).split(/[^a-z0-9]+/).filter((w) => w.length > 1);
  // Ordnet eine Datei einem Schüler zu, wenn alle Namensteile (oder die Teile vor dem @ der E-Mail-Adresse) im Dateinamen stehen – nur bei genau einem Treffer.
  function schuelerZuDatei(dateiname, schueler) {
    const w = new Set(woerter(String(dateiname).replace(/\.[a-z0-9]+$/i, '')));
    const passt = (teile) => teile.length > 0 && teile.every((x) => w.has(x));
    const treffer = schueler.filter((s) => passt(woerter(s.name)) || (s.mail && woerter(s.mail.split('@')[0]).length > 1 && passt(woerter(s.mail.split('@')[0]))));
    return treffer.length === 1 ? treffer[0].id : '';
  }
  // Quadratischer Ausschnitt, mittig; bei Hochformat etwas nach oben, dort sitzt meist das Gesicht.
  function quadratBild(img, g = 320) {
    const w = img.naturalWidth, h = img.naturalHeight, s = Math.min(w, h);
    const x = (w - s) / 2, y = h > w ? (h - s) * 0.3 : (h - s) / 2;
    const c = document.createElement('canvas'); c.width = c.height = g;
    c.getContext('2d').drawImage(img, x, y, s, s, 0, 0, g, g);
    return c.toDataURL('image/jpeg', 0.85);
  }
  let fotosNeu = []; // { url, name, img, sid, fehler }
  function fotosLeeren() { for (const f of fotosNeu) URL.revokeObjectURL(f.url); fotosNeu = []; }
  function fotosOeffnen() {
    if (!kd()) { alert('Bitte zuerst eine Klasse anlegen oder aus Moodle übernehmen.'); return; }
    fotosLeeren(); zeichneFotosListe(); $('fotosDlg').showModal();
  }
  async function fotosHinzu(dateien) {
    const d = kd(); if (!d) return;
    for (const roh of dateien) {
      if (!roh || !String(roh.type).startsWith('image/')) continue;
      const f = await bildVerkleinern(roh);
      if (!$('fotosDlg').open) return;
      const e = { url: URL.createObjectURL(f), name: roh.name || 'Bild', img: null, sid: schuelerZuDatei(roh.name || '', d.schueler), fehler: false };
      const img = new Image();
      img.onload = () => { e.img = img; zeichneFotosListe(); };
      img.onerror = () => { e.fehler = true; zeichneFotosListe(); };
      img.src = e.url; fotosNeu.push(e);
    }
    zeichneFotosListe();
  }
  function zeichneFotosListe() {
    const d = kd(), liste = $('fotosListe'); liste.innerHTML = '';
    if (!d) return;
    if (!fotosNeu.length) liste.innerHTML = '<p class="leise" style="margin:0">Noch keine Fotos gewählt.</p>';
    const vergeben = new Map(); for (const f of fotosNeu) if (f.sid) vergeben.set(f.sid, (vergeben.get(f.sid) || 0) + 1);
    const sortiert = d.schueler.slice().sort((a, b) => a.name.localeCompare(b.name, 'de'));
    fotosNeu.forEach((f, i) => {
      const z = document.createElement('div'); z.className = 'foto-zeile' + (f.sid && vergeben.get(f.sid) > 1 ? ' doppelt' : '');
      const b = document.createElement('img'); b.src = f.url; b.alt = ''; z.appendChild(b);
      const n = document.createElement('div'); n.className = 'foto-datei'; n.textContent = f.fehler ? f.name + ' – lässt sich nicht öffnen' : f.name; z.appendChild(n);
      const sel = document.createElement('select'); sel.disabled = f.fehler; sel.setAttribute('aria-label', 'Schüler für ' + f.name);
      sel.appendChild(new Option('– nicht zuordnen –', ''));
      for (const s of sortiert) sel.appendChild(new Option(s.name + (fotos.has(s.id) ? ' (hat schon ein Foto)' : ''), s.id));
      sel.value = f.sid; sel.addEventListener('change', () => { f.sid = sel.value; zeichneFotosListe(); }); z.appendChild(sel);
      const x = document.createElement('button'); x.textContent = '✕'; x.title = 'Aus der Liste nehmen';
      x.addEventListener('click', () => { URL.revokeObjectURL(f.url); fotosNeu.splice(i, 1); zeichneFotosListe(); }); z.appendChild(x);
      liste.appendChild(z);
    });
    const bereit = fotosNeu.filter((f) => f.sid && f.img).length, doppelt = [...vergeben.values()].some((v) => v > 1);
    $('fotosInfo').textContent = fotosNeu.length ? bereit + ' von ' + fotosNeu.length + ' zugeordnet' + (doppelt ? ' · ein Name ist doppelt gewählt' : '') : '';
    $('fotosUebernehmen').disabled = !bereit || doppelt;
  }
  $('fotosWaehlen').addEventListener('click', () => $('fotosDateien').click());
  $('fotosDateien').addEventListener('change', () => { const f = [...$('fotosDateien').files]; $('fotosDateien').value = ''; fotosHinzu(f); });
  $('fotosEinfuegen').addEventListener('click', () => zwischenablageNach((b) => fotosHinzu(b.map((x, i) => alsDatei(x, fotosNeu.length + i + 1)))));
  $('fotosUebernehmen').addEventListener('click', async () => {
    const bereit = fotosNeu.filter((f) => f.sid && f.img);
    const ersetzt = bereit.filter((f) => fotos.has(f.sid)).length;
    if (ersetzt && !confirm((ersetzt === 1 ? 'Ein Schüler hat' : ersetzt + ' Schüler haben') + ' schon ein Foto. Ersetzen?')) return;
    let n = 0;
    const d = kd();
    for (const f of bereit) {
      const daten = quadratBild(f.img);
      try { await DB.schreib('fotos', f.sid, daten); } catch (e) { alert('Ein Foto ließ sich nicht speichern: ' + (e && e.message || e)); break; }
      fotos.set(f.sid, daten); moodleFoto(f.sid, daten); n++;
      // Original + derselbe Ausschnitt wie quadratBild (mittig, Hochformat 30 % von oben) als Einstellung → später nachbessern
      originalMerken(f.sid, originalVon(f.img));
      const w = f.img.naturalWidth, h = f.img.naturalHeight, sk = Math.min(w, h), s = d && d.schueler.find((x) => x.id === f.sid);
      if (s) s.zuschnitt = { zoom: 1, ox: 0, oy: h > w ? Math.round((h - sk) * 0.2 * (C / sk) * 10) / 10 : 0 };
    }
    $('fotosDlg').close(); zeichne();
    zeigeMeldung(n + (n === 1 ? ' Foto' : ' Fotos') + ' übernommen. Den Ausschnitt kannst du über das Foto des Schülers nachbessern.');
  });
  $('fotosDlg').addEventListener('close', fotosLeeren);

  // ---------- Sicherung ----------
  async function sicherungSpeichern() {
    const jetzt = Date.now();
    const alleFotos = Object.fromEntries(fotos); // samt Originalen „o:<id>“, damit nach dem Laden noch nachgebessert werden kann
    try { for (const [k, v] of await DB.alle('fotos')) if (k.startsWith('o:')) alleFotos[k] = v; } catch (e) { /* ohne Originale */ }
    const daten = JSON.stringify({ app: 'klassen-app', art: 'sicherung', stand: STAND, erstellt: new Date(jetzt).toISOString(), zustand: Object.assign({}, st, { letzteSicherung: jetzt }), fotos: alleFotos });
    const name = 'klassen-app-sicherung-' + new Date(jetzt).toISOString().slice(0, 16).replace(/[T:]/g, '-') + '.json';
    const erg = await dateiAbgeben(name, daten, 'application/json');
    if (erg !== 'abgebrochen') { st.letzteSicherung = jetzt; zeichne(); zeigeMeldung('Sicherung erstellt: ' + name + ' – bitte in „Dateien“ ablegen und ab und zu auf den PC kopieren.'); }
  }
  $('sicherungDatei').addEventListener('change', async () => {
    const f = $('sicherungDatei').files[0]; $('sicherungDatei').value = ''; if (!f) return;
    let s = null; try { s = JSON.parse(await f.text()); } catch (e) { s = null; }
    if (!s || s.app !== 'klassen-app' || !s.zustand || !s.zustand.klassen) { alert('Das ist keine Sicherung der Klassen-App.'); return; }
    const anz = Object.keys(s.zustand.klassen).length;
    if (!confirm('Sicherung vom ' + new Date(s.erstellt).toLocaleString('de-DE') + ' mit ' + anz + ' Klasse(n) laden? Alles, was jetzt in der App steht, wird dabei ersetzt.')) return;
    st = Object.assign(grund(), s.zustand);
    try {
      await DB.leeren('fotos'); fotos.clear();
      for (const [k, v] of Object.entries(s.fotos || {})) { await DB.schreib('fotos', k, v); if (!k.startsWith('o:')) fotos.set(k, v); }
    } catch (e) { alert('Beim Laden der Fotos gab es einen Fehler: ' + (e && e.message || e)); }
    if (!st.klassen[st.klasse]) st.klasse = klassenSortiert()[0] || null;
    gewaehlt = null; zeichne(); zeigeMeldung('Sicherung geladen.');
  });

  // ---------- Beispielklasse (erfundene Namen) ----------
  function beispielAnlegen() {
    const namen = ['Anna Becker', 'Ben Krüger', 'Can Yilmaz', 'David Lang', 'Elif Demir', 'Finn Weber', 'Greta Vogel', 'Hamza Ali', 'Ida Sommer', 'Jonas Fuchs',
      'Kai Brandt', 'Lea Hoffmann', 'Malik Haddad', 'Nina Roth', 'Omar Saleh', 'Paul Winter', 'Quentin Moser', 'Rosa Klein', 'Sami Nowak', 'Tim Berger'];
    klasseAnlegen('Beispielklasse (erfundene Namen)');
    const d = kd();
    d.schueler = namen.map((n) => ({ id: neueId('s'), name: n, mail: n.toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ /g, '.') + '@beispiel.invalid' }));
    freiSetzen(d, d.schueler.map((s) => s.id)); gewaehlt = null; zeichne();
  }

  // ---------- Moodle-Fassung (Stufe 2, Wunsch 27.11.2026) ----------
  // Liegt die App als Datei in einem Moodle-Kurs, arbeitet sie mit der Anmeldung des Lehrers (kein Schlüssel nötig):
  // Daten und Fotos in „Meine Dateien“ › klassen-app/ (nur für ihn sichtbar), Klassen aus Moodle-Kursen, Noten direkt in einen
  // Bewertungsaspekt. Auf dem Gerät bleibt nur, was noch nicht gesendet ist. Die Wege sind am 27.11.2026 erprobt (03-Moodle.md).
  const MO = { sk: '', ctx: '', repo: '4', rev: 0, zuletzt: null, bereit: false, laeuft: false, nochmal: false, timer: null, fotoAuftraege: new Map(), origAuftraege: new Map(), kurse: null };
  const ORDNER = '/klassen-app/', FOTO_ORDNER = '/klassen-app/fotos/', ORIG_ORDNER = '/klassen-app/fotos/original/';
  MO.ajax = async (methodname, args, nochmal = true) => {
    try { return await MO.ajax1(methodname, args); } catch (e) {
      // Nach einem neuen Bewertungsaspekt rechnet Moodle die Noten erst neu, wenn die Bewertungsübersicht geöffnet wird.
      if (nochmal && /gradesneedregrading/.test(e.message) && args && args.courseid) {
        await fetch('/grade/report/grader/index.php?id=' + args.courseid, { credentials: 'same-origin' }).then((r) => r.text()).catch(() => {});
        return MO.ajax(methodname, args, false);
      }
      throw e;
    }
  };
  MO.ajax1 = async (methodname, args) => {
    if (!MO.sk) await MO.formular();
    const r = await fetch('/lib/ajax/service.php?sesskey=' + encodeURIComponent(MO.sk) + '&info=' + methodname, {
      method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify([{ index: 0, methodname, args }]) });
    const j = await r.json().catch(() => null), e = Array.isArray(j) ? j[0] : j;
    if (!e) throw new Error('Moodle antwortet nicht (' + r.status + ')');
    if (e.error) { const x = e.exception || e; if (/sesskey|login/i.test(x.errorcode || '')) MO.sk = ''; throw new Error((x.message || x.error || 'Fehler') + (x.errorcode ? ' (' + x.errorcode + ')' : '')); }
    return e.data;
  };
  // „Meine Dateien“ öffnen: liefert Sitzungsschlüssel, Benutzerkontext und einen frischen Entwurfsbereich mit allen vorhandenen Dateien
  MO.formular = async () => {
    const r = await fetch('/user/files.php', { credentials: 'same-origin', cache: 'no-store' });
    const html = await r.text();
    const sk = (html.match(/"sesskey":"([^"]+)"/) || [])[1];
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const feld = doc.querySelector('input[name="files_filemanager"]');
    if (!sk || !feld) throw new Error('anmelden');
    const js = [...doc.querySelectorAll('script')].map((s) => s.textContent).join('\n');
    MO.sk = sk; MO.ctx = (js.match(/"context":\{"id":(\d+)/) || [])[1] || MO.ctx;
    MO.repo = (js.match(/"type":"upload"[^}]*?"id":"?(\d+)/) || [])[1] || MO.repo;
    return { doc, itemid: feld.value };
  };
  MO.adresse = (pfad, name) => '/pluginfile.php/' + MO.ctx + '/user/private' + pfad + encodeURIComponent(name);
  MO.entwurf = async (aktion, daten) => {
    const r = await fetch('/repository/draftfiles_ajax.php?action=' + aktion, { method: 'POST', credentials: 'same-origin', body: new URLSearchParams(Object.assign({ sesskey: MO.sk }, daten)) });
    return r.json().catch(() => null);
  };
  // Dateien in „Meine Dateien“ schreiben oder löschen: [{ pfad, name, blob }] – blob null = löschen. Gespeichert wird wie im Moodle-Fenster.
  MO.schreibe = async (auftraege) => {
    const f = await MO.formular();
    for (const a of auftraege) {
      await MO.entwurf('delete', { itemid: f.itemid, filepath: a.pfad, filename: a.name });
      if (!a.blob) continue;
      const fd = new FormData();
      fd.append('repo_upload_file', a.blob, a.name);
      for (const [k, v] of Object.entries({ sesskey: MO.sk, repo_id: MO.repo, itemid: f.itemid, ctx_id: MO.ctx, savepath: a.pfad, title: a.name, author: '', env: 'filemanager' })) fd.append(k, v);
      const j = await (await fetch('/repository/repository_ajax.php?action=upload', { method: 'POST', credentials: 'same-origin', body: fd })).json().catch(() => null);
      if (!j || j.error || j.event === 'fileexists') throw new Error('Hochladen von ' + a.name + ' ging nicht' + (j && j.error ? ': ' + j.error : ''));
    }
    const form = f.doc.querySelector('form.mform') || f.doc.querySelector('form');
    const fd = new URLSearchParams();
    for (const e of form.elements) { if (!e.name || e.type === 'submit' || e.type === 'button') continue; fd.append(e.name, e.name === 'sesskey' ? MO.sk : e.value); }
    if (!fd.has('sesskey')) fd.append('sesskey', MO.sk);
    fd.set('files_filemanager', f.itemid);
    const erg = await MO.ajax('core_form_dynamic_form', { form: 'core_user\\form\\private_files', formdata: fd.toString() });
    if (!erg || !erg.submitted) throw new Error('Moodle hat „Meine Dateien“ nicht gespeichert');
  };
  MO.liste = async (pfad) => {
    const f = await MO.formular(); const j = await MO.entwurf('list', { itemid: f.itemid, filepath: pfad });
    return ((j && j.list) || []).filter((x) => x.type !== 'folder').map((x) => x.filename);
  };
  const speicherStand = (t) => { const e = $('speicherOrt'); if (e) e.textContent = t; };
  async function moodleDatenLesen() {
    const r = await fetch(MO.adresse(ORDNER, 'daten.json') + '?t=' + Date.now(), { credentials: 'same-origin', cache: 'no-store' });
    if (r.status === 404) return null;
    const j = await r.json().catch(() => null);
    if (!r.ok || !j || j.app !== 'klassen-app') throw new Error('daten.json ließ sich nicht lesen (' + r.status + ')');
    return j;
  }
  async function moodleFotosLaden() {
    for (const n of await MO.liste(FOTO_ORDNER)) {
      const id = n.replace(/\.jpg$/i, ''); if (!MO.fotoAuftraege.has(id)) fotos.set(id, MO.adresse(FOTO_ORDNER, n) + '?v=' + MO.rev);
    }
  }
  function moodleMerken(sofort) {
    if (!IN_MOODLE || !MO.bereit) return;
    if (!sofort && JSON.stringify(st) === MO.zuletzt && !MO.fotoAuftraege.size && !MO.origAuftraege.size) return;
    DB.schreib('kv', 'ausstehend', st).catch(() => {});
    clearTimeout(MO.timer); MO.timer = setTimeout(moodleSpeichern, 2500);
    speicherStand('Daten in Moodle · wird gleich gespeichert …');
  }
  function moodleFoto(id, daten) { // daten = Bild als data-URL, null = Foto löschen
    if (!IN_MOODLE) return;
    MO.fotoAuftraege.set(id, daten); moodleMerken(true);
  }
  async function moodleSpeichern() {
    if (MO.laeuft) { MO.nochmal = true; return; }
    MO.laeuft = true; clearTimeout(MO.timer); MO.timer = null; speicherStand('Daten in Moodle · speichert …');
    let fremdGeladen = false; // „Abbrechen“ beim Konflikt: nichts gesendet, Stand des anderen Geräts geladen (27.11.2026: stand sonst „gespeichert“)
    try {
      do {
        MO.nochmal = false;
        const fern = await moodleDatenLesen();
        if (fern && fern.rev !== MO.rev) {
          const wann = new Date(fern.rev).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
          if (!confirm('Auf einem anderen Gerät wurde am ' + wann + ' gespeichert.\n\nOK: den Stand von diesem Gerät speichern (der andere wird überschrieben).\nAbbrechen: den anderen Stand laden (die Änderungen hier gehen verloren).')) {
            st = Object.assign(grund(), fern.zustand); MO.rev = fern.rev; MO.zuletzt = JSON.stringify(st); MO.fotoAuftraege.clear(); MO.origAuftraege.clear(); fotos.clear();
            await DB.loesch('kv', 'ausstehend').catch(() => {}); await DB.leeren('fotos').catch(() => {});
            await moodleFotosLaden(); if (!st.klassen[st.klasse]) st.klasse = klassenSortiert()[0] || null; gewaehlt = null; zeichne();
            fremdGeladen = true; break;
          }
        }
        const rev = Math.max(Date.now(), (fern ? fern.rev : 0) + 1), jetzt = JSON.stringify(st);
        const auftraege = [{ pfad: ORDNER, name: 'daten.json', blob: new Blob([JSON.stringify({ app: 'klassen-app', stand: STAND, rev, zustand: st })], { type: 'application/json' }) }];
        const fotosJetzt = new Map(MO.fotoAuftraege);
        for (const [id, url] of fotosJetzt) auftraege.push({ pfad: FOTO_ORDNER, name: id + '.jpg', blob: url ? await (await fetch(url)).blob() : null });
        const origJetzt = new Map(MO.origAuftraege);
        for (const [id, url] of origJetzt) auftraege.push({ pfad: ORIG_ORDNER, name: id + '.jpg', blob: url ? await (await fetch(url)).blob() : null });
        await MO.schreibe(auftraege);
        MO.rev = rev; MO.zuletzt = jetzt;
        for (const [id, url] of fotosJetzt) {
          if (MO.fotoAuftraege.get(id) !== url) continue;
          MO.fotoAuftraege.delete(id); DB.loesch('fotos', id).catch(() => {});
          if (url) fotos.set(id, MO.adresse(FOTO_ORDNER, id + '.jpg') + '?v=' + rev);
        }
        for (const [id, url] of origJetzt) { if (MO.origAuftraege.get(id) === url) { MO.origAuftraege.delete(id); DB.loesch('fotos', 'o:' + id).catch(() => {}); } }
        if (JSON.stringify(st) === MO.zuletzt) await DB.loesch('kv', 'ausstehend').catch(() => {});
        if (JSON.stringify(st) !== MO.zuletzt || MO.fotoAuftraege.size || MO.origAuftraege.size) MO.nochmal = true;
      } while (MO.nochmal);
      speicherStand(fremdGeladen ? 'Daten in Moodle · Stand vom anderen Gerät geladen ' + uhrzeit() : 'Daten in Moodle · gespeichert ' + uhrzeit());
    } catch (e) {
      const grund_ = e && e.message === 'anmelden' ? 'nicht bei Moodle angemeldet' : navigator.onLine === false ? 'offline' : (e && e.message) || 'Fehler';
      speicherStand('⚠ Daten noch nicht in Moodle gespeichert (' + grund_ + ') – neuer Versuch in 30 s');
      MO.timer = setTimeout(moodleSpeichern, 30000);
    } finally { MO.laeuft = false; }
  }
  function moodleAnmeldeHinweis() {
    const b = $('banner'); b.hidden = false; b.textContent = 'Nicht bei Moodle angemeldet. ';
    const a = document.createElement('a'); a.href = '/login/index.php'; a.textContent = 'Jetzt anmelden'; b.append(a, ' – danach diese Seite neu laden.');
  }
  async function moodleStart() {
    document.body.classList.add('moodle'); speicherStand('Daten in Moodle · verbinde …');
    let lokal = null, fern = null, fehler = null;
    try {
      lokal = await DB.lies('kv', 'ausstehend');
      for (const [k, v] of await DB.alle('fotos')) { if (k.startsWith('o:')) MO.origAuftraege.set(k.slice(2), v); else { fotos.set(k, v); MO.fotoAuftraege.set(k, v); } }
    } catch (e) { /* kein Zwischenspeicher */ }
    try { await MO.formular(); fern = await moodleDatenLesen(); if (fern) MO.rev = fern.rev; await moodleFotosLaden(); } catch (e) { fehler = e; }
    if (fern) st = Object.assign(grund(), fern.zustand);
    MO.zuletzt = JSON.stringify(st);
    if (lokal && lokal.klassen) st = Object.assign(grund(), lokal); // noch nicht Gesendetes geht vor
    if (!st.klassen[st.klasse]) st.klasse = klassenSortiert()[0] || null;
    MO.bereit = true; zeichne();
    if (fehler) {
      if (fehler.message === 'anmelden') moodleAnmeldeHinweis();
      else banner('Moodle ist gerade nicht erreichbar (' + fehler.message + '). Du arbeitest mit dem Stand auf diesem Gerät; gespeichert wird, sobald Moodle wieder erreichbar ist.');
      speicherStand('⚠ Daten noch nicht mit Moodle abgeglichen');
      if ((lokal && lokal.klassen) || MO.fotoAuftraege.size || MO.origAuftraege.size) MO.timer = setTimeout(moodleSpeichern, 30000);
    } else if ((lokal && lokal.klassen) || MO.fotoAuftraege.size || MO.origAuftraege.size) moodleMerken(true);
    else speicherStand(fern ? 'Daten in Moodle · geladen ' + uhrzeit() : 'Daten in Moodle · noch nichts gespeichert');
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && MO.timer) moodleSpeichern(); });
  }

  // Klasse aus einem Moodle-Kurs übernehmen (nur bewertbare Teilnehmer, wahlweise eine Gruppe)
  async function moodleKurse() {
    if (!MO.kurse) {
      const d = await MO.ajax('core_course_get_enrolled_courses_by_timeline_classification', { classification: 'all', limit: 0, offset: 0, sort: 'fullname' });
      MO.kurse = (d.courses || []).map((c) => ({ id: c.id, name: c.fullname, bereich: c.coursecategory || '' }))
        .sort((a, b) => (a.bereich + ' ' + a.name).localeCompare(b.bereich + ' ' + b.name, 'de'));
    }
    return MO.kurse;
  }
  const kursOptionen = (sel, kurse, wahl) => {
    sel.innerHTML = ''; for (const k of kurse) sel.append(new Option((k.bereich ? k.bereich + ' › ' : '') + k.name, k.id));
    if (wahl && !kurse.some((k) => k.id === wahl)) sel.prepend(new Option('Kurs ' + wahl, wahl));
    if (wahl) sel.value = String(wahl);
  };
  // Kurse, in die der Lehrer nicht selbst eingeschrieben ist (Rechte über den Kursbereich), stehen nicht in der Liste → Nummer eintippen
  const kursNummer = (sel, eingabe) => {
    const n = Number(eingabe.value); eingabe.value = ''; if (!n) return false;
    if (![...sel.options].some((o) => o.value === String(n))) sel.prepend(new Option('Kurs ' + n, n));
    sel.value = String(n); return true;
  };
  const moodleFehler = (e) => (e && e.message === 'anmelden' ? 'Nicht bei Moodle angemeldet – bitte anmelden und die Seite neu laden.' : 'Fehler: ' + (e && e.message));
  let mkListe = [];
  async function mkOeffnen() {
    $('mkVorschau').textContent = 'Kurse werden geladen …'; $('mkUebernehmen').disabled = true; $('mkDlg').showModal();
    try { kursOptionen($('mkKurs'), await moodleKurse(), kd() && kd().kurs); await mkKursGewaehlt(); } catch (e) { $('mkVorschau').textContent = moodleFehler(e); }
  }
  async function mkKursGewaehlt() {
    const g = $('mkGruppe'); g.innerHTML = ''; g.append(new Option('alle Schüler des Kurses', '0'));
    try { for (const x of (await MO.ajax('core_group_get_course_groups', { courseid: Number($('mkKurs').value) })) || []) g.append(new Option(x.name, x.id)); } catch (e) { /* ohne Gruppen */ }
    $('mkAlle').hidden = g.options.length < 2;
    if (kd() && kd().gruppe && [...g.options].some((o) => o.value === String(kd().gruppe))) g.value = String(kd().gruppe);
    await mkLaden();
  }
  async function mkLaden() {
    $('mkVorschau').textContent = 'Schüler werden geladen …'; $('mkUebernehmen').disabled = true;
    const kurs = Number($('mkKurs').value), gruppe = Number($('mkGruppe').value), args = { courseid: kurs };
    if (gruppe) args.groupid = gruppe;
    mkListe = mkNutzer(await MO.ajax('core_grades_get_enrolled_users_for_selector', args));
    const z = $('mkZiel'); z.innerHTML = ''; z.append(new Option('als neue Klasse', ''));
    for (const id of klassenSortiert()) z.append(new Option('Klasse „' + st.klassen[id].name + '“ ergänzen', id));
    z.value = klassenSortiert().find((id) => st.klassen[id].kurs === kurs && (st.klassen[id].gruppe || 0) === gruppe) || '';
    $('mkNeuName').value = gruppe ? $('mkGruppe').selectedOptions[0].textContent : $('mkKurs').selectedOptions[0].textContent.replace(/^.* › /, '');
    $('mkNeuName').hidden = !!z.value;
    const mitBild = mkListe.filter((u) => u.bild).length;
    $('mkVorschau').textContent = mkListe.length + ' Schüler ' + (gruppe ? 'in dieser Gruppe' : 'in diesem Kurs') + ' (nur bewertbare, ohne Lehrkräfte)' + (mitBild ? ', ' + mitBild + ' mit Profilbild' : '') + '.';
    $('mkUebernehmen').disabled = !mkListe.length;
  }
  $('mkKurs').addEventListener('change', () => mkKursGewaehlt().catch((e) => { $('mkVorschau').textContent = moodleFehler(e); }));
  $('mkKursNr').addEventListener('change', () => { if (kursNummer($('mkKurs'), $('mkKursNr'))) mkKursGewaehlt().catch((e) => { $('mkVorschau').textContent = moodleFehler(e); }); });
  $('mdKursNr').addEventListener('change', () => { if (kursNummer($('mdKurs'), $('mdKursNr'))) mdAspekte().catch((e) => { $('mdInfo').textContent = moodleFehler(e); }); });
  $('mkGruppe').addEventListener('change', () => mkLaden().catch((e) => { $('mkVorschau').textContent = moodleFehler(e); }));
  $('mkZiel').addEventListener('change', () => { $('mkNeuName').hidden = !!$('mkZiel').value; });
  const mkNutzer = (d) => (d.users || []).map((u) => ({ mid: u.id, name: ((u.firstname || '') + ' ' + (u.lastname || '')).trim() || u.fullname, mail: u.email || '',
    vorname: (u.firstname || '').trim(), nachname: (u.lastname || '').trim(), bild: /\/user\/icon\//.test(u.profileimageurl || '') ? u.profileimageurl : '' }));
  // „1BFSHK1 (2026/27) Globale Gruppe“ → „1BFSHK1“
  const kurzName = (n) => n.replace(/\s*Globale Gruppe\s*$/i, '').replace(/\s*\(\d{4}\/\d{2}\)\s*$/, '').trim() || n;
  // Schüler aus Moodle in Klasse d übernehmen: Vorhandene (gleiche Moodle-Nummer oder E-Mail) werden aktualisiert, Bewertungen bleiben.
  function schuelerUebernehmen(d, liste) {
    const neu = []; let schonDa = 0;
    for (const u of liste) {
      let s = d.schueler.find((x) => x.mid === u.mid || (u.mail && x.mail && x.mail.toLowerCase() === u.mail.toLowerCase()));
      if (s) { s.mid = u.mid; s.name = u.name; if (u.mail) s.mail = u.mail; s.profilbild = u.bild; schonDa++; }
      else { s = { id: 'm' + u.mid, name: u.name, mail: u.mail, mid: u.mid, profilbild: u.bild }; d.schueler.push(s); neu.push(s.id); }
      if (u.vorname) { s.vorname = u.vorname; s.nachname = u.nachname; }
    }
    freiSetzen(d, neu);
    return { neu: neu.length, schonDa };
  }
  $('mkUebernehmen').addEventListener('click', () => {
    const kurs = Number($('mkKurs').value), gruppe = Number($('mkGruppe').value);
    if ($('mkZiel').value) st.klasse = $('mkZiel').value; else klasseAnlegen($('mkNeuName').value || 'Neue Klasse');
    const d = kd(); d.kurs = kurs; d.gruppe = gruppe;
    const z = schuelerUebernehmen(d, mkListe);
    gewaehlt = null; $('mkDlg').close(); zeichne();
    zeigeMeldung(z.neu + ' Schüler neu, ' + z.schonDa + ' schon vorhanden. Die Klasse „' + d.name + '“ ist mit dem Moodle-Kurs verbunden.');
  });
  // Jede Gruppe des Kurses als eigene Klasse (Wunsch 27.11.2026: Klassen automatisch aus den globalen Gruppen). Moodle gibt die Mitglieder
  // einer globalen Gruppe nur über einen Kurs heraus, in den sie eingeschrieben ist – dort steht sie als Gruppe „<Name> (2026/27) Globale Gruppe“.
  // Klassenname ohne Schuljahr und Zusatz; gibt es die Klasse (gleicher Kurs + Gruppe oder gleicher Name) schon, wird sie ergänzt.
  $('mkAlle').addEventListener('click', async () => {
    const kurs = Number($('mkKurs').value), gruppen = [...$('mkGruppe').options].filter((o) => o.value !== '0');
    if (!gruppen.length) return;
    $('mkAlle').disabled = true; $('mkUebernehmen').disabled = true;
    const bericht = []; let erste = null;
    try {
      for (const o of gruppen) {
        $('mkVorschau').textContent = 'Lade ' + o.textContent + ' …';
        const liste = mkNutzer(await MO.ajax('core_grades_get_enrolled_users_for_selector', { courseid: kurs, groupid: Number(o.value) }));
        if (!liste.length) { bericht.push(kurzName(o.textContent) + ': keine Schüler'); continue; }
        const name = kurzName(o.textContent);
        const da = klassenSortiert().find((id) => (st.klassen[id].kurs === kurs && st.klassen[id].gruppe === Number(o.value)) || st.klassen[id].name.trim().toLowerCase() === name.toLowerCase());
        if (da) st.klasse = da; else klasseAnlegen(name);
        const d = kd(); d.kurs = kurs; d.gruppe = Number(o.value);
        const z = schuelerUebernehmen(d, liste); erste = erste || st.klasse;
        bericht.push(name + ': ' + (da ? 'ergänzt' : 'neu') + ', ' + liste.length + ' Schüler');
      }
      if (erste) st.klasse = erste;
      gewaehlt = null; $('mkDlg').close(); zeichne();
      zeigeMeldung(bericht.join(' · '));
    } catch (e) { $('mkVorschau').textContent = moodleFehler(e); }
    $('mkAlle').disabled = false; $('mkUebernehmen').disabled = !mkListe.length;
  });

  // ---------- Klasse aus SHK City (Wunsch 27.11.2026: „für die Anlage der Klasse einfach die Gruppen nehmen aus SHK City“) ----------
  // Kurs 3193 „SHK City“ enthält alle Klassen als globale Gruppen („1BFSHK1 (2026/27) Globale Gruppe“). Die Herkunft steht in d.quelle;
  // d.kurs bleibt der Kurs, in den die Noten gehen („Nach Moodle …“) – sonst schlüge die App SHK City als Notenkurs vor.
  const SHK_KURS = 3193;
  let shkGruppen = [];
  const shkKlasseVon = (g) => klassenSortiert().find((id) => { const k = st.klassen[id];
    return (k.quelle && k.quelle.kurs === SHK_KURS && k.quelle.gruppe === g.id) || (k.kurs === SHK_KURS && k.gruppe === g.id) || k.name.trim().toLowerCase() === g.name.toLowerCase(); });
  async function shkOeffnen() {
    $('shkListe').innerHTML = ''; $('shkInfo').textContent = 'Klassen werden aus SHK City geladen …'; $('shkAlle').disabled = true; $('shkDlg').showModal();
    try {
      const neu = [];
      for (const x of (await MO.ajax('core_group_get_course_groups', { courseid: SHK_KURS })) || []) {
        const liste = mkNutzer(await MO.ajax('core_grades_get_enrolled_users_for_selector', { courseid: SHK_KURS, groupid: x.id }));
        if (liste.length) neu.push({ id: x.id, name: kurzName(x.name), liste });
      }
      shkGruppen = neu.sort((a, b) => a.name.localeCompare(b.name, 'de'));
      shkZeichnen();
    } catch (e) { $('shkInfo').textContent = moodleFehler(e); }
  }
  function shkZeichnen() {
    const l = $('shkListe'); l.innerHTML = '';
    for (const g of shkGruppen) {
      const da = shkKlasseVon(g), b = document.createElement('button'), n = document.createElement('b'), z = document.createElement('span');
      n.textContent = g.name; z.className = 'leise'; z.textContent = g.liste.length + ' Schüler · ' + (da ? 'schon da – ergänzen' : 'neu anlegen');
      b.append(n, z); b.addEventListener('click', () => shkAnlegen([g])); l.append(b);
    }
    $('shkInfo').textContent = shkGruppen.length ? '' : 'Im Kurs „SHK City“ gibt es keine Gruppe mit Schülern.';
    $('shkAlle').disabled = !shkGruppen.length;
  }
  function shkAnlegen(gruppen) {
    const bericht = []; let erste = null;
    for (const g of gruppen) {
      const da = shkKlasseVon(g);
      if (da) st.klasse = da; else klasseAnlegen(g.name);
      const d = kd(); d.quelle = { kurs: SHK_KURS, gruppe: g.id };
      const z = schuelerUebernehmen(d, g.liste); erste = erste || st.klasse;
      bericht.push(g.name + ': ' + (da ? 'ergänzt, ' + z.neu + ' neu' : 'neu, ' + g.liste.length + ' Schüler'));
    }
    if (erste) st.klasse = erste;
    gewaehlt = null; $('shkDlg').close(); zeichne(); zeigeMeldung(bericht.join(' · '));
  }
  $('shkAlle').addEventListener('click', () => shkAnlegen(shkGruppen));

  // Noten direkt in einen Bewertungsaspekt eintragen – wie in Moodle unter Bewertungen › Einzelansicht von Hand
  async function mdVorbereiten() {
    $('mdInfo').textContent = 'Kurse werden geladen …'; $('mdEintragen').disabled = true;
    try { kursOptionen($('mdKurs'), await moodleKurse(), kd().kurs); await mdAspekte(); } catch (e) { $('mdInfo').textContent = moodleFehler(e); }
  }
  async function mdAspekte() {
    const sel = $('mdAspekt'); sel.innerHTML = ''; $('mdEintragen').disabled = true; $('mdInfo').textContent = 'Bewertungsaspekte werden geladen …';
    const d = await MO.ajax('core_grades_get_gradeitems', { courseid: Number($('mdKurs').value) });
    for (const g of d.gradeItems || []) sel.append(new Option(g.itemname + (g.category ? ' – ' + g.category : ''), g.id));
    if (kd().aspekt && [...sel.options].some((o) => o.value === String(kd().aspekt))) sel.value = String(kd().aspekt);
    $('mdEintragen').disabled = !sel.options.length;
    $('mdInfo').textContent = sel.options.length
      ? 'Den Bewertungsaspekt (z. B. „Arbeiten im Unterricht“ unter Projektkompetenz › Pflicht) legst du einmal in Moodle an: Bewertungen › Bewertungen einrichten › Hinzufügen › Bewertungsaspekt.'
      : 'In diesem Kurs gibt es noch keinen Bewertungsaspekt. Lege ihn in Moodle an: Bewertungen › Bewertungen einrichten › Hinzufügen › Bewertungsaspekt.';
  }
  $('mdKurs').addEventListener('change', () => mdAspekte().catch((e) => { $('mdInfo').textContent = moodleFehler(e); }));
  $('mdEintragen').addEventListener('click', async () => {
    const d = kd(), kurs = Number($('mdKurs').value), item = Number($('mdAspekt').value), aspekt = $('mdAspekt').selectedOptions[0].textContent;
    const zeilen = exportZeilen().filter((r) => r.note !== null), mit = zeilen.filter((r) => r.s.mid), ohne = zeilen.length - mit.length;
    if (!mit.length) { alert('Es gibt noch keine Noten von Schülern, die aus Moodle übernommen wurden.'); return; }
    if (!confirm(mit.length + (mit.length === 1 ? ' Note' : ' Noten') + ' mit Feedback in „' + aspekt + '“ eintragen?\nVorhandene Werte dieser Schüler in diesem Bewertungsaspekt werden ersetzt.' + (ohne ? '\n' + ohne + ' Schüler ohne Moodle-Konto werden übersprungen.' : ''))) return;
    $('mdInfo').textContent = 'Wird eingetragen …'; $('mdEintragen').disabled = true;
    try {
      if (!MO.sk) await MO.formular();
      const fd = new URLSearchParams({ sesskey: MO.sk, itemid: String(item) });
      for (const r of mit) { fd.append('finalgrade_' + item + '_' + r.s.mid, String(r.punkte)); fd.append('feedback_' + item + '_' + r.s.mid, r.feedback); }
      const res = await fetch('/grade/report/singleview/index.php?id=' + kurs + '&item=grade&itemid=' + item, { method: 'POST', credentials: 'same-origin', body: fd });
      const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
      const meldung = [...doc.querySelectorAll('.alert')].map((e) => e.textContent.replace(/Systemnachricht schließen|×/g, '').replace(/\s+/g, ' ').trim()).filter(Boolean).join(' · ');
      d.kurs = kurs; d.aspekt = item; sichern();
      $('mdInfo').textContent = (meldung || 'Antwort von Moodle: ' + res.status) + ' – prüfen in Moodle unter Bewertungen › Einzelansicht.';
    } catch (e) { $('mdInfo').textContent = moodleFehler(e); }
    $('mdEintragen').disabled = false;
  });

  // ---------- Start ----------
  async function start() {
    $('stand').textContent = 'Stand ' + STAND;
    if (IN_MOODLE) { await moodleStart(); return; }
    try {
      const z = await DB.lies('kv', 'zustand');
      if (z && z.klassen) st = Object.assign(grund(), z);
      for (const [k, v] of await DB.alle('fotos')) if (!k.startsWith('o:')) fotos.set(k, v); // Originale „o:<id>“ lädt erst das Foto-Fenster
    } catch (e) {
      banner('Auf diesem Gerät kann die App nichts speichern (privates Surfen?). Bewertungen gehen beim Schließen verloren.');
    }
    if (!st.klassen[st.klasse]) st.klasse = klassenSortiert()[0] || null;
    zeichne();
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  window.__klassenApp = { stand: STAND, zustand: () => st, fotoAnzahl: () => fotos.size, bildVerkleinern, moodle: IN_MOODLE, speichereJetzt: () => moodleSpeichern() };
  start();
})();
