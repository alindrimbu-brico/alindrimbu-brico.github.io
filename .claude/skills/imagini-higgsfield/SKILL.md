---
name: imagini-higgsfield
description: "Generează imagini (și clipuri scurte) prin conectorul Higgsfield din abonamentul lui Alin (plan Ultimate), pentru două fluxuri: vizualuri YouTube pentru melodiile Suno (imagine statică 16:9, thumbnail, banner, avatar) și imagini pentru produsele Etsy TheFireThatKnows (fundaluri lifestyle, designuri noi, mockup-uri). Use for 'imagine pentru melodie', 'coperta YouTube', 'thumbnail', 'banner canal', 'fundal lifestyle', 'poze Etsy', 'design cană/poster/tote', 'generează cu Higgsfield', 'Hillsfig'."
---

# imagini-higgsfield

Generare de imagini prin **conectorul Higgsfield** (MCP `mcp__Higgsfield__*`), plătite din creditele abonamentului
lui Alin. Fără chei API, fără Google, fără OpenAI. Validat pe 19 sept 2026: 3 imagini 16:9 pentru YouTube, 6 credite.

## Cont și pornire (o singură dată pe sesiune)
1. `list_workspaces` → spațiul privat **9e73c2c9-897b-48f2-8995-307ec861f3c3** (plan `ultimate`). `select_workspace` cu acest id — fără el generările eșuează tăcut.
2. `balance` → spune-i lui Alin creditele înainte și după.
3. Dacă lipsesc uneltele Higgsfield: `ToolSearch` cu `+higgsfield generate image`. Dacă serverul e „failed to connect”, reîncearcă o dată, apoi spune-i.

## Regula de cost (regula casei)
- Înainte de generare: `generate_image` cu `get_cost: true` → cost exact. Spune modelul, costul și soldul.
- Sub **10 credite** și cererea lui Alin e explicită („fă-mi o imagine…”): generează direct, nu mai întreba.
- Peste 10 credite, sau video, sau mai mult de 4 imagini: cere „go”.
- Nu regenera același prompt pe același model după un refuz de conținut: schimbă promptul sau modelul.

## Costuri măsurate (credite)
| Model | Setări | Credite / imagine |
|---|---|---|
| `gpt_image_2` | 2k, medium, 16:9 | 2 |
| `nano_banana_pro` | 2k, 16:9 | 2 |
| `gpt_image_2_5` | 1k, low | ~1 (implicitul conectorului) |
| video `seedance_1_5` | 480p, 4 s | ~2,4 (pune `duration` explicit, altfel 12 s) |
Numerele se schimbă; verifică cu `get_cost`.

## Ce model pentru ce
| Nevoie | Model | De ce |
|---|---|---|
| Imagine statică pentru videoclip, fără text | `gpt_image_2` 2k medium **sau** `nano_banana_pro` 2k | ambele au ieșit bine; GPT mai pictural, Nano mai „poster” |
| Text pe imagine (thumbnail, titlu, banner) | `gpt_image_2` / `gpt_image_2_5` | cel mai bun la litere; pune textul exact în ghilimele |
| Logo / iconiță vectorială | `recraft_v4_1` cu `model_type: vector`, `colors` | ieșire curată, paletă controlată |
| Fundal transparent direct | `gpt_image_2_5` cu `background: transparent` | pentru elemente de compus |
| Eliminare fundal | `image_background_remover` | dedicat |
| Mărire 2K/4K | `bytedance_image_upscale` (4k) sau `topaz_image` | pentru print / YouTube 4K |
| Extindere cadru | `outpaint_image` (tool dedicat) sau `flux_2_pro_outpaint` | schimbi formatul fără să tai |
| Retuș pe zonă | `nano_banana_2` cu `is_inpaint: true` + mască | |
| Același personaj în mai multe scene | `nano_banana_pro` cu `medias` (rol `image_references`) | trimite fișa de personaj ca referință |
| Clip scurt din imagine | `generate_video` `seedance_1_5`, rol `start_image`, `duration: 4` | mișcare subtilă pentru „lyric video” |

## Mecanica
- Mai multe imagini diferite: `generate_image_batch` (până la 12) → `jobs_wait` (repetă la 10 s până `all_terminal`) → **o singură** `show_generation_by_ids` cu toate job-urile. O singură imagine sau variante ale aceluiași prompt: `generate_image` cu `count`.
- Rezultatul: `rawUrl` (PNG plin), nu `minUrl` (webp mic). Scrie link-urile în răspuns; Alin descarcă din galeria Higgsfield sau din link.
- **Mediul cloud nu poate descărca de pe cloudfront** (proxy 403). Pe laptop (Claude Code local) merge `curl`. Dacă trebuie procesat local (decupaj, compunere), lucrează pe laptop.
- Imagini de referință de la Alin: `media_upload_widget` (singura unealtă în acel tur), apoi `media_id` în `medias`. Un `media_id` sau `job_id` anterior se refolosește ca referință fără reîncărcare.
- Prompturile în engleză, chiar dacă discuția e în română. Fără text în imagine dacă nu e cerut: încheie cu „No text, no letters, no logos, no watermark.”

## Fluxul 1 — YouTube (melodii Suno, stiluri braziliene, versuri în portugheză)
Canal cu melodii; fiecare videoclip = imagine statică pe toată durata.
1. **Imagine statică 16:9** (2688×1520 sau 2752×1536): scenă în stilul melodiei, veselie/dans, culori saturate, fără text. Trei variante → Alin alege. Exemple validate (job-uri din 19 sept 2026):
   - Carnaval Rio, GPT Image 2: `b0be1941-c38d-4fbd-8e92-3a38fa9b6a82` (ales)
   - Petrecere de stradă Salvador da Bahia, GPT Image 2: `9242162c-29fb-48f5-ab8a-0fc7bbffeb62` (ales)
   - Afiș folk cordel, Nano Banana Pro: `d1ebc2c3-9ef0-4d5f-bece-c998b5e39e52`
   Schelet de prompt: `[scenă concretă: loc, oameni, instrumente, ce fac], wide 16:9 composition for a music video still, [lumină], [paletă], festive/joyful mood, painterly digital illustration, highly detailed. No text, no letters, no logos, no watermark.`
   Adaptează scena la stilul melodiei: samba/carnaval → Rio; forró → nord-est, acordeon, zabumba, triangul, festa junina; bossa nova → Ipanema la apus, chitară, liniște; axé → Salvador, trio elétrico; sertanejo → fermă, pălării, chitară, apus; funk carioca → favela colorată noaptea, neon.
2. **Thumbnail 16:9 cu text**: `gpt_image_2` 2k, promptul conține `The image must contain the exact text "TITLU" rendered clearly…`, text mare, contrast puternic, 2–4 cuvinte. Sau: imaginea statică + textul pus în editorul din `/atelier/` (Editor tip Canva), fără credite.
3. **Banner canal**: 16:9 la 2k, apoi `bytedance_image_upscale` 4k → 2560×1440; elementele importante în centrul de 1546×423 (zona sigură YouTube). **Avatar**: 1:1, `gpt_image_2`.
4. **Variantă animată (opțional)**: `generate_video` `seedance_1_5`, `medias: [{value: <job_id imagine>, role: "start_image"}]`, `duration: 4`, prompt „subtle camera drift, confetti floating, dancers swaying gently, seamless loop”. Alin o pune pe loop în editorul video.
5. Scrie în `jurnal.md` (lângă acest fișier): data, melodia, job_id, model, cost, ales/neales.

## Fluxul 2 — Etsy (TheFireThatKnows, vezi skill-ul `etsy-pod-publisher`)
Reguli moștenite de acolo: **produsul nu se generează cu AI** (printul rămâne cel real, decupat din mockup-ul Printify); AI-ul face fundaluri, designuri noi și materiale de promovare. Identitatea HARMONY: crem/olive, Lora, emblemă.
1. **Fundaluri lifestyle** pentru `lifestyle.py` (`assets/bg/`): `gpt_image_2_5` sau `gpt_image_2`, format 4:3 (Etsy 2700×2025) sau 1:1, prompt cu „**no product in frame, empty centre** where a mug will be composited, shallow depth of field, soft natural light”, scene: masă de lemn cu lumină de dimineață, raft cu cărți și plantă, pervaz cu ceai, pătură crem și lumânare, birou de lucru minimal. Paletă crem/olive/lemn cald. Generezi o dată 3–5 fundaluri și le refolosești.
2. **Designuri noi de produs** (poster, tote, tricou): `recraft_v4_1` (`vector` sau `utility_vector`, `colors` din paleta HARMONY) pentru grafică plată; `gpt_image_2` pentru text tipografic al maximelor (textul exact în ghilimele, verifică ortografia). Salvează PNG la rezoluția zonei de print din spec (vezi blueprint-urile în `etsy-pod-publisher`).
3. **Mockup-uri de prezentare** (a 5-a, a 6-a poză din listing, nu primele două): `nano_banana_pro` cu designul ca referință + „the EXACT design from the reference image printed on a [produs], realistic fabric texture, lifestyle setting”. Doar pentru poze secundare; primele poze rămân cele reale.
4. **Poze pentru Pinterest/Instagram** ale produselor: 2:3 (Pinterest) și 4:5 (Instagram) prin `outpaint_image` din poza reală, apoi text în editorul din `/atelier/`.
5. Livrare: link-urile `rawUrl` + jurnal. Urcarea pe Etsy o face `etsy-pod-publisher` (`lifestyle.py`, `etsy_client.py`), la „go”.

## Atelierul web (fără credite Higgsfield)
`https://arhitecturazilei.ro/atelier/` — editor cu straturi și text, eliminare fundal locală, upscaling local 2×/4×, export PDF pentru KDP. Folosește-l pentru finisaje gratuite după ce Higgsfield a generat imaginea.

## Model / efort
Rutina (o imagine, un set de fundaluri, un thumbnail) merge pe un model mic. Fable / efort mare doar când se construiește un flux nou sau se compun mai multe referințe.
