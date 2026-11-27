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
for (const [slug, titles] of Object.entries(brands)) {
  let got = false;
  for (const host of ['en.wikipedia.org', 'fr.wikipedia.org']) {
    for (const t of titles) {
      if (got) break;
      try {
        const j = await api(host, `action=query&prop=images&imlimit=100&redirects=1&titles=${encodeURIComponent(t)}`);
        const page = Object.values(j.query?.pages || {})[0];
        const imgs = (page?.images || []).map(i => i.title).filter(n => /logo/i.test(n) && /\.svg$/i.test(n) && !/commons|wiki|edit|flag|question|symbol_support|ambox/i.test(n));
        imgs.sort((a, b) => (/wordmark|logo\.svg$/i.test(b) ? 1 : 0) - (/wordmark|logo\.svg$/i.test(a) ? 1 : 0));
        for (const name of imgs) {
          const file = name.replace(/^[^:]+:/, '');
          const r = await fetch(`https://${host}/wiki/Special:FilePath/${encodeURIComponent(file)}`, { headers: UA });
          if (!r.ok) continue;
          const svg = await r.text();
          if (!svg.includes('<svg')) continue;
          fs.writeFileSync(`${OUT}/${slug}.svg`, svg);
          console.log(slug, '←', host, file, svg.length);
          got = true; break;
        }
      } catch (e) { console.log(slug, 'erreur', e.message); }
    }
  }
  if (!got) console.log(slug, ': rien trouvé');
}
