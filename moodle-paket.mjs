// Baut das Paket für das Moodle-Datei-Element der Klassen-App (Lehrer-Kurs 3197, Element 110049).
// Aufruf: node moodle-paket.mjs <zielordner>
//  - index.html ohne Manifest-Verweis (den holt der Browser ohne Anmeldung → Umleitung zur Moodle-Anmeldung)
//  - app.js und app.css mit „?v=<STAND>“: Moodle liefert unter jeder alten Revisionsadresse (…/content/<n>/) schon die neuen
//    Dateien aus, Browser speichern sie aber 6 Stunden zwischen. Ohne Anhang passten neue Seite und altes Programm nicht
//    zusammen (27.11.2026: Knopf „Klasse aus SHK City …“ ohne Wirkung in Firefox).
//  - Icons unverändert, kein Service Worker (die Moodle-Fassung braucht beim Start Moodle).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const quelle = path.dirname(fileURLToPath(import.meta.url));
const ziel = process.argv[2];
if (!ziel) { console.error('Aufruf: node moodle-paket.mjs <zielordner>'); process.exit(2); }

const appJs = fs.readFileSync(path.join(quelle, 'app.js'), 'utf8');
const stand = (appJs.match(/const STAND = '([^']+)'/) || [])[1];
if (!stand) { console.error('STAND in app.js nicht gefunden'); process.exit(1); }

let html = fs.readFileSync(path.join(quelle, 'index.html'), 'utf8');
html = html.split('\n').filter((z) => !/rel="manifest"/.test(z)).join('\n');
const vorher = html;
html = html.replace('href="app.css"', 'href="app.css?v=' + stand + '"').replace('src="app.js"', 'src="app.js?v=' + stand + '"');
if (html === vorher || !html.includes('app.js?v=' + stand) || !html.includes('app.css?v=' + stand)) { console.error('Verweise auf app.js/app.css nicht gefunden'); process.exit(1); }

fs.rmSync(ziel, { recursive: true, force: true });
fs.mkdirSync(path.join(ziel, 'icons'), { recursive: true });
fs.writeFileSync(path.join(ziel, 'index.html'), html);
fs.copyFileSync(path.join(quelle, 'app.js'), path.join(ziel, 'app.js'));
fs.copyFileSync(path.join(quelle, 'app.css'), path.join(ziel, 'app.css'));
for (const f of ['icon-180.png', 'icon-192.png', 'icon-512.png']) fs.copyFileSync(path.join(quelle, 'icons', f), path.join(ziel, 'icons', f));
console.log('Moodle-Paket Stand ' + stand + ' in ' + ziel + ' (ohne Manifest, app.js/app.css mit ?v=' + stand + ')');
