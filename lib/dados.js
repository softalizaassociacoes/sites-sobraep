/**
 * Camada de dados do site: notícias e webinars.
 *
 * Em produção (GITHUB_TOKEN definido), os dados vivem no próprio repositório
 * (data/noticias.json e data/webinars.json) — o painel grava via GitHub
 * Contents API, e cada gravação vira um commit que dispara o redeploy.
 * Sem token (dev local ou falha da API), cai para os JSONs locais do
 * repositório — o site público continua funcionando de qualquer forma.
 *
 * Cache em memória por instância (TTL curto) para não bater no GitHub a
 * cada request do site público.
 */
const fs = require('fs');
const path = require('path');
const github = require('./github');

const CACHE_TTL_MS = 20 * 1000;
const ARQUIVOS = {
  noticias: 'data/noticias.json',
  webinars: 'data/webinars.json'
};

const cache = {
  noticias: { dados: null, em: 0 },
  webinars: { dados: null, em: 0 }
};

function lerLocal(chave) {
  const p = path.join(__dirname, '..', ARQUIVOS[chave].replace('data/', 'data' + path.sep));
  if (!fs.existsSync(p)) return [];
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

async function ler(chave) {
  const c = cache[chave];
  if (c.dados && Date.now() - c.em < CACHE_TTL_MS) return c.dados;
  let dados = null;
  if (github.temGitHub()) {
    try {
      const arq = await github.lerArquivo(ARQUIVOS[chave]);
      if (arq) dados = JSON.parse(arq.conteudo);
    } catch (err) {
      console.error(`Erro lendo ${chave} do GitHub:`, err.message);
    }
  }
  if (!dados) dados = lerLocal(chave); // dev local ou fallback em falha da API
  cache[chave] = { dados, em: Date.now() };
  return dados;
}

async function salvar(chave, dados) {
  if (!github.temGitHub()) {
    throw new Error('GITHUB_TOKEN/GITHUB_REPO não configurados — não é possível salvar.');
  }
  await github.gravarArquivo(
    ARQUIVOS[chave],
    JSON.stringify(dados, null, 2),
    `painel: atualiza ${chave}`
  );
  // atualiza o cache local imediatamente para a leitura seguinte já vir fresca
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

function textoDoHtml(html) {
  return String(html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function resumoDoHtml(html, max = 160) {
  const texto = textoDoHtml(html);
  return texto.length > max ? texto.slice(0, max).trim() + '…' : texto;
}

/** Minúsculas e sem acento, para comparar "premio" com "Prêmio". */
function normalizar(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/**
 * Filtra notícias pelo termo digitado na busca do site.
 * Procura no título, no resumo e no corpo — assim o visitante acha uma
 * notícia pelo nome de um autor ou pelo tema do trabalho, não só pelo título.
 * Todas as palavras do termo precisam aparecer (busca "E", não "ou").
 */
function filtrarNoticias(lista, termo) {
  const palavras = normalizar(termo).trim().split(/\s+/).filter(Boolean);
  if (!palavras.length) return lista;
  return lista.filter((n) => {
    const texto = normalizar(`${n.titulo} ${n.resumo || ''} ${textoDoHtml(n.corpoHtml)}`);
    return palavras.every((p) => texto.includes(p));
  });
}

/**
 * Sobe um arquivo enviado pelo painel (imagem ou PDF) para o repositório e
 * retorna o caminho público (/docs/arquivos/... ou /images/uploads/...).
 * O arquivo passa a ser servido pelo site após o redeploy (~1 min).
 */
async function subirArquivo(nomeArquivo, buffer, tipo) {
  if (!github.temGitHub()) {
    throw new Error('GITHUB_TOKEN/GITHUB_REPO não configurados — não é possível enviar arquivos.');
  }
  const dir = tipo === 'pdf' ? 'public/docs/arquivos' : 'public/images/uploads';
  const nomeSeguro = nomeArquivoSeguro(nomeArquivo, tipo);
  const caminho = `${dir}/${nomeSeguro}`;
  await github.gravarArquivo(caminho, buffer, `painel: upload ${nomeSeguro}`);
  return caminho.replace(/^public/, ''); // caminho público servido pelo Express
}

function nomeArquivoSeguro(nome, tipo) {
  const extPadrao = tipo === 'pdf' ? 'pdf' : 'jpg';
  const ponto = nome.lastIndexOf('.');
  const ext = (ponto > -1 ? nome.slice(ponto + 1) : extPadrao).toLowerCase().replace(/[^a-z0-9]/g, '') || extPadrao;
  const base = (ponto > -1 ? nome.slice(0, ponto) : nome)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50) || 'arquivo';
  return `${base}-${Date.now()}.${ext}`;
}

module.exports = {
  getNoticias,
  saveNoticias,
  getWebinars,
  saveWebinars,
  subirArquivo,
  formatarData,
  gerarSlug,
  sanitizarHtml,
  resumoDoHtml,
  filtrarNoticias,
  temGitHub: github.temGitHub
};
