// Télécharge les photos depuis Framer (une seule fois) et les allège (2000 px max).
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const list = JSON.parse(fs.readFileSync('tools/seed/downloads.json', 'utf8'));
const F = 'https://framerusercontent.com/images/';
list.push(
  { url: F + '7JKBH3rxgXVx2vFrWG27xpKWsU.jpg', path: 'public/images/site/hero.jpg' },
  { url: F + 'JEDMoB2Ba5i3pmkNlExHneAA.png', path: 'public/images/site/vendre.png' },
  { url: F + '9jiyNlXHUwSFhdrVrNjwTxjM.png', path: 'public/assets/logo-full.png', raw: true },
  { url: F + 'DV6Op5MDCYm4lbGjUe5dVAtJsuQ.png', path: 'public/assets/favicon.png', raw: true },
  { url: F + 'NjgmelJMfVDAeniNtqc6mDG9FgY.png', path: 'public/assets/favicon-dark.png', raw: true },
  { url: F + 'X5TkFnXC7UXphaQGjUidIeZhqtU.png', path: 'public/assets/og-source.png', raw: true },
);
let ok = 0, fail = 0;
for (const it of list) {
  if (fs.existsSync(it.path)) { ok++; continue; }
  try {
    const res = await fetch(it.url);
    if (!res.ok) throw new Error(res.status);
    const buf = Buffer.from(await res.arrayBuffer());
    fs.mkdirSync(path.dirname(it.path), { recursive: true });
    if (it.raw) fs.writeFileSync(it.path, buf);
    else {
      const ext = path.extname(it.path).toLowerCase();
      let img = sharp(buf).rotate().resize({ width: 2000, height: 2000, fit: 'inside', withoutEnlargement: true });
      img = ext === '.png' ? img.png({ compressionLevel: 9 }) : ext === '.webp' ? img.webp({ quality: 86 }) : img.jpeg({ quality: 86, mozjpeg: true });
      await img.toFile(it.path);
    }
    ok++;
  } catch (e) { fail++; console.warn('Échec', it.url, e.message); }
}
console.log(`${ok} OK, ${fail} échecs`);
