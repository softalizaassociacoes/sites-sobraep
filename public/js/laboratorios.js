/*
 * Mapa dos laboratórios: abre o pop-up junto do marcador clicado.
 *
 * A posição do pop-up é calculada a cada abertura porque o mapa é fluido —
 * a mesma coordenada em % vira pixels diferentes conforme a largura da tela.
 * O cartão é mantido dentro dos limites do mapa e vai para cima do marcador
 * quando não há espaço abaixo. Em telas estreitas o CSS o fixa no rodapé e
 * este cálculo é ignorado.
 */
(() => {
  const mapa = document.getElementById('labsMapa');
  const popup = document.getElementById('labsPopup');
  if (!mapa || !popup) return;

  const dados = JSON.parse(document.getElementById('labsDados').textContent);
  const el = {
    logo: document.getElementById('labsPopupLogo'),
    sigla: document.getElementById('labsPopupTitulo'),
    nome: document.getElementById('labsPopupNome'),
    inst: document.getElementById('labsPopupInst'),
    cidade: document.getElementById('labsPopupCidade'),
    integrantes: document.getElementById('labsPopupIntegrantes'),
    linhaIntegrantes: document.getElementById('labsPopupIntegrantesLinha'),
    links: document.getElementById('labsPopupLinks')
  };
  let marcadorAtivo = null;

  const REDES = [
    { campo: 'site', rotulo: 'Site', icone: '🌐' },
    { campo: 'instagram', rotulo: 'Instagram', icone: '📷' },
    { campo: 'linkedin', rotulo: 'LinkedIn', icone: '💼' }
  ];

  function preencher(lab) {
    el.sigla.textContent = lab.sigla || '';
    el.nome.textContent = lab.nome && lab.nome !== lab.sigla ? lab.nome : '';
    el.nome.hidden = !el.nome.textContent;
    el.inst.textContent = lab.instituicao || '—';
    el.cidade.textContent = lab.cidade ? `${lab.cidade}/${lab.uf}` : '—';

    const temIntegrantes = Number.isFinite(lab.integrantes);
    el.linhaIntegrantes.hidden = !temIntegrantes;
    if (temIntegrantes) el.integrantes.textContent = lab.integrantes;

    el.logo.innerHTML = '';
    if (lab.logo) {
      const img = document.createElement('img');
      img.src = lab.logo;
      img.alt = '';
      el.logo.appendChild(img);
    } else {
      const s = document.createElement('span');
      s.textContent = lab.sigla || '';
      el.logo.appendChild(s);
    }

    el.links.innerHTML = '';
    const disponiveis = REDES.filter((r) => lab[r.campo]);
    if (!disponiveis.length) {
      const p = document.createElement('span');
      p.className = 'labs-popup-vazio';
      p.textContent = 'Sem links cadastrados.';
      el.links.appendChild(p);
      return;
    }
    for (const r of disponiveis) {
      const a = document.createElement('a');
      a.href = lab[r.campo];
      a.target = '_blank';
      a.rel = 'noopener';
      a.textContent = `${r.icone} ${r.rotulo}`;
      el.links.appendChild(a);
    }
  }

  function posicionar(marcador) {
    // no layout estreito o CSS fixa o pop-up no rodapé; não mexe aqui
    if (window.matchMedia('(max-width: 720px)').matches) {
      popup.style.left = popup.style.top = '';
      return;
    }
    const area = mapa.getBoundingClientRect();
    const m = marcador.getBoundingClientRect();
    const largura = popup.offsetWidth;
    const altura = popup.offsetHeight;
    const MARGEM = 8;

    // centraliza no marcador, mas sem deixar o cartão sair do mapa
    let x = m.left - area.left + m.width / 2 - largura / 2;
    x = Math.max(MARGEM, Math.min(x, area.width - largura - MARGEM));

    // abaixo do marcador; se não couber, acima
    let y = m.top - area.top + m.height + 10;
    if (y + altura > area.height - MARGEM) {
      const acima = m.top - area.top - altura - 10;
      y = acima >= MARGEM ? acima : Math.max(MARGEM, area.height - altura - MARGEM);
    }

    popup.style.left = `${Math.round(x)}px`;
    popup.style.top = `${Math.round(y)}px`;
  }

  function abrir(marcador) {
    const lab = dados[Number(marcador.dataset.lab)];
    if (!lab) return;
    preencher(lab);
    popup.hidden = false;      // precisa estar visível para medir o tamanho
    posicionar(marcador);
    if (marcadorAtivo) marcadorAtivo.classList.remove('is-ativo');
    marcador.classList.add('is-ativo');
    marcadorAtivo = marcador;
  }

  function fechar() {
    popup.hidden = true;
    if (marcadorAtivo) {
      marcadorAtivo.classList.remove('is-ativo');
      marcadorAtivo = null;
    }
  }

  mapa.querySelectorAll('.labs-marcador').forEach((b) => {
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      if (b === marcadorAtivo) return fechar(); // clicar de novo fecha
      abrir(b);
    });
  });

  document.getElementById('labsPopupFechar').addEventListener('click', fechar);
  popup.addEventListener('click', (e) => e.stopPropagation());
  document.addEventListener('click', () => { if (!popup.hidden) fechar(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') fechar(); });
  window.addEventListener('resize', () => { if (marcadorAtivo) posicionar(marcadorAtivo); });
})();
