/* Klassen-App – Sitzplan und Schnellbewertung der Projektkompetenz.
   Alle Daten (Klassen, Fotos, Bewertungen) bleiben auf dem Gerät (IndexedDB). Es wird nichts gesendet.
   Aufbau nach dem vom Lehrer abgenommenen Mockup (21.11.2026). */
(() => {
  'use strict';
  const STAND = '2026-11-21.1';
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
    { id: 'k5', name: 'Präsentation', gewicht: 1 }];
  const grund = () => ({ app: 'klassen-app', version: 1, klasse: null, kriterien: grundKriterien(), klassen: {}, letzteSicherung: null });
  let st = grund();
  const fotos = new Map();

  let schreibt = false, nochmal = false;
  async function sichern() {
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
    st.klassen[id] = { name: name.trim() || 'Neue Klasse', reihen: 5, spalten: 6, schueler: [], plaetze: {}, protokoll: {} };
    st.klasse = id; return id;
  }
  const klassenSortiert = () => Object.keys(st.klassen).sort((a, b) => st.klassen[a].name.localeCompare(st.klassen[b].name, 'de'));

  // ---------- Zeichnen ----------
  let modus = 'bewerten', gewaehlt = null;
  const plaetzeEl = $('plaetze'), ablageEl = $('ablage'), seite = $('seite');

  function bildEl(s) {
    const b = document.createElement('div'); b.className = 'bild';
    const f = fotos.get(s.id);
    if (f) { const i = new Image(); i.src = f; i.alt = ''; b.append(i); b.style.background = 'var(--linie)'; }
    else { b.style.background = farbe(s.name); b.textContent = kuerzel(s.name); }
    return b;
  }
  function karte(s) {
    const k = document.createElement('div'); k.className = 'karte' + (s.id === gewaehlt ? ' gewaehlt' : ''); k.dataset.id = s.id; k.title = s.name;
    const n = document.createElement('div'); n.className = 'name'; n.textContent = s.name;
    const heute = eintraege(s.id, 'heute');
    const p = document.createElement('div'); p.className = 'punkt' + (heute.some((e) => e.abw) ? ' abwesend' : heute.length ? ' heute' : '');
    const no = document.createElement('div'); const nv = noteVon(s.id, 'alle').note;
    no.className = 'note' + (nv === null ? '' : ' da'); no.textContent = nv === null ? '' : komma(nv);
    k.append(bildEl(s), n, p, no); return k;
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
    zeichneKlassenwahl();
    const d = kd();
    $('start').hidden = !!d; $('sitzplan').hidden = !d;
    if (!d) { gewaehlt = null; document.body.classList.remove('seite-offen'); zeichneSeite(); zeichneFuss(); return; }
    $('reihen').value = d.reihen; $('spalten').value = d.spalten;
    plaetzeEl.style.gridTemplateColumns = 'repeat(' + d.spalten + ', minmax(108px, 1fr))';
    plaetzeEl.innerHTML = '';
    for (const p of Object.keys(d.plaetze)) {
      const [r, c] = p.slice(1).split('p').map(Number);
      if (r > d.reihen || c > d.spalten || !finde(d.plaetze[p])) delete d.plaetze[p];
    }
    for (let r = 1; r <= d.reihen; r++) for (let c = 1; c <= d.spalten; c++) {
      const id = 'r' + r + 'p' + c, el = document.createElement('div'); el.className = 'platz'; el.dataset.platz = id;
      const nr = document.createElement('span'); nr.className = 'nr'; nr.textContent = r + '.' + c; el.append(nr);
      const sid = d.plaetze[id]; if (sid && finde(sid)) el.append(karte(finde(sid)));
      plaetzeEl.append(el);
    }
    ablageEl.innerHTML = '';
    const frei = schueler().filter((s) => !platzVon(s.id)).sort((a, b) => a.name.localeCompare(b.name, 'de'));
    frei.forEach((s) => ablageEl.append(karte(s)));
    $('ablageTitel').textContent = 'Noch ohne Platz (' + frei.length + ') – hierher ziehen nimmt eine Karte vom Platz';
    if (gewaehlt && !finde(gewaehlt)) gewaehlt = null;
    document.body.classList.toggle('seite-offen', !!gewaehlt);
    zeichneSeite(); zeichneFuss(); sichern();
  }

  function zeichneFuss() {
    const heute = schueler().filter((s) => eintraege(s.id, 'heute').some((e) => e.w)).length;
    $('heuteZahl').textContent = kd() ? 'Heute bewertet: ' + heute + ' von ' + schueler().length : '';
    const hatDaten = Object.values(st.klassen).some((k) => Object.values(k.protokoll).some((l) => l.length));
    const h = $('sicherungHinweis'); h.className = ''; h.textContent = '';
    if (hatDaten) {
      const tage = st.letzteSicherung ? Math.floor((Date.now() - st.letzteSicherung) / 864e5) : null;
      if (tage === null || tage >= 7) { h.className = 'warn'; h.textContent = '⚠ Letzte Sicherung: ' + (tage === null ? 'noch nie' : 'vor ' + tage + ' Tagen') + ' (Mehr … › Sicherung speichern)'; }
      else h.textContent = 'Letzte Sicherung: ' + new Date(st.letzteSicherung).toLocaleDateString('de-DE');
    }
    $('stand').textContent = 'Stand ' + STAND;
  }

  const notenZeigen = () => document.body.classList.contains('noten-zeigen');
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

    for (const k of st.kriterien) {
      const z = document.createElement('div'); z.className = 'kriterium';
      const t = document.createElement('div'); const je = nv.je[k.id];
      t.innerHTML = '<div class="kn"></div><div class="ks"></div>';
      t.querySelector('.kn').textContent = k.name + (k.gewicht !== 1 ? ' (×' + k.gewicht + ')' : '');
      t.querySelector('.ks').textContent = je ? je.n + (je.n === 1 ? ' Eintrag' : ' Einträge') + (notenZeigen() ? ' · Ø ' + komma(je.m) : '') : 'noch nichts';
      const w = document.createElement('div'); w.className = 'werte';
      for (const x of ['++', '+', 'o', '-', '--']) {
        const bt = document.createElement('button'); bt.className = 'wert'; bt.dataset.w = x; bt.textContent = ZEIG(x); bt.title = k.name + ': ' + ZEIG(x);
        bt.addEventListener('click', () => eintragen({ k: k.id, w: x })); w.append(bt);
      }
      z.append(t, w); seite.append(z);
    }
    const zb = document.createElement('div'); zb.className = 'zeile';
    zb.innerHTML = '<input type="text" placeholder="Bemerkung, z. B. hat den Druckverlust gut erklärt" enterkeyhint="done"><button>Notieren</button>';
    const inp = zb.querySelector('input');
    const notiere = () => { const v = inp.value.trim(); if (v) eintragen({ text: v }); };
    zb.querySelector('button').addEventListener('click', notiere);
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') notiere(); });
    seite.append(zb);
    const z2 = document.createElement('div'); z2.className = 'zeile';
    const ab = document.createElement('button'); ab.textContent = 'abwesend'; ab.addEventListener('click', () => eintragen({ text: 'abwesend', abw: true }));
    const fo = document.createElement('button'); fo.textContent = fotos.has(s.id) ? 'Foto ändern' : 'Foto aufnehmen'; fo.addEventListener('click', () => fotoOeffnen(s));
    const rk = document.createElement('button'); rk.textContent = '↶ Letzten Eintrag zurück'; rk.disabled = !(kd().protokoll[s.id] || []).length;
    rk.addEventListener('click', () => { const l = kd().protokoll[s.id]; if (l && l.length) l.pop(); zeichne(); });
    z2.append(ab, fo, rk); seite.append(z2);
    const pr = document.createElement('div'); pr.className = 'protokoll';
    const l = (kd().protokoll[s.id] || []).slice().reverse();
    if (!l.length) pr.innerHTML = '<span class="leise">Protokoll: noch keine Einträge.</span>';
    for (const e of l) {
      const d = document.createElement('div');
      const zeit = document.createElement('span'); zeit.className = 'zeit';
      zeit.textContent = new Date(e.zeit).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
      const inh = document.createElement('span');
      if (e.w) { const m = document.createElement('span'); m.className = 'marke'; m.style.background = WFARBE[e.w]; m.textContent = ZEIG(e.w); inh.append(m, ' ' + ((st.kriterien.find((k) => k.id === e.k) || {}).name || '(Kriterium entfernt)')); }
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
    if (!zug || modus !== 'bearbeiten') return;
    if (!zug.bewegt && Math.hypot(e.clientX - zug.x0, e.clientY - zug.y0) < 8) return;
    if (!zug.bewegt) { zug.bewegt = true; zug.geist = zug.k.cloneNode(true); zug.geist.classList.add('geist'); document.body.append(zug.geist); zug.k.classList.add('wird-gezogen'); }
    zug.geist.style.left = e.clientX + 'px'; zug.geist.style.top = e.clientY + 'px'; markiere(zielUnter(e.clientX, e.clientY));
  });
  const ende = (e) => {
    if (!zug) return; const z = zug; zug = null;
    if (!z.bewegt) { if (e.type === 'pointerup' && modus === 'bewerten') { gewaehlt = z.id; zeichne(); } return; }
    z.geist.remove(); z.k.classList.remove('wird-gezogen');
    const ziel = e.type === 'pointerup' ? zielUnter(e.clientX, e.clientY) : null; markiere(null);
    if (!ziel) return;
    const d = kd(), alt = platzVon(z.id);
    if (ziel.dataset.ablage) { if (alt) delete d.plaetze[alt]; }
    else {
      const neu = ziel.dataset.platz; if (neu === alt) return;
      const dort = d.plaetze[neu]; if (alt) delete d.plaetze[alt]; d.plaetze[neu] = z.id; if (dort && alt) d.plaetze[alt] = dort;
    }
    zeichne();
  };
  document.addEventListener('pointerup', ende); document.addEventListener('pointercancel', ende);

  // ---------- Werkzeugleiste ----------
  $('klasse').addEventListener('change', (e) => { st.klasse = e.target.value; gewaehlt = null; zeichne(); });
  document.querySelectorAll('.modus button').forEach((b) => b.addEventListener('click', () => {
    modus = b.dataset.m; document.querySelectorAll('.modus button').forEach((x) => x.classList.toggle('an', x === b));
    document.body.classList.toggle('bearbeiten', modus === 'bearbeiten');
    if (modus === 'bearbeiten') { gewaehlt = null; zeichne(); }
  }));
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
    ({ import: importOeffnen, klassen: klassenOeffnen, kriterien: kriterienOeffnen, sichern: sicherungSpeichern,
       laden: () => $('sicherungDatei').click(), beispiel: beispielAnlegen })[a.dataset.aktion]();
  });
  $('menueKnopf').addEventListener('click', () => $('menueDlg').showModal());

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
      xb.addEventListener('click', () => {
        if (!confirm(s.name + ' mit allen Bewertungen und dem Foto aus dieser Klasse entfernen?')) return;
        d.schueler = d.schueler.filter((y) => y.id !== s.id); const p = platzVon(s.id); if (p) delete d.plaetze[p];
        delete d.protokoll[s.id]; fotos.delete(s.id); DB.loesch('fotos', s.id).catch(() => {});
        if (gewaehlt === s.id) gewaehlt = null; zeichneKlassenDlg(); zeichne();
      });
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
    for (const s of d.schueler) { fotos.delete(s.id); DB.loesch('fotos', s.id).catch(() => {}); }
    delete st.klassen[st.klasse]; st.klasse = klassenSortiert()[0] || null; gewaehlt = null; zeichneKlassenDlg(); zeichne();
  });
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
  $('exportKnopf').addEventListener('click', () => { if (!kd()) { importOeffnen(); return; } zeichneExport(); $('exportDlg').showModal(); });
  $('zeitraum').addEventListener('change', zeichneExport);
  $('csvKnopf').addEventListener('click', () => {
    const esc = (x) => '"' + String(x).replace(/"/g, '""') + '"';
    const sp = $('spalteName').value.trim() || 'Projektkompetenz';
    const zeilen = [['E-Mail-Adresse', sp, 'Feedback'].map(esc).join(';')]
      .concat(exportZeilen().filter((r) => r.s.mail).map((r) => [r.s.mail, r.punkte, r.feedback].map(esc).join(';')));
    const datum = new Date().toISOString().slice(0, 10);
    dateiAbgeben('moodle-' + sauber(kd().name) + '-' + sauber(sp) + '-' + datum + '.csv', '﻿' + zeilen.join('\r\n'), 'text/csv');
  });

  // ---------- Foto aufnehmen, zuschneiden, speichern ----------
  const C = 600;
  const foto = { s: null, img: null, url: null, zoom: 1, ox: 0, oy: 0 };
  function fotoOeffnen(s) {
    foto.s = s; foto.img = null; $('fotoName').textContent = s.name; $('zuschnitt').hidden = true;
    $('fotoSpeichern').disabled = true; $('fotoLoeschen').hidden = !fotos.has(s.id); $('fotoDlg').showModal();
  }
  $('fotoKameraKnopf').addEventListener('click', () => $('fotoKamera').click());
  $('fotoDateiKnopf').addEventListener('click', () => $('fotoDatei').click());
  for (const inp of [$('fotoKamera'), $('fotoDatei')]) inp.addEventListener('change', () => { const f = inp.files && inp.files[0]; inp.value = ''; if (f) fotoLaden(f); });
  function fotoLaden(datei) {
    if (foto.url) URL.revokeObjectURL(foto.url);
    foto.url = URL.createObjectURL(datei);
    const img = new Image();
    img.onload = () => { foto.img = img; foto.zoom = 1; foto.ox = 0; foto.oy = 0; $('fotoZoom').value = 1; $('zuschnitt').hidden = false; $('fotoSpeichern').disabled = false; fotoZeichnen(); };
    img.onerror = () => alert('Dieses Bild lässt sich nicht öffnen.');
    img.src = foto.url;
  }
  const fotoMass = () => { const i = foto.img, sc = Math.max(C / i.naturalWidth, C / i.naturalHeight) * foto.zoom; return { w: i.naturalWidth * sc, h: i.naturalHeight * sc }; };
  const fotoBegrenzen = () => { const m = fotoMass(), mx = (m.w - C) / 2, my = (m.h - C) / 2; foto.ox = Math.max(-mx, Math.min(mx, foto.ox)); foto.oy = Math.max(-my, Math.min(my, foto.oy)); };
  const fotoMalen = (ctx, g) => { const m = fotoMass(), f = g / C; ctx.drawImage(foto.img, (C / 2 - m.w / 2 + foto.ox) * f, (C / 2 - m.h / 2 + foto.oy) * f, m.w * f, m.h * f); };
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
    fotos.set(foto.s.id, daten); $('fotoDlg').close(); zeichne();
  });
  $('fotoLoeschen').addEventListener('click', async () => {
    if (!foto.s || !confirm('Foto von ' + foto.s.name + ' entfernen?')) return;
    await DB.loesch('fotos', foto.s.id).catch(() => {}); fotos.delete(foto.s.id); $('fotoDlg').close(); zeichne();
  });
  $('fotoDlg').addEventListener('close', () => { if (foto.url) { URL.revokeObjectURL(foto.url); foto.url = null; } foto.img = null; $('fotoCanvas').getContext('2d').clearRect(0, 0, C, C); });

  // ---------- Sicherung ----------
  async function sicherungSpeichern() {
    const jetzt = Date.now();
    const daten = JSON.stringify({ app: 'klassen-app', art: 'sicherung', stand: STAND, erstellt: new Date(jetzt).toISOString(), zustand: Object.assign({}, st, { letzteSicherung: jetzt }), fotos: Object.fromEntries(fotos) });
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
      for (const [k, v] of Object.entries(s.fotos || {})) { await DB.schreib('fotos', k, v); fotos.set(k, v); }
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

  // ---------- Start ----------
  async function start() {
    $('stand').textContent = 'Stand ' + STAND;
    try {
      const z = await DB.lies('kv', 'zustand');
      if (z && z.klassen) st = Object.assign(grund(), z);
      for (const [k, v] of await DB.alle('fotos')) fotos.set(k, v);
    } catch (e) {
      banner('Auf diesem Gerät kann die App nichts speichern (privates Surfen?). Bewertungen gehen beim Schließen verloren.');
    }
    if (!st.klassen[st.klasse]) st.klasse = klassenSortiert()[0] || null;
    zeichne();
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  window.__klassenApp = { stand: STAND, zustand: () => st, fotoAnzahl: () => fotos.size };
  start();
})();
