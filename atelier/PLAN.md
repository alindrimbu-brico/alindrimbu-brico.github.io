# Atelier AI — plan spre versiunea de vânzare (tip Artistly)

Stare la 2026-09-19: `/atelier/` este o pagină statică completă (35 instrumente, 50 stiluri), în care
utilizatorul își aduce propria cheie API (Google Gemini sau OpenAI). Nu are conturi, plată sau motor propriu.

## Decizii de luat înainte de start
- Nume + domeniu (10–15 €/an).
- Model de preț: abonament lunar sau pachete de credite. NU „pe viață” fără limită: o imagine costă ~0,04 $ la Google.
- Cont Stripe (necesită firmă/PFA pentru încasări).
- Motor de generare din spate: Google Gemini (implicit) sau API-ul Higgsfield plătit la utilizare (de evaluat).

## Etape
1. **Publicare**: merge branch `claude/artistly-ai-research-2ke0jf` → `main`; domeniu propriu pe GitHub Pages sau Vercel.
2. **Conturi + bază de date**: Supabase (auth, Postgres, storage). Frontend-ul actual rămâne; se adaugă login.
3. **Motor propriu**: funcții server (Vercel) care primesc promptul de la `atelier.js` și apelează Gemini/OpenAI
   cu cheile noastre. Providerul din `atelier.js` devine „server” (același contract: generate/edit/text).
4. **Limite și credite**: tabel de consum per utilizator, plafon zilnic, blocare la epuizare.
5. **Stripe**: checkout, webhook, activare plan/credite.
6. **Galerie pe server**: imaginile în Supabase Storage în loc de IndexedDB.
7. **Legal**: termeni, confidențialitate, rambursare, GDPR; pagini în site.
8. **Restul instrumentelor pe server** (câteva per sesiune), panou de administrare, statistici.

## Estimare
- MVP vandabil (etapele 1–6): 5–8 sesiuni, 2–3 săptămâni.
- Versiune completă: încă 3–4 săptămâni.

## Costuri lunare orientative
Domeniu 1 €/lună · Vercel 0–20 € · Supabase 0–25 € · Stripe 1,5 % + 0,25 €/tranzacție · generare ~0,04 $/imagine.
