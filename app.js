const express = require('express');
const path = require('path');
const fs = require('fs');
const sgMail = require('@sendgrid/mail');

const app = express();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: false }));
app.get('/favicon.ico', (req, res) => res.sendFile(path.join(__dirname, 'public/images/favicon-64.png')));

const site = {
  nome: 'SOBRAEP',
  nomeCompleto: 'Associação Brasileira de Eletrônica de Potência',
  fundacao: '31 de agosto de 1990',
  sede: 'Florianópolis (SC)',
  email: 'presidente@sobraep.org.br',
  emailSecundario: 'heverton.pereira@ufv.br',
  emailSecretaria: 'secretaria1@sobraep.com.br',
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
    return data.success === true;
  } catch (err) {
    console.error('Erro ao validar reCAPTCHA:', err.message);
    return false;
  }
}

const noticiasPath = path.join(__dirname, 'data', 'noticias.json');
function getNoticias() {
  if (!fs.existsSync(noticiasPath)) return [];
  return JSON.parse(fs.readFileSync(noticiasPath, 'utf8'));
}

const POSTS_PER_PAGE = 10;

function render(view, extra = {}) {
  return (req, res) => res.render(view, { site, active: extra.active || view, ...extra });
}

app.get('/', (req, res) => {
  const noticias = getNoticias().slice(0, 3);
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
app.get('/webinars', render('webinars', { active: 'webinars' }));
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

app.get('/noticias', (req, res) => {
  const all = getNoticias();
  const totalPages = Math.max(1, Math.ceil(all.length / POSTS_PER_PAGE));
  const page = Math.min(Math.max(parseInt(req.query.page, 10) || 1, 1), totalPages);
  const start = (page - 1) * POSTS_PER_PAGE;
  const noticias = all.slice(start, start + POSTS_PER_PAGE);
  res.render('noticias', { site, active: 'noticias', noticias, page, totalPages });
});

app.get('/noticias/:slug', (req, res) => {
  const all = getNoticias();
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
