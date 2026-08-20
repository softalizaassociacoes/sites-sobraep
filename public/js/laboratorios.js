/*
 * Mapa dos laboratórios.
 *
 * As logomarcas saíram de cima do mapa (26 delas empilhadas deixavam a
 * visualização ilegível) e passaram para a lista ao lado. A ligação entre as
 * duas partes é feita por uma linha tracejada, desenhada só para o item em
 * foco: 26 linhas simultâneas recriariam a poluição que se quis evitar.
 *
 * Clicar num estado filtra a lista para os grupos daquele estado. Só os
 * estados que têm grupo cadastrado ficam clicáveis.
 */
(() => {
  const mapa = document.getElementById('labsMapa');
  const lista = document.getElementById('labsLista');
  const popup = document.getElementById('labsPopup');
  if (!mapa || !lista || !popup) return;

  const dados = JSON.parse(document.getElementById('labsDados').textContent);
  const ufsComLab = JSON.parse(document.getElementById('labsUfs').textContent);
  const svgLinhas = document.getElementById('labsLinhas');
  const itens = [...lista.querySelectorAll('.labs-item')];
  const pontos = [...mapa.querySelectorAll('.labs-ponto')];

  const el = {
    titulo: document.getElementById('labsFiltroTitulo'),
    limpar: document.getElementById('labsLimpar'),
    vazia: document.getElementById('labsListaVazia'),
    logo: document.getElementById('labsPopupLogo'),
    sigla: document.getElementById('labsPopupTitulo'),
    nome: document.getElementById('labsPopupNome'),
    inst: document.getElementById('labsPopupInst'),
    cidade: document.getElementById('labsPopupCidade'),
    resp: document.getElementById('labsPopupResp'),
    respLinha: document.getElementById('labsPopupRespLinha'),
    integrantes: document.getElementById('labsPopupIntegrantes'),
    integrantesLinha: document.getElementById('labsPopupIntegrantesLinha'),
    links: document.getElementById('labsPopupLinks')
  };

  let ufAtiva = null;
  let destacado = null;

  // ---------- estados clicáveis ----------
  const nomeUf = {
    AC: 'Acre', AL: 'Alagoas', AM: 'Amazonas', AP: 'Amapá', BA: 'Bahia', CE: 'Ceará',
    DF: 'Distrito Federal', ES: 'Espírito Santo', GO: 'Goiás', MA: 'Maranhão',
    MG: 'Minas Gerais', MS: 'Mato Grosso do Sul', MT: 'Mato Grosso', PA: 'Pará',
    PB: 'Paraíba', PE: 'Pernambuco', PI: 'Piauí', PR: 'Paraná', RJ: 'Rio de Janeiro',
    RN: 'Rio Grande do Norte', RO: 'Rondônia', RR: 'Roraima', RS: 'Rio Grande do Sul',
    SC: 'Santa Catarina', SE: 'Sergipe', SP: 'São Paulo', TO: 'Tocantins'
  };

  const contagem = {};
  dados.forEach((l) => { if (l.uf) contagem[l.uf] = (contagem[l.uf] || 0) + 1; });

  ufsComLab.forEach((uf) => {
    const path = mapa.querySelector(`#BR-${uf}`);
    if (!path) return;
    path.classList.add('tem-lab');
    path.setAttribute('tabindex', '0');
    path.setAttribute('role', 'button');
    const n = contagem[uf];
    path.setAttribute('aria-label', `${nomeUf[uf] || uf}: ${n} grupo${n > 1 ? 's' : ''}`);
    const titulo = document.createElementNS('http://www.w3.org/2000/svg', 'title');
    titulo.textContent = `${nomeUf[uf] || uf} — ${n} grupo${n > 1 ? 's' : ''}`;
    path.appendChild(titulo);

    const acionar = (e) => { e.stopPropagation(); filtrar(ufAtiva === uf ? null : uf); };
    path.addEventListener('click', acionar);
    path.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); acionar(e); }
    });
  });

  function filtrar(uf) {
    ufAtiva = uf;
    let visiveis = 0;
    itens.forEach((li) => {
      const mostra = !uf || li.dataset.uf === uf;
      li.hidden = !mostra;
      if (mostra) visiveis++;
    });
    pontos.forEach((p) => p.classList.toggle('is-apagado', Boolean(uf) && p.dataset.uf !== uf));
    mapa.querySelectorAll('.tem-lab').forEach((p) => {
      p.classList.toggle('is-ativo', p.id === `BR-${uf}`);
    });
    el.titulo.textContent = uf
      ? `${nomeUf[uf] || uf} — ${contagem[uf]} grupo${contagem[uf] > 1 ? 's' : ''}`
      : 'Todos os grupos';
    el.limpar.hidden = !uf;
    el.vazia.hidden = visiveis > 0;
    apagarLinha();
    fechar();
    lista.scrollTop = 0;
  }

  el.limpar.addEventListener('click', () => filtrar(null));

  // ---------- linha tracejada entre o ponto no mapa e o item da lista ----------
  function desenharLinha(indice) {
    const ponto = pontos.find((p) => p.dataset.lab === String(indice));
    const item = itens.find((li) => li.dataset.lab === String(indice));
    if (!ponto || !item || item.hidden) return apagarLinha();
    // sem espaço lateral (telas estreitas) a lista fica abaixo do mapa e a
    // linha atravessaria a página inteira
    if (window.matchMedia('(max-width: 900px)').matches) return apagarLinha();

    const base = svgLinhas.getBoundingClientRect();
    const a = ponto.getBoundingClientRect();
    const b = item.getBoundingClientRect();
    const x1 = a.left + a.width / 2 - base.left;
    const y1 = a.top + a.height / 2 - base.top;
    const x2 = b.left - base.left;               // borda esquerda do item
    const y2 = b.top + b.height / 2 - base.top;
    // curva suave: sai do ponto na horizontal e chega no item na horizontal
    const meio = x1 + (x2 - x1) * 0.55;
    svgLinhas.innerHTML =
      `<path d="M ${x1} ${y1} C ${meio} ${y1}, ${meio} ${y2}, ${x2} ${y2}" class="labs-linha"/>` +
      `<circle cx="${x1}" cy="${y1}" r="4.5" class="labs-linha-ponta"/>`;
  }

  const apagarLinha = () => { svgLinhas.innerHTML = ''; };

  // ---------- detalhe do grupo ----------
  const REDES = [
    { campo: 'site', rotulo: 'Site', icone: '🌐' },
    { campo: 'instagram', rotulo: 'Instagram', icone: '📷' },
    { campo: 'linkedin', rotulo: 'LinkedIn', icone: '💼' }
  ];

  function abrir(indice) {
    const lab = dados[indice];
    if (!lab) return;
    el.sigla.textContent = lab.sigla || '';
    el.nome.textContent = lab.nome && lab.nome !== lab.sigla ? lab.nome : '';
    el.nome.hidden = !el.nome.textContent;
    el.inst.textContent = lab.instituicao || '—';
    el.cidade.textContent = lab.cidade ? `${lab.cidade}/${lab.uf}` : '—';

    el.respLinha.hidden = !lab.responsavel;
    if (lab.responsavel) el.resp.textContent = lab.responsavel;

    const temInteg = Number.isFinite(lab.integrantes);
    el.integrantesLinha.hidden = !temInteg;
    if (temInteg) el.integrantes.textContent = `${lab.integrantes} pessoas`;

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
    } else {
      for (const r of disponiveis) {
        const a = document.createElement('a');
        a.href = lab[r.campo];
        a.target = '_blank';
        a.rel = 'noopener';
        a.textContent = `${r.icone} ${r.rotulo}`;
        el.links.appendChild(a);
      }
    }
    popup.hidden = false;
    popup.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  function fechar() {
    popup.hidden = true;
    if (destacado !== null) marcarDestaque(null);
  }

  function marcarDestaque(indice) {
    destacado = indice;
    itens.forEach((li) => li.classList.toggle('is-ativo', li.dataset.lab === String(indice)));
    pontos.forEach((p) => p.classList.toggle('is-ativo', p.dataset.lab === String(indice)));
  }

  // ---------- ligações ----------
  itens.forEach((li) => {
    const indice = Number(li.dataset.lab);
    li.addEventListener('mouseenter', () => { marcarDestaque(indice); desenharLinha(indice); });
    li.addEventListener('mouseleave', () => { if (popup.hidden) { marcarDestaque(null); apagarLinha(); } });
    li.querySelector('.labs-item-btn').addEventListener('focus', () => {
      marcarDestaque(indice);
      desenharLinha(indice);
    });
    li.querySelector('.labs-item-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      marcarDestaque(indice);
      desenharLinha(indice);
      abrir(indice);
    });
  });

  pontos.forEach((p) => {
    const indice = Number(p.dataset.lab);
    p.addEventListener('mouseenter', () => { marcarDestaque(indice); desenharLinha(indice); });
    p.addEventListener('mouseleave', () => { if (popup.hidden) { marcarDestaque(null); apagarLinha(); } });
    p.addEventListener('click', (e) => {
      e.stopPropagation();
      marcarDestaque(indice);
      desenharLinha(indice);
      abrir(indice);
      const item = itens.find((li) => li.dataset.lab === String(indice));
      if (item && !item.hidden) item.scrollIntoView({ block: 'nearest' });
    });
  });

  document.getElementById('labsPopupFechar').addEventListener('click', fechar);
  popup.addEventListener('click', (e) => e.stopPropagation());
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { fechar(); apagarLinha(); } });
  window.addEventListener('resize', () => {
    if (destacado !== null) desenharLinha(destacado); else apagarLinha();
  });
  lista.addEventListener('scroll', () => { if (destacado !== null) desenharLinha(destacado); });
})();
