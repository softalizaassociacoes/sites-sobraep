const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.get('/favicon.ico', (req, res) => res.sendFile(path.join(__dirname, 'public/images/logo.png')));

const site = {
  nome: 'SOBRAEP',
  nomeCompleto: 'Associação Brasileira de Eletrônica de Potência',
  fundacao: '31 de agosto de 1990',
  sede: 'Florianópolis (SC)',
  email: 'presidente@sobraep.org.br',
  emailSecretaria: 'secretaria1@sobraep.com.br',
  telefone: '(31) 3612-6401',
  endereco: 'Universidade Federal de Viçosa, Departamento de Engenharia Elétrica, Viçosa-MG, CEP 36570-900',
  facebook: 'https://www.facebook.com/sobraep/',
  linkedin: 'https://www.linkedin.com/groups/40133/',
  youtube: 'https://www.youtube.com/channel/UCK9b6kbTrcT-UvtjJ6pSESw'
};

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
app.get('/socios-fundadores', render('socios-fundadores', { active: 'socios-fundadores' }));
app.get('/ex-presidentes', render('ex-presidentes', { active: 'ex-presidentes' }));
app.get('/ex-editores-chefes', render('ex-editores-chefes', { active: 'ex-editores-chefes' }));
app.get('/cobep', render('cobep', { active: 'cobep' }));
app.get('/webinars', render('webinars', { active: 'webinars' }));
app.get('/contato', render('contato', { active: 'contato' }));

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
