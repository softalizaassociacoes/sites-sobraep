/**
 * Auto-hospeda as fontes do Google Fonts: baixa o CSS e os arquivos
 * .woff2 e os salva em public/fonts/, gerando um fonts.css local.
 * Remove a última dependência externa do site (fontes).
 *
 * Uso: node scripts/baixar-fontes.mjs
 */
import fs from 'fs';
import path from 'path';

const GF_URL =
  'https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600;700&display=swap';
const DEST = path.join(process.cwd(), 'public', 'fonts');
fs.mkdirSync(DEST, { recursive: true });
// UA de Chrome moderno para o Google servir woff2
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

const cssRes = await fetch(GF_URL, { headers: { 'User-Agent': UA } });
let css = await cssRes.text();

// encontra todas as urls de woff2
const urls = [...new Set([...css.matchAll(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/g)].map((m) => m[1]))];
console.log('Arquivos de fonte encontrados:', urls.length);

let seq = 0;
const mapa = {};
for (const u of urls) {
  // nome local baseado na família + peso (extrai do comentário anterior não é trivial; usa índice)
  const nome = `font-${String(++seq).padStart(2, '0')}.woff2`;
  const res = await fetch(u, { headers: { 'User-Agent': UA } });
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(path.join(DEST, nome), buf);
  mapa[u] = `/fonts/${nome}`;
  console.log(`  ${nome} (${(buf.length / 1024).toFixed(0)} KB)`);
}

// reescreve o css apontando para os arquivos locais
for (const [remote, local] of Object.entries(mapa)) css = css.split(remote).join(local);
fs.writeFileSync(path.join(DEST, 'fonts.css'), css, 'utf8');
console.log('\nfonts.css gerado com', urls.length, 'fontes locais.');
