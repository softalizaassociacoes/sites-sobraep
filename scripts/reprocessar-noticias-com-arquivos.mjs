/**
 * Re-processa notícias específicas (por slug) a partir do WordPress
 * original (sobraep.org.br, de volta ao ar): baixa o corpo, as imagens
 * e os ARQUIVOS linkados (PDFs), reaponta imagens e arquivos para
 * caminhos locais, e atualiza essas notícias no data/noticias.json.
 *
 * Recupera os links de arquivo que tinham sido removidos anteriormente.
 *
 * Uso: node scripts/reprocessar-noticias-com-arquivos.mjs
 */
import fs from 'fs';
import path from 'path';

const repo = process.cwd();
const OLD_SITE = 'https://sobraep.org.br';
const OUT_JSON = path.join(repo, 'data', 'noticias.json');
const IMAGES_DIR = path.join(repo, 'public', 'images', 'noticias');
const ARQ_DIR = path.join(repo, 'public', 'docs', 'arquivos');
const UA = 'Mozilla/5.0 (compatible; SobraepReprocess/1.0)';
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

const faltando = JSON.parse(fs.readFileSync('/tmp/faltando.json', 'utf8'));
const slugsAfetados = [...new Set(faltando.map((f) => f.slug))];

async function fetchHtml(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status} em ${url}`);
  return res.text();
}
function extractBalancedDiv(html, fromIndex) {
  const openTagRe = /<div[^>]*>/g;
  openTagRe.lastIndex = fromIndex;
  const first = openTagRe.exec(html);
  if (!first) return '';
  let depth = 1;
  const tagRe = /<div[^>]*>|<\/div>/g;
  tagRe.lastIndex = openTagRe.lastIndex;
  let m;
  while ((m = tagRe.exec(html))) {
    if (m[0].startsWith('</')) depth -= 1; else depth += 1;
    if (depth === 0) return html.slice(openTagRe.lastIndex, m.index);
  }
  return html.slice(openTagRe.lastIndex);
}
function getWidgetsContent(html, widgetType) {
  const results = [];
  const re = new RegExp(`data-widget_type="${widgetType}[^"]*"`, 'g');
  let m;
  while ((m = re.exec(html))) {
    const containerIdx = html.indexOf('elementor-widget-container', m.index);
    if (containerIdx === -1) continue;
    const divStart = html.lastIndexOf('<div', containerIdx);
    results.push(extractBalancedDiv(html, divStart));
  }
  return results;
}
function cleanBodyHtml(html) {
  let out = html.replace(/<!--[\s\S]*?-->/g, '');
  let prev;
  do {
    prev = out;
    out = out.replace(/<ul[^>]*>\s*<\/ul>/g, '');
    out = out.replace(/<li style="list-style-type: none;">\s*(<ul[\s\S]*?<\/ul>)\s*<\/li>/g, '$1');
    out = out.replace(/<li style="list-style-type: none;">\s*<\/li>/g, '');
    out = out.replace(/<ul class="wp-block-list">\s*<ul class="wp-block-list">/g, '<ul class="wp-block-list">');
    out = out.replace(/<\/ul>\s*<\/ul>/g, '</ul>');
  } while (out !== prev);
  out = out.replace(/<p>\s*<\/p>/g, '');
  out = out.replace(/\n{3,}/g, '\n\n');
  return out.trim();
}
function decodeEntities(str) {
  return str
    .replace(/&#8211;/g, '–').replace(/&#8212;/g, '—').replace(/&#8216;/g, '‘').replace(/&#8217;/g, '’')
    .replace(/&#8220;/g, '“').replace(/&#8221;/g, '”').replace(/&#038;/g, '&').replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, c) => String.fromCharCode(parseInt(c, 10))).replace(/&amp;/g, '&');
}
function stripTags(html) { return decodeEntities(html.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim(); }
function formatDate(iso) { const d = new Date(iso); return `${d.getUTCDate()} de ${MESES[d.getUTCMonth()]} de ${d.getUTCFullYear()}`; }

function nomeArquivoLocal(url) {
  let base = decodeURIComponent(url.split('/').pop().split('?')[0]);
  base = base.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9._-]/g, '_').replace(/_+/g, '_');
  return base;
}
async function baixarBinario(url, dest) {
  if (fs.existsSync(dest)) return true;
  const res = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'follow' });
  if (!res.ok) return false;
  const buf = Buffer.from(await res.arrayBuffer());
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, buf);
  return true;
}

async function scrapePost(slug) {
  const html = await fetchHtml(`${OLD_SITE}/${slug}/`);
  const titleMatch = html.match(/<h1 class="entry-title">([\s\S]*?)<\/h1>/);
  const titulo = titleMatch ? stripTags(titleMatch[1]) : slug;
  const dateMatch = html.match(/property="article:published_time" content="([^"]+)"/);
  const dataISO = dateMatch ? dateMatch[1] : null;

  const pageContentAttrIdx = html.indexOf('class="page-content"');
  const pageContentDivStart = pageContentAttrIdx !== -1 ? html.lastIndexOf('<div', pageContentAttrIdx) : -1;
  const pageContent = pageContentDivStart !== -1 ? extractBalancedDiv(html, pageContentDivStart) : html;

  const featuredWidgets = getWidgetsContent(pageContent, 'theme-post-featured-image.default');
  let imagemUrl = null;
  if (featuredWidgets.length) {
    const imgMatch = featuredWidgets[0].match(/<img[^>]*src="([^"]+)"/);
    if (imgMatch) imagemUrl = imgMatch[1];
  }
  let textWidgets = getWidgetsContent(pageContent, 'text-editor.default');
  if (!pageContent.includes('elementor-widget-container')) textWidgets = [pageContent];
  let corpoHtml = cleanBodyHtml(textWidgets.join('\n'));

  // imagens
  const destDir = path.join(IMAGES_DIR, slug);
  const localImages = {};
  if (imagemUrl) {
    const fn = nomeArquivoLocal(imagemUrl).replace(/_/g, '_'); // manter simples
    const realFn = decodeURIComponent(imagemUrl.split('/').pop().split('?')[0]);
    if (await baixarBinario(imagemUrl, path.join(destDir, realFn))) localImages[imagemUrl] = `/images/noticias/${slug}/${realFn}`;
  }
  const bodyImgRe = /<img[^>]*src="(https:\/\/sobraep\.org\.br\/wp-content\/uploads\/[^"]+)"/g;
  let im;
  const imgs = new Set();
  while ((im = bodyImgRe.exec(corpoHtml))) imgs.add(im[1]);
  for (const u of imgs) {
    if (localImages[u]) continue;
    const realFn = decodeURIComponent(u.split('/').pop().split('?')[0]);
    if (await baixarBinario(u, path.join(destDir, realFn))) localImages[u] = `/images/noticias/${slug}/${realFn}`;
  }

  // ARQUIVOS (pdf etc.) — baixa e reaponta para /docs/arquivos/
  const fileRe = /https?:\/\/(?:www\.)?sobraep\.org\.br\/(?:wp-content|site)\/uploads\/[^\s"'<>)]+\.(?:pdf|docx?|xlsx?|pptx?|zip)/gi;
  const arqs = new Set(corpoHtml.match(fileRe) || []);
  const localArqs = {};
  for (const u of arqs) {
    const base = nomeArquivoLocal(u);
    if (await baixarBinario(u, path.join(ARQ_DIR, base))) localArqs[u] = `/docs/arquivos/${base}`;
  }

  for (const [remote, local] of Object.entries({ ...localImages, ...localArqs })) {
    corpoHtml = corpoHtml.split(remote).join(local);
  }
  corpoHtml = corpoHtml.replace(/\s+srcset="[^"]*"/g, '').replace(/\s+sizes="[^"]*"/g, '');

  const resumo = stripTags(textWidgets.join(' ')).slice(0, 160).trim() + '…';
  return {
    slug, titulo, dataISO,
    dataFormatada: dataISO ? formatDate(dataISO) : '',
    imagem: imagemUrl ? localImages[imagemUrl] : null,
    resumo, corpoHtml,
    _arquivos: Object.keys(localArqs).length
  };
}

const data = JSON.parse(fs.readFileSync(OUT_JSON, 'utf8'));
const bySlug = new Map(data.map((n, i) => [n.slug, i]));

for (const slug of slugsAfetados) {
  try {
    const novo = await scrapePost(slug);
    const idx = bySlug.get(slug);
    if (idx === undefined) { console.log(`[SKIP] slug não está no JSON: ${slug}`); continue; }
    // preserva imagem existente se o reprocessamento não achou featured
    const antigo = data[idx];
    data[idx] = { ...antigo, titulo: novo.titulo, dataISO: novo.dataISO || antigo.dataISO, dataFormatada: novo.dataFormatada || antigo.dataFormatada, resumo: novo.resumo || antigo.resumo, corpoHtml: novo.corpoHtml, imagem: novo.imagem || antigo.imagem };
    console.log(`[OK] ${slug} — ${novo._arquivos} arquivo(s) recuperado(s)`);
  } catch (err) {
    console.log(`[FALHA] ${slug} — ${err.message}`);
  }
}
fs.writeFileSync(OUT_JSON, JSON.stringify(data, null, 2), 'utf8');
console.log(`\nNotícias reprocessadas: ${slugsAfetados.length}`);
