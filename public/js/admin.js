/* Painel admin: confirmações, editor WYSIWYG e upload (grava no repositório via GitHub). */

// ---------- Confirmação em formulários destrutivos (modal do próprio site) ----------
(() => {
  const forms = document.querySelectorAll('form[data-confirmar]');
  if (!forms.length) return;

  // cria o modal uma única vez, reutilizado por todos os formulários
  const overlay = document.createElement('div');
  overlay.className = 'admin-modal-overlay';
  overlay.innerHTML =
    '<div class="admin-modal" role="dialog" aria-modal="true" aria-labelledby="adminModalMsg">' +
    '<h2 class="admin-modal-titulo">Confirmar exclusão</h2>' +
    '<p class="admin-modal-msg" id="adminModalMsg"></p>' +
    '<div class="admin-modal-acoes">' +
    '<button type="button" class="btn btn-outline-primary" data-modal="cancelar">Cancelar</button>' +
    '<button type="button" class="btn btn-perigo" data-modal="confirmar">Excluir</button>' +
    '</div></div>';
  document.body.appendChild(overlay);

  const msgEl = overlay.querySelector('.admin-modal-msg');
  const btnConfirmar = overlay.querySelector('[data-modal="confirmar"]');
  const btnCancelar = overlay.querySelector('[data-modal="cancelar"]');
  let formPendente = null;

  function abrir(form) {
    formPendente = form;
    msgEl.textContent = form.dataset.confirmar;
    overlay.classList.add('is-aberto');
    btnConfirmar.focus();
  }
  function fechar() {
    overlay.classList.remove('is-aberto');
    formPendente = null;
  }

  forms.forEach((form) => {
    form.addEventListener('submit', (e) => {
      if (form.dataset.confirmado === '1') return; // já confirmado, deixa enviar
      e.preventDefault();
      abrir(form);
    });
  });

  btnConfirmar.addEventListener('click', () => {
    if (!formPendente) return;
    formPendente.dataset.confirmado = '1';
    formPendente.submit();
  });
  btnCancelar.addEventListener('click', fechar);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) fechar(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && overlay.classList.contains('is-aberto')) fechar(); });
})();

// ---------- Upload (imagens e PDFs) ----------
document.querySelectorAll('.admin-upload').forEach((wrap) => {
  const input = wrap.querySelector('.admin-upload-arquivo');
  const status = wrap.querySelector('.admin-upload-status');
  const destinoNome = wrap.dataset.destino;
  const form = wrap.closest('form');
  const campo = form.querySelector(`[name="${destinoNome}"]`);
  const preview = form.querySelector('.admin-upload-preview');
  const tipo = wrap.dataset.tipo; // 'imagem' | 'pdf'
  const submit = form.querySelector('button[type="submit"]');

  input.addEventListener('change', async () => {
    const file = input.files[0];
    if (!file) return;

    const ehImagem = file.type.startsWith('image/');
    if (tipo === 'imagem' && !ehImagem) return setStatus('Selecione um arquivo de imagem.', 'erro');
    if (tipo === 'pdf' && file.type !== 'application/pdf') return setStatus('Selecione um arquivo PDF.', 'erro');

    if (file.size > 4 * 1024 * 1024) {
      return setStatus('Arquivo muito grande (máx. 4 MB). Envie um menor ou peça à Softaliza.', 'erro');
    }

    // Preview imediato da imagem a partir do próprio arquivo escolhido
    if (preview && ehImagem) {
      preview.src = URL.createObjectURL(file);
      preview.classList.remove('oculta');
    }

    setStatus('Enviando… 0%', '');
    if (submit) submit.disabled = true;
    enviarArquivo(file, tipo)
      .then((resp) => {
        campo.value = resp.url;
        setStatus('Arquivo enviado ✓ (aparece no site em ~1 min)', 'ok');
      })
      .catch((err) => {
        console.error(err);
        setStatus('Falha no envio: ' + (err.message || 'erro'), 'erro');
      })
      .finally(() => { if (submit) submit.disabled = false; });
  });

  function setStatus(txt, estado) {
    status.textContent = txt;
    status.className = 'admin-upload-status' + (estado ? ' is-' + estado : '');
  }

  // Envia o arquivo como corpo binário, com progresso via XHR
  function enviarArquivo(file, tipo) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      const url = `/admin/api/upload?tipo=${encodeURIComponent(tipo)}&nome=${encodeURIComponent(file.name)}`;
      xhr.open('POST', url);
      xhr.setRequestHeader('Content-Type', file.type);
      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) setStatus(`Enviando… ${Math.round((e.loaded / e.total) * 100)}%`, '');
      });
      xhr.addEventListener('load', () => {
        let data = {};
        try { data = JSON.parse(xhr.responseText); } catch (_) {}
        if (xhr.status >= 200 && xhr.status < 300 && data.url) resolve(data);
        else reject(new Error(data.error || `HTTP ${xhr.status}`));
      });
      xhr.addEventListener('error', () => reject(new Error('erro de rede')));
      xhr.send(file);
    });
  }
});

// ---------- Editor WYSIWYG ----------
const area = document.getElementById('editorArea');
const htmlArea = document.getElementById('editorHtml');
if (area && htmlArea) {
  const form = area.closest('form');
  const toolbar = document.querySelector('.admin-editor-toolbar');

  toolbar.querySelectorAll('button[data-cmd]').forEach((btn) => {
    btn.addEventListener('mousedown', (e) => e.preventDefault()); // não perde a seleção
    btn.addEventListener('click', () => {
      const cmd = btn.dataset.cmd;
      area.focus();
      if (cmd === 'link') {
        const url = window.prompt('Endereço do link (https://…):', 'https://');
        if (url) document.execCommand('createLink', false, url);
      } else if (cmd === 'h3') {
        document.execCommand('formatBlock', false, 'h3');
      } else if (cmd === 'p') {
        document.execCommand('formatBlock', false, 'p');
      } else {
        document.execCommand(cmd, false, null);
      }
      sincronizar();
    });
  });

  // Alterna entre editor visual e HTML cru
  const btnHtml = document.getElementById('alternarHtml');
  let modoHtml = false;
  btnHtml.addEventListener('click', () => {
    modoHtml = !modoHtml;
    if (modoHtml) {
      htmlArea.value = area.innerHTML;
      area.classList.add('oculta');
      htmlArea.classList.remove('oculta');
      btnHtml.textContent = '✓ Visual';
    } else {
      area.innerHTML = htmlArea.value;
      htmlArea.classList.add('oculta');
      area.classList.remove('oculta');
      btnHtml.textContent = '</> HTML';
    }
  });

  area.addEventListener('input', sincronizar);
  function sincronizar() { if (!modoHtml) htmlArea.value = area.innerHTML; }

  // Garante que o textarea (enviado no POST) esteja atualizado ao salvar
  form.addEventListener('submit', () => {
    if (!modoHtml) htmlArea.value = area.innerHTML;
  });
  sincronizar();
}
