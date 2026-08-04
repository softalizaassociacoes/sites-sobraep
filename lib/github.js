/**
 * Camada de persistência via GitHub Contents API.
 *
 * Grava os dados do painel (notícias, webinars) e os arquivos enviados
 * (imagens, PDFs) como commits no próprio repositório do site — durável,
 * versionado, gratuito e impossível de "suspender".
 *
 * Os arquivos enviados são servidos IMEDIATAMENTE por uma rota do app que lê
 * o binário aqui (lerArquivoBinario), sem esperar o redeploy. Depois do
 * redeploy eles também passam a ser servidos como estáticos do bundle.
 *
 * Config por variáveis de ambiente:
 *   GITHUB_TOKEN  — PAT (classic com escopo `repo`, ou fine-grained Contents: RW)
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

function cabecalhos(extra = {}) {
  return {
    Authorization: `Bearer ${cfg().token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'sobraep-painel',
    ...extra
  };
}

// Chamada à Contents API (caminho relativo ao repo).
async function chamar(caminho, opts = {}) {
  const c = cfg();
  return fetch(`${API}/repos/${c.repo}/contents/${caminho}`, {
    ...opts,
    headers: cabecalhos(opts.headers)
  });
}

// Lê um arquivo de texto do repo. Retorna { conteudo, sha } ou null se não existir.
async function lerArquivo(caminho) {
  const c = cfg();
  const res = await chamar(`${encodeURI(caminho)}?ref=${encodeURIComponent(c.branch)}`, {
    headers: { 'Cache-Control': 'no-cache' }
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub GET ${caminho}: ${res.status}`);
  const data = await res.json();
  const conteudo = Buffer.from(data.content, 'base64').toString('utf8');
  return { conteudo, sha: data.sha };
}

// Lê um arquivo binário (imagem/PDF) de qualquer tamanho. Retorna Buffer ou null.
async function lerArquivoBinario(caminho) {
  const c = cfg();
  const meta = await chamar(`${encodeURI(caminho)}?ref=${encodeURIComponent(c.branch)}`);
  if (meta.status === 404) return null;
  if (!meta.ok) throw new Error(`GitHub meta ${caminho}: ${meta.status}`);
  const info = await meta.json();
  if (Array.isArray(info)) return null; // é uma pasta, não um arquivo
  // Arquivos > 1MB não vêm com conteúdo inline: busca pela Blobs API (até 100MB).
  if (info.content && info.encoding === 'base64') {
    return Buffer.from(info.content, 'base64');
  }
  const blob = await fetch(`${API}/repos/${c.repo}/git/blobs/${info.sha}`, { headers: cabecalhos() });
  if (!blob.ok) throw new Error(`GitHub blob ${caminho}: ${blob.status}`);
  const bj = await blob.json();
  return Buffer.from(bj.content, 'base64');
}

// Lista os arquivos de uma pasta do repo. Retorna [] se a pasta não existir.
async function listarPasta(caminho) {
  const c = cfg();
  const res = await chamar(`${encodeURI(caminho)}?ref=${encodeURIComponent(c.branch)}`, {
    headers: { 'Cache-Control': 'no-cache' }
  });
  if (res.status === 404) return [];
  if (!res.ok) throw new Error(`GitHub list ${caminho}: ${res.status}`);
  const data = await res.json();
  if (!Array.isArray(data)) return [];
  return data
    .filter((it) => it.type === 'file')
    .map((it) => ({ nome: it.name, caminho: it.path, tamanho: it.size, sha: it.sha }));
}

// Grava (cria ou atualiza) um arquivo. `conteudo` pode ser string ou Buffer.
// Faz retry em conflito de sha (409/422) — comum quando há commits em sequência.
async function gravarArquivo(caminho, conteudo, mensagem) {
  const c = cfg();
  const conteudoB64 = Buffer.from(conteudo).toString('base64');
  for (let tentativa = 0; tentativa < 4; tentativa++) {
    let sha;
    const atual = await chamar(`${encodeURI(caminho)}?ref=${encodeURIComponent(c.branch)}`);
    if (atual.ok) {
      const info = await atual.json();
      if (!Array.isArray(info)) sha = info.sha;
    } else if (atual.status !== 404) {
      throw new Error(`GitHub sha ${caminho}: ${atual.status}`);
    }

    const res = await chamar(encodeURI(caminho), {
      method: 'PUT',
      body: JSON.stringify({
        message: mensagem,
        content: conteudoB64,
        branch: c.branch,
        ...(sha ? { sha } : {})
      })
    });
    if (res.ok) return res.json();
    // 409/422 = a branch avançou entre a leitura do sha e o PUT: relê e tenta de novo.
    if ((res.status === 409 || res.status === 422) && tentativa < 3) continue;
    const txt = await res.text().catch(() => '');
    throw new Error(`GitHub PUT ${caminho}: ${res.status} ${txt.slice(0, 200)}`);
  }
}

// Remove um arquivo do repo.
async function excluirArquivo(caminho, sha, mensagem) {
  const c = cfg();
  let shaAtual = sha;
  if (!shaAtual) {
    const atual = await chamar(`${encodeURI(caminho)}?ref=${encodeURIComponent(c.branch)}`);
    if (atual.status === 404) return; // já não existe
    if (!atual.ok) throw new Error(`GitHub sha ${caminho}: ${atual.status}`);
    shaAtual = (await atual.json()).sha;
  }
  const res = await chamar(encodeURI(caminho), {
    method: 'DELETE',
    body: JSON.stringify({ message: mensagem, sha: shaAtual, branch: c.branch })
  });
  if (!res.ok && res.status !== 404) {
    const txt = await res.text().catch(() => '');
    throw new Error(`GitHub DELETE ${caminho}: ${res.status} ${txt.slice(0, 200)}`);
  }
}

module.exports = {
  temGitHub,
  lerArquivo,
  lerArquivoBinario,
  listarPasta,
  gravarArquivo,
  excluirArquivo
};
