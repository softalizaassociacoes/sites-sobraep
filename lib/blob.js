/**
 * Envio de arquivos grandes pelo Vercel Blob.
 *
 * O caminho normal (lib/dados.subirArquivo) manda o arquivo no corpo da
 * requisição para a function, e aí esbarra no teto de ~4,5MB que a Vercel
 * impõe por request (FUNCTION_PAYLOAD_TOO_LARGE) — não é configurável.
 *
 * Aqui a function não recebe o arquivo: ela só assina uma URL temporária, e o
 * navegador envia os bytes direto para o Blob. Sem passar pela function, o
 * teto deixa de existir.
 *
 * Sem BLOB_READ_WRITE_TOKEN no ambiente, temBlob() é falso e o painel
 * continua usando o caminho antigo (GitHub, limitado a 4MB).
 */
const { issueSignedToken, presignUrl } = require('@vercel/blob');

const LIMITE_BYTES = 100 * 1024 * 1024; // 100MB
const VALIDADE_MS = 30 * 60 * 1000;     // 30min: arquivo grande em rede lenta demora

const PASTAS = {
  pdf: 'docs/arquivos',
  imagem: 'images/uploads'
};

const TIPOS_OK = {
  imagem: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
  pdf: ['application/pdf']
};

const temBlob = () => Boolean(process.env.BLOB_READ_WRITE_TOKEN);

/** Mesmas regras de nome do upload antigo, para os links seguirem previsíveis. */
function nomeArquivoSeguro(nome, tipo) {
  const extPadrao = tipo === 'pdf' ? 'pdf' : 'jpg';
  const ponto = nome.lastIndexOf('.');
  const ext = (ponto > -1 ? nome.slice(ponto + 1) : extPadrao)
    .toLowerCase().replace(/[^a-z0-9]/g, '') || extPadrao;
  const base = (ponto > -1 ? nome.slice(0, ponto) : nome)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50) || 'arquivo';
  return `${base}-${Date.now()}.${ext}`;
}

/**
 * Assina uma URL de envio única para este arquivo. O token carrega o tipo e o
 * tamanho máximo permitidos, então a URL não serve para enviar outra coisa.
 */
async function gerarUrlDeEnvio({ nome, tipo, contentType, tamanho }) {
  if (!temBlob()) throw new Error('BLOB_READ_WRITE_TOKEN não configurado.');

  const grupo = tipo === 'pdf' ? 'pdf' : 'imagem';
  if (!TIPOS_OK[grupo].includes(contentType)) {
    throw new Error(`Tipo de arquivo não permitido (${contentType}).`);
  }
  const bytes = Number(tamanho) || 0;
  if (bytes <= 0) throw new Error('Arquivo vazio.');
  if (bytes > LIMITE_BYTES) {
    throw new Error(`Arquivo muito grande (máx. ${LIMITE_BYTES / 1024 / 1024} MB).`);
  }

  const pathname = `${PASTAS[grupo]}/${nomeArquivoSeguro(String(nome || 'arquivo'), grupo)}`;
  const opcoes = {
    access: 'public',
    allowedContentTypes: [contentType],
    maximumSizeInBytes: LIMITE_BYTES,
    addRandomSuffix: false,
    allowOverwrite: false // o nome já leva timestamp; recusar sobrescrita evita perda acidental
  };

  const token = await issueSignedToken({
    pathname,
    operations: ['put'],
    allowedContentTypes: [contentType],
    maximumSizeInBytes: LIMITE_BYTES,
    validUntil: Date.now() + VALIDADE_MS
  });

  const { presignedUrl } = await presignUrl(token, { operation: 'put', pathname, ...opcoes });
  return { presignedUrl, pathname };
}

module.exports = { temBlob, gerarUrlDeEnvio, LIMITE_BYTES, TIPOS_OK };
