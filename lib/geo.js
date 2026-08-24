/**
 * Posição de um laboratório no mapa a partir da cidade e do estado.
 *
 * Duas coisas são resolvidas aqui:
 *
 * 1. A coordenada da cidade, pela base de municípios do IBGE (municipios.json,
 *    gerado fora da aplicação, com a posição já em % do mapa).
 *
 * 2. A garantia de que o ponto caia dentro do desenho do estado. O contorno do
 *    SVG é simplificado, então cidades coladas na divisa — Juiz de Fora, na
 *    fronteira MG/RJ — têm a coordenada certa e ainda assim caem fora do
 *    traçado do próprio estado. Quando isso acontece, o ponto é puxado para
 *    dentro pelo caminho mais curto.
 *
 * Os contornos do mapa são poligonais (só comandos "m" e "z", sem curvas), o
 * que permite testar ponto-em-polígono direto, sem rasterizar nada.
 */
const fs = require('fs');
const path = require('path');
const municipios = require('./municipios.json');

const SVG = fs.readFileSync(path.join(__dirname, '..', 'public/images/brasil.svg'), 'utf8');
const [LON_O, LAT_N, LON_L, LAT_S] = SVG
  .match(/mapsvg:geoViewBox="([-\d.\s]+)"/)[1].trim().split(/\s+/).map(Number);
const LARGURA = 612.51611;
const ALTURA = 639.04297;

/** Lê os polígonos de cada estado a partir dos paths do mapa. */
function lerContornos() {
  const porUf = {};
  const re = /<path\b[^>]*?\sd="([^"]+)"[^>]*?\sid="BR-([A-Z]{2})"/g;
  // no arquivo o id vem depois do d; a busca abaixo cobre as duas ordens
  const blocos = SVG.split('<path').slice(1);
  for (const bloco of blocos) {
    const mId = bloco.match(/id="BR-([A-Z]{2})"/);
    const mD = bloco.match(/\sd="([^"]+)"/);
    if (!mId || !mD) continue;
    porUf[mId[1]] = polígonosDoPath(mD[1]);
  }
  return porUf;
}

/** "m x,y dx,dy ... z m ..." -> lista de anéis, cada um com pontos absolutos. */
function polígonosDoPath(d) {
  const aneis = [];
  let atual = null;
  let x = 0;
  let y = 0;
  // separa em tokens de comando e pares de coordenadas
  const tokens = d.trim().match(/[a-zA-Z]|-?[\d.]+(?:e-?\d+)?/g) || [];
  let i = 0;
  let comando = null;
  let primeiro = true;
  while (i < tokens.length) {
    const t = tokens[i];
    if (/[a-zA-Z]/.test(t)) {
      comando = t;
      i++;
      if (comando === 'z' || comando === 'Z') {
        if (atual && atual.length > 2) aneis.push(atual);
        atual = null;
      } else if (comando === 'm' || comando === 'M') {
        primeiro = true;
      }
      continue;
    }
    const a = parseFloat(tokens[i]);
    const b = parseFloat(tokens[i + 1]);
    i += 2;
    const relativo = comando === comando.toLowerCase();
    if (primeiro && (comando === 'm' || comando === 'M')) {
      x = relativo ? x + a : a;
      y = relativo ? y + b : b;
      atual = [[x, y]];
      primeiro = false;
      // depois do primeiro par, "m" continua como "l"
      comando = relativo ? 'l' : 'L';
    } else {
      x = relativo ? x + a : a;
      y = relativo ? y + b : b;
      if (atual) atual.push([x, y]);
    }
  }
  if (atual && atual.length > 2) aneis.push(atual);
  return aneis;
}

const CONTORNOS = lerContornos();

/** Ray casting: o ponto está dentro de algum anel do estado? */
function dentroDoEstado(uf, left, top) {
  const aneis = CONTORNOS[String(uf || '').toUpperCase()];
  if (!aneis || !aneis.length) return true; // sem contorno conhecido, não bloqueia
  const px = (left / 100) * LARGURA;
  const py = (top / 100) * ALTURA;
  let dentro = false;
  for (const anel of aneis) {
    for (let i = 0, j = anel.length - 1; i < anel.length; j = i++) {
      const [xi, yi] = anel[i];
      const [xj, yj] = anel[j];
      if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) {
        dentro = !dentro;
      }
    }
  }
  return dentro;
}

/** Ponto do contorno do estado mais próximo de (left, top), em % do mapa. */
function maisPertoDentro(uf, left, top) {
  const aneis = CONTORNOS[String(uf || '').toUpperCase()];
  if (!aneis || !aneis.length) return { left, top };
  const px = (left / 100) * LARGURA;
  const py = (top / 100) * ALTURA;

  let melhor = null;
  for (const anel of aneis) {
    for (let i = 0, j = anel.length - 1; i < anel.length; j = i++) {
      const [xi, yi] = anel[i];
      const [xj, yj] = anel[j];
      // projeta o ponto sobre o segmento
      const dx = xj - xi;
      const dy = yj - yi;
      const comp = dx * dx + dy * dy;
      let t = comp ? ((px - xi) * dx + (py - yi) * dy) / comp : 0;
      t = Math.max(0, Math.min(1, t));
      const qx = xi + t * dx;
      const qy = yi + t * dy;
      const dist = Math.hypot(px - qx, py - qy);
      if (!melhor || dist < melhor.dist) melhor = { dist, qx, qy };
    }
  }
  if (!melhor) return { left, top };

  // entra alguns pixels para dentro, para não ficar em cima da linha da divisa
  const ux = (melhor.qx - px) / (melhor.dist || 1);
  const uy = (melhor.qy - py) / (melhor.dist || 1);
  for (const passo of [4, 6, 9, 13, 18, 24]) {
    const nx = melhor.qx + ux * passo;
    const ny = melhor.qy + uy * passo;
    const nl = (nx / LARGURA) * 100;
    const nt = (ny / ALTURA) * 100;
    if (dentroDoEstado(uf, nl, nt)) {
      return { left: Math.round(nl * 100) / 100, top: Math.round(nt * 100) / 100 };
    }
  }
  return {
    left: Math.round((melhor.qx / LARGURA) * 10000) / 100,
    top: Math.round((melhor.qy / ALTURA) * 10000) / 100
  };
}

function normalizar(nome) {
  return String(nome || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Devolve { left, top, ajustado } em % do mapa, ou null se a cidade não
 * existir naquele estado. `ajustado` indica que o ponto precisou ser puxado
 * para dentro do desenho do estado.
 */
function posicaoDaCidade(cidade, uf) {
  const estadoSigla = String(uf || '').toUpperCase();
  const estado = municipios[estadoSigla];
  if (!estado) return null;
  const chave = normalizar(cidade);
  if (!chave) return null;

  let coord = estado[chave];
  if (!coord) {
    // "São Paulo - Campus X" e afins: tenta pelo começo do texto
    const parcial = Object.keys(estado).find((n) => chave === n || chave.startsWith(n + ' '));
    if (parcial) coord = estado[parcial];
  }
  if (!coord) return null;

  const [left, top] = coord;
  if (dentroDoEstado(estadoSigla, left, top)) return { left, top, ajustado: false };

  const dentro = maisPertoDentro(estadoSigla, left, top);
  return { left: dentro.left, top: dentro.top, ajustado: true };
}

function sugerirCidades(termo, uf, limite = 8) {
  const estado = municipios[String(uf || '').toUpperCase()];
  if (!estado) return [];
  const chave = normalizar(termo);
  if (chave.length < 2) return [];
  return Object.keys(estado).filter((n) => n.startsWith(chave)).slice(0, limite);
}

const totalMunicipios = () =>
  Object.values(municipios).reduce((s, uf) => s + Object.keys(uf).length, 0);

module.exports = {
  posicaoDaCidade,
  sugerirCidades,
  dentroDoEstado,
  normalizar,
  totalMunicipios,
  estadosComContorno: () => Object.keys(CONTORNOS).length
};
