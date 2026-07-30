/* Painel admin: confirmações, editor WYSIWYG e upload direto ao Vercel Blob. */
import { upload } from '/js/vendor/vercel-blob-client.js';

// ---------- Confirmação em formulários destrutivos ----------
document.querySelectorAll('form[data-confirmar]').forEach((form) => {
  form.addEventListener('submit', (e) => {
    if (!window.confirm(form.dataset.confirmar)) e.preventDefault();
  });
});

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

    setStatus('Enviando… 0%', '');
    if (submit) submit.disabled = true;
    try {
      const ext = (file.name.split('.').pop() || (ehImagem ? 'jpg' : 'pdf')).toLowerCase();
      const nome = `uploads/${tipo}/${Date.now()}-${slug(file.name.replace(/\.[^.]+$/, ''))}.${ext}`;
      const blob = await upload(nome, file, {
        access: 'public',
        handleUploadUrl: '/admin/api/upload',
        onUploadProgress: (p) => setStatus(`Enviando… ${Math.round(p.percentage)}%`, '')
      });
      campo.value = blob.url;
      setStatus('Arquivo enviado ✓', 'ok');
      if (preview && ehImagem) {
        preview.src = blob.url;
        preview.classList.remove('oculta');
      }
    } catch (err) {
      console.error(err);
      setStatus('Falha no envio: ' + (err.message || 'erro'), 'erro');
    } finally {
      if (submit) submit.disabled = false;
    }
  });

  function setStatus(txt, estado) {
    status.textContent = txt;
    status.className = 'admin-upload-status' + (estado ? ' is-' + estado : '');
  }
});

function slug(s) {
  return String(s)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'arquivo';
}

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
