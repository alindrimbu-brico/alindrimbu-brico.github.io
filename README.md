# Arhitectura Zilei

Rutină zilnică fundamentată pe neuroștiință, cu protocol de vizualizare ghidat, respirație dirijată,
jurnal și tracker de progres. Site static, fără build, fără dependențe de server.

**Live:** https://arhitecturazilei.ro

## Structura

```
index.html          versiunea în română   (https://arhitecturazilei.ro/)
en/index.html       versiunea în engleză  (https://arhitecturazilei.ro/en/)
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
