// One-shot : transforme montres.json (export Framer) en fiches content/montres/*.md
// et liste les photos à télécharger (tools/seed/downloads.json).
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const data = JSON.parse(fs.readFileSync(path.join(root, 'tools/seed/montres.json'), 'utf8'));
const outDir = path.join(root, 'content/montres');
fs.mkdirSync(outDir, { recursive: true });

const BRANDS = ['Audemars Piguet', 'Patek Philippe', 'Vacheron Constantin', 'Cartier', 'Rolex', 'Tudor', 'Omega'];
const downloads = [];
const start = new Date('2026-11-27T12:00:00Z');

data.forEach((m, idx) => {
  const slug = m.s.normalize('NFD').replace(/[̀-ͯ]/g, '');
  const marque = BRANDS.find(b => m.t.startsWith(b)) || 'Autre';
  const photos = m.i.map((file, n) => {
    const ext = path.extname(file).toLowerCase().replace('.jpeg', '.jpg');
    const local = `/images/montres/${slug}-${n + 1}${ext}`;
    downloads.push({ url: `https://framerusercontent.com/images/${file}`, path: `public${local}` });
    return local;
  });
  const date = new Date(start.getTime() - idx * 86400000).toISOString().slice(0, 10);
  const fm = {
    titre: m.t.trim(),
    marque,
    reference: (m.r || '').replace(/^R[ée]f\.\s*/i, '').trim(),
    prix: (m.p || '').replace(/\s+/g, ' ').trim(),
    statut: m.st === 'reservee' ? 'Réservée' : m.st === 'arrivage' ? 'En arrivage' : 'Disponible',
    nouveaute: !!m.n,
    publie: !m.d,
    date,
    photos,
  };
  // Fiche technique : « Clé : valeur » -> champs simples éditables dans le CMS
  const infos = [];
  for (const raw of (m.x || '').split('\n')) {
    if (!/^\s*-\s+/.test(raw)) continue;
    const l = raw.replace(/^\s*-\s+/, '').replace(/\*\*/g, '').trim();
    const kv = l.match(/^([^:]{2,30}?)\s*:\s+(.+)$/);
    const k = kv ? kv[1].toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '') : '';
    if (k === 'reference') continue;
    else if (k === 'boitier') fm.boitier = kv[2];
    else if (k === 'annee') fm.annee = kv[2];
    else if (k === 'etat' || k === 'condition') fm.etat = kv[2];
    else if (k === 'set' || k === 'full set') fm.contenu = kv[2];
    else if (/^garantie/i.test(l) || /^r[ée]vis[ée]e et garantie/i.test(l)) fm.garantie = l;
    else infos.push(l);
  }
  if (infos.length) fm.infos = infos.join('\n');
  fs.writeFileSync(path.join(outDir, `${slug}.md`), `---\n${yaml.dump(fm, { lineWidth: 200 })}---\n`);
});

fs.writeFileSync(path.join(root, 'tools/seed/downloads.json'), JSON.stringify(downloads, null, 1));
console.log(`${data.length} fiches, ${downloads.length} photos`);
