/**
 * Painel administrativo (/admin): CRUD de notícias e webinars.
 * Protegido por sessão (lib/auth). Dados e arquivos são gravados no próprio
 * repositório via GitHub Contents API (lib/dados + lib/github) — cada
 * gravação vira um commit que dispara o redeploy do site.
 * Upload passa pela function (limite ~4,5MB por request do Vercel).
 */
const express = require('express');
const auth = require('../lib/auth');
const dados = require('../lib/dados');
const github = require('../lib/github');

const router = express.Router();

router.use(express.json({ limit: '1mb' }));
router.use(auth.exigirLogin);

// Todas as páginas do admin: nunca indexar
router.use((req, res, next) => {
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  next();
});

function render(res, view, extra = {}) {
  res.render(`admin/${view}`, { erro: null, ok: null, copiaDe: null, ...extra });
}

// ---------- Login / logout ----------
router.get('/login', (req, res) => {
  if (auth.estaLogado(req)) return res.redirect('/admin/noticias');
  render(res, 'login', { erro: req.query.erro ? 'Usuário ou senha inválidos.' : null });
});

router.post('/login', async (req, res) => {
  const { usuario, senha } = req.body || {};
  if (auth.credenciaisOk(usuario, senha)) {
    auth.setSessao(res);
    return res.redirect('/admin/noticias');
  }
  await new Promise((r) => setTimeout(r, 500)); // atraso anti força bruta
  res.redirect('/admin/login?erro=1');
});

router.post('/logout', (req, res) => {
  auth.limparSessao(res);
  res.redirect('/admin/login');
});

router.get('/', (req, res) => res.redirect('/admin/noticias'));

// ---------- Upload (grava o arquivo no repositório via GitHub) ----------
// Recebe o arquivo como corpo binário; nome e tipo vêm na query string.
const TIPOS_OK = {
  imagem: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
  pdf: ['application/pdf']
};
router.post('/api/upload', express.raw({ type: '*/*', limit: '4mb' }), async (req, res) => {
  try {
    const tipo = req.query.tipo === 'pdf' ? 'pdf' : 'imagem';
    const nome = String(req.query.nome || 'arquivo');
    const contentType = req.headers['content-type'] || '';
    if (!TIPOS_OK[tipo].includes(contentType)) {
      return res.status(400).json({ error: `Tipo de arquivo não permitido (${contentType}).` });
    }
    if (!req.body || !req.body.length) {
      return res.status(400).json({ error: 'Arquivo vazio.' });
    }
    const url = await dados.subirArquivo(nome, req.body, tipo);
    res.json({ url, nome: url.split('/').pop(), tipo });
  } catch (err) {
    console.error('Erro no upload:', err.message);
    res.status(400).json({ error: err.message });
  }
});

// ---------- Biblioteca de arquivos ----------
const PASTAS_ARQUIVOS = {
  imagens: { dir: 'public/images/uploads', urlBase: '/images/uploads', rotulo: 'Imagens' },
  documentos: { dir: 'public/docs/arquivos', urlBase: '/docs/arquivos', rotulo: 'Documentos (PDF)' }
};

router.get('/arquivos', async (req, res) => {
  let grupos = [];
  let erro = null;
  try {
    for (const chave of Object.keys(PASTAS_ARQUIVOS)) {
      const p = PASTAS_ARQUIVOS[chave];
      const itens = (await github.listarPasta(p.dir))
        .map((f) => ({ nome: f.nome, url: `${p.urlBase}/${f.nome}`, tamanho: f.tamanho }))
        .sort((a, b) => a.nome.localeCompare(b.nome));
      grupos.push({ chave, rotulo: p.rotulo, itens });
    }
  } catch (err) {
    console.error('Erro listando arquivos:', err.message);
    erro = 'Não foi possível listar os arquivos agora. Tente recarregar.';
  }
  render(res, 'arquivos', { grupos, erro, ok: req.query.ok || null });
});

router.post('/arquivos/excluir', async (req, res) => {
  try {
    const caminho = String(req.body.caminho || '');
    // segurança: só permite excluir dentro das pastas de upload conhecidas
    const permitido = Object.values(PASTAS_ARQUIVOS).some((p) => caminho.startsWith(p.dir + '/'));
    if (!permitido || caminho.includes('..')) {
      return res.redirect('/admin/arquivos?ok=' + encodeURIComponent('Caminho inválido.'));
    }
    await github.excluirArquivo(caminho, null, `painel: remove ${caminho.split('/').pop()}`);
    res.redirect('/admin/arquivos?ok=' + encodeURIComponent('Arquivo removido.'));
  } catch (err) {
    console.error('Erro excluindo arquivo:', err.message);
    res.redirect('/admin/arquivos?ok=' + encodeURIComponent('Falha ao remover: ' + err.message));
  }
});

// ---------- Notícias ----------
router.get('/noticias', async (req, res) => {
  const todas = await dados.getNoticias();
  const q = String(req.query.q || '').trim().toLowerCase();
  const lista = q ? todas.filter((n) => n.titulo.toLowerCase().includes(q)) : todas;
  render(res, 'noticias', { lista, q, total: todas.length, ok: req.query.ok || null });
});

/**
 * Formulário de nova notícia. Com ?copiarDe=<slug>, vem pré-preenchido com o
 * conteúdo da notícia indicada — é a "Duplicar" da listagem.
 *
 * A cópia só existe no formulário: nada é gravado (nem publicado) até o
 * usuário clicar em Salvar. Assim a notícia de origem fica intacta e não vai
 * ao ar uma cópia pela metade enquanto os textos e links do ano são ajustados.
 */
router.get('/noticias/nova', async (req, res) => {
  const origem = String(req.query.copiarDe || '').trim();
  if (!origem) return render(res, 'noticia-form', { noticia: null });

  const base = (await dados.getNoticias()).find((n) => n.slug === origem);
  if (!base) return res.redirect('/admin/noticias');

  render(res, 'noticia-form', {
    copiaDe: base.titulo,
    noticia: {
      // sem slug: o formulário se comporta como "nova notícia" e, ao salvar,
      // ganha um slug próprio (gerarSlug evita colisão com o da origem)
      titulo: base.titulo,
      resumo: base.resumo,
      imagem: base.imagem,
      corpoHtml: base.corpoHtml,
      data: new Date().toISOString().slice(0, 10)
    }
  });
});

router.post('/noticias/nova', async (req, res) => {
  try {
    const todas = await dados.getNoticias();
    const noticia = montarNoticia(req.body, todas.map((n) => n.slug));
    todas.unshift(noticia);
    await dados.saveNoticias(todas);
    res.redirect('/admin/noticias?ok=Not%C3%ADcia%20publicada');
  } catch (err) {
    render(res, 'noticia-form', { noticia: req.body, erro: err.message });
  }
});

router.get('/noticias/:slug/editar', async (req, res) => {
  const todas = await dados.getNoticias();
  const noticia = todas.find((n) => n.slug === req.params.slug);
  if (!noticia) return res.redirect('/admin/noticias');
  render(res, 'noticia-form', { noticia });
});

router.post('/noticias/:slug/editar', async (req, res) => {
  const todas = await dados.getNoticias();
  const idx = todas.findIndex((n) => n.slug === req.params.slug);
  if (idx === -1) return res.redirect('/admin/noticias');
  try {
    const atualizada = montarNoticia(req.body, [], todas[idx].slug);
    todas[idx] = atualizada;
    await dados.saveNoticias(todas);
    res.redirect('/admin/noticias?ok=Not%C3%ADcia%20atualizada');
  } catch (err) {
    render(res, 'noticia-form', { noticia: { ...req.body, slug: req.params.slug }, erro: err.message });
  }
});

router.post('/noticias/:slug/excluir', async (req, res) => {
  const todas = await dados.getNoticias();
  const restantes = todas.filter((n) => n.slug !== req.params.slug);
  if (restantes.length !== todas.length) await dados.saveNoticias(restantes);
  res.redirect('/admin/noticias?ok=Not%C3%ADcia%20exclu%C3%ADda');
});

function montarNoticia(body, slugsExistentes, slugFixo = null) {
  const titulo = String(body.titulo || '').trim();
  const dataInput = String(body.data || '').trim(); // YYYY-MM-DD
  const corpoHtml = dados.sanitizarHtml(String(body.corpoHtml || '').trim());
  if (!titulo) throw new Error('Informe o título.');
  if (!dataInput) throw new Error('Informe a data.');
  if (!corpoHtml) throw new Error('O conteúdo da notícia está vazio.');
  const dataISO = `${dataInput}T12:00:00.000Z`;
  const resumo = String(body.resumo || '').trim() || dados.resumoDoHtml(corpoHtml);
  return {
    slug: slugFixo || dados.gerarSlug(titulo, slugsExistentes),
    titulo,
    dataISO,
    dataFormatada: dados.formatarData(dataISO),
    imagem: String(body.imagem || '').trim() || null,
    resumo,
    corpoHtml
  };
}

// ---------- Webinars ----------
router.get('/webinars', async (req, res) => {
  const lista = await dados.getWebinars();
  render(res, 'webinars', { lista, ok: req.query.ok || null });
});

router.get('/webinars/novo', (req, res) => {
  render(res, 'webinar-form', { webinar: null });
});

router.post('/webinars/novo', async (req, res) => {
  try {
    const lista = await dados.getWebinars();
    const w = montarWebinar(req.body);
    w.id = 'w-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    w.criadoEm = new Date().toISOString();
    lista.unshift(w); // novos no topo
    await dados.saveWebinars(lista);
    res.redirect('/admin/webinars?ok=Webinar%20cadastrado');
  } catch (err) {
    render(res, 'webinar-form', { webinar: req.body, erro: err.message });
  }
});

router.get('/webinars/:id/editar', async (req, res) => {
  const lista = await dados.getWebinars();
  const webinar = lista.find((w) => w.id === req.params.id);
  if (!webinar) return res.redirect('/admin/webinars');
  render(res, 'webinar-form', { webinar });
});

router.post('/webinars/:id/editar', async (req, res) => {
  const lista = await dados.getWebinars();
  const idx = lista.findIndex((w) => w.id === req.params.id);
  if (idx === -1) return res.redirect('/admin/webinars');
  try {
    const w = montarWebinar(req.body);
    lista[idx] = { ...lista[idx], ...w };
    await dados.saveWebinars(lista);
    res.redirect('/admin/webinars?ok=Webinar%20atualizado');
  } catch (err) {
    render(res, 'webinar-form', { webinar: { ...req.body, id: req.params.id }, erro: err.message });
  }
});

router.post('/webinars/:id/excluir', async (req, res) => {
  const lista = await dados.getWebinars();
  const restantes = lista.filter((w) => w.id !== req.params.id);
  if (restantes.length !== lista.length) await dados.saveWebinars(restantes);
  res.redirect('/admin/webinars?ok=Webinar%20exclu%C3%ADdo');
});

router.post('/webinars/:id/mover', async (req, res) => {
  const lista = await dados.getWebinars();
  const idx = lista.findIndex((w) => w.id === req.params.id);
  const dir = req.body.dir === 'up' ? -1 : 1;
  const alvo = idx + dir;
  if (idx !== -1 && alvo >= 0 && alvo < lista.length) {
    [lista[idx], lista[alvo]] = [lista[alvo], lista[idx]];
    await dados.saveWebinars(lista);
  }
  res.redirect('/admin/webinars');
});

function montarWebinar(body) {
  const imagem = String(body.imagem || '').trim();
  const linkInscricao = String(body.linkInscricao || '').trim() || null;
  const slides = String(body.slides || '').trim() || null;
  if (!imagem) throw new Error('Envie a imagem de divulgação.');
  if (!linkInscricao && !slides) {
    throw new Error('Informe o link de inscrição (webinar futuro) ou os slides (webinar realizado).');
  }
  return { imagem, linkInscricao, slides };
}

module.exports = router;
