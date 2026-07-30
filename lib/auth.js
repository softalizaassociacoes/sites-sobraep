/**
 * Autenticação do painel administrativo.
 *
 * Login com ADMIN_USER / ADMIN_PASSWORD (variáveis de ambiente) e cookie
 * de sessão assinado com HMAC-SHA256 usando SESSION_SECRET. O cookie
 * carrega apenas a expiração; a assinatura impede forjar sessão sem o
 * segredo. Sem estado no servidor (compatível com serverless).
 */
const crypto = require('crypto');

const COOKIE = 'sobraep_admin';
const MAX_AGE_S = 60 * 60 * 24 * 30; // 30 dias

function segredo() {
  return process.env.SESSION_SECRET || '';
}

function assinar(payload) {
  return crypto.createHmac('sha256', segredo()).update(payload).digest('hex');
}

function gerarToken() {
  const exp = String(Date.now() + MAX_AGE_S * 1000);
  return `${exp}.${assinar(exp)}`;
}

function tokenValido(token) {
  if (!token || !segredo()) return false;
  const [exp, sig] = String(token).split('.');
  if (!exp || !sig) return false;
  const esperado = assinar(exp);
  const a = Buffer.from(sig);
  const b = Buffer.from(esperado);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  return Number(exp) > Date.now();
}

function lerCookie(req) {
  const raw = req.headers.cookie || '';
  for (const parte of raw.split(/;\s*/)) {
    const i = parte.indexOf('=');
    if (i > 0 && parte.slice(0, i) === COOKIE) return decodeURIComponent(parte.slice(i + 1));
  }
  return null;
}

function estaLogado(req) {
  return tokenValido(lerCookie(req));
}

function credenciaisOk(usuario, senha) {
  const u = process.env.ADMIN_USER || '';
  const s = process.env.ADMIN_PASSWORD || '';
  if (!u || !s) return false;
  const igual = (x, y) => {
    const bx = Buffer.from(String(x));
    const by = Buffer.from(String(y));
    return bx.length === by.length && crypto.timingSafeEqual(bx, by);
  };
  return igual(usuario, u) && igual(senha, s);
}

function setSessao(res) {
  res.setHeader(
    'Set-Cookie',
    `${COOKIE}=${encodeURIComponent(gerarToken())}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${MAX_AGE_S}`
  );
}

function limparSessao(res) {
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`);
}

/** Middleware: exige sessão válida em tudo sob /admin, exceto /admin/login. */
function exigirLogin(req, res, next) {
  if (req.path === '/login') return next();
  if (estaLogado(req)) return next();
  return res.redirect('/admin/login');
}

module.exports = { estaLogado, credenciaisOk, setSessao, limparSessao, exigirLogin };
