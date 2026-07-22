/**
 * Reaponta os links de arquivos do site antigo (sobraep.org.br/wp-content...)
 * para caminhos locais (/docs/arquivos/<nome>), tornando o site auto-contido.
 *
 * Usa /tmp/mapa-arquivos.json (gerado por recuperar-arquivos.mjs).
 *
 * Uso: node scripts/reapontar-arquivos.mjs
 */
import fs from 'fs';
import path from 'path';

const mapa = JSON.parse(fs.readFileSync('/tmp/mapa-arquivos.json', 'utf8'));

const noticiasPath = path.join(process.cwd(), 'data', 'noticias.json');
const webinarsPath = path.join(process.cwd(), 'views', 'webinars.ejs');

let noticias = fs.readFileSync(noticiasPath, 'utf8');
let webinars = fs.readFileSync(webinarsPath, 'utf8');

let subsNoticias = 0;
let subsWebinars = 0;

for (const [urlAntiga, info] of Object.entries(mapa)) {
  const local = info.local;
  // no JSON as URLs podem estar escapadas normalmente (sem escape especial de barra)
  const antesN = noticias.split(urlAntiga).length - 1;
  noticias = noticias.split(urlAntiga).join(local);
  subsNoticias += antesN;

  const antesW = webinars.split(urlAntiga).length - 1;
  webinars = webinars.split(urlAntiga).join(local);
  subsWebinars += antesW;
}

fs.writeFileSync(noticiasPath, noticias, 'utf8');
fs.writeFileSync(webinarsPath, webinars, 'utf8');

console.log('Substituições em data/noticias.json:', subsNoticias);
console.log('Substituições em views/webinars.ejs:', subsWebinars);

// Lista de pendentes com o nome de arquivo esperado (para o cliente enviar)
const pendentes = Object.entries(mapa).filter(([, m]) => m.status === 'pendente');
console.log('\n===== ARQUIVOS PENDENTES (precisam ser enviados) =====');
pendentes.forEach(([url, m]) => {
  console.log(`\nOriginal: ${url}`);
  console.log(`Salvar como: public/docs/arquivos/${m.base}`);
});
console.log(`\nTotal pendente: ${pendentes.length}`);
