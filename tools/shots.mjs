// Captures d'écran de contrôle (desktop + mobile) du site construit.
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const DIST = path.resolve('dist');
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let f = path.join(DIST, p);
  if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
  if (!fs.existsSync(f)) { res.writeHead(404); return res.end(fs.readFileSync(path.join(DIST, '404.html'))); }
  res.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream' });
  res.end(fs.readFileSync(f));
}).listen(4173);

const pages = (process.env.PAGES || '/,/montres/,/vendre/,/contact/').split(',');
const firstWatch = fs.readdirSync(path.join(DIST, 'montres')).find(d => fs.statSync(path.join(DIST, 'montres', d)).isDirectory());
if (firstWatch && !process.env.PAGES) pages.push(`/montres/${firstWatch}/`);
fs.mkdirSync('shots', { recursive: true });
const browser = await chromium.launch();
for (const [name, vp] of [['desk', { width: 1440, height: 900 }], ['lap', { width: 1200, height: 800 }], ['mob', { width: 390, height: 844 }]]) {
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: name === 'mob' ? 2 : 1 });
  const page = await ctx.newPage();
  for (const p of pages) {
    await page.goto('http://localhost:4173' + p, { waitUntil: 'networkidle' });
    await page.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 500) { scrollTo(0, y); await new Promise(r => setTimeout(r, 60)); } scrollTo(0, 0); document.querySelectorAll('[data-reveal]').forEach(e => e.classList.add('is-in')); });
    await page.waitForTimeout(900);
    const slug = (p.replace(/\//g, '_') || 'home').replace(/^_|_$/g, '') || 'home';
    await page.screenshot({ path: `shots/${name}-${slug.slice(0, 40)}.jpg`, fullPage: true, type: 'jpeg', quality: 70 });
  }
  // Captures « écran » de l’accueil à plusieurs hauteurs (sections animées)
  await page.goto('http://localhost:4173/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `shots/${name}-v0-hero.jpg`, type: 'jpeg', quality: 72 });
  for (const f of [0.5]) {
    await page.evaluate(f => { const r = document.querySelector('[data-ring]'); if (r) scrollTo(0, r.offsetTop + (r.offsetHeight - innerHeight) * f); }, f);
    await page.waitForTimeout(1600);
    await page.screenshot({ path: `shots/${name}-v1-ring-${Math.round(f * 100)}.jpg`, type: 'jpeg', quality: 72 });
  }
  for (const sel of ['.trust', '.maisons', '.sell', '.reviews']) {
    await page.evaluate(sel => { const el = document.querySelector(sel); if (el) { el.scrollIntoView(); document.querySelectorAll('[data-reveal]').forEach(e => e.classList.add('is-in')); } }, sel);
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `shots/${name}-v2${sel.replace('.', '-')}.jpg`, type: 'jpeg', quality: 72 });
  }
  await ctx.close();
}
await browser.close();
server.close();
console.log('captures OK');
