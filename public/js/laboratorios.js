/*
 * Mapa dos laboratórios.
 *
 * As logomarcas ficam na lista ao lado, não sobre o mapa — 29 marcadores com
 * logo deixavam a leitura impossível. A ligação entre o ponto e o grupo é uma
 * linha tracejada, desenhada só para o item em foco.
 *
 * Três comportamentos merecem explicação:
 *
 * - O marcador é a CIDADE, não o grupo. Quatro grupos em Belo Horizonte ficavam
 *   na mesma coordenada, um sobre o outro: só o de cima respondia, e ampliar
 *   não separava porque a posição era idêntica. Agora o ponto traz a contagem,
 *   o cartão mostra todas as logomarcas da cidade e o clique filtra a lista
 *   para aqueles grupos. Um grupo com polos aparece em cada cidade onde está.
 * - Ao passar por um ponto, o cartão aparece ao lado do mapa e a linha
 *   tracejada vai até ele — sempre, esteja o grupo visível na lista ou não. A
 *   lista continua servindo para procurar e filtrar.
 * - O mapa tem zoom próprio, porque o zoom do navegador amplia a página
 *   inteira. Os pontos encolhem na mesma medida em que o mapa cresce, senão
 *   cobririam cidades vizinhas justamente quando se quer precisão.
 */
(() => {
  const mapa = document.getElementById('labsMapa');
  const lista = document.getElementById('labsLista');
  const popup = document.getElementById('labsPopup');
  if (!mapa || !lista || !popup) return;

  const dados = JSON.parse(document.getElementById('labsDados').textContent);
  const ufsComLab = JSON.parse(document.getElementById('labsUfs').textContent);
  const cidades = JSON.parse(document.getElementById('labsCidades').textContent);
  const svgLinhas = document.getElementById('labsLinhas');
  const palco = document.getElementById('labsPalco') || mapa;
  const itens = [...lista.querySelectorAll('.labs-item')];
  const pontos = [...mapa.querySelectorAll('.labs-ponto')];
  const cartao = document.getElementById('labsCartao');

  const el = {
    titulo: document.getElementById('labsFiltroTitulo'),
    limpar: document.getElementById('labsLimpar'),
    vazia: document.getElementById('labsListaVazia'),
    logo: document.getElementById('labsPopupLogo'),
    sigla: document.getElementById('labsPopupTitulo'),
    nome: document.getElementById('labsPopupNome'),
    inst: document.getElementById('labsPopupInst'),
    cidade: document.getElementById('labsPopupCidade'),
    cidadeRotulo: document.getElementById('labsPopupCidadeRotulo'),
    resp: document.getElementById('labsPopupResp'),
    respLinha: document.getElementById('labsPopupRespLinha'),
    integrantes: document.getElementById('labsPopupIntegrantes'),
    integrantesLinha: document.getElementById('labsPopupIntegrantesLinha'),
    links: document.getElementById('labsPopupLinks')
  };

  // filtro da lista: null, { uf } ou { cidade }
  let filtro = null;
  // o que está em foco: { tipo, labs, cidade, local, ponto }
  let foco = null;

  const NOMES_UF = {
    AC: 'Acre', AL: 'Alagoas', AM: 'Amazonas', AP: 'Amapá', BA: 'Bahia', CE: 'Ceará',
    DF: 'Distrito Federal', ES: 'Espírito Santo', GO: 'Goiás', MA: 'Maranhão',
    MG: 'Minas Gerais', MS: 'Mato Grosso do Sul', MT: 'Mato Grosso', PA: 'Pará',
    PB: 'Paraíba', PE: 'Pernambuco', PI: 'Piauí', PR: 'Paraná', RJ: 'Rio de Janeiro',
    RN: 'Rio Grande do Norte', RO: 'Rondônia', RR: 'Roraima', RS: 'Rio Grande do Sul',
    SC: 'Santa Catarina', SE: 'Sergipe', SP: 'São Paulo', TO: 'Tocantins'
  };

  const cidadesDe = (lab) =>
    (lab.polos && lab.polos.length)
      ? lab.polos.map((p) => `${p.cidade}/${p.uf}`)
      : (lab.cidade ? [`${lab.cidade}/${lab.uf}`] : []);

  // ---------- zoom e arraste ----------
  let escala = 1;
  let panX = 0;
  let panY = 0;
  const ESCALA_MIN = 1;
  const ESCALA_MAX = 6;

  function aplicarTransformacao() {
    palco.style.transform = `translate(${panX}px, ${panY}px) scale(${escala})`;
    // o ponto encolhe na mesma proporção: assim ele cobre sempre a mesma área
    // geográfica, e aproximar realmente separa cidades vizinhas
    mapa.style.setProperty('--zoom', escala);
    document.getElementById('labsZoomNivel').textContent = `${Math.round(escala * 100)}%`;
    document.getElementById('labsZoomMenos').disabled = escala <= ESCALA_MIN + 0.01;
    document.getElementById('labsZoomMais').disabled = escala >= ESCALA_MAX - 0.01;
    mapa.classList.toggle('is-ampliado', escala > 1.01);
    if (foco) desenharLinha();
  }

  function limitarPan() {
    // não deixa arrastar o mapa para fora da moldura
    const limite = mapa.getBoundingClientRect();
    const extraX = (limite.width * (escala - 1)) / 2;
    const extraY = (limite.height * (escala - 1)) / 2;
    panX = Math.max(-extraX, Math.min(extraX, panX));
    panY = Math.max(-extraY, Math.min(extraY, panY));
  }

  function zoomPara(novaEscala, ancoraX, ancoraY) {
    const antes = escala;
    escala = Math.max(ESCALA_MIN, Math.min(ESCALA_MAX, novaEscala));
    if (escala === antes) return;
    if (ancoraX !== undefined) {
      // mantém sob o cursor o mesmo ponto do mapa
      const r = mapa.getBoundingClientRect();
      const cx = ancoraX - r.left - r.width / 2;
      const cy = ancoraY - r.top - r.height / 2;
      panX = cx - ((cx - panX) * escala) / antes;
      panY = cy - ((cy - panY) * escala) / antes;
    }
    if (escala === 1) { panX = 0; panY = 0; }
    limitarPan();
    aplicarTransformacao();
  }

  document.getElementById('labsZoomMais').addEventListener('click', () => zoomPara(escala * 1.5));
  document.getElementById('labsZoomMenos').addEventListener('click', () => zoomPara(escala / 1.5));
  document.getElementById('labsZoomReset').addEventListener('click', () => {
    escala = 1; panX = 0; panY = 0; aplicarTransformacao();
  });

  // roda do mouse com Ctrl, ou pinça do trackpad: não sequestra a rolagem
  mapa.addEventListener('wheel', (e) => {
    if (!e.ctrlKey && escala === 1) return; // rolagem normal da página
    e.preventDefault();
    zoomPara(escala * (e.deltaY < 0 ? 1.15 : 1 / 1.15), e.clientX, e.clientY);
  }, { passive: false });

  // arrastar quando ampliado
  let arrastando = null;
  mapa.addEventListener('pointerdown', (e) => {
    if (escala <= 1 || e.target.closest('.labs-ponto')) return;
    arrastando = { x: e.clientX, y: e.clientY, px: panX, py: panY };
    mapa.setPointerCapture(e.pointerId);
    mapa.classList.add('is-arrastando');
  });
  mapa.addEventListener('pointermove', (e) => {
    if (!arrastando) return;
    panX = arrastando.px + (e.clientX - arrastando.x);
    panY = arrastando.py + (e.clientY - arrastando.y);
    limitarPan();
    aplicarTransformacao();
  });
  const soltar = () => { arrastando = null; mapa.classList.remove('is-arrastando'); };
  mapa.addEventListener('pointerup', soltar);
  mapa.addEventListener('pointercancel', soltar);

  // ---------- de grupo para cidade e vice-versa ----------
  const cidadesDoGrupo = dados.map(function (_, i) {
    return cidades.reduce(function (acc, c, ci) {
      return c.labs.indexOf(i) === -1 ? acc : acc.concat(ci);
    }, []);
  });
  const pontoDaCidade = (ci) => pontos.find((p) => Number(p.dataset.cidade) === ci);
  const nomeDaCidade = (c) => (c.cidade ? `${c.cidade}/${c.uf}` : (c.uf || ''));
  const plural = (n) => `${n} grupo${n > 1 ? 's' : ''}`;

  // ---------- estados clicáveis ----------
  const contagem = {};
  dados.forEach((l) => {
    const ufs = (l.polos && l.polos.length) ? [...new Set(l.polos.map((p) => p.uf))] : [l.uf];
    ufs.filter(Boolean).forEach((uf) => { contagem[uf] = (contagem[uf] || 0) + 1; });
  });

  ufsComLab.forEach((uf) => {
    const path = mapa.querySelector(`#BR-${uf}`);
    if (!path) return;
    path.classList.add('tem-lab');
    path.setAttribute('tabindex', '0');
    path.setAttribute('role', 'button');
    const n = contagem[uf] || 0;
    path.setAttribute('aria-label', `${NOMES_UF[uf] || uf}: ${plural(n)}`);
    const titulo = document.createElementNS('http://www.w3.org/2000/svg', 'title');
    titulo.textContent = `${NOMES_UF[uf] || uf} — ${plural(n)}`;
    path.appendChild(titulo);

    const acionar = (e) => {
      e.stopPropagation();
      filtrar(filtro && filtro.uf === uf ? null : { uf });
    };
    path.addEventListener('click', acionar);
    path.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); acionar(e); }
    });
  });

  // ---------- filtro da lista ----------
  // Atende ao clique no estado e ao clique numa cidade com mais de um grupo:
  // nesse caso a lista passa a mostrar só os grupos de lá, e cada um continua
  // abrindo o próprio detalhe.
  function filtrar(criterio) {
    filtro = criterio || null;
    const daCidade = filtro && filtro.cidade != null ? cidades[filtro.cidade] : null;
    let visiveis = 0;

    itens.forEach((li) => {
      const i = Number(li.dataset.lab);
      const ufsDoItem = (li.dataset.ufs || li.dataset.uf || '').split(',');
      const mostra = !filtro ? true
        : daCidade ? daCidade.labs.indexOf(i) !== -1
        : ufsDoItem.indexOf(filtro.uf) !== -1;
      li.hidden = !mostra;
      if (mostra) visiveis++;
    });

    pontos.forEach((p) => {
      const ci = Number(p.dataset.cidade);
      const fora = !filtro ? false
        : daCidade ? ci !== filtro.cidade
        : cidades[ci].uf !== filtro.uf;
      p.classList.toggle('is-apagado', fora);
    });

    const ufAceso = daCidade ? daCidade.uf : (filtro ? filtro.uf : null);
    mapa.querySelectorAll('.tem-lab').forEach((p) => {
      p.classList.toggle('is-ativo', p.id === `BR-${ufAceso}`);
    });

    el.titulo.textContent = !filtro ? 'Todos os grupos'
      : daCidade ? `${nomeDaCidade(daCidade)} — ${plural(daCidade.labs.length)}`
      : `${NOMES_UF[filtro.uf] || filtro.uf} — ${plural(contagem[filtro.uf] || 0)}`;
    el.limpar.hidden = !filtro;
    el.vazia.hidden = visiveis > 0;
    limparDestaque();
    fechar();
    lista.scrollTop = 0;
  }

  el.limpar.addEventListener('click', () => filtrar(null));

  // ---------- cartão flutuante ----------
  // Mostra as logomarcas do que está em foco ao lado do mapa: um grupo, quando
  // veio da lista, ou todos os da cidade, quando veio de um ponto do mapa. Fica
  // fora da área recortada pelo zoom, senão um ponto colado na borda — Recife é
  // o caso — teria o cartão cortado junto com o mapa.
  function mostrarCartao(labs, local, ponto) {
    const caixa = cartao.querySelector('.labs-cartao-logos');
    caixa.innerHTML = '';
    labs.forEach((lab) => {
      const item = document.createElement('span');
      item.className = 'labs-cartao-logo';
      item.title = lab.sigla;
      if (lab.logo) {
        const img = document.createElement('img');
        img.src = lab.logo;
        img.alt = lab.sigla;
        item.appendChild(img);
      } else {
        const s = document.createElement('span');
        s.textContent = lab.sigla;
        item.appendChild(s);
      }
      caixa.appendChild(item);
    });

    const varios = labs.length > 1;
    cartao.classList.toggle('labs-cartao--varios', varios);
    cartao.querySelector('.labs-cartao-sigla').textContent = varios ? local : labs[0].sigla;
    cartao.querySelector('.labs-cartao-local').textContent = varios
      ? labs.map((l) => l.sigla).join(' · ')
      : (cidadesDe(labs[0]).join(' · ') || local || '—');
    cartao.hidden = false;

    // do lado do mapa oposto ao ponto, para a linha não cruzar o desenho
    const area = mapa.getBoundingClientRect();
    const p = ponto.getBoundingClientRect();
    const naEsquerda = (p.left + p.width / 2 - area.left) > area.width / 2;
    cartao.classList.toggle('labs-cartao--esq', naEsquerda);
    const alturaCartao = cartao.offsetHeight;
    let topo = p.top + p.height / 2 - area.top - alturaCartao / 2;
    topo = Math.max(6, Math.min(topo, area.height - alturaCartao - 6));
    cartao.style.top = `${Math.round(topo)}px`;
  }

  const esconderCartao = () => { cartao.hidden = true; };

  // ---------- linha tracejada ----------
  function desenharLinha() {
    if (!foco) return apagarLinha();
    const p = foco.ponto || (foco.cidade != null ? pontoDaCidade(foco.cidade) : null);
    if (!p) return apagarLinha();
    if (window.matchMedia('(max-width: 900px)').matches) return apagarLinha();

    // A linha aponta sempre para o cartão, nunca para a lista. Antes ela ia
    // para o item quando ele estava à vista, e isso dependia da resolução e de
    // quantos grupos cabiam sem rolar: num item na borda da área rolável, a
    // linha terminava colada no limite e parecia não apontar para nada.
    mostrarCartao(foco.labs.map((i) => dados[i]), foco.local, p);
    const destino = cartao;

    const base = svgLinhas.getBoundingClientRect();
    const a = p.getBoundingClientRect();
    const b = destino.getBoundingClientRect();
    const x1 = a.left + a.width / 2 - base.left;
    const y1 = a.top + a.height / 2 - base.top;
    // chega pela borda voltada para o ponto
    const pelaEsquerda = b.left > x1 + base.left;
    const x2 = (pelaEsquerda ? b.left : b.right) - base.left;
    const y2 = b.top + b.height / 2 - base.top;
    const meio = x1 + (x2 - x1) * 0.55;
    svgLinhas.innerHTML =
      `<path d="M ${x1} ${y1} C ${meio} ${y1}, ${meio} ${y2}, ${x2} ${y2}" class="labs-linha"/>` +
      `<circle cx="${x1}" cy="${y1}" r="4.5" class="labs-linha-ponta"/>`;
  }

  const apagarLinha = () => { svgLinhas.innerHTML = ''; esconderCartao(); };

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

    const temPolos = lab.polos && lab.polos.length > 1;
    el.inst.textContent = temPolos
      ? [...new Set(lab.polos.map((p) => p.instituicao).filter(Boolean))].join(' · ')
      : (lab.instituicao || '—');
    el.cidadeRotulo.textContent = temPolos ? 'Polos' : 'Cidade';
    el.cidade.textContent = cidadesDe(lab).join(' · ') || '—';

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
  }

  function fechar() { popup.hidden = true; }

  // ---------- foco ----------
  // Vindo da lista o foco é um grupo, e todas as cidades onde ele tem polo
  // acendem. Vindo do mapa o foco é a cidade, e acendem os grupos dela.
  function focarCidade(ci, ponto) {
    const c = cidades[ci];
    foco = { tipo: 'cidade', labs: c.labs, cidade: ci, local: nomeDaCidade(c), ponto: ponto || pontoDaCidade(ci) };
    aplicarDestaque();
  }

  function focarGrupo(indice) {
    const cs = cidadesDoGrupo[indice] || [];
    foco = { tipo: 'grupo', labs: [indice], cidade: cs.length ? cs[0] : null, local: '', ponto: null };
    aplicarDestaque();
  }

  function aplicarDestaque() {
    itens.forEach((li) => {
      li.classList.toggle('is-ativo', !!foco && foco.labs.indexOf(Number(li.dataset.lab)) !== -1);
    });
    pontos.forEach((p) => {
      const ci = Number(p.dataset.cidade);
      const aceso = !!foco && (foco.tipo === 'cidade'
        ? ci === foco.cidade
        : cidades[ci].labs.some((x) => foco.labs.indexOf(x) !== -1));
      p.classList.toggle('is-ativo', aceso);
    });
  }

  function limparDestaque() {
    foco = null;
    aplicarDestaque();
    apagarLinha();
  }

  itens.forEach((li) => {
    const indice = Number(li.dataset.lab);
    li.addEventListener('mouseenter', () => { focarGrupo(indice); desenharLinha(); });
    li.addEventListener('mouseleave', () => { if (popup.hidden) limparDestaque(); });
    const btn = li.querySelector('.labs-item-btn');
    btn.addEventListener('focus', () => { focarGrupo(indice); desenharLinha(); });
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      focarGrupo(indice);
      desenharLinha();
      abrir(indice);
    });
  });

  pontos.forEach((p) => {
    const ci = Number(p.dataset.cidade);
    p.addEventListener('mouseenter', () => { focarCidade(ci, p); desenharLinha(); });
    p.addEventListener('mouseleave', () => { if (popup.hidden) limparDestaque(); });
    p.addEventListener('click', (e) => {
      e.stopPropagation();
      const c = cidades[ci];
      if (c.labs.length > 1) {
        // mais de um grupo na cidade: em vez de abrir um deles por sorteio, a
        // lista passa a mostrar só esses, e a pessoa escolhe qual quer ver
        filtrar({ cidade: ci });
        focarCidade(ci, p);
        desenharLinha();
        // no celular a lista fica abaixo do mapa e o filtro passaria batido
        if (window.matchMedia('(max-width: 900px)').matches) {
          lista.scrollIntoView({ block: 'nearest' });
        }
        return;
      }
      focarCidade(ci, p);
      desenharLinha();
      const indice = c.labs[0];
      // rola a lista até o grupo por conveniência; a linha não depende disso
      const item = itens.find((li) => Number(li.dataset.lab) === indice);
      if (item && !item.hidden) item.scrollIntoView({ block: 'nearest' });
      abrir(indice);
    });
  });

  document.getElementById('labsPopupFechar').addEventListener('click', () => { fechar(); limparDestaque(); });
  popup.addEventListener('click', (e) => e.stopPropagation());
  cartao.addEventListener('click', (e) => e.stopPropagation());
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { fechar(); limparDestaque(); } });
  window.addEventListener('resize', () => desenharLinha());

  aplicarTransformacao();
})();
