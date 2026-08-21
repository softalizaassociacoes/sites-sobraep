/**
 * Posição de um laboratório no mapa a partir da cidade.
 *
 * Antes a posição era marcada clicando no mapa, o que é impreciso: no zoom
 * normal do navegador, um pixel de erro vale alguns quilômetros, e vários
 * pontos acabavam caindo fora do estado ou no mar.
 *
 * A tabela vem da base de municípios do IBGE, com a posição já convertida
 * para % do mapa (lib/municipios.json, gerado fora da aplicação).
 */
const municipios = require('./municipios.json');

/** Minúsculas, sem acento e sem pontuação — a busca não depende da digitação. */
function normalizar(nome) {
  return String(nome || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Devolve { left, top } em % do mapa, ou null quando a cidade não é
 * encontrada naquele estado.
 */
function posicaoDaCidade(cidade, uf) {
  const estado = municipios[String(uf || '').toUpperCase()];
  if (!estado) return null;
  const chave = normalizar(cidade);
  if (!chave) return null;

  const exata = estado[chave];
  if (exata) return { left: exata[0], top: exata[1] };

  // "São Paulo - Campus X", "Viçosa (MG)": tenta o começo do texto
  const parcial = Object.keys(estado).find((n) => chave === n || chave.startsWith(n + ' '));
  if (parcial) return { left: estado[parcial][0], top: estado[parcial][1] };

  return null;
}

/** Nomes de cidade do estado que combinam com o trecho digitado. */
function sugerirCidades(termo, uf, limite = 8) {
  const estado = municipios[String(uf || '').toUpperCase()];
  if (!estado) return [];
  const chave = normalizar(termo);
  if (chave.length < 2) return [];
  return Object.keys(estado)
    .filter((n) => n.startsWith(chave))
    .slice(0, limite);
}

const totalMunicipios = () =>
  Object.values(municipios).reduce((s, uf) => s + Object.keys(uf).length, 0);

module.exports = { posicaoDaCidade, sugerirCidades, normalizar, totalMunicipios };
