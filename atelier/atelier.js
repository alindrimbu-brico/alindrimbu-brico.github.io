/* Atelier AI — atelier de design AI care rulează în browser, cu cheia API a utilizatorului.
   Fără server. Cheile stau în localStorage, imaginile în IndexedDB. */
(() => {
'use strict';

/* =====================================================================
   1. Utilitare
   ===================================================================== */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const el = (tag, attrs = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v;
    else if (k === 'html') n.innerHTML = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (v === true) n.setAttribute(k, '');
    else if (v !== false && v != null) n.setAttribute(k, v);
  }
  for (const k of kids.flat()) if (k != null) n.append(k.nodeType ? k : document.createTextNode(String(k)));
  return n;
};
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

let toastT;
function toast(msg, ms = 2600) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), ms);
}

async function pool(tasks, limit, onEach) {
  const out = new Array(tasks.length); let i = 0;
  const worker = async () => { while (i < tasks.length) { const k = i++; try { out[k] = await tasks[k](); } catch (e) { out[k] = { error: e }; } onEach && onEach(k, out[k]); } };
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
  return out;
}

/* ---- imagini ---- */
const fileToDataURL = f => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(f); });
const loadImage = src => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('Imaginea nu a putut fi citită')); i.src = src; });
function dataURLParts(d) { const m = /^data:([^;]+);base64,(.*)$/s.exec(d); return m ? { mime: m[1], b64: m[2] } : null; }
function dataURLtoBlob(d) { const p = dataURLParts(d); const bin = atob(p.b64); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return new Blob([u], { type: p.mime }); }
async function fitDataURL(d, maxSide = 1536, mime = 'image/png') {
  const img = await loadImage(d);
  if (img.width <= maxSide && img.height <= maxSide && (mime === 'image/png' ? d.startsWith('data:image/png') : true)) return d;
  const s = Math.min(1, maxSide / Math.max(img.width, img.height));
  const c = document.createElement('canvas'); c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
  const x = c.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL(mime, 0.92);
}
function download(dataUrl, name) { const a = el('a', { href: dataUrl, download: name }); document.body.append(a); a.click(); a.remove(); }
const stamp = () => new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');

/* ---- încărcare lazy a bibliotecilor externe ---- */
const libs = {};
function loadScript(url) {
  return libs[url] ||= new Promise((res, rej) => { const s = el('script', { src: url }); s.onload = res; s.onerror = () => rej(new Error('Nu am putut încărca ' + url)); document.head.append(s); });
}
const LIB = {
  fabric: 'vendor/fabric.min.js',
  jspdf: 'vendor/jspdf.umd.min.js',
  jszip: 'vendor/jszip.min.js',
  imgly: 'https://cdn.jsdelivr.net/npm/@imgly/background-removal@1.5.5/+esm',
};

/* =====================================================================
   2. Stocare: setări (localStorage) + galerie/personaje/cărți (IndexedDB)
   ===================================================================== */
const SKEY = 'atelier-ai.v1';
const defaults = { provider: 'gemini', keys: { gemini: '', openai: '' }, models: { gemini: 'gemini-2.5-flash-image', openai: 'gpt-image-1.5' }, custom: { gemini: '', openai: '' }, text: { gemini: 'gemini-2.5-flash', openai: 'gpt-4.1-mini' }, quality: 'medium', theme: 'auto', lastTool: 'prompt' };
let S;
try { S = Object.assign({}, defaults, JSON.parse(localStorage.getItem(SKEY) || '{}')); S.keys = Object.assign({}, defaults.keys, S.keys); S.models = Object.assign({}, defaults.models, S.models); S.custom = Object.assign({}, defaults.custom, S.custom); S.text = Object.assign({}, defaults.text, S.text); } catch { S = structuredClone(defaults); }
const saveS = () => { try { localStorage.setItem(SKEY, JSON.stringify(S)); } catch {} };
const imageModel = () => S.models[S.provider] === 'custom' ? (S.custom[S.provider] || defaults.models[S.provider]) : S.models[S.provider];
const hasKey = () => !!S.keys[S.provider];
const isGeminiPro = () => S.provider === 'gemini' && /pro/i.test(imageModel());

const DB = (() => {
  let dbp;
  const open = () => dbp ||= new Promise((res, rej) => {
    const r = indexedDB.open('atelier-ai', 1);
    r.onupgradeneeded = () => { const d = r.result; for (const s of ['images', 'characters', 'books']) if (!d.objectStoreNames.contains(s)) d.createObjectStore(s, { keyPath: 'id' }); };
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
  const tx = async (store, mode, fn) => { const d = await open(); return new Promise((res, rej) => { const t = d.transaction(store, mode); const q = fn(t.objectStore(store)); t.oncomplete = () => res(q.result); t.onerror = () => rej(t.error); }); };
  return {
    put: (s, v) => tx(s, 'readwrite', o => o.put(v)),
    del: (s, id) => tx(s, 'readwrite', o => o.delete(id)),
    clear: s => tx(s, 'readwrite', o => o.clear()),
    all: async s => (await tx(s, 'readonly', o => o.getAll())) || [],
    get: (s, id) => tx(s, 'readonly', o => o.get(id)),
  };
})();

/* =====================================================================
   3. Furnizori AI (apeluri directe din browser)
   ===================================================================== */
async function readErr(r) {
  let msg = `${r.status} ${r.statusText}`;
  try { const j = await r.json(); msg = j.error?.message || j.message || JSON.stringify(j).slice(0, 300); } catch {}
  if (r.status === 401 || r.status === 403) msg = 'Cheie API respinsă (' + r.status + '). Verifică cheia în setări. ' + msg;
  if (r.status === 429) msg = 'Limită de rată atinsă (429). Așteaptă un minut sau activează facturarea la furnizor. ' + msg;
  return new Error(msg);
}
const RATIO_SIZES = { '1:1': [1024, 1024], '4:5': [1024, 1280], '3:4': [1024, 1365], '2:3': [1024, 1536], '9:16': [1024, 1820], '16:9': [1820, 1024], '3:2': [1536, 1024], '4:3': [1365, 1024], '21:9': [2048, 878] };
const openaiSize = ratio => { const [w, h] = RATIO_SIZES[ratio] || [1024, 1024]; return w === h ? '1024x1024' : (w > h ? '1536x1024' : '1024x1536'); };

const Gemini = {
  async call(model, parts, generationConfig, signal) {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST', signal, headers: { 'Content-Type': 'application/json', 'x-goog-api-key': S.keys.gemini },
      body: JSON.stringify({ contents: [{ role: 'user', parts }], generationConfig }),
    });
    if (!r.ok) throw await readErr(r);
    const j = await r.json();
    const c = j.candidates?.[0];
    if (!c) throw new Error(j.promptFeedback?.blockReason ? 'Blocat de filtrul de siguranță (' + j.promptFeedback.blockReason + '). Reformulează promptul.' : 'Răspuns gol de la model.');
    const ps = c.content?.parts || [];
    return { imgs: ps.filter(p => p.inlineData).map(p => `data:${p.inlineData.mimeType};base64,${p.inlineData.data}`), text: ps.filter(p => p.text).map(p => p.text).join('\n'), finish: c.finishReason };
  },
  async generate({ prompt, refs = [], ratio = '1:1', n = 1, size, signal, onOne }) {
    const model = imageModel();
    const parts = [];
    for (const d of refs) { const p = dataURLParts(await fitDataURL(d, 1536)); parts.push({ inlineData: { mimeType: p.mime, data: p.b64 } }); }
    parts.push({ text: prompt });
    const cfg = { responseModalities: ['TEXT', 'IMAGE'], imageConfig: { aspectRatio: ratio } };
    if (size && /pro/i.test(model)) cfg.imageConfig.imageSize = size;
    const out = await pool(Array.from({ length: n }, () => async () => {
      const r = await this.call(model, parts, cfg, signal);
      if (!r.imgs.length) throw new Error(r.text ? 'Modelul a răspuns cu text, nu cu imagine: ' + r.text.slice(0, 200) : 'Nicio imagine returnată (' + (r.finish || '') + ').');
      return r.imgs[0];
    }), 2, (i, v) => onOne && onOne(v));
    const errs = out.filter(o => o && o.error); const imgs = out.filter(o => typeof o === 'string');
    if (!imgs.length) throw errs[0].error;
    return imgs;
  },
  async text(prompt, { json = false, signal } = {}) {
    const cfg = json ? { responseMimeType: 'application/json', temperature: 0.8 } : { temperature: 0.7 };
    const r = await this.call(S.text.gemini || 'gemini-2.5-flash', [{ text: prompt }], cfg, signal);
    return r.text;
  },
  async test() { await this.call(S.text.gemini || 'gemini-2.5-flash', [{ text: 'Reply with the single word OK.' }], {}); },
};

const OpenAI = {
  H() { return { Authorization: 'Bearer ' + S.keys.openai }; },
  async generate({ prompt, refs = [], mask, ratio = '1:1', n = 1, signal, onOne }) {
    const model = imageModel(); const size = openaiSize(ratio);
    let r;
    if (refs.length || mask) {
      const fd = new FormData();
      fd.append('model', model); fd.append('prompt', prompt); fd.append('n', String(n)); fd.append('size', size); fd.append('quality', S.quality);
      for (const [i, d] of refs.entries()) fd.append('image[]', dataURLtoBlob(await fitDataURL(d, 1536)), `ref${i}.png`);
      if (mask) fd.append('mask', dataURLtoBlob(mask), 'mask.png');
      r = await fetch('https://api.openai.com/v1/images/edits', { method: 'POST', signal, headers: this.H(), body: fd });
    } else {
      r = await fetch('https://api.openai.com/v1/images/generations', { method: 'POST', signal, headers: { ...this.H(), 'Content-Type': 'application/json' }, body: JSON.stringify({ model, prompt, n, size, quality: S.quality, output_format: 'png' }) });
    }
    if (!r.ok) throw await readErr(r);
    const j = await r.json();
    const imgs = (j.data || []).map(d => d.b64_json ? 'data:image/png;base64,' + d.b64_json : d.url).filter(Boolean);
    if (!imgs.length) throw new Error('Nicio imagine returnată.');
    imgs.forEach(i => onOne && onOne(i));
    return imgs;
  },
  async text(prompt, { json = false, signal } = {}) {
    const body = { model: S.text.openai || 'gpt-4.1-mini', messages: [{ role: 'user', content: prompt }], temperature: 0.8 };
    if (json) body.response_format = { type: 'json_object' };
    const r = await fetch('https://api.openai.com/v1/chat/completions', { method: 'POST', signal, headers: { ...this.H(), 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!r.ok) throw await readErr(r);
    return (await r.json()).choices?.[0]?.message?.content || '';
  },
  async test() { const r = await fetch('https://api.openai.com/v1/models?limit=1', { headers: this.H() }); if (!r.ok) throw await readErr(r); },
};
const P = () => S.provider === 'openai' ? OpenAI : Gemini;
function requireKey() { if (!hasKey()) { openSettings(); throw new Error('Pune mai întâi cheia API în setări.'); } }

/* Prompt enhancer (Smart Prompt Enhancer) */
async function enhancePrompt(idea, extra = '') {
  const p = `You are a prompt engineer for text-to-image models. Rewrite the idea below into ONE detailed English prompt of at most 90 words: subject, setting, composition, lighting, colour palette, mood, medium/style. Keep the user's intent. Keep any text in quotation marks EXACTLY as written and say it must be rendered legibly. Do not add explanations. ${extra}\n\nIdea: ${idea}\n\nPrompt:`;
  const out = (await P().text(p)).trim().replace(/^prompt:\s*/i, '').replace(/^["“]|["”]$/g, '');
  return out || idea;
}
function parseJSON(s) { const m = /\{[\s\S]*\}/.exec(s); return JSON.parse(m ? m[0] : s); }

/* =====================================================================
   4. Stiluri, formate, registrul de instrumente
   ===================================================================== */
const STYLES = [
  ['none', 'Fără stil', ''],
  ['photoreal', 'Fotorealist', 'photorealistic, ultra detailed, natural lighting, shot on a full-frame camera, 85mm lens'],
  ['cinematic', 'Cinematic', 'cinematic still, dramatic lighting, shallow depth of field, film grain, anamorphic'],
  ['product', 'Foto de produs', 'studio product photography, softbox lighting, clean seamless background, sharp focus'],
  ['children', 'Desen de copil', "children's drawing, crayon and marker on paper, naive, playful"],
  ['oldschool', 'Old school', 'old school vintage illustration, halftone, muted palette, 1950s print'],
  ['pixel', 'Pixel art', 'pixel art, 32-bit, crisp pixels, limited palette'],
  ['comic', 'Comic book', 'comic book art, bold ink outlines, halftone shading, dynamic'],
  ['cartoon', 'Cartoon', 'cartoon style, clean bold outlines, flat bright colours, expressive'],
  ['storybook', 'Storybook', "children's storybook illustration, soft painterly textures, warm, whimsical"],
  ['minimal', 'Minimalist', 'minimalist, lots of negative space, simple geometric shapes, restrained palette'],
  ['retrogame', 'Retro game', 'retro video game art, 16-bit sprite aesthetic, arcade colours'],
  ['origami', 'Origami', 'origami paper craft, folded paper, visible creases, soft studio light'],
  ['amcomic', 'Comic american', 'american superhero comic art, dramatic inking, vivid primary colours'],
  ['vector', 'Ilustrație vectorială', 'flat vector illustration, clean shapes, no gradients, crisp edges, SVG look'],
  ['pixar', '3D Pixar', '3D animated movie style, Pixar-like rendering, subsurface scattering, expressive big eyes, soft global illumination'],
  ['collage', 'Colaj', 'mixed media collage, cut paper, torn edges, layered textures'],
  ['robots', 'Roboți futuriști', 'futuristic robots, sleek sci-fi hard surface design, neon accents'],
  ['miniature', 'Miniatură', 'tilt-shift miniature diorama, tiny world, macro photography'],
  ['nailart', 'Nail art', 'nail art design, glossy, close-up manicure photography'],
  ['storyboard', 'Schiță storyboard', 'storyboard sketch, rough pencil, grey markers, film pre-production'],
  ['vangogh', 'Van Gogh', 'in the manner of post-impressionism, thick swirling brushstrokes, vivid complementary colours'],
  ['flat2d', '2D flat', '2D flat design, geometric, pastel palette, no outlines'],
  ['impasto', 'Ulei impasto', 'impasto oil painting, thick visible palette-knife strokes, rich texture'],
  ['stained', 'Vitraliu', 'stained glass window, black lead lines, luminous coloured glass'],
  ['oil', 'Pictură în ulei', 'classical oil painting, canvas texture, chiaroscuro, museum quality'],
  ['gamechar', 'Personaje de joc', 'video game character concept art, full body, detailed costume, turnaround'],
  ['manga', 'Manga', 'manga style, black and white ink, screentones, expressive lines'],
  ['dashcam', 'Dashcam', 'dashcam footage still, wide angle, slight motion blur, realistic'],
  ['retro', 'Retro vibe', 'retro 80s aesthetic, synthwave palette, chrome and neon, grain'],
  ['clay', 'Animație din plastilină', 'claymation, stop-motion clay figures, fingerprints in clay, miniature set'],
  ['mystic', 'Fantezie mistică', 'mystic fantasy art, ethereal glow, magical particles, epic'],
  ['watercolor', 'Acuarelă', 'watercolour painting, wet-on-wet bleeds, paper texture, soft edges'],
  ['darkmanga', 'Manga dark', 'dark seinen manga, heavy black ink, gritty crosshatching'],
  ['clipart', 'Clipart', 'clipart, isolated on plain white background, clean simple shapes, bold outlines'],
  ['kawaii', 'Acuarelă kawaii', 'kawaii watercolour, cute, pastel, rounded shapes, blush cheeks'],
  ['pencil', 'Schiță în creion', 'graphite pencil sketch, hatching, white paper, realistic'],
  ['multiexpr', 'Expresii multiple', 'character expression sheet, same character, grid of 6 facial expressions, white background'],
  ['crayon', 'Creioane cerate', 'crayon drawing, waxy texture, bright childlike colours'],
  ['anime', 'Ilustrație anime', 'anime illustration, cel shading, clean line art, vibrant'],
  ['doodle', 'Doodle', 'doodle illustration, hand-drawn marker lines, playful, white background'],
  ['retroillu', 'Ilustrație retro', 'mid-century retro illustration, limited spot colours, textured print'],
  ['semireal', 'Cartoon semi-realist', 'semi-realistic cartoon, stylised proportions, painterly rendering'],
  ['wcdigital', 'Digital tip acuarelă', 'watercolour-inspired digital painting, soft washes, clean digital edges'],
  ['playful', 'Storybook jucăuș', 'playful cartoon storybook, bouncy shapes, saturated friendly colours'],
  ['flatstyl', 'Digital flat stilizat', 'flat and stylised digital illustration, bold shapes, editorial'],
  ['whimsy', 'Fantezie capricioasă', 'whimsical fantasy illustration, dreamy, glowing, enchanted'],
  ['lineart', 'Line art', 'clean black line art on white, no shading, uniform line weight'],
  ['isometric', 'Izometric', 'isometric 3D illustration, clean, soft shadows, pastel'],
  ['lowpoly', 'Low poly', 'low poly 3D render, faceted geometry, flat shading'],
  ['neon', 'Neon / cyberpunk', 'cyberpunk neon, rain-soaked streets, glowing signs, moody'],
].map(([id, ro, p]) => ({ id, ro, p }));
const styleP = id => (STYLES.find(s => s.id === id) || {}).p || '';
const RATIOS = ['1:1', '4:5', '3:4', '2:3', '9:16', '16:9', '3:2', '4:3', '21:9'];
const SOCIAL = [['1:1', 'Instagram post 1080×1080'], ['4:5', 'Instagram portret 1080×1350'], ['9:16', 'Story / Reel / TikTok 1080×1920'], ['16:9', 'YouTube / LinkedIn 1920×1080'], ['2:3', 'Pinterest pin 1000×1500'], ['21:9', 'Copertă Facebook / banner']];
const KDP = [['8.5x8.5', '8,5 × 8,5 in (pătrat, cărți pentru copii)'], ['8.5x11', '8,5 × 11 in (colorat, activități)'], ['6x9', '6 × 9 in (roman, ficțiune)'], ['5x8', '5 × 8 in'], ['8x10', '8 × 10 in']];
const NOTEXT = 'No text, letters, watermarks or signatures in the image.';
const TEXT = t => t ? `The image must contain the exact text "${t}" rendered clearly, correctly spelled, legible, well-kerned, integrated into the design. ` : '';

/* Câmpuri comune */
const F = {
  style: (d = 'none') => ({ k: 'style', t: 'style', label: 'Stil', d }),
  ratio: (d = '1:1', opts) => ({ k: 'ratio', t: 'ratio', label: 'Format', d, opts }),
  n: () => ({ k: 'n', t: 'count', label: 'Variante', d: 1 }),
  neg: () => ({ k: 'negative', t: 'text', label: 'De evitat', ph: 'ex. text, blur, mâini deformate', opt: true }),
  enh: (d = false) => ({ k: 'enhance', t: 'toggle', label: 'Îmbunătățește promptul automat (Smart Prompt Enhancer)', d }),
  colors: () => ({ k: 'colors', t: 'text', label: 'Culori', ph: 'ex. albastru marin și auriu', opt: true }),
  img: (k, label, multi = false, hint) => ({ k, t: 'image', label, multi, hint }),
};
const C = v => v.colors ? ` Colour palette: ${v.colors}.` : '';

/* Registrul. grp: creare | personaje | carti | editare | productie. custom: instrument cu interfață proprie. prem: marcat Premium la Artistly. */
const TOOLS = [
  { id: 'prompt', grp: 'creare', ic: '✦', name: 'Creează din prompt', desc: 'Text în imagine, cu presetări de stil, format și până la 4 variante. Instrumentul de bază, echivalentul „Create From Prompt”.',
    fields: [{ k: 'idea', t: 'textarea', label: 'Ce vrei să vezi', ph: 'o vulpe mică cu eșarfă roșie, într-o pădure de toamnă, la apus', req: true }, F.style(), F.ratio(), F.n(), F.neg(), F.enh(true), F.img('ref', 'Imagini de referință (opțional)', true, 'Modelul păstrează subiectul, stilul sau compoziția din referințe.')],
    build: v => ({ prompt: v.idea, refs: v.ref }) },
  { id: 'logo', grp: 'creare', ic: '◆', name: 'Creator de logo', desc: 'Logo cu numele brandului redat corect, pe fundal simplu, gata de vectorizat.',
    fields: [{ k: 'brand', t: 'text', label: 'Numele brandului', req: true }, { k: 'tagline', t: 'text', label: 'Slogan (opțional)', opt: true }, { k: 'industry', t: 'text', label: 'Domeniu', ph: 'ex. cafenea, studio de yoga, IT' }, { k: 'type', t: 'select', label: 'Tip', opts: [['combo', 'Simbol + text'], ['wordmark', 'Doar text (wordmark)'], ['emblem', 'Emblemă / sigiliu'], ['mascot', 'Mascotă'], ['lettermark', 'Monogramă']] }, { k: 'look', t: 'select', label: 'Aspect', opts: [['minimal', 'Minimalist, plat'], ['modern', 'Modern, geometric'], ['vintage', 'Vintage, cu textură'], ['luxury', 'Luxos, elegant'], ['playful', 'Jucăuș, rotunjit'], ['tech', 'Tech, futurist']] }, F.colors(), F.n(), F.enh()],
    build: v => ({ prompt: `Professional ${v.look} ${v.type === 'wordmark' ? 'wordmark' : v.type === 'emblem' ? 'emblem badge' : v.type === 'mascot' ? 'mascot' : v.type === 'lettermark' ? 'monogram lettermark' : 'combination mark'} logo for "${v.brand}"${v.industry ? `, a ${v.industry} business` : ''}. ${TEXT(v.brand)}${v.tagline ? TEXT(v.tagline) : ''}Flat vector logo design, centred, isolated on a plain white background, scalable, no mockup, no photo, no extra text.${C(v)}` }) },
  { id: 'tshirt', grp: 'creare', ic: '👕', name: 'Design de tricou', desc: 'Grafică pentru print-on-demand, izolată pe fundal simplu, cu text opțional redat corect.',
    fields: [{ k: 'idea', t: 'textarea', label: 'Ideea designului', ph: 'un urs care bea cafea, umor', req: true }, { k: 'text', t: 'text', label: 'Text pe tricou (opțional)', opt: true }, { k: 'bg', t: 'select', label: 'Fundal', opts: [['white', 'Alb (pentru tricouri deschise)'], ['black', 'Negru (pentru tricouri închise)']] }, F.style('vector'), F.n(), F.neg(), F.enh(true)],
    build: v => ({ prompt: `T-shirt print design: ${v.idea}. ${TEXT(v.text)}Centred graphic isolated on a plain ${v.bg} background, no shirt, no mockup, high contrast, print-ready, limited colour count.` }) },
  { id: 'social', grp: 'creare', ic: '▣', name: 'Postare social media', desc: 'Vizual pentru Instagram, Facebook, TikTok sau LinkedIn, în formatul potrivit.',
    fields: [{ k: 'idea', t: 'textarea', label: 'Despre ce este postarea', ph: 'promoție de toamnă la o cafenea, ton cald', req: true }, { k: 'text', t: 'text', label: 'Text pe imagine (opțional)', opt: true }, F.ratio('1:1', SOCIAL), F.style('flatstyl'), F.colors(), F.n(), F.enh(true)],
    build: v => ({ prompt: `Social media post graphic: ${v.idea}. ${TEXT(v.text)}Eye-catching, clean composition with safe margins, modern layout.${C(v)}` }) },
  { id: 'poster', grp: 'creare', ic: '▮', name: 'Creator de afișe', desc: 'Afiș sau poster cu titlu, ierarhie tipografică și format vertical.',
    fields: [{ k: 'idea', t: 'textarea', label: 'Ce anunță afișul', ph: 'concert de jazz în parc, seara', req: true }, { k: 'title', t: 'text', label: 'Titlu (opțional)', opt: true }, { k: 'sub', t: 'text', label: 'Text secundar (dată, loc)', opt: true }, F.ratio('2:3'), F.style('retroillu'), F.colors(), F.n(), F.enh(true)],
    build: v => ({ prompt: `Poster design: ${v.idea}. ${TEXT(v.title)}${v.sub ? TEXT(v.sub) : ''}Strong typographic hierarchy, balanced layout, print quality.${C(v)}` }) },
  { id: 'sticker', grp: 'creare', ic: '✿', name: 'Stickere', desc: 'Sticker die-cut cu contur alb gros, izolat, gata de tăiat.',
    fields: [{ k: 'idea', t: 'text', label: 'Subiect', ph: 'o pisică astronaut', req: true }, F.style('cartoon'), F.n(), F.enh()],
    build: v => ({ prompt: `Die-cut sticker of ${v.idea}. Thick white sticker border around the subject, isolated on a plain white background, glossy look, bold outlines, vibrant. ${NOTEXT}` }) },
  { id: 'card', grp: 'creare', ic: '✉', name: 'Felicitări & invitații', desc: 'Felicitări, invitații de nuntă sau botez, cu textul redat exact.',
    fields: [{ k: 'occasion', t: 'text', label: 'Ocazia', ph: 'invitație la nuntă, felicitare de Crăciun', req: true }, { k: 'text', t: 'text', label: 'Text principal', ph: 'Ana & Mihai · 12 iunie 2027', opt: true }, { k: 'mood', t: 'text', label: 'Atmosferă', ph: 'elegant, floral, minimalist' }, F.ratio('4:5'), F.style('watercolor'), F.colors(), F.n(), F.enh(true)],
    build: v => ({ prompt: `Greeting card / invitation design for: ${v.occasion}. ${TEXT(v.text)}Mood: ${v.mood || 'elegant'}. Front face of the card, flat, printable, decorative border.${C(v)}` }) },
  { id: 'thumbnail', grp: 'creare', ic: '▶', name: 'Thumbnail YouTube', desc: 'Thumbnail 16:9 cu text mare, contrast puternic și expresie care atrage click.',
    fields: [{ k: 'topic', t: 'text', label: 'Subiectul videoclipului', ph: 'cum am construit un site în 24 de ore', req: true }, { k: 'text', t: 'text', label: 'Text pe thumbnail (2–4 cuvine)', ph: '24 DE ORE', opt: true }, { k: 'face', t: 'select', label: 'Persoană în cadru', opts: [['none', 'Fără'], ['shocked', 'Persoană surprinsă'], ['pointing', 'Persoană care arată spre text'], ['happy', 'Persoană zâmbind']] }, F.img('ref', 'Fotografia ta (opțional, pentru fața ta)', false), F.colors(), F.n(), F.enh(true)],
    build: v => ({ prompt: `YouTube thumbnail about "${v.topic}". ${TEXT(v.text)}${v.face !== 'none' ? `A ${v.face === 'shocked' ? 'shocked, wide-eyed' : v.face === 'pointing' ? 'person pointing at the text' : 'happy, smiling person'}${v.ref?.length ? ' who looks exactly like the person in the reference photo' : ''} in the foreground. ` : ''}Very high contrast, saturated colours, bold huge readable text, simple background, 16:9.${C(v)}`, refs: v.ref }), fixed: { ratio: '16:9' } },
  { id: 'wallart', grp: 'creare', ic: '🖼', name: 'Artă de perete', desc: 'Tablouri și printuri pentru Etsy sau acasă, în stilul ales.',
    fields: [{ k: 'idea', t: 'textarea', label: 'Subiect', ph: 'linie continuă, femeie cu flori', req: true }, F.ratio('4:5'), F.style('lineart'), F.colors(), F.n(), F.enh(true)],
    build: v => ({ prompt: `Wall art print: ${v.idea}. Gallery-quality, balanced composition, suitable for framing. ${NOTEXT}${C(v)}` }) },
  { id: 'tattoo', grp: 'creare', ic: '☠', name: 'Design de tatuaj', desc: 'Schiță de tatuaj pe fundal alb, gata de dus la salon.',
    fields: [{ k: 'idea', t: 'text', label: 'Subiect', ph: 'lup și lună, geometric', req: true }, { k: 'kind', t: 'select', label: 'Stil de tatuaj', opts: [['fineline', 'Fine line'], ['traditional', 'Old school tradițional'], ['blackwork', 'Blackwork'], ['geometric', 'Geometric'], ['realism', 'Realism'], ['watercolor', 'Acuarelă'], ['japanese', 'Japonez (irezumi)'], ['minimal', 'Minimalist']] }, F.n(), F.enh()],
    build: v => ({ prompt: `Tattoo design: ${v.idea}. ${v.kind} tattoo style, black ink${v.kind === 'watercolor' ? ' with watercolour splashes' : v.kind === 'traditional' ? ' with bold lines and limited flat colours' : ''}, clean stencil-ready artwork isolated on a plain white background, no skin, no body. ${NOTEXT}` }) },
  { id: 'pattern', grp: 'creare', ic: '▦', name: 'Model repetitiv', desc: 'Pattern fără cusătură (seamless) pentru textile, hârtie de împachetat sau fundaluri.',
    fields: [{ k: 'idea', t: 'text', label: 'Motive', ph: 'lămâi, frunze și flori mici', req: true }, F.style('flat2d'), F.colors(), F.n(), F.enh()],
    build: v => ({ prompt: `Seamless repeating pattern tile of ${v.idea}. Evenly distributed motifs, edges designed to tile perfectly, flat background, textile print. ${NOTEXT}${C(v)}` }), fixed: { ratio: '1:1' } },
  { id: 'icon', grp: 'creare', ic: '◉', name: 'Iconițe & clipart', desc: 'O iconiță sau un element clipart izolat pe alb. Pentru seturi întregi folosește „Clipart în masă”.',
    fields: [{ k: 'idea', t: 'text', label: 'Obiect', ph: 'o ceașcă de cafea aburindă', req: true }, F.style('clipart'), F.colors(), F.n()],
    build: v => ({ prompt: `Single ${v.idea} icon, centred, isolated on a plain white background, no shadow on the background, consistent stroke, simple. ${NOTEXT}${C(v)}` }), fixed: { ratio: '1:1' } },
  { id: 'perfecttext', grp: 'creare', ic: 'Aa', name: 'Text perfect în imagine', desc: 'Echivalentul „Perfect Text”: text redat corect, fără litere deformate, integrat în design.',
    fields: [{ k: 'text', t: 'text', label: 'Textul exact', ph: 'Bună dimineața!', req: true }, { k: 'idea', t: 'textarea', label: 'Designul în jurul textului', ph: 'tablă de cafenea cu cretă, frunze desenate', req: true }, { k: 'font', t: 'select', label: 'Caracterul literelor', opts: [['auto', 'Lasă modelul să aleagă'], ['serif', 'Serif elegant'], ['sans', 'Sans-serif modern'], ['script', 'Caligrafic / script'], ['display', 'Display, bold, afiș'], ['hand', 'Scris de mână']] }, F.ratio(), F.style(), F.n()],
    build: v => ({ prompt: `${v.idea}. ${TEXT(v.text)}${v.font !== 'auto' ? `Lettering in a ${v.font} typeface. ` : ''}The text is the hero of the composition, perfectly spelled, every letter correct, no extra words.` }) },
  { id: 'photoreal', grp: 'creare', ic: '📷', name: 'Fotorealism', desc: 'Fotografii realiste: portrete, peisaje, produse, cu parametri de cameră.',
    fields: [{ k: 'idea', t: 'textarea', label: 'Scena', ph: 'o femeie în vârstă zâmbind la piață, lumină de dimineață', req: true }, { k: 'lens', t: 'select', label: 'Obiectiv', opts: [['85mm', '85 mm, portret'], ['35mm', '35 mm, reportaj'], ['24mm', '24 mm, peisaj / arhitectură'], ['100mm', '100 mm macro'], ['drone', 'Dronă, de sus']] }, { k: 'light', t: 'select', label: 'Lumină', opts: [['golden', 'Ora de aur'], ['soft', 'Lumină difuză de zi'], ['studio', 'Studio, softbox'], ['night', 'Noapte, neon'], ['overcast', 'Cer înnorat']] }, F.ratio('3:2'), F.n(), F.neg(), F.enh(true)],
    build: v => ({ prompt: `Photorealistic photograph: ${v.idea}. Shot with a ${v.lens} lens, ${v.light} lighting, natural skin texture, realistic materials, sharp focus, RAW photo look. ${NOTEXT}` }) },
  { id: 'animal', grp: 'creare', ic: '🦊', name: 'Animale', desc: 'Echivalentul „Animal feature”: animale în orice stil, poză și decor.',
    fields: [{ k: 'animal', t: 'text', label: 'Animalul', ph: 'un bursuc', req: true }, { k: 'doing', t: 'text', label: 'Ce face / unde', ph: 'citește o carte lângă foc' }, { k: 'outfit', t: 'text', label: 'Îmbrăcat cu (opțional)', opt: true }, F.style('pixar'), F.ratio(), F.n(), F.enh(true)],
    build: v => ({ prompt: `${v.animal}${v.outfit ? ` wearing ${v.outfit}` : ''}${v.doing ? `, ${v.doing}` : ''}. Charming, detailed fur texture, expressive eyes. ${NOTEXT}` }) },

  { id: 'selfportrait', grp: 'personaje', ic: '🙂', name: 'Portretul tău (Self-Portrait AI)', desc: 'Încarci 1–3 poze cu tine și te vezi în orice stil, ținută sau decor, cu fața păstrată.', prem: true,
    fields: [F.img('ref', 'Fotografii cu tine (1–3, fața clar vizibilă)', true), { k: 'scene', t: 'textarea', label: 'Cum vrei să apari', ph: 'portret profesional LinkedIn, sacou bleumarin, fundal de birou luminos', req: true }, F.style('photoreal'), F.ratio('4:5'), F.n(), F.enh()],
    build: v => ({ prompt: `Create an image of the exact same person shown in the reference photo(s): identical face, facial structure, skin tone, eyes, hair and age. ${v.scene}. Keep the likeness faithful. ${NOTEXT}`, refs: v.ref, needRef: true }) },
  { id: 'petportrait', grp: 'personaje', ic: '🐾', name: 'Portret animal de companie', desc: 'Din poza animalului tău: portret regal, acuarelă, Pixar sau ulei, gata de print.', prem: true,
    fields: [F.img('ref', 'Poza animalului (1–2)', true), { k: 'look', t: 'select', label: 'Tip de portret', opts: [['royal', 'Portret regal, în uniformă de epocă'], ['watercolor', 'Acuarelă delicată'], ['oil', 'Pictură clasică în ulei'], ['pixar', '3D animat'], ['popart', 'Pop art'], ['astronaut', 'Astronaut'], ['custom', 'Descriu eu']] }, { k: 'custom', t: 'text', label: 'Descriere (dacă ai ales „Descriu eu”)', opt: true }, F.colors(), F.ratio('4:5'), F.n()],
    build: v => { const looks = { royal: 'a regal 18th-century aristocratic portrait wearing an ornate military uniform with gold epaulettes, classical oil painting, dark background', watercolor: 'a delicate watercolour portrait, soft washes, white paper', oil: 'a classical oil painting portrait, museum quality, warm light', pixar: 'a 3D animated movie character portrait, big expressive eyes', popart: 'a bold pop art portrait, halftone dots, four-colour', astronaut: 'a portrait as an astronaut in a spacesuit, space background', custom: v.custom || 'an artistic portrait' }; return { prompt: `Portrait of the exact same pet from the reference photo (same breed, fur colours, markings, eye colour, face shape) as ${looks[v.look]}. Faithful likeness, head and shoulders, centred. ${NOTEXT}${C(v)}`, refs: v.ref, needRef: true }; } },
  { id: 'soulmate', grp: 'personaje', ic: '✎', name: 'Schiță „soulmate”', desc: 'Portret în creion al unei persoane descrise: produsul viral de pe Etsy, generat local.',
    fields: [{ k: 'desc', t: 'textarea', label: 'Descrierea persoanei', ph: 'bărbat de 30 de ani, păr șaten ondulat, barbă scurtă, zâmbet cald, ochi verzi', req: true }, { k: 'mood', t: 'select', label: 'Expresie', opts: [['warm', 'Zâmbet cald'], ['serious', 'Serios, intens'], ['dreamy', 'Visător']] }, F.n()],
    build: v => ({ prompt: `Realistic graphite pencil sketch portrait, head and shoulders, of ${v.desc}. ${v.mood} expression, soft shading, unfinished sketch edges, white paper. ${NOTEXT}` }), fixed: { ratio: '3:4' } },
  { id: 'character', grp: 'personaje', ic: '👤', name: 'Personaj consistent', desc: 'Definești personajul o dată (fișă de personaj), apoi îl pui în orice scenă, cu până la 3 personaje deodată.', prem: true, custom: true },
  { id: 'mockup', grp: 'personaje', ic: '☕', name: 'Mockup de produs (Magic Merch)', desc: 'Încarci designul și îl vezi pe tricou, cană, hanorac, tote bag, husă, poster sau ambalaj.', prem: true,
    fields: [F.img('ref', 'Designul / logo-ul (PNG)', false), { k: 'product', t: 'select', label: 'Produs', opts: [['t-shirt', 'Tricou'], ['hoodie', 'Hanorac'], ['ceramic mug', 'Cană'], ['tote bag', 'Sacoșă tote'], ['phone case', 'Husă de telefon'], ['framed poster on a wall', 'Poster înrămat'], ['baseball cap', 'Șapcă'], ['throw pillow', 'Pernă'], ['product box packaging', 'Cutie / ambalaj'], ['coffee cup sleeve', 'Pahar de cafea'], ['laptop sticker', 'Sticker pe laptop'], ['canvas print', 'Tablou canvas']] }, { k: 'color', t: 'text', label: 'Culoarea produsului', ph: 'alb, negru, bej', opt: true }, { k: 'scene', t: 'select', label: 'Scenă', opts: [['studio', 'Studio, fundal neutru'], ['lifestyle', 'Lifestyle, purtat / folosit de o persoană'], ['flatlay', 'Flat lay de sus'], ['outdoor', 'Exterior, lumină naturală']] }, F.ratio(), F.n()],
    build: v => ({ prompt: `Realistic product mockup photograph: a ${v.color ? v.color + ' ' : ''}${v.product} with the EXACT design from the reference image printed on it. Reproduce the design faithfully (same shapes, colours, text) and wrap it naturally to the product surface with realistic fabric/material texture, lighting and shadows. ${v.scene === 'lifestyle' ? 'Worn or used by a person in a lifestyle setting' : v.scene === 'flatlay' ? 'Top-down flat lay' : v.scene === 'outdoor' ? 'Outdoor natural light' : 'Clean studio photography, neutral background'}. Photorealistic, e-commerce quality.`, refs: v.ref, needRef: true }) },
  { id: 'stylize', grp: 'personaje', ic: '🎨', name: 'Stilizator', desc: 'Transformă orice fotografie sau imagine în stilul ales, păstrând compoziția.', prem: true,
    fields: [F.img('ref', 'Imaginea de transformat', false), F.style('watercolor'), { k: 'extra', t: 'text', label: 'Indicații (opțional)', opt: true }, F.ratio(), F.n()],
    build: v => ({ prompt: `Re-render the reference image in a new artistic style while keeping the same subject, composition, poses and layout. ${v.extra || ''}`, refs: v.ref, needRef: true }) },
  { id: 'mirror', grp: 'personaje', ic: '⇄', name: 'Mirror Magic', desc: 'Din orice imagine, o creație nouă, originală, cu același layout, paletă și atmosferă, dar cu conținut diferit.', prem: true,
    fields: [F.img('ref', 'Imaginea sursă', false), { k: 'change', t: 'textarea', label: 'Ce se schimbă', ph: 'alt subiect, alt text, alte obiecte; păstrează structura', req: true }, { k: 'text', t: 'text', label: 'Text nou (dacă imaginea are text)', opt: true }, F.n()],
    build: v => ({ prompt: `Create a NEW original image inspired by the reference: keep the overall layout, composition grid, colour palette, mood and typographic hierarchy, but replace the actual content so the result is a different, original work. Changes: ${v.change}. ${TEXT(v.text)}Do not copy the original elements literally.`, refs: v.ref, needRef: true }) },
  { id: 'sceneedit', grp: 'personaje', ic: '🌄', name: 'Editor de scenă / fundal', desc: 'Înlocuiește fundalul, lumina și umbrele în jurul subiectului, păstrând subiectul intact.',
    fields: [F.img('ref', 'Imaginea', false), { k: 'bg', t: 'textarea', label: 'Noul fundal', ph: 'plajă la apus, lumină caldă din stânga', req: true }, { k: 'keep', t: 'select', label: 'Subiectul', opts: [['keep', 'Păstrează subiectul identic'], ['relight', 'Păstrează subiectul, adaptează lumina și umbrele']] }, F.n()],
    build: v => ({ prompt: `Replace the background of the reference image with: ${v.bg}. Keep the main subject exactly as it is (same shape, pose, clothing, colours)${v.keep === 'relight' ? ', but adjust its lighting, shadows and reflections to match the new environment' : ''}. Seamless edges, realistic integration.`, refs: v.ref, needRef: true }) },

  { id: 'bookcover', grp: 'carti', ic: '📕', name: 'Copertă de carte', desc: 'Copertă față cu titlu și autor redate corect, în formatul KDP ales.',
    fields: [{ k: 'title', t: 'text', label: 'Titlul', req: true }, { k: 'author', t: 'text', label: 'Autor', opt: true }, { k: 'genre', t: 'select', label: 'Gen', opts: [['children', 'Carte pentru copii'], ['fantasy', 'Fantasy'], ['thriller', 'Thriller / mister'], ['romance', 'Romance'], ['scifi', 'SF'], ['selfhelp', 'Dezvoltare personală'], ['business', 'Business'], ['poetry', 'Poezie'], ['cookbook', 'Carte de bucate']] }, { k: 'idea', t: 'textarea', label: 'Ce apare pe copertă', ph: 'o fetiță și un dragon albastru pe un deal', req: true }, { k: 'trim', t: 'select', label: 'Format KDP', opts: KDP }, F.style('storybook'), F.n(), F.enh()],
    build: v => { const r = { '8.5x8.5': '1:1', '8.5x11': '3:4', '6x9': '2:3', '5x8': '2:3', '8x10': '4:5' }[v.trim]; return { prompt: `Front book cover design for a ${v.genre} book. Artwork: ${v.idea}. ${TEXT(v.title)}${v.author ? TEXT(v.author) : ''}Title large at the top, author name smaller at the bottom, professional typography, safe margins for print, no spine, no back cover.`, ratio: r }; } },
  { id: 'coloring', grp: 'carti', ic: '✏', name: 'Pagină de colorat', desc: 'Contururi negre curate pe alb, fără umbre, pentru copii sau adulți. Format 8,5×11.',
    fields: [{ k: 'idea', t: 'text', label: 'Subiect', ph: 'un unicorn în grădină cu fluturi', req: true }, { k: 'age', t: 'select', label: 'Public', opts: [['kids', 'Copii mici (contururi groase, simplu)'], ['older', 'Copii mari (mai multe detalii)'], ['adult', 'Adulți (mandala, detalii fine)']] }, F.n()],
    build: v => ({ prompt: `Coloring book page of ${v.idea}. Clean black line art on pure white background, ${v.age === 'kids' ? 'very thick simple outlines, large areas, minimal detail' : v.age === 'older' ? 'medium detail, clear outlines' : 'intricate fine detail, mandala-like patterns'}, no shading, no grey, no colour, no filled black areas, closed shapes. ${NOTEXT}` }), fixed: { ratio: '3:4' } },
  { id: 'storybook', grp: 'carti', ic: '📖', name: 'Studio storybook', desc: 'Poveste generată, personaj consistent pe fiecare pagină, editare text, export PDF la dimensiune KDP. Include modurile carte de colorat și storyboard.', prem: true, custom: true },
  { id: 'storyboard', grp: 'carti', ic: '🎬', name: 'Script → storyboard', desc: 'Din scenariu, cadre de storyboard numerotate, cu personaj consistent.', prem: true, custom: true },

  { id: 'inpaint', grp: 'editare', ic: '🖌', name: 'Inpainting (retuș pe zonă)', desc: 'Pictezi zona, descrii ce vrei acolo. Restul imaginii rămâne neschimbat.', custom: true },
  { id: 'outpaint', grp: 'editare', ic: '⤢', name: 'Extindere imagine', desc: 'Mărește canvasul în orice direcție și lasă modelul să continue scena.', custom: true },
  { id: 'bgremove', grp: 'editare', ic: '✂', name: 'Eliminare fundal', desc: 'PNG transparent, cu margini curate. Rulează local în browser, fără cost.', custom: true },
  { id: 'upscale', grp: 'editare', ic: '⤴', name: 'Upscaler', desc: 'Mărire 2× / 4× locală sau re-randare AI la 2K / 4K cu Gemini 3 Pro Image.', custom: true },
  { id: 'editor', grp: 'editare', ic: '⌘', name: 'Editor (tip Canva)', desc: 'Straturi, text cu fonturi, forme, imagini, fundal, export PNG/JPG la dimensiunea dorită.', custom: true },

  { id: 'bulkclipart', grp: 'productie', ic: '⧉', name: 'Clipart în masă', desc: 'Dintr-o temă, până la 24 de cliparturi coerente, descărcate ca ZIP.', prem: true, custom: true },
  { id: 'batch', grp: 'productie', ic: '≣', name: 'Prompturi în lot', desc: 'Un prompt pe linie, același stil și format, rulate pe rând.', prem: true, custom: true },
  { id: 'enhancer', grp: 'productie', ic: '✧', name: 'Îmbunătățire prompt', desc: 'Transformă o idee scurtă într-un prompt detaliat, în engleză, pe care îl poți copia oriunde.', custom: true },
];
const GROUPS = { creare: 'Creare rapidă (Fast AI)', personaje: 'Imagine & personaje', carti: 'Cărți & KDP', editare: 'Editare', productie: 'Producție' };
const toolById = id => TOOLS.find(t => t.id === id);

/* =====================================================================
   5. Interfața: navigare, formulare generice, rulare, rezultate
   ===================================================================== */
const panel = $('#panel'), stage = $('#stage');
let current = null;          // instrumentul deschis
let incoming = null;         // imagine trimisă dintr-un alt instrument
let aborter = null;

function renderNav() {
  const side = $('#side'); side.innerHTML = '';
  for (const [g, label] of Object.entries(GROUPS)) {
    const box = el('div', { class: 'grp' });
    side.append(el('div', { class: 'grp-t' }, label), box);
    for (const t of TOOLS.filter(t => t.grp === g)) {
      box.append(el('button', { type: 'button', 'data-tool': t.id, 'aria-current': current?.id === t.id ? 'true' : 'false', onclick: () => openTool(t.id) }, el('span', { class: 'ic' }, t.ic), t.name, t.prem ? el('span', { class: 'badge-p', title: 'La Artistly este doar în planul Premium (147 $)' }, 'PREMIUM') : null));
    }
  }
  const grid = $('#tools-grid'); grid.innerHTML = '';
  for (const t of TOOLS) grid.append(el('button', { class: 'tool-card', type: 'button', onclick: () => { openTool(t.id); $('#atelier').scrollIntoView({ behavior: 'smooth' }); } }, el('span', { class: 'ic' }, t.ic), el('b', {}, t.name), el('span', {}, t.desc), el('span', { class: 'grp' }, GROUPS[t.grp] + (t.prem ? ' · Premium la Artistly' : ''))));
  $('#stat-tools').textContent = TOOLS.length + '';
  $('#stat-styles').textContent = (STYLES.length - 1) + '';
  const strip = $('#styles-strip'); strip.innerHTML = '';
  for (const s of STYLES.slice(1)) strip.append(el('span', { class: 'chip' }, s.ro));
}

function openTool(id, payload) {
  const t = toolById(id); if (!t) return;
  if (aborter) { aborter.abort(); aborter = null; }
  current = t; incoming = payload || null; S.lastTool = id; saveS();
  $$('#side button').forEach(b => b.setAttribute('aria-current', b.dataset.tool === id ? 'true' : 'false'));
  location.hash = 'atelier';
  panel.innerHTML = ''; stage.innerHTML = '';
  if (t.custom) CUSTOM[t.id](panel, stage, t); else renderGeneric(t);
}

/* ---- câmpuri ---- */
function imageField(f, initial = []) {
  const w = el('div', { class: 'field' });
  const files = [...initial];
  const drop = el('label', { class: 'drop' }, `${f.multi ? 'Trage imagini aici sau apasă pentru a alege' : 'Trage o imagine aici sau apasă pentru a alege'}`, el('input', { type: 'file', accept: 'image/*', multiple: f.multi }));
  const thumbs = el('div', { class: 'thumbs' });
  const redraw = () => { thumbs.innerHTML = ''; files.forEach((d, i) => thumbs.append(el('div', { class: 'th' }, el('img', { src: d, alt: '' }), el('button', { type: 'button', 'aria-label': 'Elimină', onclick: () => { files.splice(i, 1); redraw(); } }, '✕')))); };
  const add = async list => { for (const file of list) { if (!file.type.startsWith('image/')) continue; const d = await fileToDataURL(file); if (f.multi) files.push(d); else files.splice(0, files.length, d); } redraw(); };
  drop.querySelector('input').addEventListener('change', e => add(e.target.files));
  drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', e => { e.preventDefault(); drop.classList.remove('over'); add(e.dataTransfer.files); });
  // lipire din clipboard
  w.addEventListener('paste', e => { const its = [...(e.clipboardData?.items || [])].filter(i => i.type.startsWith('image/')); if (its.length) add(its.map(i => i.getAsFile())); });
  w.append(el('label', {}, f.label, f.hint ? el('small', {}, f.hint) : null), drop, thumbs);
  if (window.__gallery?.length) {
    const pick = el('button', { type: 'button', class: 'btn ghost small', style: 'margin-top:6px', onclick: () => pickFromGallery(d => { if (f.multi) files.push(d); else files.splice(0, files.length, d); redraw(); }) }, 'Alege din galerie');
    w.append(pick);
  }
  redraw();
  return { node: w, get: () => files.slice(), set: d => { files.splice(0, files.length, d); redraw(); } };
}
function segField(f, opts, initial) {
  let val = initial;
  const seg = el('div', { class: 'seg' });
  const btns = opts.map(([v, label]) => el('button', { type: 'button', 'aria-pressed': v === val ? 'true' : 'false', title: label, onclick: () => { val = v; btns.forEach(b => b.setAttribute('aria-pressed', b.dataset.v === v ? 'true' : 'false')); }, 'data-v': v }, f.t === 'ratio' ? v + (label && label !== v ? ' · ' + label.split(' ')[0] : '') : label));
  seg.append(...btns);
  return { node: el('div', { class: 'field' }, el('label', {}, f.label), seg), get: () => val };
}
function styleField(f, initial) {
  let val = initial || 'none';
  const search = el('input', { class: 'stylesearch', type: 'search', placeholder: 'Caută stil…' });
  const grid = el('div', { class: 'stylepick' });
  const draw = q => { grid.innerHTML = ''; for (const s of STYLES) { if (q && !s.ro.toLowerCase().includes(q)) continue; grid.append(el('button', { type: 'button', 'aria-pressed': s.id === val ? 'true' : 'false', 'data-v': s.id, title: s.p, onclick: () => { val = s.id; $$('button', grid).forEach(b => b.setAttribute('aria-pressed', b.dataset.v === val ? 'true' : 'false')); } }, s.ro)); } };
  search.addEventListener('input', () => draw(search.value.trim().toLowerCase())); draw('');
  return { node: el('div', { class: 'field' }, el('label', {}, f.label, el('small', {}, 'sufix adăugat promptului')), search, grid), get: () => val };
}
function buildForm(fields, container, initial = {}) {
  const getters = {};
  for (const f of fields) {
    const init = initial[f.k] ?? f.d;
    if (f.t === 'image') { const g = imageField(f, initial[f.k] ? [].concat(initial[f.k]) : []); container.append(g.node); getters[f.k] = g.get; continue; }
    if (f.t === 'style') { const g = styleField(f, init); container.append(g.node); getters[f.k] = g.get; continue; }
    if (f.t === 'ratio') { const g = segField(f, (f.opts || RATIOS.map(r => [r, r])), init || '1:1'); container.append(g.node); getters[f.k] = g.get; continue; }
    if (f.t === 'count') { const g = segField(f, [[1, '1'], [2, '2'], [3, '3'], [4, '4']], init || 1); container.append(g.node); getters[f.k] = () => +g.get(); continue; }
    if (f.t === 'size') { const g = segField(f, [['1K', '1K'], ['2K', '2K'], ['4K', '4K']], init || '1K'); container.append(g.node); getters[f.k] = g.get; continue; }
    if (f.t === 'toggle') { const inp = el('input', { type: 'checkbox' }); inp.checked = !!init; container.append(el('div', { class: 'field' }, el('label', { class: 'toggle' }, inp, f.label))); getters[f.k] = () => inp.checked; continue; }
    let inp;
    if (f.t === 'textarea') inp = el('textarea', { placeholder: f.ph || '' });
    else if (f.t === 'select') { inp = el('select', {}); for (const [v, l] of f.opts) inp.append(el('option', { value: v }, l)); }
    else if (f.t === 'number') inp = el('input', { type: 'number', min: f.min, max: f.max, step: f.step || 1 });
    else inp = el('input', { type: 'text', placeholder: f.ph || '' });
    if (init != null) inp.value = init;
    container.append(el('div', { class: 'field' }, el('label', {}, f.label, f.opt ? el('small', {}, 'opțional') : f.req ? el('small', {}, 'obligatoriu') : null), inp));
    getters[f.k] = () => f.t === 'number' ? +inp.value : inp.value.trim();
  }
  return () => Object.fromEntries(Object.entries(getters).map(([k, g]) => [k, g()]));
}

/* ---- formular generic + rulare ---- */
function renderGeneric(t) {
  panel.append(el('h3', {}, t.name), el('p', { class: 'desc' }, t.desc));
  if (t.prem) panel.append(el('div', { class: 'note' }, 'La Artistly acest instrument este disponibil doar în planul Premium (147 $). Aici este deschis.'));
  const form = el('div', {});
  const fields = t.fields.slice();
  if (isGeminiPro()) fields.push({ k: 'size', t: 'size', label: 'Rezoluție (Gemini 3 Pro)', d: '1K' });
  const initial = {}; if (incoming?.image) { const imgF = fields.find(f => f.t === 'image'); if (imgF) initial[imgF.k] = incoming.image; }
  const read = buildForm(fields, form, initial);
  const btn = el('button', { class: 'btn primary wide', type: 'button' }, 'Generează');
  const promptPreview = el('details', { style: 'margin-top:10px' }, el('summary', { style: 'font-size:12.5px;color:var(--ink-3);cursor:pointer' }, 'Vezi promptul trimis'), el('pre', { class: 'log', id: 'pp' }, ''));
  panel.append(form, btn, promptPreview);
  btn.addEventListener('click', () => runGeneric(t, read(), btn));
  emptyStage('Completează formularul și apasă „Generează”. Rezultatele apar aici și în galerie.');
}
function emptyStage(msg) { stage.innerHTML = ''; stage.append(el('div', { class: 'empty' }, msg)); }
function stageBusy(msg) { stage.innerHTML = ''; const log = el('div', { class: 'log' }, msg); const stop = el('button', { class: 'btn ghost small', type: 'button', onclick: () => aborter?.abort() }, 'Oprește'); stage.append(el('div', { class: 'stage-top' }, el('div', { class: 'progress' }, el('span', { class: 'spin' }), el('span', { id: 'prog' }, msg)), stop), log); return { set: m => { $('#prog', stage).textContent = m; log.textContent += '\n' + m; }, log }; }
function stageError(e) { stage.prepend(el('div', { class: 'note err' }, 'Eroare: ' + (e.name === 'AbortError' ? 'oprit de tine.' : e.message))); }
function busyBtn(btn, on) { btn.disabled = on; btn.textContent = on ? 'Se generează…' : (btn.dataset.label || 'Generează'); }

async function runGeneric(t, v, btn) {
  try {
    requireKey();
    for (const f of t.fields) if (f.req && !v[f.k]) throw new Error(`Completează câmpul „${f.label}”.`);
    let { prompt, refs = [], ratio, needRef } = t.build(v);
    if (needRef && !(refs && refs.length)) throw new Error('Acest instrument are nevoie de o imagine încărcată.');
    ratio = t.fixed?.ratio || ratio || v.ratio || '1:1';
    const sp = styleP(v.style); if (sp) prompt += ` Style: ${sp}.`;
    if (v.negative) prompt += ` Avoid: ${v.negative}.`;
    busyBtn(btn, true); aborter = new AbortController();
    const prog = stageBusy('Pregătesc promptul…');
    if (v.enhance) { prog.set('Îmbunătățesc promptul…'); prompt = await enhancePrompt(prompt, refs.length ? 'The prompt will be sent together with reference images; keep references to them.' : ''); }
    $('#pp').textContent = prompt;
    prog.set(`Generez ${v.n || 1} imagine/imagini cu ${imageModel()}…`);
    const imgs = await P().generate({ prompt, refs, ratio, n: v.n || 1, size: v.size, signal: aborter.signal, onOne: () => prog.set('O imagine gata…') });
    await showResults(imgs, { tool: t.id, prompt, ratio });
  } catch (e) { if (!stage.querySelector('.results')) emptyStage(''); stageError(e); }
  finally { busyBtn(btn, false); aborter = null; }
}

async function showResults(imgs, meta, { keep = false, transparent = false } = {}) {
  if (!keep) stage.innerHTML = '';
  let grid = stage.querySelector('.results');
  if (!grid) { grid = el('div', { class: 'results' + (imgs.length === 1 ? ' single' : '') }); stage.append(el('div', { class: 'stage-top' }, el('h4', {}, 'Rezultate'), el('span', { class: 'hint', style: 'margin:0' }, meta.prompt ? meta.prompt.slice(0, 90) + (meta.prompt.length > 90 ? '…' : '') : '')), grid); }
  for (const d of imgs) {
    const rec = { id: uid(), tool: meta.tool, prompt: meta.prompt || '', data: d, t: Date.now() };
    try { await DB.put('images', rec); } catch (e) { toast('Nu am putut salva în galerie: ' + e.message); }
    grid.prepend(resultCard(rec, transparent));
  }
  refreshGallery();
}
function resultCard(rec, transparent) {
  const img = el('img', { src: rec.data, alt: rec.prompt.slice(0, 80), loading: 'lazy', onclick: () => lightbox(rec) });
  const acts = el('div', { class: 'acts' });
  for (const [label, fn] of imageActions(rec)) acts.append(el('button', { type: 'button', onclick: fn }, label));
  const c = el('div', { class: 'res' }, img, el('div', { class: 'cap' }, toolById(rec.tool)?.name || rec.tool), acts);
  if (transparent) c.style.background = 'repeating-conic-gradient(var(--surface-2) 0 25%,var(--surface) 0 50%) 0 0/18px 18px';
  return c;
}
function imageActions(rec) {
  const d = rec.data;
  return [
    ['Descarcă', () => download(d, `atelier-${rec.tool}-${stamp()}.png`)],
    ['Retuș', () => openTool('inpaint', { image: d })],
    ['Extinde', () => openTool('outpaint', { image: d })],
    ['Fundal', () => openTool('bgremove', { image: d })],
    ['Mărește', () => openTool('upscale', { image: d })],
    ['Editor', () => openTool('editor', { image: d })],
    ['Variații', () => openTool('prompt', { image: d, idea: rec.prompt })],
    ['Stilizează', () => openTool('stylize', { image: d })],
    ['Mockup', () => openTool('mockup', { image: d })],
    ['Șterge', async () => { await DB.del('images', rec.id); refreshGallery(); toast('Șters din galerie'); }],
  ];
}

/* ---- galerie ---- */
window.__gallery = [];
async function refreshGallery() {
  const all = (await DB.all('images')).sort((a, b) => b.t - a.t); window.__gallery = all;
  const g = $('#gal'); g.innerHTML = '';
  $('#gal-empty').hidden = all.length > 0;
  for (const rec of all.slice(0, 200)) g.append(el('div', { class: 'g', role: 'button', tabindex: 0, onclick: () => lightbox(rec), onkeydown: e => e.key === 'Enter' && lightbox(rec) }, el('img', { src: rec.data, alt: rec.prompt.slice(0, 60), loading: 'lazy' }), el('span', {}, (toolById(rec.tool)?.name || rec.tool) + ' · ' + new Date(rec.t).toLocaleDateString('ro-RO'))));
}
function pickFromGallery(cb) {
  const m = $('#lightbox'); const box = $('.box', m); box.innerHTML = '';
  box.append(el('button', { class: 'iconbtn close', type: 'button', onclick: () => m.classList.remove('open') }, '✕'), el('h3', {}, 'Alege din galerie'));
  const g = el('div', { class: 'gal' });
  for (const rec of window.__gallery) g.append(el('div', { class: 'g', onclick: () => { cb(rec.data); m.classList.remove('open'); } }, el('img', { src: rec.data, alt: '' })));
  box.append(g); m.classList.add('open');
}
function lightbox(rec) {
  const m = $('#lightbox'); const box = $('.box', m); box.innerHTML = '';
  box.append(el('button', { class: 'iconbtn close', type: 'button', onclick: () => m.classList.remove('open') }, '✕'), el('img', { src: rec.data, alt: '' }), el('p', { class: 'meta' }, `${toolById(rec.tool)?.name || rec.tool} · ${new Date(rec.t).toLocaleString('ro-RO')}`, el('br'), rec.prompt));
  const acts = el('div', { class: 'acts' });
  for (const [label, fn] of imageActions(rec)) acts.append(el('button', { class: 'btn ghost small', type: 'button', onclick: () => { m.classList.remove('open'); fn(); } }, label));
  acts.append(el('button', { class: 'btn ghost small', type: 'button', onclick: () => { navigator.clipboard?.writeText(rec.prompt); toast('Prompt copiat'); } }, 'Copiază promptul'));
  box.append(acts); m.classList.add('open');
}
$$('.modal').forEach(m => m.addEventListener('click', e => { if (e.target === m || e.target.closest('[data-close]')) m.classList.remove('open'); }));
document.addEventListener('keydown', e => { if (e.key === 'Escape') $$('.modal.open').forEach(m => m.classList.remove('open')); });
$('#gal-clear').addEventListener('click', async () => { if (!window.__gallery.length) return; if (!confirm(`Ștergi definitiv ${window.__gallery.length} imagini din galeria locală?`)) return; await DB.clear('images'); refreshGallery(); toast('Galerie golită'); });
$('#gal-zip').addEventListener('click', async () => { if (!window.__gallery.length) return toast('Galeria e goală'); await zipDownload(window.__gallery.map((r, i) => [`${String(i + 1).padStart(3, '0')}-${r.tool}.png`, r.data]), `atelier-galerie-${stamp()}.zip`); });
async function zipDownload(entries, name) {
  await loadScript(LIB.jszip); const z = new JSZip();
  for (const [n, d] of entries) z.file(n, dataURLParts(d).b64, { base64: true });
  const blob = await z.generateAsync({ type: 'blob' }); const u = URL.createObjectURL(blob); download(u, name); setTimeout(() => URL.revokeObjectURL(u), 5000);
}

/* ---- setări ---- */
function openSettings() { syncSettingsUI(); $('#settings').classList.add('open'); }
function syncSettingsUI() {
  $$('#provider-tabs button').forEach(b => b.setAttribute('aria-pressed', b.dataset.prov === S.provider ? 'true' : 'false'));
  $('#prov-gemini').hidden = S.provider !== 'gemini'; $('#prov-openai').hidden = S.provider !== 'openai';
  $('#key-gemini').value = S.keys.gemini; $('#key-openai').value = S.keys.openai;
  for (const p of ['gemini', 'openai']) { const sel = $('#model-' + p); sel.value = S.models[p]; if (sel.value !== S.models[p]) { sel.value = 'custom'; } $('#model-' + p + '-custom-w').hidden = sel.value !== 'custom'; $('#model-' + p + '-custom').value = S.custom[p]; $('#text-' + p).value = S.text[p]; }
  $('#quality-openai').value = S.quality;
}
function readSettingsUI() {
  S.keys.gemini = $('#key-gemini').value.trim(); S.keys.openai = $('#key-openai').value.trim();
  for (const p of ['gemini', 'openai']) { S.models[p] = $('#model-' + p).value; S.custom[p] = $('#model-' + p + '-custom').value.trim(); S.text[p] = $('#text-' + p).value.trim(); }
  S.quality = $('#quality-openai').value; saveS(); updateKeyPill();
}
function updateKeyPill() { const k = $('#keypill'); k.classList.toggle('ok', hasKey()); $('span', k).textContent = hasKey() ? `${S.provider === 'gemini' ? 'Gemini' : 'OpenAI'} · ${imageModel()}` : 'Fără cheie API'; }
$('#keypill').addEventListener('click', openSettings);
$$('[data-open-settings]').forEach(b => b.addEventListener('click', openSettings));
$$('#provider-tabs button').forEach(b => b.addEventListener('click', () => { readSettingsUI(); S.provider = b.dataset.prov; saveS(); syncSettingsUI(); updateKeyPill(); }));
for (const p of ['gemini', 'openai']) $('#model-' + p).addEventListener('change', e => { $('#model-' + p + '-custom-w').hidden = e.target.value !== 'custom'; });
$('#key-save').addEventListener('click', () => { readSettingsUI(); $('#settings').classList.remove('open'); toast('Setări salvate'); if (current) openTool(current.id); });
$('#key-test').addEventListener('click', async () => { readSettingsUI(); const st = $('#key-status'); st.textContent = 'Testez…'; try { await P().test(); st.textContent = 'Cheia funcționează.'; st.style.color = 'var(--good)'; } catch (e) { st.textContent = 'Eroare: ' + e.message; st.style.color = 'var(--bad)'; } });

/* ---- temă ---- */
function applyTheme() { const t = S.theme || 'auto'; if (t === 'auto') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', t); $('#themebtn').dataset.mode = t; }
$('#themebtn').addEventListener('click', () => { S.theme = { auto: 'light', light: 'dark', dark: 'auto' }[S.theme || 'auto']; saveS(); applyTheme(); toast('Temă: ' + { auto: 'automată', light: 'luminoasă', dark: 'întunecată' }[S.theme]); });

/* =====================================================================
   6. Instrumente cu interfață proprie
   ===================================================================== */
const nearestRatio = (w, h) => { const r = w / h; let best = '1:1', bd = 9; for (const k of RATIOS) { const [a, b] = k.split(':').map(Number); const d = Math.abs(a / b - r); if (d < bd) { bd = d; best = k; } } return best; };
const canvasOf = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
function singleImage(container, label, initial) { const g = imageField({ k: 'img', label, multi: false }, initial ? [initial] : []); container.append(g.node); return g; }
function header(container, t, extra) { container.append(el('h3', {}, t.name), el('p', { class: 'desc' }, t.desc)); if (extra) container.append(extra); }
function nField(container, d = 1) { const g = segField({ k: 'n', t: 'count', label: 'Variante' }, [[1, '1'], [2, '2'], [3, '3'], [4, '4']], d); container.append(g.node); return () => +g.get(); }

/* ---- canvas de mască (inpainting) ---- */
async function maskEditor(stageEl, dataUrl) {
  const src = await fitDataURL(dataUrl, 1536, 'image/png'); const img = await loadImage(src);
  const W = img.width, H = img.height;
  const base = canvasOf(W, H); base.getContext('2d').drawImage(img, 0, 0);
  const over = canvasOf(W, H); over.className = 'over'; const ox = over.getContext('2d');
  const wrap = el('div', { class: 'cv-wrap' }, base, over);
  let brush = Math.round(Math.max(W, H) / 18), erase = false, drawing = false, last = null;
  const range = el('input', { type: 'range', min: 4, max: Math.round(Math.max(W, H) / 4), value: brush, oninput: e => brush = +e.target.value });
  const eraseBtn = el('button', { class: 'btn ghost small', type: 'button', 'aria-pressed': 'false', onclick: () => { erase = !erase; eraseBtn.setAttribute('aria-pressed', String(erase)); eraseBtn.textContent = erase ? 'Șterge din mască (activ)' : 'Șterge din mască'; } }, 'Șterge din mască');
  const clearBtn = el('button', { class: 'btn ghost small', type: 'button', onclick: () => ox.clearRect(0, 0, W, H) }, 'Curăță masca');
  const fillBtn = el('button', { class: 'btn ghost small', type: 'button', onclick: () => { ox.globalCompositeOperation = 'source-over'; ox.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--mask'); ox.fillRect(0, 0, W, H); } }, 'Selectează tot');
  const tools = el('div', { class: 'cv-tools' }, el('span', { class: 'hint', style: 'margin:0' }, 'Pensulă'), range, eraseBtn, clearBtn, fillBtn);
  const pos = e => { const r = over.getBoundingClientRect(); const p = e.touches ? e.touches[0] : e; return [(p.clientX - r.left) * W / r.width, (p.clientY - r.top) * H / r.height]; };
  const dot = (x, y) => { ox.globalCompositeOperation = erase ? 'destination-out' : 'source-over'; ox.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--mask'); ox.strokeStyle = ox.fillStyle; ox.lineWidth = brush; ox.lineCap = 'round'; ox.lineJoin = 'round'; if (last) { ox.beginPath(); ox.moveTo(last[0], last[1]); ox.lineTo(x, y); ox.stroke(); } else { ox.beginPath(); ox.arc(x, y, brush / 2, 0, Math.PI * 2); ox.fill(); } last = [x, y]; };
  const start = e => { e.preventDefault(); drawing = true; last = null; const [x, y] = pos(e); dot(x, y); };
  const move = e => { if (!drawing) return; e.preventDefault(); const [x, y] = pos(e); dot(x, y); };
  const end = () => { drawing = false; last = null; };
  over.addEventListener('pointerdown', start); over.addEventListener('pointermove', move); window.addEventListener('pointerup', end);
  stageEl.append(tools, wrap, el('p', { class: 'hint', style: 'margin-top:8px' }, 'Pictează peste zona de schimbat. Zona colorată este cea pe care modelul o va reface.'));
  return {
    W, H, src,
    hasMask() { const d = ox.getImageData(0, 0, W, H).data; for (let i = 3; i < d.length; i += 4 * 97) if (d[i] > 0) return true; return false; },
    // pentru OpenAI: PNG cu alfa 0 unde s-a pictat
    maskPNG() { const m = canvasOf(W, H); const mx = m.getContext('2d'); mx.drawImage(base, 0, 0); mx.globalCompositeOperation = 'destination-out'; mx.drawImage(over, 0, 0); return m.toDataURL('image/png'); },
    // pentru Gemini: imaginea cu zona marcată în magenta opac
    overlayPNG() { const m = canvasOf(W, H); const mx = m.getContext('2d'); mx.drawImage(base, 0, 0); mx.globalAlpha = 1; const solid = canvasOf(W, H); const sx = solid.getContext('2d'); sx.drawImage(over, 0, 0); sx.globalCompositeOperation = 'source-in'; sx.fillStyle = '#FF00C8'; sx.fillRect(0, 0, W, H); mx.drawImage(solid, 0, 0); return m.toDataURL('image/png'); },
  };
}

const CUSTOM = {};

/* ---- Inpainting ---- */
CUSTOM.inpaint = (p, s, t) => {
  header(p, t);
  const img = singleImage(p, 'Imaginea de retușat', incoming?.image);
  const prompt = el('textarea', { placeholder: 'ex. o pălărie roșie de paie; sau: elimină obiectul și completează fundalul' });
  p.append(el('div', { class: 'field' }, el('label', {}, 'Ce vrei în zona pictată', el('small', {}, 'obligatoriu')), prompt));
  const getN = nField(p);
  const btn = el('button', { class: 'btn primary wide', type: 'button' }, 'Generează'); p.append(btn);
  let ed = null, lastSrc = null;
  const refresh = async () => { const d = img.get()[0]; if (d && d !== lastSrc) { lastSrc = d; s.innerHTML = ''; ed = await maskEditor(s, d); } };
  img.node.addEventListener('click', () => setTimeout(refresh, 300)); img.node.addEventListener('drop', () => setTimeout(refresh, 300)); img.node.querySelector('input').addEventListener('change', () => setTimeout(refresh, 300));
  new MutationObserver(refresh).observe(img.node.querySelector('.thumbs'), { childList: true });
  if (incoming?.image) refresh(); else emptyStage('Încarcă o imagine: apare aici, cu pensula de mască.');
  btn.addEventListener('click', async () => {
    try {
      requireKey(); await refresh(); if (!ed) throw new Error('Încarcă o imagine.'); if (!prompt.value.trim()) throw new Error('Scrie ce vrei în zona pictată.'); if (!ed.hasMask()) throw new Error('Pictează mai întâi zona de schimbat.');
      busyBtn(btn, true); aborter = new AbortController();
      const n = getN(), ratio = nearestRatio(ed.W, ed.H), what = prompt.value.trim();
      const keepEd = s.innerHTML; const prog = stageBusy('Trimit imaginea și masca…');
      let imgs;
      if (S.provider === 'openai') imgs = await OpenAI.generate({ prompt: `Edit only the transparent (masked) region of the image: ${what}. Keep everything outside the mask unchanged. Match lighting, perspective and style seamlessly.`, refs: [ed.src], mask: ed.maskPNG(), ratio, n, signal: aborter.signal });
      else imgs = await Gemini.generate({ prompt: `The reference image has a region painted in solid bright magenta (#FF00C8). Replace ONLY that magenta region with: ${what}. Remove the magenta completely. Everything outside the magenta region must stay pixel-identical (same composition, colours, details). Match lighting, perspective and style seamlessly so the edit is invisible.`, refs: [ed.overlayPNG()], ratio, n, signal: aborter.signal });
      s.innerHTML = keepEd; ed = await (async () => { s.innerHTML = ''; return maskEditor(s, lastSrc); })();
      await showResults(imgs, { tool: 'inpaint', prompt: what }, { keep: true });
    } catch (e) { stageError(e); } finally { busyBtn(btn, false); aborter = null; }
  });
};

/* ---- Extindere (outpainting) ---- */
CUSTOM.outpaint = (p, s, t) => {
  header(p, t);
  const img = singleImage(p, 'Imaginea de extins', incoming?.image);
  const dirs = new Set(['l', 'r']);
  const grid = el('div', { class: 'outpaint-grid' });
  for (const k of ['tl', 't', 'tr', 'l', 'c', 'r', 'bl', 'b', 'br']) grid.append(k === 'c' ? el('button', { type: 'button', class: 'c', disabled: true }, '▣') : el('button', { type: 'button', 'aria-pressed': String(dirs.has(k)), onclick: e => { dirs.has(k) ? dirs.delete(k) : dirs.add(k); e.target.setAttribute('aria-pressed', String(dirs.has(k))); } }, { tl: '↖', t: '↑', tr: '↗', l: '←', r: '→', bl: '↙', b: '↓', br: '↘' }[k]));
  p.append(el('div', { class: 'field' }, el('label', {}, 'Direcții de extindere'), grid));
  const amt = el('select', {}, el('option', { value: '0.25' }, '25 %'), el('option', { value: '0.5', selected: true }, '50 %'), el('option', { value: '1' }, '100 %'));
  p.append(el('div', { class: 'field' }, el('label', {}, 'Cât de mult, față de latura imaginii'), amt));
  const prompt = el('textarea', { placeholder: 'opțional: ce ar trebui să apară în zona nouă' });
  p.append(el('div', { class: 'field' }, el('label', {}, 'Indicații', el('small', {}, 'opțional')), prompt));
  const getN = nField(p);
  const btn = el('button', { class: 'btn primary wide', type: 'button' }, 'Extinde'); p.append(btn);
  emptyStage('Alege direcțiile și apasă „Extinde”.');
  btn.addEventListener('click', async () => {
    try {
      requireKey(); const d = img.get()[0]; if (!d) throw new Error('Încarcă o imagine.'); if (!dirs.size) throw new Error('Alege cel puțin o direcție.');
      busyBtn(btn, true); aborter = new AbortController(); const prog = stageBusy('Construiesc canvasul extins…');
      const im = await loadImage(await fitDataURL(d, 1280, 'image/png')); const a = +amt.value;
      const L = [...dirs].some(k => k.includes('l')) ? Math.round(im.width * a) : 0, R = [...dirs].some(k => k.includes('r')) ? Math.round(im.width * a) : 0;
      const T = [...dirs].some(k => k.includes('t')) ? Math.round(im.height * a) : 0, B = [...dirs].some(k => k.includes('b')) ? Math.round(im.height * a) : 0;
      const W = im.width + L + R, H = im.height + T + B;
      const mk = (fill) => { const c = canvasOf(W, H); const x = c.getContext('2d'); if (fill) { x.fillStyle = fill; x.fillRect(0, 0, W, H); } x.drawImage(im, L, T); return c.toDataURL('image/png'); };
      const ratio = nearestRatio(W, H), n = getN(), extra = prompt.value.trim();
      let imgs;
      if (S.provider === 'openai') imgs = await OpenAI.generate({ prompt: `Extend the picture into the transparent areas so the scene continues naturally and seamlessly (same style, perspective, lighting, textures). ${extra}`, refs: [mk(null)], mask: mk(null), ratio, n, signal: aborter.signal });
      else imgs = await Gemini.generate({ prompt: `The reference image has been placed on a larger canvas; the solid bright magenta (#FF00C8) areas are empty. Fill ONLY the magenta areas by continuing the scene naturally and seamlessly outward (same style, perspective, lighting, textures, horizon). Keep the original picture area pixel-identical. No magenta may remain. ${extra}`, refs: [mk('#FF00C8')], ratio, n, signal: aborter.signal });
      await showResults(imgs, { tool: 'outpaint', prompt: 'Extindere ' + [...dirs].join(',') + ' ' + extra });
    } catch (e) { stageError(e); } finally { busyBtn(btn, false); aborter = null; }
  });
};

/* ---- Eliminare fundal ---- */
CUSTOM.bgremove = (p, s, t) => {
  header(p, t, el('div', { class: 'note' }, 'Metoda locală descarcă o singură dată un model de circa 40 MB și rulează pe dispozitivul tău, gratuit. Metoda AI trimite imaginea la furnizor și returnează fundal alb (modelele nu produc transparență).'));
  const img = singleImage(p, 'Imaginea', incoming?.image);
  const method = el('select', {}, el('option', { value: 'local' }, 'Local, în browser (PNG transparent)'), el('option', { value: 'ai' }, 'Cu modelul AI (fundal alb)'));
  p.append(el('div', { class: 'field' }, el('label', {}, 'Metodă'), method));
  const btn = el('button', { class: 'btn primary wide', type: 'button' }, 'Elimină fundalul'); p.append(btn);
  emptyStage('Încarcă o imagine și apasă butonul.');
  btn.addEventListener('click', async () => {
    try {
      const d = img.get()[0]; if (!d) throw new Error('Încarcă o imagine.');
      busyBtn(btn, true); const prog = stageBusy(method.value === 'local' ? 'Încarc modelul local (prima dată durează)…' : 'Trimit imaginea…');
      let out;
      if (method.value === 'local') {
        const mod = await import(LIB.imgly);
        const blob = await mod.removeBackground(dataURLtoBlob(await fitDataURL(d, 2048, 'image/png')), { progress: (k, cur, tot) => prog.set(`${k}: ${Math.round(cur / (tot || 1) * 100)} %`) });
        out = await fileToDataURL(blob);
      } else { requireKey(); aborter = new AbortController(); const im = await loadImage(d); out = (await P().generate({ prompt: 'Remove the background completely and place the exact same subject, unchanged, on a pure flat white (#FFFFFF) background. Clean, precise edges, no shadow, no added elements.', refs: [d], ratio: nearestRatio(im.width, im.height), n: 1, signal: aborter.signal }))[0]; }
      s.innerHTML = '';
      s.append(el('div', { class: 'cmpimg' }, el('figure', {}, el('img', { src: d, alt: '' }), el('figcaption', {}, 'Înainte')), el('figure', { style: 'background:repeating-conic-gradient(var(--surface-2) 0 25%,var(--surface) 0 50%) 0 0/18px 18px' }, el('img', { src: out, alt: '' }), el('figcaption', {}, 'După'))));
      await showResults([out], { tool: 'bgremove', prompt: 'Fundal eliminat' }, { keep: true, transparent: true });
    } catch (e) { stageError(new Error(e.message + (method.value === 'local' ? ' — încearcă metoda AI dacă modelul local nu se poate încărca.' : ''))); } finally { busyBtn(btn, false); aborter = null; }
  });
};

/* ---- Upscaler ---- */
function sharpen(c, amount = 0.35) {
  const x = c.getContext('2d'); const { width: W, height: H } = c; const src = x.getImageData(0, 0, W, H); const d = src.data; const out = new Uint8ClampedArray(d);
  const k = [0, -1, 0, -1, 5, -1, 0, -1, 0];
  for (let y = 1; y < H - 1; y++) for (let xx = 1; xx < W - 1; xx++) for (let ch = 0; ch < 3; ch++) { let v = 0, i = 0; for (let ky = -1; ky <= 1; ky++) for (let kx = -1; kx <= 1; kx++) v += d[((y + ky) * W + (xx + kx)) * 4 + ch] * k[i++]; const o = (y * W + xx) * 4 + ch; out[o] = d[o] + (v - d[o]) * amount; }
  src.data.set(out); x.putImageData(src, 0, 0);
}
async function localUpscale(d, f) {
  let im = await loadImage(d); let c = canvasOf(im.width, im.height); c.getContext('2d').drawImage(im, 0, 0);
  for (let s = 1; s < f; s *= 2) { const n = canvasOf(c.width * 2, c.height * 2); const x = n.getContext('2d'); x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high'; x.drawImage(c, 0, 0, n.width, n.height); sharpen(n); c = n; if (c.width > 8192) break; }
  return c.toDataURL('image/png');
}
CUSTOM.upscale = (p, s, t) => {
  header(p, t);
  const img = singleImage(p, 'Imaginea', incoming?.image);
  const mode = el('select', {}, el('option', { value: 'l2' }, 'Local 2× (instant, gratuit)'), el('option', { value: 'l4' }, 'Local 4× (instant, gratuit)'), el('option', { value: 'ai2' }, 'AI: re-randare la 2K (Gemini 3 Pro Image)'), el('option', { value: 'ai4' }, 'AI: re-randare la 4K (Gemini 3 Pro Image)'), el('option', { value: 'aie' }, 'AI: adaugă detalii (orice model, aceeași rezoluție)'));
  p.append(el('div', { class: 'field' }, el('label', {}, 'Metodă'), mode), el('p', { class: 'hint' }, 'Metoda locală mărește prin resampling și accentuare; nu inventează detalii. Variantele AI re-randează imaginea, deci pot apărea mici diferențe.'));
  const btn = el('button', { class: 'btn primary wide', type: 'button' }, 'Mărește'); p.append(btn);
  emptyStage('Încarcă o imagine și alege metoda.');
  btn.addEventListener('click', async () => {
    try {
      const d = img.get()[0]; if (!d) throw new Error('Încarcă o imagine.');
      busyBtn(btn, true); stageBusy('Procesez…'); let out; const im = await loadImage(d);
      if (mode.value.startsWith('l')) out = await localUpscale(d, mode.value === 'l2' ? 2 : 4);
      else { requireKey(); aborter = new AbortController(); const size = mode.value === 'ai2' ? '2K' : mode.value === 'ai4' ? '4K' : undefined; if (size && !isGeminiPro()) throw new Error('Pentru 2K/4K alege în setări modelul gemini-3-pro-image-preview.'); out = (await P().generate({ prompt: 'Upscale and enhance this image: reproduce it EXACTLY (same composition, subjects, colours, text) at higher resolution with sharper details, finer textures and no artifacts. Do not add, remove or change anything.', refs: [d], ratio: nearestRatio(im.width, im.height), n: 1, size, signal: aborter.signal }))[0]; }
      const om = await loadImage(out); s.innerHTML = '';
      s.append(el('div', { class: 'cmpimg' }, el('figure', {}, el('img', { src: d, alt: '' }), el('figcaption', {}, `Înainte · ${im.width}×${im.height}`)), el('figure', {}, el('img', { src: out, alt: '' }), el('figcaption', {}, `După · ${om.width}×${om.height}`))));
      await showResults([out], { tool: 'upscale', prompt: 'Upscale ' + mode.value }, { keep: true });
    } catch (e) { stageError(e); } finally { busyBtn(btn, false); aborter = null; }
  });
};

/* ---- Editor tip Canva (fabric.js) ---- */
CUSTOM.editor = async (p, s, t) => {
  header(p, t);
  const preset = el('select', {}, el('option', { value: '1080x1080' }, 'Instagram 1080×1080'), el('option', { value: '1080x1350' }, 'Instagram portret 1080×1350'), el('option', { value: '1080x1920' }, 'Story 1080×1920'), el('option', { value: '1280x720' }, 'YouTube thumbnail 1280×720'), el('option', { value: '1000x1500' }, 'Pinterest 1000×1500'), el('option', { value: '1920x1080' }, 'Full HD 1920×1080'), el('option', { value: '2550x3300' }, 'Letter 300 dpi 2550×3300'), el('option', { value: '2480x3508' }, 'A4 300 dpi 2480×3508'));
  const bg = el('input', { type: 'color', value: '#ffffff' });
  p.append(el('div', { class: 'field' }, el('label', {}, 'Dimensiunea canvasului'), preset), el('div', { class: 'field' }, el('label', {}, 'Fundal'), bg));
  const fonts = ['Hanken Grotesk', 'Newsreader', 'JetBrains Mono', 'Arial', 'Georgia', 'Impact', 'Verdana', 'Trebuchet MS', 'Courier New', 'Comic Sans MS', 'Times New Roman'];
  const addText = el('button', { class: 'btn ghost small', type: 'button' }, '+ Text'), addRect = el('button', { class: 'btn ghost small', type: 'button' }, '+ Dreptunghi'), addCircle = el('button', { class: 'btn ghost small', type: 'button' }, '+ Cerc'), addImg = el('label', { class: 'btn ghost small' }, '+ Imagine', el('input', { type: 'file', accept: 'image/*', style: 'display:none' })), addGal = el('button', { class: 'btn ghost small', type: 'button' }, '+ Din galerie');
  p.append(el('div', { class: 'field' }, el('label', {}, 'Adaugă'), el('div', { class: 'seg' }, addText, addRect, addCircle, addImg, addGal)));
  const scale = el('select', {}, el('option', { value: '1' }, '1×'), el('option', { value: '2' }, '2×'));
  const expPng = el('button', { class: 'btn primary small', type: 'button' }, 'Export PNG'), expJpg = el('button', { class: 'btn ghost small', type: 'button' }, 'Export JPG'), toGal = el('button', { class: 'btn ghost small', type: 'button' }, 'Salvează în galerie');
  p.append(el('div', { class: 'field' }, el('label', {}, 'Export'), el('div', { class: 'seg' }, scale, expPng, expJpg, toGal)));
  p.append(el('div', { class: 'field' }, el('label', {}, 'Straturi'), el('div', { class: 'layers', id: 'layers' })));
  stageBusy('Încarc editorul…');
  try { await loadScript(LIB.fabric); } catch (e) { return stageError(e); }
  s.innerHTML = '';
  const bar = el('div', { class: 'ed-bar' });
  const fontSel = el('select', {}); fonts.forEach(f => fontSel.append(el('option', { value: f, style: `font-family:'${f}'` }, f)));
  const sizeIn = el('input', { type: 'number', min: 6, max: 600, value: 64, style: 'width:70px' }), colorIn = el('input', { type: 'color', value: '#1A1730' });
  const bold = el('button', { class: 'btn ghost small', type: 'button' }, 'B'), italic = el('button', { class: 'btn ghost small', type: 'button' }, 'I'), alignBtn = el('button', { class: 'btn ghost small', type: 'button' }, 'Aliniere'), strokeBtn = el('button', { class: 'btn ghost small', type: 'button' }, 'Contur'), shadowBtn = el('button', { class: 'btn ghost small', type: 'button' }, 'Umbră');
  const opac = el('input', { type: 'range', min: 0, max: 1, step: 0.05, value: 1, title: 'Opacitate' });
  const up = el('button', { class: 'btn ghost small', type: 'button' }, '▲ Sus'), down = el('button', { class: 'btn ghost small', type: 'button' }, '▼ Jos'), dup = el('button', { class: 'btn ghost small', type: 'button' }, 'Duplică'), del = el('button', { class: 'btn ghost small danger', type: 'button' }, 'Șterge'), center = el('button', { class: 'btn ghost small', type: 'button' }, 'Centrează'), fit = el('button', { class: 'btn ghost small', type: 'button' }, 'Umple canvasul');
  bar.append(fontSel, sizeIn, colorIn, bold, italic, alignBtn, strokeBtn, shadowBtn, opac, up, down, dup, center, fit, del);
  const cvEl = el('canvas'); const wrap = el('div', { class: 'ed-canvas' }, cvEl);
  s.append(bar, wrap, el('p', { class: 'hint', style: 'margin-top:8px' }, 'Dublu-click pe text pentru a-l edita. Trage colțurile pentru a redimensiona. Delete șterge obiectul selectat.'));
  const fc = new fabric.Canvas(cvEl, { preserveObjectStacking: true, backgroundColor: bg.value });
  let W = 1080, H = 1080;
  const fitView = () => { const avail = Math.min(wrap.clientWidth - 2, 900); const z = Math.min(1, avail / W); fc.setZoom(z); fc.setWidth(W * z); fc.setHeight(H * z); fc.requestRenderAll(); };
  const setSize = (w, h) => { W = w; H = h; fitView(); };
  preset.addEventListener('change', () => { const [w, h] = preset.value.split('x').map(Number); setSize(w, h); });
  bg.addEventListener('input', () => { fc.setBackgroundColor(bg.value, () => fc.requestRenderAll()); });
  window.addEventListener('resize', fitView);
  const layers = $('#layers', p);
  const redrawLayers = () => { layers.innerHTML = ''; const objs = fc.getObjects().slice().reverse(); for (const o of objs) layers.append(el('button', { type: 'button', 'aria-current': fc.getActiveObject() === o ? 'true' : 'false', onclick: () => { fc.setActiveObject(o); fc.requestRenderAll(); } }, o.type === 'i-text' || o.type === 'textbox' ? 'T · ' + (o.text || '').slice(0, 24) : o.type === 'image' ? '▣ Imagine' : '◆ ' + o.type)); };
  fc.on('object:added', redrawLayers); fc.on('object:removed', redrawLayers); fc.on('selection:created', syncBar); fc.on('selection:updated', syncBar); fc.on('selection:cleared', redrawLayers);
  function syncBar() { const o = fc.getActiveObject(); redrawLayers(); if (!o) return; if (o.fontFamily) fontSel.value = o.fontFamily; if (o.fontSize) sizeIn.value = o.fontSize; if (typeof o.fill === 'string' && /^#/.test(o.fill)) colorIn.value = o.fill; opac.value = o.opacity ?? 1; }
  const act = fn => { const o = fc.getActiveObject(); if (!o) return toast('Selectează un obiect'); fn(o); o.setCoords(); fc.requestRenderAll(); };
  fontSel.addEventListener('change', () => act(o => o.set('fontFamily', fontSel.value)));
  sizeIn.addEventListener('input', () => act(o => o.set('fontSize', +sizeIn.value)));
  colorIn.addEventListener('input', () => act(o => o.set('fill', colorIn.value)));
  bold.addEventListener('click', () => act(o => o.set('fontWeight', o.fontWeight === 'bold' ? 'normal' : 'bold')));
  italic.addEventListener('click', () => act(o => o.set('fontStyle', o.fontStyle === 'italic' ? 'normal' : 'italic')));
  alignBtn.addEventListener('click', () => act(o => o.set('textAlign', { left: 'center', center: 'right', right: 'left' }[o.textAlign || 'left'])));
  strokeBtn.addEventListener('click', () => act(o => o.set(o.strokeWidth ? { strokeWidth: 0 } : { stroke: '#000000', strokeWidth: Math.max(1, (o.fontSize || 40) / 16) })));
  shadowBtn.addEventListener('click', () => act(o => o.set('shadow', o.shadow ? null : new fabric.Shadow({ color: 'rgba(0,0,0,.5)', blur: 12, offsetX: 4, offsetY: 6 }))));
  opac.addEventListener('input', () => act(o => o.set('opacity', +opac.value)));
  up.addEventListener('click', () => act(o => fc.bringForward(o))); down.addEventListener('click', () => act(o => fc.sendBackwards(o)));
  del.addEventListener('click', () => act(o => fc.remove(o))); center.addEventListener('click', () => act(o => { o.set({ left: W / 2, top: H / 2, originX: 'center', originY: 'center' }); }));
  fit.addEventListener('click', () => act(o => { const sc = Math.max(W / o.width, H / o.height); o.set({ scaleX: sc, scaleY: sc, left: W / 2, top: H / 2, originX: 'center', originY: 'center' }); }));
  dup.addEventListener('click', () => act(o => o.clone(c => { c.set({ left: o.left + 30, top: o.top + 30 }); fc.add(c); fc.setActiveObject(c); })));
  document.addEventListener('keydown', e => { if ((e.key === 'Delete' || e.key === 'Backspace') && fc.getActiveObject() && !fc.getActiveObject().isEditing && !/input|textarea/i.test(e.target.tagName)) { fc.remove(fc.getActiveObject()); } });
  addText.addEventListener('click', () => { const tx = new fabric.IText('Textul tău', { left: W / 2, top: H / 2, originX: 'center', originY: 'center', fontFamily: fontSel.value, fontSize: Math.round(W / 12), fill: colorIn.value }); fc.add(tx); fc.setActiveObject(tx); });
  addRect.addEventListener('click', () => { fc.add(new fabric.Rect({ left: W / 2, top: H / 2, originX: 'center', originY: 'center', width: W / 3, height: H / 5, fill: colorIn.value, rx: 24, ry: 24 })); });
  addCircle.addEventListener('click', () => { fc.add(new fabric.Circle({ left: W / 2, top: H / 2, originX: 'center', originY: 'center', radius: W / 6, fill: colorIn.value })); });
  const addImage = (d, asBg) => fabric.Image.fromURL(d, im => { if (asBg) { setSize(Math.min(im.width, 2048), Math.round(Math.min(im.width, 2048) * im.height / im.width)); const sc = W / im.width; im.set({ scaleX: sc, scaleY: sc, left: 0, top: 0, selectable: true }); fc.add(im); fc.sendToBack(im); } else { const sc = Math.min(W / im.width, H / im.height) * 0.6; im.set({ scaleX: sc, scaleY: sc, left: W / 2, top: H / 2, originX: 'center', originY: 'center' }); fc.add(im); fc.setActiveObject(im); } fc.requestRenderAll(); }, { crossOrigin: 'anonymous' });
  addImg.querySelector('input').addEventListener('change', async e => { for (const f of e.target.files) addImage(await fileToDataURL(f), false); });
  addGal.addEventListener('click', () => pickFromGallery(d => addImage(d, fc.getObjects().length === 0)));
  const exportData = (fmt) => { const z = fc.getZoom(); fc.setZoom(1); fc.setWidth(W); fc.setHeight(H); const d = fc.toDataURL({ format: fmt, quality: 0.92, multiplier: +scale.value }); fc.setZoom(z); fc.setWidth(W * z); fc.setHeight(H * z); return d; };
  expPng.addEventListener('click', () => download(exportData('png'), `atelier-editor-${stamp()}.png`));
  expJpg.addEventListener('click', () => download(exportData('jpeg'), `atelier-editor-${stamp()}.jpg`));
  toGal.addEventListener('click', async () => { await DB.put('images', { id: uid(), tool: 'editor', prompt: 'Editor', data: exportData('png'), t: Date.now() }); refreshGallery(); toast('Salvat în galerie'); });
  setSize(W, H);
  if (incoming?.image) addImage(incoming.image, true);
};

/* ---- Personaj consistent ---- */
async function charGrid(container, selected, onToggle) {
  const chars = (await DB.all('characters')).sort((a, b) => b.t - a.t);
  container.innerHTML = '';
  if (!chars.length) { container.append(el('p', { class: 'hint' }, 'Niciun personaj salvat încă.')); return chars; }
  const g = el('div', { class: 'chars' });
  for (const c of chars) g.append(el('button', { type: 'button', class: 'char', 'aria-pressed': String(selected.has(c.id)), onclick: e => { onToggle(c); e.currentTarget.setAttribute('aria-pressed', String(selected.has(c.id))); }, oncontextmenu: async e => { e.preventDefault(); if (confirm(`Ștergi personajul „${c.name}”?`)) { await DB.del('characters', c.id); selected.delete(c.id); charGrid(container, selected, onToggle); } } }, el('img', { src: c.sheet, alt: c.name }), el('b', {}, c.name)));
  container.append(g, el('p', { class: 'hint', style: 'margin-top:6px' }, 'Click pentru selectare, click-dreapta pentru ștergere.'));
  return chars;
}
async function makeCharacterSheet({ name, desc, style, refs = [], signal }) {
  const prompt = `Character reference sheet for "${name}": ${desc}. ${refs.length ? 'Base the character faithfully on the person/creature in the reference photo(s). ' : ''}Show the SAME character three times side by side on a plain white background: full-body front view, full-body side view, and a close-up of the face with a neutral expression. Consistent proportions, colours and outfit. ${styleP(style) ? 'Style: ' + styleP(style) + '. ' : ''}${NOTEXT}`;
  return (await P().generate({ prompt, refs, ratio: '16:9', n: 1, signal }))[0];
}
CUSTOM.character = (p, s, t) => {
  header(p, t);
  const selected = new Set();
  const gridBox = el('div', {}); const results = el('div', {});
  s.append(el('div', { class: 'stage-top' }, el('h4', {}, 'Personajele tale')), gridBox, results);
  const redraw = () => charGrid(gridBox, selected, c => { selected.has(c.id) ? selected.delete(c.id) : selected.add(c.id); });
  redraw();
  // Tab: personaj nou
  const tabs = el('div', { class: 'provider-tabs' }); const tabNew = el('button', { type: 'button', 'aria-pressed': 'true' }, 'Personaj nou'), tabScene = el('button', { type: 'button', 'aria-pressed': 'false' }, 'Scenă cu personaje');
  tabs.append(tabNew, tabScene); p.append(tabs);
  const boxNew = el('div', {}), boxScene = el('div', { hidden: true }); p.append(boxNew, boxScene);
  tabNew.addEventListener('click', () => { boxNew.hidden = false; boxScene.hidden = true; tabNew.setAttribute('aria-pressed', 'true'); tabScene.setAttribute('aria-pressed', 'false'); });
  tabScene.addEventListener('click', () => { boxNew.hidden = true; boxScene.hidden = false; tabNew.setAttribute('aria-pressed', 'false'); tabScene.setAttribute('aria-pressed', 'true'); });
  const readNew = buildForm([{ k: 'name', t: 'text', label: 'Nume', req: true, ph: 'Mira' }, { k: 'desc', t: 'textarea', label: 'Descriere vizuală', req: true, ph: 'fetiță de 7 ani, păr roșcat împletit, pistrui, salopetă galbenă, cizme verzi, întotdeauna cu un fluture albastru pe umăr' }, F.img('ref', 'Poze de referință (opțional: tu, un copil, un animal)', true), F.style('storybook')], boxNew);
  const btnNew = el('button', { class: 'btn primary wide', type: 'button' }, 'Creează fișa de personaj'); boxNew.append(btnNew);
  btnNew.addEventListener('click', async () => {
    try { requireKey(); const v = readNew(); if (!v.name || !v.desc) throw new Error('Completează numele și descrierea.'); busyBtn(btnNew, true); aborter = new AbortController(); results.innerHTML = ''; results.append(el('div', { class: 'progress' }, el('span', { class: 'spin' }), 'Generez fișa de personaj…'));
      const sheet = await makeCharacterSheet({ ...v, refs: v.ref, signal: aborter.signal });
      await DB.put('characters', { id: uid(), name: v.name, desc: v.desc, style: v.style, sheet, t: Date.now() });
      await DB.put('images', { id: uid(), tool: 'character', prompt: 'Fișă: ' + v.name, data: sheet, t: Date.now() }); refreshGallery();
      results.innerHTML = ''; toast('Personaj salvat'); redraw(); tabScene.click();
    } catch (e) { results.innerHTML = ''; results.append(el('div', { class: 'note err' }, 'Eroare: ' + e.message)); } finally { busyBtn(btnNew, false); btnNew.textContent = 'Creează fișa de personaj'; aborter = null; }
  });
  // Tab: scenă
  boxScene.append(el('p', { class: 'hint' }, 'Selectează 1–3 personaje din dreapta, apoi descrie scena.'));
  const readScene = buildForm([{ k: 'scene', t: 'textarea', label: 'Scena', req: true, ph: 'Mira și Tobi construiesc o navă din cutii de carton în pod, lumină de după-amiază' }, F.style('storybook'), F.ratio('4:3'), F.n(), F.enh()], boxScene);
  const btnScene = el('button', { class: 'btn primary wide', type: 'button' }, 'Generează scena'); boxScene.append(btnScene);
  btnScene.addEventListener('click', async () => {
    try { requireKey(); const v = readScene(); if (!v.scene) throw new Error('Descrie scena.'); if (!selected.size) throw new Error('Selectează cel puțin un personaj din dreapta.'); if (selected.size > 3) throw new Error('Maximum 3 personaje.');
      const chars = (await DB.all('characters')).filter(c => selected.has(c.id));
      busyBtn(btnScene, true); aborter = new AbortController(); results.innerHTML = ''; results.append(el('div', { class: 'progress' }, el('span', { class: 'spin' }), 'Generez scena…'));
      let prompt = `${chars.map((c, i) => `Reference image ${i + 1} is the character sheet of "${c.name}" (${c.desc}).`).join(' ')} Draw ${chars.length === 1 ? 'this character' : 'these characters'} EXACTLY as in the reference sheets (same face, hair, colours, outfit, proportions) in the following scene: ${v.scene}. ${styleP(v.style) ? 'Style: ' + styleP(v.style) + '. ' : ''}${NOTEXT}`;
      if (v.enhance) prompt = await enhancePrompt(prompt, 'Keep the sentences about reference images and character consistency.');
      const imgs = await P().generate({ prompt, refs: chars.map(c => c.sheet), ratio: v.ratio, n: v.n, signal: aborter.signal });
      results.innerHTML = ''; const grid = el('div', { class: 'results' }); results.append(grid);
      for (const d of imgs) { const rec = { id: uid(), tool: 'character', prompt: v.scene, data: d, t: Date.now() }; await DB.put('images', rec); grid.append(resultCard(rec)); }
      refreshGallery();
    } catch (e) { results.innerHTML = ''; results.append(el('div', { class: 'note err' }, 'Eroare: ' + e.message)); } finally { busyBtn(btnScene, false); btnScene.textContent = 'Generează scena'; aborter = null; }
  });
};

/* ---- Studio storybook / carte de colorat / storyboard ---- */
CUSTOM.storyboard = (p, s, t) => CUSTOM.storybook(p, s, t, 'storyboard');
CUSTOM.storybook = async (p, s, t, mode = 'storybook') => {
  header(p, t);
  let book = null; // {id, title, mode, character, sheet, style, lang, trim, pages:[{n,text,scene,img}], cover}
  const chars = (await DB.all('characters')).sort((a, b) => b.t - a.t);
  const fields = [
    { k: 'mode', t: 'select', label: 'Tip', d: mode, opts: [['storybook', 'Carte ilustrată pentru copii'], ['coloring', 'Carte de colorat'], ['storyboard', 'Storyboard din scenariu'], ['bible', 'Povestiri biblice ilustrate'], ['personal', 'Carte personalizată (copilul tău ca erou)']] },
    { k: 'title', t: 'text', label: 'Titlu', ph: 'lasă gol ca să propună modelul', opt: true },
    { k: 'char', t: 'select', label: 'Personaj principal', opts: [['new', 'Descriu mai jos (se creează fișă nouă)'], ...chars.map(c => [c.id, 'Salvat: ' + c.name])] },
    { k: 'hero', t: 'textarea', label: 'Descrierea eroului (dacă nu ai ales unul salvat)', ph: 'un pui de elefant timid, gri-albăstrui, cu o eșarfă portocalie' },
    F.img('heroref', 'Poză de referință pentru erou (opțional, ex. copilul tău)', false),
    { k: 'premise', t: 'textarea', label: 'Despre ce este povestea / scenariul', req: true, ph: 'Eroul se teme de întuneric și descoperă că licuricii sunt prieteni. Lecție: curajul crește cu fiecare pas mic.' },
    { k: 'age', t: 'select', label: 'Vârsta cititorilor', opts: [['2-4', '2–4 ani (o propoziție pe pagină)'], ['4-7', '4–7 ani (2–3 propoziții)'], ['7-10', '7–10 ani (paragraf scurt)']] },
    { k: 'pages', t: 'number', label: 'Număr de pagini', d: 8, min: 2, max: 24 },
    { k: 'lang', t: 'select', label: 'Limba textului', opts: [['română', 'Română'], ['engleză', 'Engleză'], ['germană', 'Germană'], ['franceză', 'Franceză'], ['spaniolă', 'Spaniolă'], ['italiană', 'Italiană']] },
    { k: 'trim', t: 'select', label: 'Format KDP pentru PDF', opts: KDP },
    F.style(mode === 'storyboard' ? 'storyboard' : 'storybook'),
  ];
  const read = buildForm(fields, p);
  const b1 = el('button', { class: 'btn primary wide', type: 'button' }, '1. Scrie povestea'), b2 = el('button', { class: 'btn ghost wide', type: 'button', disabled: true }, '2. Ilustrează paginile'), b3 = el('button', { class: 'btn ghost wide', type: 'button', disabled: true }, '3. Export PDF (KDP)'), b4 = el('button', { class: 'btn ghost wide', type: 'button', disabled: true }, 'Export ZIP cu imagini');
  p.append(el('div', { class: 'seg', style: 'flex-direction:column;gap:8px' }, b1, b2, b3, b4));
  const prev = (await DB.all('books')).sort((a, b) => b.t - a.t)[0];
  if (prev) p.append(el('button', { class: 'btn ghost small wide', type: 'button', style: 'margin-top:8px', onclick: () => { book = prev; renderBook(); } }, `Continuă cartea anterioară: „${prev.title}”`));
  emptyStage('Completează formularul și apasă „1. Scrie povestea”. Textul apare aici, editabil, apoi ilustrezi paginile.');
  const saveBook = async () => { if (book) { book.t = Date.now(); await DB.put('books', book); } };
  function renderBook() {
    s.innerHTML = ''; b2.disabled = false; b3.disabled = !book.pages.some(pg => pg.img); b4.disabled = b3.disabled;
    const titleIn = el('input', { type: 'text', value: book.title, style: 'font-family:Newsreader,serif;font-size:22px;border:none;background:none;width:100%;color:inherit' }); titleIn.addEventListener('input', () => { book.title = titleIn.value; saveBook(); });
    s.append(el('div', { class: 'stage-top' }, titleIn), el('div', { class: 'kv' }, el('b', {}, 'Erou'), el('span', {}, book.character), el('b', {}, 'Tip'), el('span', {}, book.mode), el('b', {}, 'Pagini'), el('span', {}, book.pages.length + '')));
    const grid = el('div', { class: 'book-pages' });
    const pageCard = (pg, isCover) => {
      const ta = el('textarea', { placeholder: 'text' }); ta.value = isCover ? (book.coverScene || '') : pg.text; ta.addEventListener('input', () => { if (isCover) book.coverScene = ta.value; else pg.text = ta.value; saveBook(); });
      const sceneTa = el('textarea', { placeholder: 'descrierea ilustrației (engleză)', style: 'font-size:11.5px;color:var(--ink-3);min-height:52px' }); sceneTa.value = isCover ? '' : pg.scene; sceneTa.addEventListener('input', () => { pg.scene = sceneTa.value; saveBook(); });
      const imgBox = el('div', { class: 'img' }, (isCover ? book.cover : pg.img) ? el('img', { src: isCover ? book.cover : pg.img, alt: '', onclick: () => lightbox({ id: '', tool: 'storybook', prompt: pg?.text || book.title, data: isCover ? book.cover : pg.img, t: book.t }) }) : 'neilustrată');
      const regen = el('button', { type: 'button', onclick: async () => { try { requireKey(); imgBox.innerHTML = ''; imgBox.append(el('span', { class: 'spin' })); await illustrate(isCover ? 'cover' : pg); renderBook(); } catch (e) { toast('Eroare: ' + e.message, 5000); renderBook(); } } }, (isCover ? book.cover : pg.img) ? 'Regenerează' : 'Ilustrează');
      return el('div', { class: 'bp' }, imgBox, isCover ? el('div', { class: 'bp-h' }, 'Copertă', regen) : el('div', { class: 'bp-h' }, 'Pagina ' + pg.n, regen), isCover ? null : ta, isCover ? null : sceneTa);
    };
    grid.append(pageCard(null, true)); book.pages.forEach(pg => grid.append(pageCard(pg, false)));
    s.append(grid);
  }
  async function ensureSheet(v) {
    if (v.char !== 'new') { const c = chars.find(c => c.id === v.char); return { desc: c.desc, sheet: c.sheet }; }
    const desc = book?.character || v.hero || 'the main character';
    const sheet = await makeCharacterSheet({ name: book?.title || 'Hero', desc, style: v.style, refs: v.heroref, signal: aborter?.signal });
    await DB.put('characters', { id: uid(), name: (book?.title || 'Erou').slice(0, 30), desc, style: v.style, sheet, t: Date.now() });
    return { desc, sheet };
  }
  async function illustrate(target) {
    const v = read(); const sty = styleP(book.style || v.style);
    const isColoring = book.mode === 'coloring', isBoard = book.mode === 'storyboard';
    const common = `Main character: ${book.character}. It must look EXACTLY like in the reference image (same face, colours, outfit, proportions). ${sty ? 'Style: ' + sty + '. ' : ''}${isColoring ? 'Coloring book page: clean black line art on pure white, no shading, no grey, no colour. ' : ''}${isBoard ? 'Storyboard frame, cinematic 16:9 composition, indicate camera angle. ' : 'Consistent illustration style across all pages. '}${NOTEXT}`;
    const ratio = isBoard ? '16:9' : book.trim === '8.5x11' ? '3:4' : book.trim === '6x9' || book.trim === '5x8' ? '2:3' : book.trim === '8x10' ? '4:5' : '1:1';
    if (target === 'cover') { book.cover = (await P().generate({ prompt: `Front cover illustration for the ${isColoring ? 'coloring' : 'picture'} book "${book.title}": ${book.coverScene || book.premise}. ${common}`, refs: [book.sheet], ratio, n: 1, signal: aborter?.signal }))[0]; }
    else { const prevImg = book.pages.find(pg => pg.n === target.n - 1)?.img; target.img = (await P().generate({ prompt: `Illustration for page ${target.n} of ${book.pages.length}: ${target.scene}. ${common}${prevImg ? ' The second reference image is the previous page: keep the same visual style, palette and rendering.' : ''}`, refs: prevImg ? [book.sheet, prevImg] : [book.sheet], ratio, n: 1, signal: aborter?.signal }))[0]; }
    await DB.put('images', { id: uid(), tool: 'storybook', prompt: (book.title + ' · ' + (target === 'cover' ? 'copertă' : 'pagina ' + target.n)), data: target === 'cover' ? book.cover : target.img, t: Date.now() });
    await saveBook(); refreshGallery();
  }
  b1.addEventListener('click', async () => {
    try {
      requireKey(); const v = read(); if (!v.premise) throw new Error('Scrie despre ce este povestea.'); if (v.char === 'new' && !v.hero && !v.heroref?.length) throw new Error('Descrie eroul sau alege unul salvat.');
      busyBtn(b1, true); aborter = new AbortController(); const prog = stageBusy('Scriu povestea…');
      const N = clamp(v.pages || 8, 2, 24); const heroDesc = v.char !== 'new' ? chars.find(c => c.id === v.char).desc : v.hero;
      const kind = { storybook: "children's picture book", coloring: 'coloring book with a short caption per page', storyboard: 'film storyboard: split the script into shots', bible: "children's illustrated Bible story, faithful to scripture, gentle tone", personal: "personalised children's picture book in which the hero is the reader" }[v.mode];
      const tp = `Write a ${kind} in ${v.lang}. ${v.title ? `Title: "${v.title}".` : 'Invent a short catchy title.'} Main character: ${heroDesc}. Readers aged ${v.age}. Premise/script: ${v.premise}. Exactly ${N} pages. Return ONLY JSON: {"title": string, "character": string (one-paragraph VISUAL description of the main character in English: species/age, hair, eyes, skin, clothes with colours, distinctive props; identical on every page), "coverScene": string (English description of the cover illustration), "pages": [{"n": 1, "text": string (${v.mode === 'coloring' ? 'a caption of at most 8 words' : v.mode === 'storyboard' ? 'shot description with dialogue/caption' : v.age === '2-4' ? 'one short sentence' : v.age === '4-7' ? '2-3 sentences' : 'a short paragraph'} in ${v.lang}), "scene": string (English visual description for the illustration: setting, action, other characters, time of day, emotion; mention the main character by role)}]}`;
      const j = parseJSON(await P().text(tp, { json: true, signal: aborter.signal }));
      book = { id: uid(), title: j.title || v.title || 'Carte', mode: v.mode, premise: v.premise, character: j.character || heroDesc, coverScene: j.coverScene || '', pages: (j.pages || []).slice(0, N).map((pg, i) => ({ n: i + 1, text: pg.text || '', scene: pg.scene || '', img: null })), cover: null, style: v.style, lang: v.lang, trim: v.trim, t: Date.now() };
      prog.set('Creez fișa de personaj pentru consistență…');
      const sh = await ensureSheet(v); book.sheet = sh.sheet; if (v.char !== 'new') book.character = sh.desc;
      await saveBook(); renderBook(); toast('Povestea e gata. Editează textul, apoi ilustrează.');
    } catch (e) { stageError(e); } finally { busyBtn(b1, false); b1.textContent = '1. Scrie povestea'; aborter = null; }
  });
  b2.addEventListener('click', async () => {
    try { requireKey(); if (!book) return; busyBtn(b2, true); aborter = new AbortController(); const todo = ['cover', ...book.pages].filter(x => x === 'cover' ? !book.cover : !x.img);
      let done = 0; const note = el('div', { class: 'note' }, `Ilustrez 0/${todo.length}…`); s.prepend(note);
      await pool(todo.map(x => async () => { await illustrate(x); note.textContent = `Ilustrez ${++done}/${todo.length}…`; }), 2, (i, r) => { if (r?.error) toast('Pagină eșuată: ' + r.error.message, 5000); });
      renderBook(); toast('Ilustrațiile sunt gata.');
    } catch (e) { stageError(e); } finally { busyBtn(b2, false); b2.textContent = '2. Ilustrează paginile'; aborter = null; }
  });
  b4.addEventListener('click', async () => { if (!book) return; const entries = []; if (book.cover) entries.push(['00-coperta.png', book.cover]); for (const pg of book.pages) if (pg.img) entries.push([`${String(pg.n).padStart(2, '0')}-pagina.png`, pg.img]); entries.push(['text.txt', 'data:text/plain;base64,' + btoa(unescape(encodeURIComponent(book.title + '\n\n' + book.pages.map(pg => `Pagina ${pg.n}\n${pg.text}\n`).join('\n'))))]); await zipDownload(entries, `${book.title.replace(/[^\w\dăâîșț -]/gi, '')}-${stamp()}.zip`); });
  b3.addEventListener('click', async () => {
    if (!book) return; busyBtn(b3, true); b3.textContent = 'Generez PDF…';
    try {
      await loadScript(LIB.jspdf);
      const [tw, th] = book.trim.split('x').map(Number); const bleed = 0.125, DPI = 300; const W = Math.round((tw + 2 * bleed) * DPI), H = Math.round((th + 2 * bleed) * DPI), m = Math.round((bleed + 0.375) * DPI);
      const pdf = new jspdf.jsPDF({ unit: 'in', format: [tw + 2 * bleed, th + 2 * bleed], compress: true });
      const isBoard = book.mode === 'storyboard', isColoring = book.mode === 'coloring';
      const drawPage = async (img, text, isCover) => {
        const c = canvasOf(W, H); const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, W, H);
        const textH = isCover || isColoring ? 0 : Math.round(H * (isBoard ? 0.22 : 0.3));
        if (img) { const im = await loadImage(img); const areaW = W, areaH = H - textH; const sc = Math.max(areaW / im.width, areaH / im.height); const dw = im.width * sc, dh = im.height * sc; x.drawImage(im, (areaW - dw) / 2, (areaH - dh) / 2, dw, dh); }
        if (isCover) { x.fillStyle = 'rgba(0,0,0,.42)'; x.fillRect(0, 0, W, Math.round(H * .22)); x.fillStyle = '#fff'; x.textAlign = 'center'; x.font = `600 ${Math.round(W / 10)}px Newsreader, Georgia, serif`; wrapText(x, book.title, W / 2, Math.round(H * .11), W - 2 * m, Math.round(W / 9)); }
        else if (text) { x.fillStyle = '#1A1730'; x.textAlign = 'center'; const fs = Math.round(W / (isBoard ? 34 : 24)); x.font = `${fs}px "Hanken Grotesk", Arial, sans-serif`; wrapText(x, text, W / 2, H - textH + m * .9, W - 2 * m, Math.round(fs * 1.35)); }
        return c.toDataURL('image/jpeg', 0.9);
      };
      let first = true; const add = d => { if (!first) pdf.addPage(); first = false; pdf.addImage(d, 'JPEG', 0, 0, tw + 2 * bleed, th + 2 * bleed); };
      add(await drawPage(book.cover, '', true));
      for (const pg of book.pages) add(await drawPage(pg.img, pg.text, false));
      pdf.save(`${book.title.replace(/[^\w\dăâîșț -]/gi, '')}-KDP-${book.trim}.pdf`); toast('PDF generat la 300 dpi, cu bleed de 0,125 in.');
    } catch (e) { toast('Eroare PDF: ' + e.message, 5000); } finally { busyBtn(b3, false); b3.textContent = '3. Export PDF (KDP)'; }
  });
  function wrapText(x, text, cx, y, maxW, lh) { const words = String(text).split(/\s+/); let line = '', yy = y; for (const w of words) { const test = line ? line + ' ' + w : w; if (x.measureText(test).width > maxW && line) { x.fillText(line, cx, yy); line = w; yy += lh; } else line = test; } if (line) x.fillText(line, cx, yy); }
};

/* ---- Clipart în masă ---- */
CUSTOM.bulkclipart = (p, s, t) => {
  header(p, t);
  const read = buildForm([{ k: 'theme', t: 'text', label: 'Tema setului', req: true, ph: 'Halloween drăguț: dovleci, fantome, lilieci' }, { k: 'count', t: 'number', label: 'Câte elemente', d: 8, min: 1, max: 24 }, { k: 'bg', t: 'select', label: 'Fundal', opts: [['white', 'Alb (curat, pentru eliminare de fundal)'], ['none', 'Cum decide modelul']] }, F.style('clipart'), F.colors(), F.ratio('1:1')], p);
  const btn = el('button', { class: 'btn primary wide', type: 'button' }, 'Generează setul'); const zipBtn = el('button', { class: 'btn ghost wide', type: 'button', disabled: true, style: 'margin-top:8px' }, 'Descarcă ZIP'); p.append(btn, zipBtn);
  emptyStage('Modelul de text propune lista de elemente, apoi se generează pe rând.');
  let made = [];
  btn.addEventListener('click', async () => {
    try { requireKey(); const v = read(); if (!v.theme) throw new Error('Scrie tema.'); const N = clamp(v.count, 1, 24);
      busyBtn(btn, true); aborter = new AbortController(); const prog = stageBusy('Compun lista de elemente…'); made = []; zipBtn.disabled = true;
      const j = parseJSON(await P().text(`Propose ${N} distinct clipart subjects for a coherent set on the theme: "${v.theme}". Return ONLY JSON: {"items": [string, ...]} where each item is a short English description of ONE object/character (max 10 words), no duplicates.`, { json: true, signal: aborter.signal }));
      const items = (j.items || []).slice(0, N); if (!items.length) throw new Error('Nu am primit lista.');
      s.innerHTML = ''; const grid = el('div', { class: 'results' }); const note = el('div', { class: 'note' }, `0/${items.length}`); s.append(el('div', { class: 'stage-top' }, el('h4', {}, 'Set: ' + v.theme), note), grid);
      let done = 0;
      await pool(items.map((it, i) => async () => { const prompt = `${it}, clipart from a coherent set themed "${v.theme}", same style and palette across the set, centred, ${v.bg === 'white' ? 'isolated on a plain pure white background, ' : ''}no shadow on the background. ${styleP(v.style) ? 'Style: ' + styleP(v.style) + '. ' : ''}${NOTEXT}${C(v)}`; const d = (await P().generate({ prompt, ratio: v.ratio, n: 1, signal: aborter.signal }))[0]; const rec = { id: uid(), tool: 'bulkclipart', prompt: it, data: d, t: Date.now() }; await DB.put('images', rec); made.push([`${String(i + 1).padStart(2, '0')}-${it.replace(/[^\w-]+/g, '_').slice(0, 40)}.png`, d]); grid.append(resultCard(rec)); note.textContent = `${++done}/${items.length}`; }), 2, (i, r) => { if (r?.error) { note.textContent += ' · eșec: ' + r.error.message.slice(0, 60); } });
      refreshGallery(); zipBtn.disabled = !made.length; toast('Set gata: ' + made.length + ' elemente');
    } catch (e) { stageError(e); } finally { busyBtn(btn, false); btn.textContent = 'Generează setul'; aborter = null; }
  });
  zipBtn.addEventListener('click', () => zipDownload(made, `clipart-${stamp()}.zip`));
};

/* ---- Prompturi în lot ---- */
CUSTOM.batch = (p, s, t) => {
  header(p, t);
  const ta = el('textarea', { placeholder: 'un prompt pe linie\nex.\nred fox in autumn forest\nblue whale under the moon', style: 'min-height:160px' });
  p.append(el('div', { class: 'field' }, el('label', {}, 'Prompturi (unul pe linie)'), ta));
  const read = buildForm([F.style(), F.ratio(), F.n(), F.enh()], p);
  const btn = el('button', { class: 'btn primary wide', type: 'button' }, 'Rulează lotul'); p.append(btn);
  emptyStage('Fiecare linie devine o generare separată, cu stilul și formatul de mai jos.');
  btn.addEventListener('click', async () => {
    try { requireKey(); const lines = ta.value.split('\n').map(l => l.trim()).filter(Boolean); if (!lines.length) throw new Error('Scrie cel puțin un prompt.'); const v = read();
      busyBtn(btn, true); aborter = new AbortController(); s.innerHTML = ''; const grid = el('div', { class: 'results' }); const note = el('div', { class: 'note' }, `0/${lines.length}`); s.append(el('div', { class: 'stage-top' }, el('h4', {}, 'Lot'), note), grid); let done = 0;
      await pool(lines.map(l => async () => { let prompt = l + (styleP(v.style) ? ` Style: ${styleP(v.style)}.` : ''); if (v.enhance) prompt = await enhancePrompt(prompt); const imgs = await P().generate({ prompt, ratio: v.ratio, n: v.n, signal: aborter.signal }); for (const d of imgs) { const rec = { id: uid(), tool: 'batch', prompt: l, data: d, t: Date.now() }; await DB.put('images', rec); grid.append(resultCard(rec)); } note.textContent = `${++done}/${lines.length}`; }), 2, (i, r) => { if (r?.error) note.textContent += ' · eșec: ' + r.error.message.slice(0, 60); });
      refreshGallery();
    } catch (e) { stageError(e); } finally { busyBtn(btn, false); btn.textContent = 'Rulează lotul'; aborter = null; }
  });
};

/* ---- Îmbunătățire prompt ---- */
CUSTOM.enhancer = (p, s, t) => {
  header(p, t);
  const ta = el('textarea', { placeholder: 'o pisică pe acoperiș noaptea' }); p.append(el('div', { class: 'field' }, el('label', {}, 'Ideea ta, în orice limbă'), ta));
  const read = buildForm([F.style()], p);
  const btn = el('button', { class: 'btn primary wide', type: 'button' }, 'Îmbunătățește'); p.append(btn);
  emptyStage('Promptul detaliat apare aici, cu buton de copiere și de trimitere la „Creează din prompt”.');
  btn.addEventListener('click', async () => {
    try { requireKey(); if (!ta.value.trim()) throw new Error('Scrie o idee.'); busyBtn(btn, true); stageBusy('Rescriu promptul…'); const v = read();
      const out = await enhancePrompt(ta.value.trim() + (styleP(v.style) ? ` Style: ${styleP(v.style)}.` : ''));
      s.innerHTML = ''; const o = el('textarea', { style: 'min-height:160px;width:100%;padding:12px;border:1px solid var(--line-strong);border-radius:10px;background:var(--ground);color:inherit' }); o.value = out;
      s.append(el('div', { class: 'stage-top' }, el('h4', {}, 'Prompt îmbunătățit')), o, el('div', { class: 'seg' }, el('button', { class: 'btn ghost small', type: 'button', onclick: () => { navigator.clipboard?.writeText(o.value); toast('Copiat'); } }, 'Copiază'), el('button', { class: 'btn primary small', type: 'button', onclick: () => openTool('prompt', { idea: o.value }) }, 'Trimite la „Creează din prompt”')));
    } catch (e) { stageError(e); } finally { busyBtn(btn, false); btn.textContent = 'Îmbunătățește'; }
  });
};

/* =====================================================================
   7. Pornire
   ===================================================================== */
// „Creează din prompt” acceptă idee pre-completată (de la Variații / Enhancer)
const _renderGeneric = renderGeneric;
renderGeneric = function (t) { _renderGeneric(t); if (incoming?.idea) { const ta = panel.querySelector('textarea'); if (ta) ta.value = incoming.idea; } };

applyTheme(); updateKeyPill(); renderNav(); refreshGallery();
const hashTool = /tool=([\w-]+)/.exec(location.hash)?.[1];
openTool(toolById(hashTool) ? hashTool : (toolById(S.lastTool) ? S.lastTool : 'prompt'));
if (location.hash === '#atelier' || hashTool) setTimeout(() => $('#atelier').scrollIntoView(), 50);
if (!hasKey()) setTimeout(() => toast('Pune cheia API din butonul de sus ca să poți genera.', 5000), 1200);
})();
