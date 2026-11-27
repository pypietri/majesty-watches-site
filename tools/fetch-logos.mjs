// Récupère les logos des maisons depuis Wikipédia (exécuté par GitHub Actions).
import fs from 'node:fs';
const OUT = 'public/assets/marques';
fs.mkdirSync(OUT, { recursive: true });
const UA = { 'User-Agent': 'majesty-watches-site/1.0 (contact@majestywatches.fr)' };
const brands = {
  'rolex': ['Rolex'],
  'audemars-piguet': ['Audemars Piguet'],
  'patek-philippe': ['Patek Philippe', 'Patek Philippe SA'],
  'cartier': ['Cartier (jeweler)', 'Cartier SA'],
  'tudor': ['Tudor Watches', 'Montres Tudor SA'],
  'vacheron-constantin': ['Vacheron Constantin'],
  'omega': ['Omega SA'],
  'richard-mille': ['Richard Mille'],
  'hublot': ['Hublot'],
  'iwc': ['IWC Schaffhausen'],
  'breitling': ['Breitling SA'],
  'panerai': ['Panerai'],
};
const api = async (host, q) => (await fetch(`https://${host}/w/api.php?format=json&${q}`, { headers: UA })).json();
const direct = {
  'rolex': ['Rolex logo.svg', 'Rolex Logo.svg', 'Logo da Rolex.svg', 'Rolex-Logo.svg'],
  'audemars-piguet': ['Audemars Piguet logo.svg', 'Audemars Piguet Logo.svg', 'Audemars-Piguet-Logo.svg', 'Logo Audemars Piguet.svg'],
  'breitling': ['Breitling logo.svg', 'Breitling Logo.svg', 'Breitling SA logo.svg'],
};
async function save(host, file, slug) {
  const r = await fetch(`https://${host}/wiki/Special:FilePath/${encodeURIComponent(file)}`, { headers: UA });
  if (!r.ok) return false;
  const svg = await r.text();
  if (!svg.includes('<svg')) return false;
  fs.writeFileSync(`${OUT}/${slug}.svg`, svg);
  console.log(slug, '←', host, file, svg.length);
  return true;
}
for (const [slug, titles] of Object.entries(brands)) {
  if (fs.existsSync(`${OUT}/${slug}.svg`)) continue;
  let got = false;
  for (const host of ['en.wikipedia.org', 'commons.wikimedia.org', 'fr.wikipedia.org', 'de.wikipedia.org']) for (const f of direct[slug] || []) { if (!got) got = await save(host, f, slug); }
  for (const host of ['en.wikipedia.org', 'fr.wikipedia.org']) {
    for (const t of titles) {
      if (got) break;
      try {
        let all = [], cont = '';
        for (let k = 0; k < 6; k++) {
          const j = await api(host, `action=query&prop=images&imlimit=500&redirects=1&titles=${encodeURIComponent(t)}${cont}`);
          const page = Object.values(j.query?.pages || {})[0];
          all = all.concat((page?.images || []).map(i => i.title));
          if (!j.continue?.imcontinue) break;
          cont = `&imcontinue=${encodeURIComponent(j.continue.imcontinue)}`;
        }
        const imgs = all.filter(n => /logo/i.test(n) && /\.svg$/i.test(n) && !/commons|wiki|edit|flag|question|symbol_support|ambox|disambig/i.test(n));
        imgs.sort((a, b) => (/wordmark|logo\.svg$/i.test(b) ? 1 : 0) - (/wordmark|logo\.svg$/i.test(a) ? 1 : 0));
        for (const name of imgs) { if (await save(host, name.replace(/^[^:]+:/, ''), slug)) { got = true; break; } }
      } catch (e) { console.log(slug, 'erreur', e.message); }
    }
  }
  if (!got) console.log(slug, ': rien trouvé');
}
