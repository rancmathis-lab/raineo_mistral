import { chromium } from 'playwright';

const BASE = 'http://localhost:5173';
let failures = 0;
async function check(name, cond) {
  if (cond) console.log('PASS', name);
  else { console.log('FAIL', name); failures++; }
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto(BASE);
await page.waitForSelector('canvas');

// Dessiner un rectangle : activer l'outil, deux clics
await page.click('button:has-text("Rectangle")');
await page.mouse.click(300, 300);
await page.mouse.click(500, 400);
await page.click('button:has-text("Sélection")');

// Comptage via statut ? On vérifie via export SVG (download)
const [svgDownload] = await Promise.all([
  page.waitForEvent('download'),
  page.click('button:has-text("Exporter SVG")')
]);
const svgPath = await svgDownload.path();
const fs = await import('fs');
const svg = fs.readFileSync(svgPath, 'utf-8');
await check('SVG contient un rect 100x60 (zoom 0.5 mm/px)', svg.includes('width="100mm"') && svg.includes('height="60mm"') && svg.includes('<rect'));

// Sélection clic : cliquer sur le bord du rectangle
await page.mouse.click(400, 300); // bord haut du rect
const selText = await page.textContent('.sidepanel');
await check('1 élément sélectionné après clic', selText.includes('1 élément(s)'));

// Déplacer puis Ctrl+Z
await page.mouse.move(400, 300);
await page.mouse.down();
await page.mouse.move(500, 400, { steps: 5 });
await page.mouse.up();
const selAfter = await page.textContent('.sidepanel');
const [svg2] = await Promise.all([
  page.waitForEvent('download'),
  page.click('button:has-text("Exporter SVG")')
]);
const svg2Path = await svg2.path();
const svg2content = fs.readFileSync(svg2Path, 'utf-8');
const moved = /x="(\d+)"/.exec(svg2content);
await check('rect déplacé (x > 0)', moved && Number(moved[1]) > 0);

await page.keyboard.press('Control+z');
const [svg3] = await Promise.all([
  page.waitForEvent('download'),
  page.click('button:has-text("Exporter SVG")')
]);
const svg3content = fs.readFileSync(await svg3.path(), 'utf-8');
const restored = /x="(\d+)"/.exec(svg3content);
await check('undo restaure la position initiale', restored && restored[1] === '0');

// Enregistrer puis rouvrir
const [docDownload] = await Promise.all([
  page.waitForEvent('download'),
  page.click('button:has-text("Enregistrer")')
]);
const docPath = await docDownload.path();
const docContent = JSON.parse(fs.readFileSync(docPath, 'utf-8'));
await check('fichier .raineo valide avec formatVersion', docContent.formatVersion === 1 && Array.isArray(docContent.entities));

const [fileChooser] = await Promise.all([
  page.waitForEvent('filechooser'),
  page.click('text=Ouvrir')
]);
await fileChooser.setFiles(docPath);
await new Promise(r => setTimeout(r, 300));
const [svg4] = await Promise.all([
  page.waitForEvent('download'),
  page.click('button:has-text("Exporter SVG")')
]);
const svg4content = fs.readFileSync(await svg4.path(), 'utf-8');
await check('réouverture : le dessin est conservé', svg4content.includes('<rect'));

await browser.close();
console.log(failures === 0 ? 'TOUS LES TESTS UI PASSENT' : `${failures} ÉCHECS`);
process.exit(failures === 0 ? 0 : 1);
