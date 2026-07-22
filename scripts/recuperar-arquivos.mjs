/**
 * Recupera os arquivos (PDFs) que estavam linkados no site antigo e que
 * quebraram após a migração do domínio. Baixa cada arquivo do Wayback
 * Machine (web.archive.org) e salva localmente em public/docs/arquivos/.
 *
 * Estratégia robusta: consulta a CDX API para obter TODOS os snapshots
 * com status 200 e mimetype PDF, e tenta baixar cada um (do mais recente
 * ao mais antigo, com variações id_/if_/normal) até um funcionar.
 *
 * Gera /tmp/mapa-arquivos.json com o mapeamento url_antiga -> caminho_local
 * e a lista de pendentes (sem fonte pública, precisam ser enviados).
 *
 * Uso: node scripts/recuperar-arquivos.mjs
 */
import fs from 'fs';
import path from 'path';

const antigas = JSON.parse(fs.readFileSync('/tmp/arquivos-antigos.json', 'utf8'));
const DEST = path.join(process.cwd(), 'public', 'docs', 'arquivos');
fs.mkdirSync(DEST, { recursive: true });

const UA = 'Mozilla/5.0 (compatible; SobraepRecovery/1.0)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function nomeLocal(url) {
  let base = decodeURIComponent(url.split('/').pop().split('?')[0]);
  base = base.normalize('NFD').replace(/[̀-ͯ]/g, '');
  base = base.replace(/[^A-Za-z0-9._-]/g, '_').replace(/_+/g, '_');
  return base;
}

async function snapshotsCDX(url) {
  const api = `http://web.archive.org/cdx/search/cdx?url=${encodeURIComponent(url)}&output=json&fl=timestamp,statuscode,mimetype&filter=statuscode:200&collapse=digest`;
  try {
    const res = await fetch(api, { headers: { 'User-Agent': UA } });
    const rows = await res.json();
    if (!Array.isArray(rows) || rows.length < 2) return [];
    // rows[0] é o cabeçalho
    return rows
      .slice(1)
      .map((r) => ({ ts: r[0], status: r[1], mime: r[2] }))
      .filter((r) => /pdf/i.test(r.mime))
      .sort((a, b) => Number(b.ts) - Number(a.ts)); // mais recente primeiro
  } catch {
    return [];
  }
}

async function tentarBaixar(ts, url, destPath) {
  for (const suf of ['id_', 'if_', '']) {
    const wb = `https://web.archive.org/web/${ts}${suf}/${url}`;
    try {
      const res = await fetch(wb, { headers: { 'User-Agent': UA }, redirect: 'follow' });
      if (!res.ok) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.slice(0, 5).toString('latin1') === '%PDF-') {
        fs.writeFileSync(destPath, buf);
        return buf.length;
      }
    } catch {
      /* tenta próxima variação */
    }
  }
  return 0;
}

const mapa = {};
const pendentes = [];

for (const url of antigas) {
  const base = nomeLocal(url);
  const destPath = path.join(DEST, base);
  const localHref = `/docs/arquivos/${base}`;
  const snaps = await snapshotsCDX(url);
  let tam = 0;
  for (const s of snaps.slice(0, 6)) {
    tam = await tentarBaixar(s.ts, url, destPath);
    if (tam) break;
    await sleep(400);
  }
  if (tam) {
    mapa[url] = { status: 'ok', local: localHref, base, tamanho: tam };
    console.log(`[OK] ${base} (${(tam / 1024).toFixed(0)} KB)`);
  } else {
    pendentes.push(url);
    mapa[url] = { status: 'pendente', local: localHref, base };
    console.log(`[PENDENTE] ${base} — ${snaps.length ? snaps.length + ' snapshots, nenhum baixou' : 'sem snapshot no Wayback'}`);
  }
  await sleep(300);
}

fs.writeFileSync('/tmp/mapa-arquivos.json', JSON.stringify(mapa, null, 2));
console.log('\n===== RESUMO =====');
console.log('Recuperados:', Object.values(mapa).filter((m) => m.status === 'ok').length);
console.log('Pendentes (precisam ser enviados):', pendentes.length);
pendentes.forEach((u) => console.log('  -', u));
