/**
 * Camada de persistência via GitHub Contents API.
 *
 * Grava os dados do painel (notícias, webinars) e os arquivos enviados
 * (imagens, PDFs) como commits no próprio repositório do site. Cada commit
 * dispara um redeploy no Vercel. Vantagens sobre um store gerenciado:
 * durável, versionado, gratuito e impossível de "suspender" — o dado do
 * cliente nunca some.
 *
 * Config por variáveis de ambiente:
 *   GITHUB_TOKEN  — fine-grained PAT com permissão Contents: Read and write
 *   GITHUB_REPO   — "owner/repo" (ex.: softalizaassociacoes/sites-sobraep)
 *   GITHUB_BRANCH — branch de destino (padrão: main)
 */
const API = 'https://api.github.com';

function cfg() {
  return {
    token: process.env.GITHUB_TOKEN,
    repo: process.env.GITHUB_REPO,
    branch: process.env.GITHUB_BRANCH || 'main'
  };
}

function temGitHub() {
  const c = cfg();
  return Boolean(c.token && c.repo);
}

async function chamar(caminho, opts = {}) {
  const c = cfg();
  return fetch(`${API}/repos/${c.repo}/contents/${caminho}`, {
    ...opts,
    headers: {
      Authorization: `Bearer ${c.token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'sobraep-painel',
      ...(opts.headers || {})
    }
  });
}

// Lê um arquivo do repo. Retorna { conteudo, sha } ou null se não existir.
async function lerArquivo(caminho) {
  const c = cfg();
  const res = await chamar(`${encodeURI(caminho)}?ref=${encodeURIComponent(c.branch)}`, {
    // evita cache de CDN da API para leituras sempre frescas
    headers: { 'Cache-Control': 'no-cache' }
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub GET ${caminho}: ${res.status}`);
  const data = await res.json();
  const conteudo = Buffer.from(data.content, 'base64').toString('utf8');
  return { conteudo, sha: data.sha };
}

// Grava (cria ou atualiza) um arquivo no repo. `conteudo` pode ser string ou Buffer.
async function gravarArquivo(caminho, conteudo, mensagem) {
  const c = cfg();
  // Descobre o sha atual (obrigatório para atualizar um arquivo existente).
  let sha;
  const atual = await chamar(`${encodeURI(caminho)}?ref=${encodeURIComponent(c.branch)}`);
  if (atual.ok) sha = (await atual.json()).sha;
  else if (atual.status !== 404) throw new Error(`GitHub sha ${caminho}: ${atual.status}`);

  const corpo = {
    message: mensagem,
    content: Buffer.from(conteudo).toString('base64'),
    branch: c.branch,
    ...(sha ? { sha } : {})
  };
  const res = await chamar(encodeURI(caminho), {
    method: 'PUT',
    body: JSON.stringify(corpo)
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`GitHub PUT ${caminho}: ${res.status} ${txt.slice(0, 200)}`);
  }
  return res.json();
}

module.exports = { temGitHub, lerArquivo, gravarArquivo };
