const express = require('express');
const path = require('path');
const fs = require('fs');
const sgMail = require('@sendgrid/mail');
const dados = require('./lib/dados');
const github = require('./lib/github');
const adminRouter = require('./routes/admin');

const app = express();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: false, limit: '2mb' }));
app.get('/favicon.ico', (req, res) => res.sendFile(path.join(__dirname, 'public/images/favicon-64.png')));

// Serve arquivos enviados pelo painel IMEDIATAMENTE, lendo do GitHub, quando
// ainda não estão no bundle do deploy (evita o "buraco" de ~1 min até o
// redeploy). Só é alcançado se o express.static acima não encontrou o arquivo.
const TIPOS_MIME = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
  gif: 'image/gif', svg: 'image/svg+xml', pdf: 'application/pdf'
};
async function servirDoGitHub(req, res, next) {
  if (!github.temGitHub()) return next();
  const nome = path.basename(req.params.nome || '');
  if (!nome || nome.includes('..')) return next();
  const ext = nome.split('.').pop().toLowerCase();
  const rel = `public${req.path}`; // ex.: public/images/uploads/x.png
  try {
    const buf = await github.lerArquivoBinario(rel);
    if (!buf) return next();
    res.set('Content-Type', TIPOS_MIME[ext] || 'application/octet-stream');
    res.set('Cache-Control', 'public, max-age=31536000, immutable');
    return res.send(buf);
  } catch (err) {
    console.error('Erro servindo do GitHub:', req.path, err.message);
    return next();
  }
}
app.get('/images/uploads/:nome', servirDoGitHub);
app.get('/docs/arquivos/:nome', servirDoGitHub);

const site = {
  nome: 'SOBRAEP',
  nomeCompleto: 'Associação Brasileira de Eletrônica de Potência',
  fundacao: '31 de agosto de 1990',
  sede: 'Florianópolis (SC)',
  email: 'presidente@sobraep.org.br',
  emailSecundario: 'heverton.pereira@ufv.br',
  emailSecretaria: 'secretaria1@sobraep.org.br',
  telefone: '(31) 3612-6401',
  endereco: 'Prof. Heverton Augusto Pereira, Universidade Federal de Viçosa – UFV. Gerência de Especialistas em Sistemas Elétricos de Potência – GESEP. Departamento de Engenharia Elétrica, Viçosa – MG – Brasil, CEP 36570-900',
  facebook: 'https://www.facebook.com/sobraep/',
  linkedin: 'https://www.linkedin.com/company/sobraep/',
  instagram: 'https://www.instagram.com/sobraep/',
  youtube: 'https://www.youtube.com/channel/UCK9b6kbTrcT-UvtjJ6pSESw',
  // Chave do site do reCAPTCHA v2 (pública por design). A chave secreta
  // fica em process.env.RECAPTCHA_SECRET e nunca é versionada.
  recaptchaSiteKey: process.env.RECAPTCHA_SITE_KEY || '6LfXt1wtAAAAAMFk7G8yZ5OkES0WVH1Bn59m8yyy'
};

async function verificarCaptcha(token, ip) {
  // Sem a chave secreta configurada, o captcha é ignorado para não
  // quebrar o formulário (ele passa a valer assim que RECAPTCHA_SECRET
  // for definida nas variáveis de ambiente).
  if (!process.env.RECAPTCHA_SECRET) {
    console.warn('RECAPTCHA_SECRET não configurada — validação de captcha ignorada.');
    return true;
  }
  if (!token) return false;
  try {
    const params = new URLSearchParams({
      secret: process.env.RECAPTCHA_SECRET,
      response: token
    });
    if (ip) params.append('remoteip', ip);
    const resp = await fetch('https://www.google.com/recaptcha/api/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params
    });
    const data = await resp.json();
    // reCAPTCHA v3: além de success, valida o score (0.0 bot → 1.0 humano).
    const minScore = parseFloat(process.env.RECAPTCHA_MIN_SCORE || '0.5');
    if (data.success !== true) return false;
    if (typeof data.score === 'number' && data.score < minScore) {
      console.warn(`reCAPTCHA reprovado por score baixo: ${data.score}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error('Erro ao validar reCAPTCHA:', err.message);
    return false;
  }
}

const getNoticias = () => dados.getNoticias();

const POSTS_PER_PAGE = 10;

function render(view, extra = {}) {
  return (req, res) => res.render(view, { site, active: extra.active || view, ...extra });
}

// Painel administrativo
app.use('/admin', adminRouter);

app.get('/', async (req, res) => {
  const noticias = (await getNoticias()).slice(0, 3);
  res.render('index', { site, active: 'home', noticias });
});

app.get('/sobre-nos', render('sobre-nos', { active: 'sobre-nos' }));
app.get('/estatuto', render('estatuto', { active: 'estatuto' }));
app.get('/diretoria', render('diretoria', { active: 'diretoria' }));
app.get('/palavra-do-presidente', render('palavra-do-presidente', { active: 'diretoria' }));
app.get('/socios-fundadores', render('socios-fundadores', { active: 'socios-fundadores' }));
app.get('/ex-presidentes', render('ex-presidentes', { active: 'ex-presidentes' }));
app.get('/ex-editores-chefes', render('ex-editores-chefes', { active: 'ex-editores-chefes' }));
app.get('/cobep', render('cobep', { active: 'cobep' }));
app.get('/premio-sobraep', render('premio-sobraep', { active: 'premio-sobraep' }));

/**
 * Mapa dos laboratórios e grupos de pesquisa associados.
 *
 * O SVG do Brasil entra inline na página para que o CSS do site pinte os
 * estados e os marcadores fiquem posicionados por cima, em porcentagem — assim
 * o mapa acompanha a largura da tela sem recalcular nada.
 *
 * Os dados vêm de data/laboratorios.json pela mesma camada das notícias, então
 * o que o painel grava aparece aqui sem depender de novo deploy.
 */
const mapaBrasil = fs.readFileSync(path.join(__dirname, 'public/images/brasil.svg'), 'utf8');

app.get('/laboratorios', async (req, res) => {
  const laboratorios = await dados.getLaboratorios();
  const instituicoes = new Set(laboratorios.map((l) => l.instituicao).filter(Boolean));
  const estados = new Set(laboratorios.map((l) => l.uf).filter(Boolean));
  res.render('laboratorios', {
    site,
    active: 'laboratorios',
    laboratorios,
    mapaSvg: mapaBrasil,
    totalInstituicoes: instituicoes.size,
    totalEstados: estados.size
  });
});
const UFS = ['AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT',
  'PA', 'PB', 'PE', 'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO'];

app.get('/laboratorios/cadastro', (req, res) => {
  res.render('laboratorio-cadastro', {
    site, active: 'laboratorios', ufs: UFS,
    enviado: req.query.enviado, erro: req.query.erro
  });
});

/**
 * Cadastro de novo grupo vindo do site.
 *
 * O envio não grava direto no mapa: chega por e-mail para a secretaria, que
 * confere e cadastra pelo painel. Gravar sem revisão exporia o arquivo de
 * dados a qualquer visitante.
 *
 * O e-mail sai com os campos na mesma ordem do formulário do painel, para o
 * cadastro ser só copiar e colar.
 */
app.post('/laboratorios/cadastro', async (req, res) => {
  const campo = (nome, max) => String(req.body[nome] || '').trim().slice(0, max);
  const dadosLab = {
    sigla: campo('sigla', 20),
    nome: campo('nome', 200),
    instituicao: campo('instituicao', 150),
    cidade: campo('cidade', 80),
    uf: campo('uf', 2).toUpperCase(),
    responsavel: campo('responsavel', 120),
    email: campo('email', 120),
    integrantes: campo('integrantes', 5),
    site: campo('site', 300),
    instagram: campo('instagram', 300),
    linkedin: campo('linkedin', 300)
  };

  if (!dadosLab.sigla || !dadosLab.instituicao || !dadosLab.cidade ||
      !dadosLab.email || !UFS.includes(dadosLab.uf)) {
    return res.redirect('/laboratorios/cadastro?erro=1');
  }

  const captchaOk = await verificarCaptcha(
    req.body['g-recaptcha-response'],
    req.headers['x-forwarded-for'] || req.socket?.remoteAddress
  );
  if (!captchaOk) return res.redirect('/laboratorios/cadastro?erro=captcha');

  // 1) entra na fila de aprovação do painel — é o que evita a redigitação
  const LIMITE_FILA = 60; // trava de segurança contra envio em massa
  let naFila = false;
  try {
    const fila = await dados.getPendentes();
    if (fila.length >= LIMITE_FILA) throw new Error('fila de cadastros cheia');
    fila.push({
      id: 'p-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      recebidoEm: new Date().toISOString(),
      ...dadosLab
    });
    await dados.savePendentes(fila);
    naFila = true;
  } catch (err) {
    // o aviso por e-mail abaixo ainda sai, então o cadastro não se perde
    console.error('Erro gravando cadastro pendente:', err.message);
  }

  const rotulos = {
    sigla: 'Sigla', nome: 'Nome completo', instituicao: 'Instituição',
    cidade: 'Cidade', uf: 'Estado', responsavel: 'Responsável',
    email: 'E-mail', integrantes: 'Nº de integrantes',
    site: 'Site', instagram: 'Instagram', linkedin: 'LinkedIn'
  };
  const corpo = Object.keys(rotulos)
    .map((k) => `${rotulos[k]}: ${dadosLab[k] || '—'}`)
    .join('\n');

  try {
    if (!process.env.SENDGRID_API_KEY || !process.env.SENDGRID_FROM) {
      throw new Error('SendGrid não configurado');
    }
    sgMail.setApiKey(process.env.SENDGRID_API_KEY);
    await sgMail.send({
      to: [site.emailSecretaria, 'marcos@softaliza.com.br'],
      from: { email: process.env.SENDGRID_FROM, name: 'Site SOBRAEP' },
      replyTo: dadosLab.email,
      subject: `[Mapa de laboratórios] Novo cadastro: ${dadosLab.sigla}`,
      text: `Um grupo se cadastrou pelo site para entrar no mapa de laboratórios.\n\n${corpo}\n\n` +
        `Para publicar: Painel > Laboratórios > Novo laboratório, com estes mesmos campos.\n` +
        `A logomarca vem por e-mail à parte, com a sigla no assunto.`
    });
    res.redirect('/laboratorios/cadastro?enviado=1');
  } catch (err) {
    console.error('Erro no aviso de cadastro:', err.response?.body || err.message);
    // o e-mail é só notificação: com o cadastro já na fila, quem enviou não
    // tem por que ver uma falha
    res.redirect(naFila ? '/laboratorios/cadastro?enviado=1' : '/laboratorios/cadastro?erro=1');
  }
});

app.get('/webinars', async (req, res) => {
  const webinars = await dados.getWebinars();
  res.render('webinars', { site, active: 'webinars', webinars });
});
app.get('/contato', (req, res) => {
  res.render('contato', { site, active: 'contato', enviado: req.query.enviado, erro: req.query.erro });
});

app.post('/contato', async (req, res) => {
  const { nome, email, telefone, assunto, mensagem } = req.body;
  if (!nome || !email || !assunto || !mensagem) {
    return res.redirect('/contato?erro=1');
  }
  const captchaOk = await verificarCaptcha(
    req.body['g-recaptcha-response'],
    req.headers['x-forwarded-for'] || req.socket?.remoteAddress
  );
  if (!captchaOk) {
    return res.redirect('/contato?erro=captcha');
  }
  try {
    if (!process.env.SENDGRID_API_KEY) throw new Error('SENDGRID_API_KEY não configurada');
    if (!process.env.SENDGRID_FROM) throw new Error('SENDGRID_FROM não configurada');
    sgMail.setApiKey(process.env.SENDGRID_API_KEY);
    await sgMail.send({
      to: [site.email, 'marcos@softaliza.com.br'],
      from: { email: process.env.SENDGRID_FROM, name: 'Site SOBRAEP' },
      replyTo: email,
      subject: `[Site SOBRAEP] ${assunto}`,
      text: `Nome: ${nome}\nE-mail: ${email}\nTelefone: ${telefone || 'não informado'}\n\nMensagem:\n${mensagem}`
    });
    res.redirect('/contato?enviado=1');
  } catch (err) {
    console.error('Erro ao enviar e-mail de contato:', err.response?.body || err.message);
    res.redirect('/contato?erro=1');
  }
});

app.get('/noticias', async (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 80);
  const todas = await getNoticias();
  const all = dados.filtrarNoticias(todas, q);
  const totalPages = Math.max(1, Math.ceil(all.length / POSTS_PER_PAGE));
  const page = Math.min(Math.max(parseInt(req.query.page, 10) || 1, 1), totalPages);
  const start = (page - 1) * POSTS_PER_PAGE;
  const noticias = all.slice(start, start + POSTS_PER_PAGE);
  res.render('noticias', {
    site, active: 'noticias', noticias, page, totalPages,
    q, totalEncontradas: all.length, totalGeral: todas.length
  });
});

app.get('/noticias/:slug', async (req, res) => {
  const all = await getNoticias();
  const noticia = all.find((n) => n.slug === req.params.slug);
  if (!noticia) {
    return res.status(404).render('404', { site, active: '' });
  }
  const relacionadas = all.filter((n) => n.slug !== noticia.slug).slice(0, 3);
  res.render('noticia', { site, active: 'noticias', noticia, relacionadas });
});

app.use((req, res) => {
  res.status(404).render('404', { site, active: '' });
});

module.exports = app;
