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

// ---------- Envio de arquivo ao servidor (compartilhado) ----------
const LIMITE_UPLOAD = 4 * 1024 * 1024; // ~4 MB (limite da function do Vercel)

// Envia o arquivo como corpo binário; resolve com { url }. onProgress(pct) opcional.
function uploadArquivo(file, tipo, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const url = `/admin/api/upload?tipo=${encodeURIComponent(tipo)}&nome=${encodeURIComponent(file.name)}`;
    xhr.open('POST', url);
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100));
    });
    xhr.addEventListener('load', () => {
      let data = {};
      try { data = JSON.parse(xhr.responseText); } catch (_) {}
      if (xhr.status >= 200 && xhr.status < 300 && data.url) resolve(data);
      else reject(new Error(data.error || (xhr.status === 413 ? 'arquivo grande demais' : `HTTP ${xhr.status}`)));
    });
    xhr.addEventListener('error', () => reject(new Error('erro de rede')));
    xhr.send(file);
  });
}

// ---------- Upload da imagem de destaque / slides (campos .admin-upload) ----------
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
    if (file.size > LIMITE_UPLOAD) {
      return setStatus('Arquivo muito grande (máx. 4 MB). Envie um menor ou peça à Softaliza.', 'erro');
    }

    // Preview imediato da imagem a partir do próprio arquivo escolhido
    if (preview && ehImagem) {
      preview.src = URL.createObjectURL(file);
      preview.classList.remove('oculta');
    }

    setStatus('Enviando… 0%', '');
    if (submit) submit.disabled = true;
    uploadArquivo(file, tipo, (pct) => setStatus(`Enviando… ${pct}%`, ''))
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
});

// ---------- Página de Arquivos: upload múltiplo (arrastar + fila) ----------
(() => {
  const dz = document.getElementById('arqDropzone');
  if (!dz) return;
  const input = document.getElementById('arqInput');
  const fila = document.getElementById('arqFila');

  dz.addEventListener('click', () => input.click());
  ['dragover', 'dragenter'].forEach((ev) => dz.addEventListener(ev, (e) => {
    e.preventDefault(); dz.classList.add('is-arrastando');
  }));
  ['dragleave', 'drop'].forEach((ev) => dz.addEventListener(ev, (e) => {
    e.preventDefault(); dz.classList.remove('is-arrastando');
  }));
  dz.addEventListener('drop', (e) => { if (e.dataTransfer.files.length) enviarVarios(e.dataTransfer.files); });
  input.addEventListener('change', () => { if (input.files.length) enviarVarios(input.files); input.value = ''; });

  async function enviarVarios(lista) {
    let houveSucesso = false;
    for (const file of [...lista]) {
      const linha = criarLinha(file.name);
      const tipo = file.type === 'application/pdf' ? 'pdf' : (file.type.startsWith('image/') ? 'imagem' : null);
      if (!tipo) { linha.set('Tipo não suportado (só imagem ou PDF)', 'erro'); continue; }
      if (file.size > LIMITE_UPLOAD) { linha.set('Grande demais (máx. 4 MB)', 'erro'); continue; }
      try {
        await uploadArquivo(file, tipo, (pct) => linha.set(`Enviando… ${pct}%`));
        linha.set('Enviado ✓', 'ok');
        houveSucesso = true;
      } catch (err) {
        linha.set('Falha: ' + (err.message || 'erro'), 'erro');
      }
    }
    if (houveSucesso) {
      const aviso = criarLinha('Atualizando a lista…');
      aviso.set('', 'ok');
      setTimeout(() => location.reload(), 900);
    }
  }

  function criarLinha(nome) {
    const el = document.createElement('div');
    el.className = 'arq-fila-item';
    el.innerHTML = '<span class="arq-fila-nome"></span><span class="arq-fila-status"></span>';
    el.querySelector('.arq-fila-nome').textContent = nome;
    fila.appendChild(el);
    return {
      set(txt, estado) {
        const s = el.querySelector('.arq-fila-status');
        s.textContent = txt;
        s.className = 'arq-fila-status' + (estado ? ' is-' + estado : '');
      }
    };
  }
})();

// ---------- Copiar link de um arquivo (delegação) ----------
document.addEventListener('click', (e) => {
  const b = e.target.closest('.arq-copiar');
  if (!b) return;
  const link = b.dataset.url;
  const feedback = () => {
    const orig = b.textContent;
    b.textContent = 'Copiado ✓';
    setTimeout(() => { b.textContent = orig; }, 1500);
  };
  if (navigator.clipboard) {
    navigator.clipboard.writeText(link).then(feedback).catch(() => window.prompt('Copie o link:', link));
  } else {
    window.prompt('Copie o link:', link);
  }
});

// ---------- Editor WYSIWYG ----------
const area = document.getElementById('editorArea');
const htmlArea = document.getElementById('editorHtml');
if (area && htmlArea) {
  const form = area.closest('form');
  const toolbar = document.querySelector('.admin-editor-toolbar');

  // Ícones-link usados nos resultados do Prêmio SOBRAEP: 📖 aponta para o
  // trabalho (dissertação/tese) e 💎 para o Currículo Lattes. Ficam como
  // <img> de um SVG do site — assim continuam legíveis no modo HTML e
  // sobrevivem inteiros quando a notícia é duplicada para outro ano.
  const ICONES = {
    'icone-trabalho': {
      arquivo: 'trabalho.svg',
      rotulo: 'Ler o trabalho',
      pergunta: 'Endereço da dissertação ou tese (https://…):'
    },
    'icone-lattes': {
      arquivo: 'lattes.png', // logo oficial do Currículo Lattes
      rotulo: 'Currículo Lattes',
      pergunta: 'Endereço do Currículo Lattes (http://lattes.cnpq.br/…):'
    }
  };

  const urlValida = (u) => /^https?:\/\/\S+/i.test(u);

  function pedirUrl(mensagem, valorAtual) {
    const resposta = window.prompt(mensagem, valorAtual);
    if (resposta === null) return null; // cancelou
    const url = resposta.trim();
    if (!urlValida(url)) {
      alert('Endereço inválido. Ele precisa começar com http:// ou https://');
      return null;
    }
    return url;
  }

  toolbar.querySelectorAll('button[data-cmd]').forEach((btn) => {
    const cmd = btn.dataset.cmd;
    btn.addEventListener('mousedown', (e) => e.preventDefault()); // não perde a seleção
    if (cmd === 'imagem' || cmd === 'arquivo') {
      btn.addEventListener('click', () => inserirArquivoNoTexto(cmd === 'imagem' ? 'imagem' : 'pdf'));
      return;
    }
    if (ICONES[cmd]) {
      btn.addEventListener('click', () => {
        const cfg = ICONES[cmd];
        const url = pedirUrl(cfg.pergunta, 'https://');
        if (!url) return;
        area.focus();
        document.execCommand('insertHTML', false, ' ' + htmlIcone(cfg, url));
        sincronizar();
      });
      return;
    }
    btn.addEventListener('click', () => {
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

  // Sobe uma imagem/PDF e insere no ponto do cursor (sem embutir base64).
  let selecaoSalva = null;
  area.addEventListener('blur', () => {
    const sel = window.getSelection();
    if (sel.rangeCount && area.contains(sel.anchorNode)) selecaoSalva = sel.getRangeAt(0);
  });
  function inserirArquivoNoTexto(tipo) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = tipo === 'imagem' ? 'image/*' : 'application/pdf';
    input.addEventListener('change', async () => {
      const file = input.files[0];
      if (!file) return;
      if (file.size > LIMITE_UPLOAD) {
        alert('Arquivo muito grande (máx. 4 MB). Envie um menor ou peça à Softaliza.');
        return;
      }
      const btnMsg = tipo === 'imagem' ? '🖼️ Enviando…' : '📎 Enviando…';
      const btn = toolbar.querySelector(`[data-cmd="${tipo === 'imagem' ? 'imagem' : 'arquivo'}"]`);
      const textoOriginal = btn ? btn.textContent : '';
      if (btn) { btn.textContent = btnMsg; btn.disabled = true; }
      try {
        const resp = await uploadArquivo(file, tipo);
        area.focus();
        // restaura a posição do cursor de antes de abrir o seletor de arquivo
        const sel = window.getSelection();
        sel.removeAllRanges();
        if (selecaoSalva) sel.addRange(selecaoSalva);
        const html = tipo === 'imagem'
          ? `<img src="${resp.url}" alt="" style="max-width:100%;height:auto;">`
          : `<a href="${resp.url}" target="_blank" rel="noopener">${escaparHtml(file.name)}</a>`;
        document.execCommand('insertHTML', false, html + '&nbsp;');
        sincronizar();
      } catch (err) {
        alert('Falha no envio: ' + (err.message || 'erro'));
      } finally {
        if (btn) { btn.textContent = textoOriginal; btn.disabled = false; }
      }
    });
    input.click();
  }
  function escaparHtml(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  function htmlIcone(cfg, url) {
    return `<a class="premio-link" href="${escaparHtml(url)}" target="_blank" rel="noopener" title="${cfg.rotulo}">` +
      `<img src="/images/icones/${cfg.arquivo}" alt="${cfg.rotulo}"></a>`;
  }

  // Clicar num ícone já existente troca só o endereço — é assim que a cópia de
  // um ano vira a do ano seguinte sem precisar mexer no HTML.
  area.addEventListener('click', (e) => {
    const link = e.target.closest('.premio-link');
    if (!link) return;
    e.preventDefault(); // dentro do editor o link não deve navegar
    const url = pedirUrl('Endereço deste ícone (https://…):', link.getAttribute('href') || 'https://');
    if (!url) return;
    link.setAttribute('href', url);
    sincronizar();
  });

  // Bloqueia colar imagem direto (vira base64 gigante e estoura o envio).
  area.addEventListener('paste', (e) => {
    const itens = (e.clipboardData && e.clipboardData.items) || [];
    for (const it of itens) {
      if (it.kind === 'file' && it.type.startsWith('image/')) {
        e.preventDefault();
        alert('Para inserir imagem no texto, use o botão 🖼️ Imagem da barra — assim o site sobe o arquivo. Colar a imagem direto deixa a notícia pesada demais e o envio falha.');
        return;
      }
    }
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
