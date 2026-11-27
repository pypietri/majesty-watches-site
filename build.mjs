// Générateur du site Majesty Watches.
// Lit content/ (édité via Pages CMS) et produit dist/ (servi par Cloudflare Pages).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import yaml from 'js-yaml';
import { marked } from 'marked';
import sharp from 'sharp';

const ROOT = path.dirname(new URL(import.meta.url).pathname);
const DIST = path.join(ROOT, 'dist');
const SITE_URL = 'https://www.majestywatches.fr';
const CACHE = path.join(ROOT, '.cache/img');

fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(DIST, { recursive: true });
fs.mkdirSync(CACHE, { recursive: true });

// ---------- Contenu ----------
const site = yaml.load(fs.readFileSync(path.join(ROOT, 'content/site.yml'), 'utf8'));
const C = site.contact || {};
const G = site.google || {};
const phoneDigits = (C.telephone || '').replace(/[^\d+]/g, '');
const waNumber = phoneDigits.replace(/^\+/, '').replace(/^0/, '33');
const wa = (msg) => `https://wa.me/${waNumber}${msg ? '?text=' + encodeURIComponent(msg) : ''}`;

const slugify = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const esc = (s = '') => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const priceNum = (p = '') => { const n = parseInt(String(p).replace(/[^\d]/g, ''), 10); return Number.isFinite(n) ? n : null; };

function readMontres() {
  const dir = path.join(ROOT, 'content/montres');
  return fs.readdirSync(dir).filter(f => f.endsWith('.md')).map(f => {
    const raw = fs.readFileSync(path.join(dir, f), 'utf8');
    const m = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
    const fm = m ? (yaml.load(m[1]) || {}) : {};
    const body = m ? m[2] : raw;
    const slug = f.replace(/\.md$/, '');
    const titre = String(fm.titre || slug);
    const discontinued = /\[discontinued\]/i.test(titre);
    const nom = titre.replace(/\s*\[discontinued\]\s*/i, ' ').replace(/\s+/g, ' ').trim();
    const marque = fm.marque && fm.marque !== 'Autre' ? fm.marque : (nom.split(' - ')[0].split(' ').slice(0, 1).join(' '));
    const modele = nom.startsWith(marque) ? nom.slice(marque.length).trim() : nom;
    // « Royal Oak 'Kasparov' - Brown - 39 mm - 2013 » -> nom court + détails
    const parts = (modele || nom).split(/\s+-\s+/).map(x => x.trim()).filter(Boolean)
      .map(x => x.replace(/'([^']+)'/g, '‘$1’').replace(/"([^"]+)"/g, '‘$1’').replace(/^New$/i, 'Neuve').replace(/^Mint$/i, 'Mint'));
    const court = parts[0] || nom;
    const detail = parts.slice(1).join(' · ');
    // Détails : on transforme « Clé : valeur » en lignes de fiche technique.
    const specs = []; const notes = [];
    for (const [k, label] of [['boitier', 'Boîtier'], ['annee', 'Année'], ['etat', 'État'], ['contenu', 'Contenu'], ['garantie', 'Garantie']]) {
      if (fm[k] === undefined || !String(fm[k]).trim()) continue;
      let v = String(fm[k]).trim();
      if (k === 'garantie') { v = v.replace(/^garantie\s*/i, '').replace(/^\((.+)\)/, '$1').trim(); v = v ? v[0].toUpperCase() + v.slice(1) : 'Oui'; }
      specs.push([label, v]);
    }
    for (const l of String(fm.infos || '').split('\n').map(s => s.trim()).filter(Boolean)) specs.push(['', l]);
    let seenList = false;
    for (const line of body.split('\n')) {
      const isItem = /^\s*[-*]\s+/.test(line);
      const l = line.replace(/^\s*[-*]\s+/, '').replace(/\*\*/g, '').trim();
      if (!l) continue;
      if (!isItem) { if (seenList && !/^#/.test(l)) notes.push(l); continue; } // la 1re ligne (titre) est ignorée
      seenList = true;
      const kv = l.match(/^([^:]{2,30}?)\s*:\s+(.+)$/);
      if (kv) specs.push([kv[1].trim().replace(/^Condition$/i, 'État').replace(/^Etat$/i, 'État'), kv[2].trim()]);
      else specs.push(['', l]);
    }
    return {
      slug, titre, nom, marque, modele, court, detail, discontinued,
      reference: String(fm.reference || '').trim(),
      prix: String(fm.prix || '').trim(),
      prixNum: priceNum(fm.prix),
      statut: fm.statut || 'Disponible',
      nouveaute: !!fm.nouveaute,
      publie: fm.publie !== false,
      date: String(fm.date || '2000-01-01'),
      photos: (fm.photos || []).filter(Boolean),
      specs, notes, bodyHtml: marked.parse(body || ''),
    };
  });
}

const all = readMontres();
const montres = all.filter(m => m.publie && m.statut !== 'Masquée')
  .sort((a, b) => (b.date.localeCompare(a.date)) || a.titre.localeCompare(b.titre));
const marques = [...new Set(montres.map(m => m.marque))].sort((a, b) => (a === 'Rolex' ? -1 : b === 'Rolex' ? 1 : a.localeCompare(b)));

// ---------- Images ----------
const imgMap = new Map(); // src -> { w: {480: url, ...}, ratio }
const SIZES = [480, 900, 1600];
async function processImage(src, sizes = SIZES) {
  if (imgMap.has(src)) return imgMap.get(src);
  const file = path.join(ROOT, 'public', src);
  if (!fs.existsSync(file)) { imgMap.set(src, null); return null; }
  const buf = fs.readFileSync(file);
  const hash = crypto.createHash('md5').update(buf).digest('hex').slice(0, 10);
  const base = slugify(path.basename(src, path.extname(src))).slice(0, 60);
  const meta = await sharp(buf).metadata();
  const out = { srcset: [], ratio: (meta.height && meta.width) ? meta.height / meta.width : 1, url: {} };
  fs.mkdirSync(path.join(DIST, 'img'), { recursive: true });
  for (const w of sizes) {
    const name = `${base}-${hash}-${w}.webp`;
    const cached = path.join(CACHE, name);
    if (!fs.existsSync(cached)) {
      await sharp(buf).rotate().resize({ width: Math.min(w, meta.width || w), withoutEnlargement: true }).webp({ quality: 78 }).toFile(cached);
    }
    fs.copyFileSync(cached, path.join(DIST, 'img', name));
    out.url[w] = `/img/${name}`;
    out.srcset.push(`/img/${name} ${w}w`);
  }
  imgMap.set(src, out);
  return out;
}
function img(src, { sizes = '100vw', alt = '', cls = '', eager = false, w = 900 } = {}) {
  const o = imgMap.get(src);
  if (!o) return `<div class="img-missing ${cls}" aria-hidden="true"></div>`;
  return `<img class="${cls}" src="${o.url[w] || o.url[900] || Object.values(o.url).pop()}" srcset="${o.srcset.join(', ')}" sizes="${sizes}" alt="${esc(alt)}" ${eager ? 'fetchpriority="high"' : 'loading="lazy"'} decoding="async">`;
}

// ---------- Gabarits ----------
const nav = [
  ['/montres/', 'Collection'],
  ['/vendre/', 'Vendre'],
  ['/recherche/', 'Recherche'],
  ['/contact/', 'Contact'],
];
const icon = {
  wa: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2.05 22l5.25-1.38c1.45.79 3.08 1.21 4.74 1.21 5.46 0 9.91-4.45 9.91-9.91C21.95 6.45 17.5 2 12.04 2Zm5.79 14.04c-.24.68-1.42 1.3-1.95 1.35-.5.05-.97.23-3.28-.68-2.78-1.1-4.55-3.94-4.69-4.12-.14-.18-1.12-1.49-1.12-2.85 0-1.35.71-2.02.96-2.29.25-.27.55-.34.73-.34h.52c.17 0 .39-.06.61.47.24.55.78 1.9.85 2.04.07.14.11.3.02.48-.09.18-.14.3-.27.46-.14.16-.29.36-.41.48-.14.14-.28.29-.12.56.16.27.71 1.17 1.52 1.9 1.05.93 1.93 1.22 2.2 1.36.27.14.43.11.59-.07.16-.18.68-.79.86-1.06.18-.27.36-.23.61-.14.25.09 1.59.75 1.86.89.27.14.45.2.52.32.07.11.07.66-.17 1.34Z"/></svg>',
  phone: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.4" d="M5 3.5h3l1.5 4-2 1.2a11 11 0 0 0 7.8 7.8l1.2-2 4 1.5v3a2 2 0 0 1-2.2 2A17.5 17.5 0 0 1 3 5.7 2 2 0 0 1 5 3.5Z"/></svg>',
  mail: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.4" d="M3.5 5.5h17v13h-17zM3.8 6l8.2 7 8.2-7"/></svg>',
  ig: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="3.5" width="17" height="17" rx="5" fill="none" stroke="currentColor" stroke-width="1.4"/><circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" stroke-width="1.4"/><circle cx="17.3" cy="6.7" r="1" fill="currentColor"/></svg>',
  arrow: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.3" d="M4 12h15m-5-5 5 5-5 5"/></svg>',
  search: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="m16 16 4.5 4.5" stroke="currentColor" stroke-width="1.4"/></svg>',
  star: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="m12 2.8 2.8 5.8 6.3.9-4.6 4.4 1.1 6.3L12 17.2l-5.6 3 1.1-6.3L2.9 9.5l6.3-.9z"/></svg>',
  google: '<svg class="g-logo" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>',
  watch: '<svg viewBox="0 0 32 32" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1.1"><circle cx="16" cy="16" r="7.5"/><path d="M12 9.5 13 4h6l1 5.5M12 22.5l1 5.5h6l1-5.5M16 12v4l2.5 2"/></g></svg>',
  swap: '<svg viewBox="0 0 32 32" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1.1"><path d="M6 12h19l-5-5M26 20H7l5 5"/></g></svg>',
  box: '<svg viewBox="0 0 32 32" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1.1"><path d="m16 4 11 5.5v13L16 28 5 22.5v-13z"/><path d="m5 9.5 11 5.5 11-5.5M16 15v13"/></g></svg>',
  shield: '<svg viewBox="0 0 32 32" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1.1"><path d="M16 4 6 8v7c0 6.5 4.3 11 10 13 5.7-2 10-6.5 10-13V8z"/><path d="m11.5 16 3.3 3.2 6-6.4"/></g></svg>',
  check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.3" d="m5 12.5 4.2 4L19 7"/></svg>',
};

const logo = `<span class="logo"><img src="/assets/logo-mark.png" alt="" width="34" height="30"><span class="logo-word">Majesty</span></span>`;

function layout({ title, description, canonical, body, ogImage, jsonld, bodyClass = '' }) {
  const fullTitle = title ? `${title} — Majesty Watches` : 'Majesty Watches — Montres de prestige, achat, vente & recherche';
  const og = ogImage ? SITE_URL + ogImage : SITE_URL + '/assets/og.jpg';
  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(fullTitle)}</title>
<meta name="description" content="${esc(description || site.accueil.texte)}">
<link rel="canonical" href="${SITE_URL}${canonical}">
<meta property="og:type" content="website">
<meta property="og:title" content="${esc(fullTitle)}">
<meta property="og:description" content="${esc(description || site.accueil.texte)}">
<meta property="og:image" content="${og}">
<meta property="og:url" content="${SITE_URL}${canonical}">
<meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="#FFFFFF">
<link rel="icon" href="/assets/favicon.png">
<link rel="apple-touch-icon" href="/assets/favicon.png">
<link rel="preload" href="/assets/fonts/kumbh.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/assets/site.css?v=${BUILD}">
${jsonld ? `<script type="application/ld+json">${JSON.stringify(jsonld)}</script>` : ''}
</head>
<body class="${bodyClass}">
<a class="skip" href="#contenu">Aller au contenu</a>
<header class="hd" data-hd>
  <div class="hd-in">
    <nav class="hd-nav" aria-label="Navigation principale">
      ${nav.map(([h, l]) => `<a href="${h}"${canonical.startsWith(h) ? ' aria-current="page"' : ''}>${l}</a>`).join('')}
    </nav>
    <a href="/" class="hd-logo" aria-label="Majesty Watches — accueil">${logo}</a>
    <a class="hd-cta" href="${wa('Bonjour Majesty Watches, ')}" target="_blank" rel="noopener">${icon.wa}<span>WhatsApp</span></a>
    <button class="hd-burger" aria-label="Menu" aria-expanded="false" data-burger><span></span><span></span></button>
  </div>
  <div class="hd-drawer" data-drawer>
    ${nav.map(([h, l]) => `<a href="${h}">${l}</a>`).join('')}
    <a href="${wa('Bonjour Majesty Watches, ')}" target="_blank" rel="noopener">Écrire sur WhatsApp</a>
  </div>
</header>
<main id="contenu">
${body}
</main>
<footer class="ft">
  <div class="wrap">
    <a href="/" aria-label="Majesty Watches — accueil"><img class="ft-logo" src="/assets/logo-full.png" alt="Majesty Watches" width="120" height="109" loading="lazy"></a>
    <div class="ft-grid">
      <h3>Contact</h3>
      <a href="${wa()}" target="_blank" rel="noopener">WhatsApp : ${esc(C.telephone)}</a>
      <a href="mailto:${esc(C.email)}">${esc(C.email)}</a>
      <a href="https://www.instagram.com/${esc(C.instagram)}/" target="_blank" rel="noopener">Instagram : @${esc(C.instagram)}</a>
      ${G.lien ? `<a href="${esc(G.lien)}" target="_blank" rel="noopener">Nos avis Google</a>` : ''}
    </div>
    <nav class="ft-nav" aria-label="Pied de page">
      <a href="/montres/">Collection</a><a href="/vendre/">Vendre</a><a href="/recherche/">Recherche</a><a href="/contact/">Contact</a><a href="/mentions-legales/">Mentions légales</a><a href="/confidentialite/">Confidentialité</a>
    </nav>
    <div class="ft-bottom">
      <span>© ${new Date().getFullYear()} Majesty Watches</span>
      <span>Site créé par <a href="https://www.pierreyvespietri.com" target="_blank" rel="noopener">Pierre-Yves Pietri</a></span>
    </div>
  </div>
</footer>
<a class="wa-float" href="${wa('Bonjour Majesty Watches, ')}" target="_blank" rel="noopener" aria-label="Nous écrire sur WhatsApp">${icon.wa}<span>WhatsApp</span></a>
<script src="/assets/site.js?v=${BUILD}" defer></script>
</body>
</html>`;
}

const BUILD = Date.now().toString(36);

function badge(m) {
  if (m.statut === 'Réservée') return '<span class="tag tag-res">Réservée</span>';
  if (m.statut === 'Vendue') return '<span class="tag tag-sold">Vendue</span>';
  if (m.statut === 'En arrivage') return '<span class="tag tag-arr">En arrivage</span>';
  if (m.nouveaute) return '<span class="tag tag-new">Nouveauté</span>';
  return '';
}
function priceLabel(m) {
  if (m.statut === 'Vendue') return 'Vendue';
  if (m.statut === 'En arrivage' && !m.prixNum) return 'Prix sur demande';
  return m.prix || 'Prix sur demande';
}
function card(m, { eager = false } = {}) {
  const [a, b] = m.photos;
  return `<article class="card" data-reveal data-marque="${esc(m.marque)}" data-prix="${m.prixNum ?? ''}" data-date="${m.date}" data-q="${esc((m.nom + ' ' + m.reference).toLowerCase())}">
  <a href="/montres/${m.slug}/" class="card-a">
    <div class="card-img">
      ${img(a, { sizes: '(min-width: 1100px) 22vw, (min-width: 700px) 30vw, 46vw', alt: m.nom, cls: 'i1', eager, w: 480 })}
      ${b ? img(b, { sizes: '(min-width: 1100px) 22vw, (min-width: 700px) 30vw, 46vw', alt: '', cls: 'i2', w: 480 }) : ''}
      ${badge(m)}
      <span class="card-price">${esc(priceLabel(m))}</span>
    </div>
    <div class="card-tx">
      <span class="card-brand">${esc(m.marque)}</span>
      <h3 class="card-name">${esc(m.court)}</h3>
      <p class="card-detail">${esc([m.detail, m.reference ? 'Réf. ' + m.reference : ''].filter(Boolean).join(' · '))}</p>
    </div>
  </a>
</article>`;
}

// ---------- Pages ----------
function writePage(urlPath, html) {
  const dir = path.join(DIST, urlPath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.html'), html);
}

function logoMarque(b) { const f = `/assets/marques/${slugify(b)}.svg`; return fs.existsSync(path.join(ROOT, 'public', f)) ? f.replace('.svg', '.png') : null; }
function stars(n = 5) { return `<span class="stars" aria-label="${n} étoiles sur 5">${Array.from({ length: Math.round(n) }, () => icon.star).join('')}</span>`; }

function heroPicture(A) {
  const src = (f, mq) => { const o = imgMap.get(f); return o ? `<source media="${mq}" srcset="${o.srcset.join(', ')}" sizes="100vw">` : ''; };
  return `<picture>${src(A.image_mobile, '(max-width: 640px)')}${src(A.image_tablette, '(max-width: 1100px)')}${img(A.image, { sizes: '100vw', alt: 'Montre de prestige — Majesty Watches', eager: true, w: 1600 })}</picture>`;
}

function pageHome() {
  const A = site.accueil;
  const okRing = m => m.statut !== 'Vendue' && m.photos[0] && imgMap.get(m.photos[0]) && fondBlanc.has(m.photos[0]);
  const nouveaux = montres.filter(m => m.nouveaute && okRing(m)).slice(0, 14);
  // L'anneau a besoin d'au moins 8 pièces : on complète avec le reste du stock si besoin
  const list = [...nouveaux, ...montres.filter(m => !nouveaux.includes(m) && okRing(m))].slice(0, Math.max(nouveaux.length, 10));
  const dispo = montres.filter(m => m.statut !== 'Vendue').length;
  const tournantes = (A.montres_tournantes || []).filter(Boolean);
  const avis = site.temoignages || [];
  // Montres qui défilent : les visuels détourés du CMS, puis des pièces du stock (une par modèle)
  const vus = new Set();
  const stock = montres.filter(m => m.statut !== 'Vendue' && m.photos[0] && imgMap.get(m.photos[0]) && !vus.has(m.marque + m.court) && vus.add(m.marque + m.court)).slice(0, 14);
  const spinImgs = [];
  const det = tournantes.filter(t => imgMap.get(t)).map(src => ({ src })), sto = stock.map(m => ({ src: m.photos[0], ph: true }));
  for (let i = 0; i < Math.max(det.length, sto.length); i++) { if (sto[i]) spinImgs.push(sto[i]); if (det[i]) spinImgs.push(det[i]); }
  const body = `
<section class="hero" data-hero>
  <div class="hero-bg">${heroPicture(A)}</div>
  <div class="wrap">
    <div class="hero-tx">
      <h1 class="display" data-reveal>${esc(A.titre)}</h1>
      <p class="lead" data-reveal>${esc(A.texte)}</p>
      <div class="hero-btns" data-reveal>
        <a class="btn" href="/montres/">Découvrez notre collection ${icon.arrow}</a>
        <a class="btn btn-white" href="/vendre/">Vendez votre montre ${icon.arrow}</a>
      </div>
    </div>
  </div>
  <div class="hero-foot"><div class="wrap"><span>${dispo} pièces disponibles</span><span class="hero-scroll"><i></i>Défiler</span></div></div>
</section>

<section class="trust">
  <div class="wrap trust-grid">
    ${(site.engagements || []).map((e, i) => `<div class="trust-it" data-reveal>${[icon.watch, icon.swap, icon.box, icon.shield][i % 4]}<h3>${esc(e.titre)}</h3><p>${esc(e.texte)}</p></div>`).join('')}
  </div>
</section>

<section class="ring" data-ring aria-label="Nouvel arrivage">
  <div class="ring-in">
    <div class="ring-hd wrap">
      <p class="eyebrow">Arrivages récents</p>
      <h2 class="h2">Nouvel arrivage</h2>
      <span class="ring-hint">Glissez, balayez au trackpad ou utilisez les flèches</span>
    </div>
    <div class="ring-stage" data-ring-stage>
      <div class="ring-track" data-ring-track style="--n:${list.length}">
        ${list.map((m, i) => `<a class="ring-it" href="/montres/${m.slug}/" style="--i:${i}" data-name="${esc(m.marque + ' ' + m.court)}" data-price="${esc(priceLabel(m))}" draggable="false"><img src="${imgMap.get(m.photos[0]).url[480]}" alt="${esc(m.nom)}" loading="lazy" draggable="false"></a>`).join('')}
      </div>
      <div class="ring-floor" aria-hidden="true"></div>
    </div>
    <div class="ring-info wrap">
      <button class="ring-btn" type="button" data-ring-prev aria-label="Montre précédente">${icon.arrow}</button>
      <a class="ring-now" data-ring-link href="/montres/${list[0].slug}/"><span data-ring-name>${esc(list[0].marque + ' ' + list[0].court)}</span><strong data-ring-price>${esc(priceLabel(list[0]))}</strong><em>Voir la fiche</em></a>
      <button class="ring-btn" type="button" data-ring-next aria-label="Montre suivante">${icon.arrow}</button>
    </div>
    <div class="ring-ft"><a class="link" href="/montres/">Voir toute la collection (${dispo} pièces) ${icon.arrow}</a></div>
  </div>
</section>

<section class="maisons">
  <div class="wrap">
    <div class="sec-hd"><div><p class="eyebrow">Les maisons</p><h2 class="h2">Nos manufactures</h2></div><a class="link" href="/montres/">Toute la collection ${icon.arrow}</a></div>
    <div class="maisons-grid">
      ${marques.map(b => { const ms = montres.filter(m => m.marque === b); const ph = ms.find(m => m.photos[0])?.photos[0]; return `<a class="maison" href="/montres/?marque=${encodeURIComponent(b)}" data-reveal>
        ${logoMarque(b) ? `<span class="maison-logo" role="img" aria-label="${esc(b)}" style="--logo:url('${logoMarque(b)}')"></span>` : `<span class="maison-n">${esc(b)}</span>`}
        <span class="maison-c">${ms.length} pièce${ms.length > 1 ? 's' : ''} ${icon.arrow}</span>
        ${ph ? img(ph, { sizes: '30vw', alt: '', cls: 'maison-img', w: 480 }) : ''}
      </a>`; }).join('')}
    </div>
  </div>
</section>

<section class="sell">
  <div class="wrap sell-grid">
    <div class="sell-col" data-reveal>
      <p class="eyebrow">Vendre</p>
      <h2 class="h2">${esc(site.vendre.titre)}</h2>
      <p>${esc(site.vendre.intro)}</p>
      <a class="btn btn-ghost" href="/vendre/">Vendez votre montre ${icon.arrow}</a>
    </div>
    <div class="spin corners" data-spin data-reveal>${spinImgs.map((t, i) => `<img src="${imgMap.get(t.src).url[t.ph ? 480 : 900]}" alt="" loading="lazy" class="${[i === 0 ? 'on' : '', t.ph ? 'ph' : ''].filter(Boolean).join(' ')}">`).join('')}</div>
    <div class="sell-col r" data-reveal>
      <p class="eyebrow">Rechercher</p>
      <h2 class="h2">${esc(site.recherche.titre)}</h2>
      <p>${esc(site.recherche.intro)} ${esc(site.recherche.texte)}</p>
      <a class="btn btn-ghost" href="/recherche/">Lancer une recherche ${icon.arrow}</a>
    </div>
  </div>
</section>

<section class="reviews" aria-label="Avis clients">
  <video autoplay muted loop playsinline preload="none" poster="" data-lazy-video><source data-src="/assets/ocean.mp4" type="video/mp4"></video>
  <div class="wrap">
    <div class="reviews-card corners" data-reveal>
      <p class="eyebrow">Ils nous ont fait confiance</p>
      <h2 class="h2">Nos clients</h2>
      ${G.note ? `<${G.lien ? `a href="${esc(G.lien)}" target="_blank" rel="noopener"` : 'div'} class="g-score">${icon.google}<strong>${esc(G.note)}</strong>${stars(parseFloat(String(G.note).replace(',', '.')) || 5)}<span>${G.nombre ? esc(G.nombre) + ' avis Google' : 'Avis Google'}</span></${G.lien ? 'a' : 'div'}>` : ''}
      <div class="rv-track" data-rv>
        ${avis.map((t, i) => `<figure class="rv${i === 0 ? ' on' : ''}"><blockquote>“${esc(t.texte)}”</blockquote><figcaption>${stars(t.etoiles || 5)}${esc(t.nom)}</figcaption></figure>`).join('')}
      </div>
      ${avis.length > 1 ? `<div class="rv-dots" role="tablist">${avis.map((_, i) => `<button aria-label="Avis ${i + 1}" aria-current="${i === 0}"></button>`).join('')}</div>` : ''}
      ${G.lien ? `<a class="link" href="${esc(G.lien)}" target="_blank" rel="noopener">Lire tous nos avis sur Google ${icon.arrow}</a>` : ''}
    </div>
  </div>
</section>

${ctaBand()}`;
  writePage('/', layout({ title: '', canonical: '/', body, bodyClass: 'home', jsonld: {
    '@context': 'https://schema.org', '@type': 'Store', name: 'Majesty Watches', url: SITE_URL, email: C.email, telephone: C.telephone,
    sameAs: [`https://www.instagram.com/${C.instagram}/`, G.lien].filter(Boolean), image: SITE_URL + '/assets/og.jpg', description: site.accueil.texte,
  } }));
}

function ctaBand() {
  return `<section class="cta">
  <div class="wrap cta-in">
    <div>
      <p class="eyebrow">Une question sur une pièce ?</p>
      <h2 class="h2">Parlons-en directement.</h2>
    </div>
    <div class="cta-btns">
      <a class="btn" href="${wa('Bonjour Majesty Watches, ')}" target="_blank" rel="noopener">${icon.wa} WhatsApp</a>
      <a class="btn btn-ghost" href="tel:${phoneDigits}">${icon.phone} ${esc(C.telephone)}</a>
      <a class="btn btn-ghost" href="mailto:${esc(C.email)}">${icon.mail} E-mail</a>
    </div>
  </div>
</section>`;
}

function pageCollection() {
  const body = `
<section class="page-hd">
  <div class="wrap">
    <p class="eyebrow">La collection</p>
    <h1 class="display-s">Toutes nos montres</h1>
    <p class="lead">${montres.length} pièces sélectionnées une à une. Chaque montre est contrôlée et décrite avec précision&nbsp;— n’hésitez pas à nous écrire pour toute question.</p>
  </div>
</section>
<section class="sec sec-tight">
  <div class="wrap">
    <div class="tools" data-tools>
      <div class="chips" role="group" aria-label="Filtrer par maison">
        <button class="chip" aria-pressed="true" data-marque="">Toutes</button>
        ${marques.map(b => `<button class="chip" aria-pressed="false" data-marque="${esc(b)}">${esc(b)}</button>`).join('')}
      </div>
      <div class="tools-r">
        <label class="search">${icon.search}<input type="search" placeholder="Modèle, référence…" data-search aria-label="Rechercher"></label>
        <label class="sort"><span class="sr">Trier</span>
          <select data-sort>
            <option value="date">Arrivages récents</option>
            <option value="asc">Prix croissant</option>
            <option value="desc">Prix décroissant</option>
          </select>
        </label>
      </div>
    </div>
    <p class="count" data-count aria-live="polite">${montres.length} montres</p>
    <div class="grid" data-grid>${montres.map((m, i) => card(m, { eager: i < 4 })).join('')}</div>
    <div class="empty" data-empty hidden>
      <p>Aucune montre ne correspond à votre recherche.</p>
      <a class="link" href="/recherche/">Demander une recherche personnalisée ${icon.arrow}</a>
    </div>
  </div>
</section>
${ctaBand()}`;
  writePage('/montres/', layout({ title: 'La collection', description: `Découvrez nos ${montres.length} montres de prestige : Rolex, Audemars Piguet, Patek Philippe, Cartier…`, canonical: '/montres/', body }));
}

function pageMontre(m) {
  const msg = `Bonjour Majesty Watches, je suis intéressé(e) par la ${m.nom}${m.reference ? ' (réf. ' + m.reference + ')' : ''}.`;
  const autres = montres.filter(x => x.slug !== m.slug && x.statut !== 'Vendue');
  const similaires = [...autres.filter(x => x.marque === m.marque), ...autres.filter(x => x.marque !== m.marque)].slice(0, 4);
  const photos = m.photos.filter(p => imgMap.get(p));
  const body = `
<nav class="crumbs wrap" aria-label="Fil d’Ariane"><a href="/montres/">Collection</a><span>/</span><a href="/montres/?marque=${encodeURIComponent(m.marque)}">${esc(m.marque)}</a><span>/</span><span aria-current="page">${esc(m.court)}</span></nav>
<section class="pdp">
  <div class="wrap pdp-grid">
    <div class="gal" data-gal>
      <div class="gal-main" data-gal-track>
        ${photos.map((p, i) => `<button class="gal-slide" data-zoom="${imgMap.get(p).url[1600]}" aria-label="Agrandir la photo ${i + 1}">${img(p, { sizes: '(min-width: 1000px) 55vw, 100vw', alt: `${m.nom} — photo ${i + 1}`, eager: i === 0, w: 900 })}</button>`).join('') || '<div class="img-missing"></div>'}
      </div>
      ${photos.length > 1 ? `<div class="gal-thumbs">${photos.map((p, i) => `<button class="gal-th" data-go="${i}" aria-label="Photo ${i + 1}"${i === 0 ? ' aria-current="true"' : ''}>${img(p, { sizes: '96px', alt: '', w: 480 })}</button>`).join('')}</div>` : ''}
    </div>
    <div class="pdp-info">
      <div class="pdp-sticky">
        <p class="eyebrow">${esc(m.marque)}${m.discontinued ? ' · Production arrêtée' : ''}</p>
        <h1 class="pdp-title">${esc(m.court)}</h1>
        <p class="pdp-ref">${[m.detail, m.reference ? 'Réf. ' + esc(m.reference) : ''].filter(Boolean).join(' · ')}</p>
        <div class="pdp-price"><span>${esc(priceLabel(m))}</span>${m.statut !== 'Disponible' ? `<em class="pdp-status">${esc(m.statut)}</em>` : ''}</div>
        <div class="pdp-btns">
          <a class="btn btn-block" href="${wa(msg)}" target="_blank" rel="noopener">${icon.wa} ${m.statut === 'Disponible' ? 'Réserver / poser une question' : 'Nous écrire sur WhatsApp'}</a>
          <div class="pdp-alt">
            <a class="btn btn-ghost" href="tel:${phoneDigits}">${icon.phone} Appeler</a>
            <a class="btn btn-ghost" href="mailto:${esc(C.email)}?subject=${encodeURIComponent(m.nom)}&body=${encodeURIComponent(msg)}">${icon.mail} E-mail</a>
          </div>
        </div>
        ${m.specs.length ? `<dl class="specs">${m.specs.map(([k, v]) => k ? `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>` : `<div class="specs-full"><dd>${icon.check} ${esc(v)}</dd></div>`).join('')}</dl>` : m.bodyHtml}
        ${m.notes.length ? `<div class="pdp-notes">${m.notes.map(n => `<p>${esc(n.replace(/\*\*/g, ''))}</p>`).join('')}</div>` : ''}
        <ul class="pdp-trust">
          <li>${icon.check} Authenticité contrôlée</li>
          <li>${icon.check} Envoi sécurisé et assuré</li>
          <li>${icon.check} Paiement sécurisé</li>
        </ul>
      </div>
    </div>
  </div>
</section>
${similaires.length ? `<section class="sec">
  <div class="wrap">
    <div class="sec-hd"><div><p class="eyebrow">À découvrir aussi</p><h2 class="h2">Dans la collection</h2></div><a class="link" href="/montres/">Toute la collection ${icon.arrow}</a></div>
    <div class="grid">${similaires.map(x => card(x)).join('')}</div>
  </div>
</section>` : ''}
<div class="lb" data-lb hidden><button class="lb-x" aria-label="Fermer" data-lb-x>×</button><img alt=""></div>`;
  const jsonld = {
    '@context': 'https://schema.org', '@type': 'Product', name: m.nom, brand: { '@type': 'Brand', name: m.marque }, sku: m.reference || undefined,
    image: photos.slice(0, 3).map(p => SITE_URL + imgMap.get(p).url[1600]),
    offers: m.prixNum ? { '@type': 'Offer', priceCurrency: 'EUR', price: m.prixNum, itemCondition: 'https://schema.org/UsedCondition',
      availability: m.statut === 'Disponible' ? 'https://schema.org/InStock' : m.statut === 'Vendue' ? 'https://schema.org/SoldOut' : 'https://schema.org/PreOrder',
      url: `${SITE_URL}/montres/${m.slug}/` } : undefined,
  };
  const desc = `${m.nom}${m.reference ? ', réf. ' + m.reference : ''} — ${priceLabel(m)}. ${m.specs.filter(s => s[0]).slice(0, 3).map(s => s.join(' : ')).join(' · ')}`;
  writePage(`/montres/${m.slug}/`, layout({ title: m.nom, description: desc, canonical: `/montres/${m.slug}/`, body, jsonld, ogImage: photos[0] ? imgMap.get(photos[0]).url[900] : null, bodyClass: 'pdp-page' }));
}

function pageText(urlPath, { eyebrow, title, html, description, aside = '' }) {
  const body = `
<section class="page-hd">
  <div class="wrap"><p class="eyebrow">${esc(eyebrow)}</p><h1 class="display-s">${esc(title)}</h1></div>
</section>
<section class="sec sec-tight">
  <div class="wrap text-grid">
    <div class="prose">${html}</div>
    ${aside}
  </div>
</section>
${ctaBand()}`;
  writePage(urlPath, layout({ title, description, canonical: urlPath, body }));
}

function contactAside(msg) {
  return `<aside class="contact-card">
  <p class="eyebrow">Nous contacter</p>
  <a class="btn btn-block" href="${wa(msg)}" target="_blank" rel="noopener">${icon.wa} WhatsApp</a>
  <a class="btn btn-ghost btn-block" href="tel:${phoneDigits}">${icon.phone} ${esc(C.telephone)}</a>
  <a class="btn btn-ghost btn-block" href="mailto:${esc(C.email)}">${icon.mail} ${esc(C.email)}</a>
  <a class="btn btn-ghost btn-block" href="https://www.instagram.com/${esc(C.instagram)}/" target="_blank" rel="noopener">${icon.ig} @${esc(C.instagram)}</a>
</aside>`;
}

function pagesStatic() {
  const V = site.vendre;
  pageText('/vendre/', {
    eyebrow: 'Vendre', title: V.titre, description: V.intro,
    html: `<p class="lead">${esc(V.intro)}</p><ol class="steps">${(V.liste || []).map(l => `<li>${esc(l)}</li>`).join('')}</ol><p>${esc(V.conclusion)}</p>`,
    aside: contactAside('Bonjour Majesty Watches, je souhaite faire estimer ma montre : '),
  });
  const R = site.recherche;
  pageText('/recherche/', {
    eyebrow: 'Recherche personnalisée', title: R.titre, description: R.intro,
    html: `<p class="lead">${esc(R.intro)}</p><p>${esc(R.texte)}</p>`,
    aside: contactAside('Bonjour Majesty Watches, je recherche le modèle suivant : '),
  });
  // Contact avec formulaire
  const body = `
<section class="page-hd"><div class="wrap"><p class="eyebrow">Contact</p><h1 class="display-s">Écrivez-nous</h1><p class="lead">Une question sur une montre, une estimation, une recherche&nbsp;? Nous vous répondons rapidement — le plus simple reste WhatsApp.</p></div></section>
<section class="sec sec-tight">
  <div class="wrap text-grid">
    <form class="form" data-form action="https://formsubmit.co/ajax/${esc(C.email)}" method="post">
      <input type="hidden" name="_subject" value="Nouveau message — site Majesty Watches">
      <input type="text" name="_honey" tabindex="-1" autocomplete="off" class="hp" aria-hidden="true">
      <div class="form-row">
        <label><span>Nom</span><input name="nom" required autocomplete="name"></label>
        <label><span>Téléphone</span><input name="telephone" type="tel" autocomplete="tel"></label>
      </div>
      <label><span>E-mail</span><input name="email" type="email" required autocomplete="email"></label>
      <label><span>Objet</span>
        <select name="objet"><option>Achat d’une montre</option><option>Vendre ma montre</option><option>Recherche personnalisée</option><option>Autre</option></select>
      </label>
      <label><span>Message</span><textarea name="message" rows="6" required></textarea></label>
      <button class="btn" type="submit">Envoyer le message ${icon.arrow}</button>
      <p class="form-msg" data-form-msg role="status"></p>
    </form>
    ${contactAside('Bonjour Majesty Watches, ')}
  </div>
</section>`;
  writePage('/contact/', layout({ title: 'Contact', description: 'Contactez Majesty Watches par WhatsApp, téléphone, e-mail ou Instagram.', canonical: '/contact/', body }));

  const legal = fs.readFileSync(path.join(ROOT, 'content/mentions-legales.md'), 'utf8').replace(/^---[\s\S]*?---\n/, '');
  pageText('/mentions-legales/', { eyebrow: 'Informations', title: 'Mentions légales', html: marked.parse(legal) });
  const conf = fs.readFileSync(path.join(ROOT, 'content/confidentialite.md'), 'utf8');
  pageText('/confidentialite/', { eyebrow: 'Informations', title: 'Confidentialité', html: marked.parse(conf) });

  // 404
  fs.writeFileSync(path.join(DIST, '404.html'), layout({ title: 'Page introuvable', canonical: '/404', body: `
<section class="page-hd"><div class="wrap"><p class="eyebrow">Erreur 404</p><h1 class="display-s">Cette page n’existe pas (ou plus).</h1><p class="lead">La montre que vous cherchez a peut-être trouvé preneur.</p><div class="btns"><a class="btn" href="/montres/">Voir la collection ${icon.arrow}</a><a class="btn btn-ghost" href="/recherche/">Recherche personnalisée</a></div></div></section>` }));
}

function seoFiles() {
  const urls = ['/', '/montres/', '/vendre/', '/recherche/', '/contact/', ...montres.map(m => `/montres/${m.slug}/`)];
  fs.writeFileSync(path.join(DIST, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map(u => `<url><loc>${SITE_URL}${u}</loc></url>`).join('\n')}\n</urlset>\n`);
  fs.writeFileSync(path.join(DIST, 'robots.txt'), `User-agent: *\nAllow: /\nSitemap: ${SITE_URL}/sitemap.xml\n`);
  // Anciennes URL Framer -> nouvelles
  const redirects = [
    '/shop /montres/ 301',
    '/shop/ /montres/ 301',
    '/shop/:slug /montres/:slug/ 301',
    '/montres /montres/ 301',
    '/collection/minimalist-elegance /vendre/ 301',
    '/collection/recherche-personnalisee /recherche/ 301',
    '/collection/* /montres/ 301',
    '/legal-2 /mentions-legales/ 301',
    '/contact /contact/ 301',
  ];
  fs.writeFileSync(path.join(DIST, '_redirects'), redirects.join('\n') + '\n');
  fs.writeFileSync(path.join(DIST, '_headers'), `/assets/*\n  Cache-Control: public, max-age=0, must-revalidate\n/assets/fonts/*\n  Cache-Control: public, max-age=31536000, immutable\n/img/*\n  Cache-Control: public, max-age=31536000, immutable\n`);
}

function copyAssets() {
  const to = path.join(DIST, 'assets');
  fs.mkdirSync(path.join(to, 'fonts'), { recursive: true });
  for (const f of ['site.css', 'site.js']) fs.copyFileSync(path.join(ROOT, 'src', f), path.join(to, f));
  fs.copyFileSync(path.join(ROOT, 'node_modules/@fontsource-variable/kumbh-sans/files/kumbh-sans-latin-wght-normal.woff2'), path.join(to, 'fonts/kumbh.woff2'));
  // Fichiers statiques du dossier public (logo, favicon…), hors photos des montres (traitées en webp)
  const pub = path.join(ROOT, 'public/assets');
  if (fs.existsSync(pub)) fs.cpSync(pub, to, { recursive: true });
}

// ---------- Exécution ----------
const t0 = Date.now();
const toProcess = new Set([site.accueil.image, ...(site.accueil.montres_tournantes || []), ...montres.flatMap(m => m.photos)]);
let done = 0;
const queue = [...toProcess].filter(Boolean);
await processImage(site.accueil.image, [1280, 1920, 2560, 3200]);
await processImage(site.accueil.image_mobile, [640, 960, 1350]);
await processImage(site.accueil.image_tablette, [900, 1400, 1800]);
await Promise.all(Array.from({ length: 4 }, async () => {
  while (queue.length) { const s = queue.shift(); try { await processImage(s); } catch (e) { console.warn('Image ignorée', s, e.message); imgMap.set(s, null); } done++; }
}));
copyAssets();
// Logos des maisons : rasterisés, recadrés et convertis en masque (la couleur vient du CSS)
async function buildLogos() {
  const dir = path.join(ROOT, 'public/assets/marques');
  if (!fs.existsSync(dir)) return;
  for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.svg'))) {
    try {
      const svg = fs.readFileSync(path.join(dir, f));
      const { data, info } = await sharp(svg, { density: 600 }).resize({ height: 600, withoutEnlargement: false }).flatten({ background: '#fff' }).trim({ threshold: 12 }).resize({ height: 180 }).raw().toBuffer({ resolveWithObject: true });
      const out = Buffer.alloc(info.width * info.height * 4);
      for (let i = 0, j = 0; i < data.length; i += info.channels, j += 4) {
        const m = Math.min(data[i], data[i + 1], data[i + 2]);
        out[j] = out[j + 1] = out[j + 2] = 0; out[j + 3] = Math.min(255, Math.max(0, (255 - m) * 3 - 20));
      }
      await sharp(out, { raw: { width: info.width, height: info.height, channels: 4 } }).png({ compressionLevel: 9 }).toFile(path.join(DIST, 'assets/marques', f.replace('.svg', '.png')));
    } catch (e) { console.warn('Logo ignoré', f, e.message); }
  }
}
await buildLogos();
// Photos sur fond blanc (pour l'anneau : une photo sur fond gris ferait un carré visible)
const fondBlanc = new Set();
for (const m of montres) {
  const src = m.photos[0]; if (!src) continue;
  try {
    const { data, info } = await sharp(path.join(ROOT, 'public', src)).resize(24, 24, { fit: 'fill' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const px = (x, y) => { const i = (y * info.width + x) * 3; return Math.min(data[i], data[i + 1], data[i + 2]); };
    const bords = [[0, 0], [23, 0], [0, 23], [23, 23], [12, 0], [0, 12], [23, 12]].map(([x, y]) => px(x, y));
    if (Math.min(...bords) > 235) fondBlanc.add(src);
  } catch {}
}
pageHome();
pageCollection();
montres.forEach(pageMontre);
pagesStatic();
seoFiles();
const missing = [...imgMap].filter(([, v]) => !v).map(([k]) => k);
console.log(`OK : ${montres.length} montres publiées / ${all.length}, ${done} images (${missing.length} manquantes) en ${((Date.now() - t0) / 1000).toFixed(1)} s`);
