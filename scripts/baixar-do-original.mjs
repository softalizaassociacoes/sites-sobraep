/**
 * Baixa TODOS os arquivos linkados direto do WordPress antigo
 * (sobraep.org.br, que voltou ao ar) e salva em public/docs/arquivos/.
 * Usa a mesma sanitização de nome do reapontamento, então os arquivos
 * batem com os links /docs/arquivos/ já presentes no site.
 *
 * Uso: node scripts/baixar-do-original.mjs
 */
import fs from 'fs';
import path from 'path';

const URLS = [
  'https://sobraep.org.br/wp-content/uploads/2026/07/PremioSOBRAEP_DissertacaoTese2026_assinado.pdf',
  'https://sobraep.org.br/wp-content/uploads/2025/10/RELATORIO_DE_ELEICAO_ASSEMBLEIA_DE_ASSOCIADOS_SOBRAEP_assinado.pdf',
  'https://sobraep.org.br/wp-content/uploads/2025/08/Edital_Premio_SOBRAEP_2025.pdf',
  'https://sobraep.org.br/wp-content/uploads/2025/09/Homologacao_das_incricoes_-_Concurso_Sobraep_2025.pdf',
  'https://sobraep.org.br/wp-content/uploads/2025/09/Ata_PremioSobraep2025_assinado_assinado_assinado_assinado.pdf',
  'https://sobraep.org.br/site/uploads/2023/03/Artigo_v05.pdf',
  'https://sobraep.org.br/site/uploads/2019/06/EDITAL-Nº-444-DE-17-DE-JUNHO-DE-2019-Sistemas-de-Conversão-Eletromecânica-de-Energia.pdf',
  'https://sobraep.org.br/wp-content/uploads/2026/06/Demystifying-Capacitive-Isolation-in-High-Efficiency-DC-DC-Converters.pdf',
  'https://sobraep.org.br/wp-content/uploads/2026/05/PELSSOBRAEPWebinarSLBIllaFont.pdf',
  'https://sobraep.org.br/wp-content/uploads/2026/03/PELS-WEBINAR-2026.pdf',
  'https://sobraep.org.br/wp-content/uploads/2025/11/PELSSOBRAEPWebinar-B2Bsynergeticoperation.pdf',
  'https://sobraep.org.br/wp-content/uploads/2025/09/Why-and-When-Power-Electronics-Calls-For-Artificial-Intelligence.pdf',
  'https://sobraep.org.br/wp-content/uploads/2025/09/The-Challenges-of-Renewable-Energy-Sources.pdf',
  'https://sobraep.org.br/wp-content/uploads/2026/02/PELSWEB091024S.pdf',
  'https://sobraep.org.br/wp-content/uploads/2026/02/PELSWEB072524S.pdf',
  'https://sobraep.org.br/wp-content/uploads/2026/02/PELSWEB060624S.pdf'
];

const DEST = path.join(process.cwd(), 'public', 'docs', 'arquivos');
fs.mkdirSync(DEST, { recursive: true });
const UA = 'Mozilla/5.0 (compatible; SobraepFetch/1.0)';

function nomeLocal(url) {
  let base = decodeURIComponent(url.split('/').pop().split('?')[0]);
  base = base.normalize('NFD').replace(/[̀-ͯ]/g, '');
  base = base.replace(/[^A-Za-z0-9._-]/g, '_').replace(/_+/g, '_');
  return base;
}

let ok = 0;
let falha = 0;
let totalBytes = 0;
for (const url of URLS) {
  const base = nomeLocal(url);
  const dest = path.join(DEST, base);
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'follow' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.slice(0, 5).toString('latin1') !== '%PDF-') throw new Error('não é PDF');
    fs.writeFileSync(dest, buf);
    totalBytes += buf.length;
    ok++;
    console.log(`[OK] ${base} (${(buf.length / 1024 / 1024).toFixed(1)} MB)`);
  } catch (err) {
    falha++;
    console.log(`[FALHA] ${base} — ${err.message}`);
  }
}
console.log(`\nRecuperados: ${ok}/${URLS.length} | Falhas: ${falha}`);
console.log(`Total baixado: ${(totalBytes / 1024 / 1024).toFixed(1)} MB`);
