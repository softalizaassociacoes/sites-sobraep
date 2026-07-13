/**
 * Script único (não roda no runtime do site) para migrar as notícias do
 * WordPress antigo (sobraep.org.br) para data/noticias.json, baixando as
 * imagens usadas para public/images/noticias/<slug>/.
 *
 * Uso: node scripts/scrape-noticias.js
 */
const fs = require('fs');
const path = require('path');

const OLD_SITE = 'https://sobraep.org.br';
const OUT_JSON = path.join(__dirname, '..', 'data', 'noticias.json');
const IMAGES_DIR = path.join(__dirname, '..', 'public', 'images', 'noticias');
const UA = 'Mozilla/5.0 (compatible; SobraepMigration/1.0)';

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

async function fetchHtml(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`HTTP ${res.status} em ${url}`);
  return res.text();
}

function extractBalancedDiv(html, fromIndex) {
  const openTagRe = /<div[^>]*>/g;
  openTagRe.lastIndex = fromIndex;
  const firstMatch = openTagRe.exec(html);
  if (!firstMatch) return '';
  let depth = 1;
  const tagRe = /<div[^>]*>|<\/div>/g;
  tagRe.lastIndex = openTagRe.lastIndex;
  let m;
  while ((m = tagRe.exec(html))) {
    if (m[0].startsWith('</')) depth -= 1;
    else depth += 1;
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
    .replace(/&#8211;/g, '–')
    .replace(/&#8212;/g, '—')
    .replace(/&#8216;/g, '‘')
    .replace(/&#8217;/g, '’')
    .replace(/&#8220;/g, '“')
    .replace(/&#8221;/g, '”')
    .replace(/&#038;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)))
    .replace(/&amp;/g, '&');
}

function stripTags(html) {
  return decodeEntities(html.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function formatDate(iso) {
  const d = new Date(iso);
  return `${d.getUTCDate()} de ${MESES[d.getUTCMonth()]} de ${d.getUTCFullYear()}`;
}

async function getAllPostUrls() {
  const urls = new Set();
  for (let page = 1; page <= 8; page++) {
    const url = page === 1 ? `${OLD_SITE}/noticias/` : `${OLD_SITE}/noticias/page/${page}/`;
    const html = await fetchHtml(url);
    const re = /class="elementor-post__read-more" href="([^"]+)"/g;
    let m;
    while ((m = re.exec(html))) urls.add(m[1]);
  }
  return Array.from(urls);
}

async function downloadImage(url, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  const filename = decodeURIComponent(url.split('/').pop().split('?')[0]);
  const dest = path.join(destDir, filename);
  if (!fs.existsSync(dest)) {
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (!res.ok) throw new Error(`Falha ao baixar imagem ${url}: HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(dest, buf);
  }
  return filename;
}

async function scrapePost(url) {
  const html = await fetchHtml(url);

  const titleMatch = html.match(/<h1 class="entry-title">([\s\S]*?)<\/h1>/);
  const titulo = titleMatch ? stripTags(titleMatch[1]) : url;

  const dateMatch = html.match(/property="article:published_time" content="([^"]+)"/);
  const dataISO = dateMatch ? dateMatch[1] : null;

  const slug = url.replace(/\/$/, '').split('/').pop();

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
  if (!pageContent.includes('elementor-widget-container')) {
    // Posts do editor clássico do WP: o page-content já é o HTML puro do post,
    // sem widgets do Elementor.
    textWidgets = [pageContent];
  }
  let corpoHtml = cleanBodyHtml(textWidgets.join('\n'));

  const destDir = path.join(IMAGES_DIR, slug);
  const localImages = {};

  if (imagemUrl) {
    const filename = await downloadImage(imagemUrl, destDir);
    localImages[imagemUrl] = `/images/noticias/${slug}/${filename}`;
  }

  const bodyImgRe = /<img[^>]*src="(https:\/\/sobraep\.org\.br\/wp-content\/uploads\/[^"]+)"/g;
  let im;
  const bodyImgUrls = new Set();
  while ((im = bodyImgRe.exec(corpoHtml))) bodyImgUrls.add(im[1]);
  for (const imgUrl of bodyImgUrls) {
    if (localImages[imgUrl]) continue;
    const filename = await downloadImage(imgUrl, destDir);
    localImages[imgUrl] = `/images/noticias/${slug}/${filename}`;
  }
  for (const [remote, local] of Object.entries(localImages)) {
    corpoHtml = corpoHtml.split(remote).join(local);
  }
  // remove srcset (aponta pra tamanhos remotos que não baixamos)
  corpoHtml = corpoHtml.replace(/\s+srcset="[^"]*"/g, '').replace(/\s+sizes="[^"]*"/g, '');

  const resumo = stripTags(textWidgets.join(' ')).slice(0, 160).trim() + '…';

  return {
    slug,
    titulo,
    dataISO,
    dataFormatada: dataISO ? formatDate(dataISO) : '',
    imagem: imagemUrl ? localImages[imagemUrl] : null,
    resumo,
    corpoHtml
  };
}

async function main() {
  console.log('Buscando lista de posts...');
  const urls = await getAllPostUrls();
  console.log(`${urls.length} posts encontrados.`);

  const noticias = [];
  const CONCURRENCY = 5;
  let idx = 0;

  async function worker() {
    while (idx < urls.length) {
      const current = idx++;
      const url = urls[current];
      try {
        const noticia = await scrapePost(url);
        noticias[current] = noticia;
        console.log(`[${current + 1}/${urls.length}] OK — ${noticia.titulo}`);
      } catch (err) {
        console.error(`[${current + 1}/${urls.length}] ERRO em ${url}:`, err.message);
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  const result = noticias.filter(Boolean).sort((a, b) => (a.dataISO < b.dataISO ? 1 : -1));
  fs.mkdirSync(path.dirname(OUT_JSON), { recursive: true });
  fs.writeFileSync(OUT_JSON, JSON.stringify(result, null, 2), 'utf8');
  console.log(`\nSalvo ${result.length} notícias em ${OUT_JSON}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
