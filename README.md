# Arhitectura Zilei

Rutină zilnică fundamentată pe neuroștiință, cu protocol de vizualizare ghidat, respirație dirijată,
jurnal și tracker de progres. Site static, fără build, fără dependențe de server.

**Live:** https://arhitecturazilei.ro

## Structura

```
index.html          versiunea în română   (https://arhitecturazilei.ro/)
en/index.html       versiunea în engleză  (https://arhitecturazilei.ro/en/)
calendar/index.html rutina în calendar    (https://arhitecturazilei.ro/calendar/)
atelier/            Atelier AI            (https://arhitecturazilei.ro/atelier/)
404.html            pagina de eroare
CNAME               domeniul propriu, citit de GitHub Pages
robots.txt          permite indexarea, indică sitemap-ul
sitemap.xml         cele două adrese, cu alternative hreflang
site.webmanifest    instalare pe telefon (Add to Home Screen)
favicon.svg         iconița din tab
og.png              imaginea de previzualizare la partajare (1200×630)
apple-touch-icon.png, icon-192.png, icon-512.png
.nojekyll           oprește procesarea Jekyll pe GitHub Pages
```

Fiecare pagină este completă în sine: HTML, CSS și JavaScript într-un singur fișier, cu conținutul
rutinei pregătit static în HTML (deci vizibil pentru motoarele de căutare și fără JavaScript).
Singurele resurse externe sunt fonturile de la Google Fonts.

## Cum modific textul

Conținutul stă în blocul `<script>` de la finalul fiecărei pagini, în structurile `BLOCKS`, `VIZ`,
`PATTERNS`, `PRINCIPLES`, `JOURNAL` și `UI`. Fiecare text este o pereche `["română", "english"]`.
După modificare, aceeași schimbare trebuie făcută în ambele fișiere (`index.html` și `en/index.html`),
pentru că fiecare are conținutul pregătit static în HTML.

## Datele utilizatorului

Bifările, jurnalul, seria, limba și tema se salvează în `localStorage`, sub cheia
`arhitectura-zilei.v1`, în browserul vizitatorului. Nu există server, cont sau colectare de date.

## Publicare

Orice commit pe branch-ul `main` este publicat automat de GitHub Pages în circa un minut.

## Atelier AI (`/atelier/`)

Atelier de design AI cu peste 30 de instrumente, construit după oferta Artistly.ai (text în imagine, logo,
tricouri, thumbnail-uri, coperți, pagini de colorat, personaj consistent, storybook cu export PDF pentru KDP,
mockup de produs, inpainting, extindere, eliminare fundal, upscaling, editor cu straturi, clipart în masă).
Rulează integral în browser, fără server și fără cont: utilizatorul își pune propria cheie API
(Google Gemini sau OpenAI), cererile pleacă direct la furnizor.

```
atelier/index.html      pagina de prezentare + aplicația
atelier/atelier.css     stiluri (aceleași tokens ca restul site-ului)
atelier/atelier.js      motorul: furnizori AI, registrul de instrumente, interfața
atelier/vendor/         fabric.js 5.3.0 (editor), jsPDF 2.5.1 (export KDP), JSZip 3.10.1 (export ZIP)
```

Cheile și setările stau în `localStorage` (cheia `atelier-ai.v1`); imaginile, personajele și cărțile în
IndexedDB (`atelier-ai`). Eliminarea fundalului folosește `@imgly/background-removal` încărcat la cerere de pe
jsDelivr și rulat local; dacă nu se poate încărca, există varianta prin modelul AI.

Instrumentele noi se adaugă în lista `TOOLS` din `atelier.js`: un instrument generic are `fields` (formularul)
și `build(v)` (promptul); unul cu interfață proprie are `custom: true` și o funcție în `CUSTOM[id]`.

## Skill: imagini-higgsfield (`.claude/skills/imagini-higgsfield/`)

Rețetele de generare de imagini prin conectorul Higgsfield (YouTube pentru melodiile Suno, imagini pentru Etsy),
cu costuri măsurate, modele recomandate și jurnalul generărilor. Se încarcă automat în Claude Code în acest repo;
pentru claude.ai se urcă folderul ca skill personalizat.
