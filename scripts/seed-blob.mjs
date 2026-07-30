/**
 * Envia os JSONs iniciais (data/noticias.json e data/webinars.json) para o
 * Vercel Blob, criando os pathnames fixos que o site e o painel usam.
 * Rode uma vez após configurar o BLOB_READ_WRITE_TOKEN:
 *
 *   npm run seed-blob
 *
 * É idempotente: sobrescreve o conteúdo atual pelos arquivos do repositório.
 * Use com cuidado em produção — só rode para o seed inicial, senão você
 * sobrescreve as edições feitas pelo painel.
 */
import { put } from '@vercel/blob';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const raiz = path.join(__dirname, '..');

if (!process.env.BLOB_READ_WRITE_TOKEN) {
  console.error('❌ BLOB_READ_WRITE_TOKEN não definido. Coloque-o no arquivo .env e rode de novo.');
  process.exit(1);
}

const arquivos = ['data/noticias.json', 'data/webinars.json'];

for (const rel of arquivos) {
  const conteudo = fs.readFileSync(path.join(raiz, rel), 'utf8');
  const { url } = await put(rel, conteudo, {
    access: 'public',
    contentType: 'application/json',
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 60
  });
  console.log(`✅ ${rel} → ${url} (${(conteudo.length / 1024).toFixed(1)} KB)`);
}

console.log('\nSeed concluído.');
