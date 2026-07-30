/**
 * Camada de dados do site: notícias e webinars.
 *
 * Em produção (BLOB_READ_WRITE_TOKEN definido), os dados vivem no Vercel
 * Blob em pathnames fixos (data/noticias.json e data/webinars.json) —
 * o filesystem do Vercel é somente leitura, então o painel admin grava lá.
 * Sem o token (ou em falha), cai para os JSONs locais do repositório,
 * que também servem de seed inicial.
 *
 * Cache em memória por instância (TTL curto) para não buscar o Blob a
 * cada request do site público.
 */
const fs = require('fs');
const path = require('path');

const CACHE_TTL_MS = 15 * 1000;
const ARQUIVOS = {
  noticias: 'data/noticias.json',
  webinars: 'data/webinars.json'
};

const cache = {
  noticias: { dados: null, em: 0 },
  webinars: { dados: null, em: 0 }
};

let blobBaseUrl = null; // descoberto uma vez por cold start

function temBlob() {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

function lerLocal(chave) {
  const p = path.join(__dirname, '..', ARQUIVOS[chave].replace('data/', 'data' + path.sep));
  if (!fs.existsSync(p)) return [];
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

async function descobrirBaseUrl() {
  if (blobBaseUrl) return blobBaseUrl;
  const { list } = require('@vercel/blob');
  const res = await list({ prefix: 'data/', limit: 10 });
  const item = res.blobs.find((b) => b.pathname === ARQUIVOS.noticias || b.pathname === ARQUIVOS.webinars);
  if (item) {
    blobBaseUrl = item.url.slice(0, item.url.lastIndexOf(item.pathname));
    return blobBaseUrl;
  }
  return null;
}

async function lerDoBlob(chave) {
  const base = await descobrirBaseUrl();
  if (!base) return null; // ainda não semeado
  const res = await fetch(base + ARQUIVOS[chave], { cache: 'no-store' });
  if (!res.ok) return null;
  return res.json();
}

async function ler(chave) {
  const c = cache[chave];
  if (c.dados && Date.now() - c.em < CACHE_TTL_MS) return c.dados;
  let dados = null;
  if (temBlob()) {
    try {
      dados = await lerDoBlob(chave);
    } catch (err) {
      console.error(`Erro lendo ${chave} do Blob:`, err.message);
    }
  }
  if (!dados) dados = lerLocal(chave);
  cache[chave] = { dados, em: Date.now() };
  return dados;
}

async function salvar(chave, dados) {
  if (!temBlob()) {
    throw new Error('BLOB_READ_WRITE_TOKEN não configurado — não é possível salvar (filesystem do Vercel é somente leitura).');
  }
  const { put } = require('@vercel/blob');
  await put(ARQUIVOS[chave], JSON.stringify(dados, null, 2), {
    access: 'public',
    contentType: 'application/json',
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 60
  });
  // atualiza cache local imediatamente (a instância que salvou serve fresco)
  cache[chave] = { dados, em: Date.now() };
}

// ---------- Notícias ----------
const getNoticias = () => ler('noticias');
const saveNoticias = (dados) => salvar('noticias', dados);

// ---------- Webinars ----------
const getWebinars = () => ler('webinars');
const saveWebinars = (dados) => salvar('webinars', dados);

// ---------- Utilidades compartilhadas ----------
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

function formatarData(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return '';
  return `${d.getUTCDate()} de ${MESES[d.getUTCMonth()]} de ${d.getUTCFullYear()}`;
}

function gerarSlug(titulo, existentes = []) {
  let base = titulo
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'noticia';
  let slug = base;
  let n = 2;
  while (existentes.includes(slug)) slug = `${base}-${n++}`;
  return slug;
}

function sanitizarHtml(html) {
  if (!html) return '';
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<script[^>]*>/gi, '')
    .replace(/\son\w+\s*=\s*"[^"]*"/gi, '')
    .replace(/\son\w+\s*=\s*'[^']*'/gi, '')
    .replace(/javascript:/gi, '');
}

function resumoDoHtml(html, max = 160) {
  const texto = String(html).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  return texto.length > max ? texto.slice(0, max).trim() + '…' : texto;
}

module.exports = {
  getNoticias,
  saveNoticias,
  getWebinars,
  saveWebinars,
  formatarData,
  gerarSlug,
  sanitizarHtml,
  resumoDoHtml,
  temBlob
};
