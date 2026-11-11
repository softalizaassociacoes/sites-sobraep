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
 * - A lista tem busca própria. Passou de 40 grupos: rolar até achar um deixou
 *   de funcionar, e o filtro por estado só ajuda quem já sabe onde o grupo
 *   fica. A busca casa sigla, nome, instituição, cidade e estado.
 * - O mapa tem zoom próprio, porque o zoom do navegador amplia a página
 *   inteira. Os pontos encolhem na mesma medida em que o mapa cresce, senão
 *   cobririam cidades vizinhas justamente quando se quer precisão.
 * - Cidades vizinhas demais para caber lado a lado entram num ponto só, que
 *   mostra o total e se desfaz sozinho quando o zoom dá espaço. Sem isso, Rio
 *   e Niterói ficam a 1,8px uma da outra: o ponto de cima rouba o mouse e o
 *   laboratório de baixo é inalcançável em qualquer zoom razoável.
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
    links: document.getElementById('labsPopupLinks'),
    busca: document.getElementById('labsBusca'),
    buscaLimpar: document.getElementById('labsBuscaLimpar')
  };

  // filtro da lista: null, { uf } ou { cidade }
  let filtro = null;
  // termos da busca, já normalizados, e o texto cru para exibir no título
  let termos = [];
  let termoExibido = '';
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
  // 1200%: Rio e Niterói pedem 1025% para o mouse acertar uma sem pegar a
  // outra, e esse é o par mais apertado do mapa
  const ESCALA_MAX = 12;

  function aplicarTransformacao() {
    palco.style.transform = `translate(${panX}px, ${panY}px) scale(${escala})`;
    // o ponto encolhe na mesma proporção: assim ele cobre sempre a mesma área
    // geográfica, e aproximar realmente separa cidades vizinhas
    mapa.style.setProperty('--zoom', escala);
    mapa.style.setProperty('--mapa', fatorDoMapa());
    document.getElementById('labsZoomNivel').textContent = `${Math.round(escala * 100)}%`;
    document.getElementById('labsZoomMenos').disabled = escala <= ESCALA_MIN + 0.01;
    document.getElementById('labsZoomMais').disabled = escala >= ESCALA_MAX - 0.01;
    mapa.classList.toggle('is-ampliado', escala > 1.01);
    aplicarAgrupamento();
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
  const plural = (n) => `${n} grupo${n === 1 ? '' : 's'}`;
  const cidadesDoPonto = (p) => p.dataset.conjunto.split(',').map(Number);
  const labsDoPonto = (p) =>
    [...new Set(cidadesDoPonto(p).flatMap((ci) => cidades[ci].labs))];
  const nomeDoConjunto = (membros) => membros.map((ci) => nomeDaCidade(cidades[ci])).join(' · ');
  // o ponto que de fato responde pela cidade: pode ser o dela ou o do conjunto
  // em que ela caiu
  const pontoVisivelDaCidade = (ci) =>
    pontos.find((p) => !p.hidden && cidadesDoPonto(p).indexOf(ci) !== -1);

  // ---------- agrupamento por proximidade ----------
  // Dois pontos a menos de ENCOSTO pixels na tela brigam pelo mouse: o de cima
  // ganha sempre e o de baixo não existe. Em vez de deixar assim, viram um
  // ponto só com o total, e se separam quando o zoom abre espaço entre eles.
  const ENCOSTO = 20;

  // Quanto o mapa desta tela mede em relacao ao desktop (699px). O ponto e o
  // limite de agrupamento seguem essa proporcao: assim o territorio coberto
  // por um marcador e o mesmo em qualquer tela, e o celular deixa de virar um
  // ponto por estado. O piso evita que o ponto suma numa tela muito estreita.
  const LARGURA_BASE = 699;
  const fatorDoMapa = () =>
    Math.max(0.5, Math.min(1, mapa.getBoundingClientRect().width / LARGURA_BASE));

  function agrupar() {
    const area = mapa.getBoundingClientRect();
    const limite = ENCOSTO * fatorDoMapa();
    const px = (a, b) => Math.hypot(
      ((cidades[a].left - cidades[b].left) / 100) * area.width * escala,
      ((cidades[a].top - cidades[b].top) / 100) * area.height * escala
    );
    // Cada conjunto é um círculo de raio ENCOSTO em volta de uma cidade. Juntar
    // "quem encosta em quem" de forma transitiva não serve: com 31 cidades
    // espalhadas por 700px sempre existe uma corrente de saltos curtos ligando
    // Salvador a Porto Alegre, e o mapa inteiro virava um ponto só.
    const livres = cidades.map((_, i) => i);
    const conjuntos = [];
    while (livres.length) {
      const semente = livres.shift();
      const membros = [semente];
      for (let k = livres.length - 1; k >= 0; k--) {
        if (px(semente, livres[k]) < limite) membros.push(livres.splice(k, 1)[0]);
      }
      conjuntos.push({ semente, membros: membros.sort((a, b) => a - b) });
    }
    return conjuntos;
  }

  function aplicarAgrupamento() {
    const escondidas = new Set();
    agrupar().forEach(({ semente, membros }) => {
      const ponto = pontoDaCidade(semente);
      if (!ponto) return;
      // O ponto fica sobre a cidade-semente, e não no meio do conjunto. Pelo
      // meio, dois conjuntos vizinhos podiam ser desenhados mais perto do que
      // o limite que os manteve separados — a conta usava a semente e o
      // desenho usava o centro. Pela semente os dois coincidem, e como duas
      // sementes estão sempre a ENCOSTO ou mais uma da outra, dois pontos
      // desenhados nunca ficam mais perto do que isso.
      ponto.style.left = cidades[semente].left + '%';
      ponto.style.top = cidades[semente].top + '%';
      ponto.dataset.conjunto = membros.join(',');

      const labs = [...new Set(membros.flatMap((ci) => cidades[ci].labs))];
      const num = ponto.querySelector('.labs-ponto-num');
      if (num) num.textContent = labs.length > 1 ? labs.length : '';
      ponto.classList.toggle('labs-ponto--varios', labs.length > 1);
      ponto.setAttribute('aria-label',
        nomeDoConjunto(membros) + ' — ' + plural(labs.length) + ': ' +
        labs.map((i) => dados[i].sigla).join(', '));

      membros.forEach((ci) => { if (ci !== semente) escondidas.add(ci); });
    });
    pontos.forEach((p) => { p.hidden = escondidas.has(Number(p.dataset.cidade)); });
    // o foco pode ter ido parar num ponto que sumiu
    if (foco && foco.ponto && foco.ponto.hidden) limparDestaque();
  }

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

  // ---------- busca por texto ----------
  // Casa sigla, nome, instituição, cidade e estado — o estado tanto pela sigla
  // (MG) quanto pelo nome por extenso (Minas Gerais). Os acentos saem dos dois
  // lados: quem digita "vicosa" precisa achar Viçosa.
  const semAcento = (t) => String(t || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

  const textoDoGrupo = dados.map((l) => {
    // A cidade do próprio grupo entra sempre, e não só pelos polos: o painel
    // monta os polos pela base de municípios e descarta em silêncio a linha
    // cuja cidade não reconhece — inclusive a principal. Um grupo com polos
    // ficaria impossível de achar justamente pela cidade onde ele fica.
    const partes = [l.sigla, l.nome, l.instituicao, l.cidade, l.uf, NOMES_UF[l.uf]];
    (l.polos || []).forEach((p) => partes.push(p.cidade, p.uf, NOMES_UF[p.uf], p.instituicao));
    return semAcento(partes.filter(Boolean).join(' '));
  });

  // termos separados por espaço se somam: "gesep vicosa" só casa com quem tem
  // os dois, o que é o que faz a busca por cidade + sigla valer a pena
  const casaBusca = (i) => termos.every((t) => textoDoGrupo[i].indexOf(t) !== -1);

  // ---------- filtro da lista ----------
  // Atende ao clique no estado e ao clique numa cidade com mais de um grupo:
  // nesse caso a lista passa a mostrar só os grupos de lá, e cada um continua
  // abrindo o próprio detalhe.
  function filtrar(criterio) {
    filtro = criterio || null;
    aplicarLista();
  }

  function buscar(texto) {
    termoExibido = String(texto || '').trim();
    termos = semAcento(termoExibido).split(/\s+/).filter(Boolean);
    aplicarLista();
  }

  // O estado da lista é a soma dos dois: o clique no mapa recorta a região e a
  // busca recorta o texto. Um não zera o outro — buscar dentro de um estado já
  // filtrado é justamente o caso de quem sabe a região mas não a sigla.
  function aplicarLista() {
    // o clique no mapa recorta por um ponto, que pode reunir mais de uma cidade
    const noPonto = filtro && filtro.cidades
      ? { cidades: filtro.cidades,
          labs: [...new Set(filtro.cidades.flatMap((ci) => cidades[ci].labs))],
          uf: cidades[filtro.cidades[0]].uf }
      : null;
    const buscando = termos.length > 0;
    let visiveis = 0;

    itens.forEach((li) => {
      const i = Number(li.dataset.lab);
      const ufsDoItem = (li.dataset.ufs || li.dataset.uf || '').split(',');
      const naRegiao = !filtro ? true
        : noPonto ? noPonto.labs.indexOf(i) !== -1
        : ufsDoItem.indexOf(filtro.uf) !== -1;
      const mostra = naRegiao && (!buscando || casaBusca(i));
      li.hidden = !mostra;
      if (mostra) visiveis++;
    });

    pontos.forEach((p) => {
      const membros = cidadesDoPonto(p);
      const foraDaRegiao = !filtro ? false
        : noPonto ? !membros.some((ci) => noPonto.cidades.indexOf(ci) !== -1)
        : !membros.some((ci) => cidades[ci].uf === filtro.uf);
      // o ponto apaga quando nenhum grupo dele sobrou na busca: assim o mapa
      // mostra onde está o que a lista encontrou
      const foraDaBusca = buscando && !labsDoPonto(p).some((i) => casaBusca(i));
      p.classList.toggle('is-apagado', foraDaRegiao || foraDaBusca);
    });

    const ufAceso = noPonto ? noPonto.uf : (filtro ? filtro.uf : null);
    mapa.querySelectorAll('.tem-lab').forEach((p) => {
      p.classList.toggle('is-ativo', p.id === `BR-${ufAceso}`);
    });

    const regiao = !filtro ? ''
      : noPonto ? nomeDoConjunto(noPonto.cidades)
      : (NOMES_UF[filtro.uf] || filtro.uf);
    el.titulo.textContent = buscando
      ? `${regiao ? regiao + ' · ' : ''}\u201C${termoExibido}\u201D — ${plural(visiveis)}`
      : !filtro ? 'Todos os grupos'
      : noPonto ? `${regiao} — ${plural(noPonto.labs.length)}`
      : `${regiao} — ${plural(contagem[filtro.uf] || 0)}`;
    el.limpar.hidden = !filtro && !buscando;
    el.vazia.hidden = visiveis > 0;
    el.vazia.textContent = buscando
      ? 'Nenhum grupo encontrado. Tente a sigla, a instituição, a cidade ou o estado.'
      : 'Nenhum grupo neste estado.';
    if (el.buscaLimpar) el.buscaLimpar.hidden = !buscando;
    limparDestaque();
    fechar();
    lista.scrollTop = 0;
  }

  // "ver todos" desfaz tudo de uma vez: com os dois filtros somados, limpar só
  // um deixava a lista ainda recortada e parecia que o botão não funcionou
  el.limpar.addEventListener('click', () => {
    if (el.busca) el.busca.value = '';
    termoExibido = '';
    termos = [];
    filtrar(null);
  });

  if (el.busca) {
    el.busca.addEventListener('input', () => buscar(el.busca.value));
    el.busca.addEventListener('keydown', (e) => {
      // Esc limpa a busca em vez de fechar o detalhe: o campo é o que está em
      // uso. O stopPropagation é o que impede o Esc global de agir também.
      if (e.key === 'Escape' && el.busca.value) {
        e.stopPropagation();
        el.busca.value = '';
        buscar('');
      }
    });
  }
  if (el.buscaLimpar) {
    el.buscaLimpar.addEventListener('click', () => {
      el.busca.value = '';
      buscar('');
      el.busca.focus();
    });
  }

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
    const p = (foco.ponto && !foco.ponto.hidden) ? foco.ponto
      : (foco.cidades && foco.cidades.length ? pontoVisivelDaCidade(foco.cidades[0]) : null);
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
  // Vindo da lista o foco é um grupo, e todos os pontos onde ele aparece
  // acendem. Vindo do mapa o foco é o ponto — uma cidade, ou o punhado de
  // cidades vizinhas que couberam nele — e acendem os grupos de lá.
  function focarPonto(ponto) {
    const membros = cidadesDoPonto(ponto);
    foco = {
      tipo: 'ponto',
      labs: labsDoPonto(ponto),
      cidades: membros,
      local: nomeDoConjunto(membros),
      ponto
    };
    aplicarDestaque();
  }

  function focarGrupo(indice) {
    const cs = cidadesDoGrupo[indice] || [];
    const ponto = cs.length ? pontoVisivelDaCidade(cs[0]) : null;
    foco = { tipo: 'grupo', labs: [indice], cidades: cs, local: '', ponto: ponto || null };
    aplicarDestaque();
  }

  function aplicarDestaque() {
    itens.forEach((li) => {
      li.classList.toggle('is-ativo', !!foco && foco.labs.indexOf(Number(li.dataset.lab)) !== -1);
    });
    pontos.forEach((p) => {
      const aceso = !!foco && (foco.tipo === 'ponto'
        ? p === foco.ponto
        : labsDoPonto(p).some((x) => foco.labs.indexOf(x) !== -1));
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
    p.addEventListener('mouseenter', () => { focarPonto(p); desenharLinha(); });
    p.addEventListener('mouseleave', () => { if (popup.hidden) limparDestaque(); });
    p.addEventListener('click', (e) => {
      e.stopPropagation();
      const labs = labsDoPonto(p);
      if (labs.length > 1) {
        // mais de um grupo no ponto: em vez de abrir um deles por sorteio, a
        // lista passa a mostrar só esses, e a pessoa escolhe qual quer ver
        filtrar({ cidades: cidadesDoPonto(p) });
        focarPonto(p);
        desenharLinha();
        // no celular a lista fica abaixo do mapa e o filtro passaria batido
        if (window.matchMedia('(max-width: 900px)').matches) {
          lista.scrollIntoView({ block: 'nearest' });
        }
        return;
      }
      focarPonto(p);
      desenharLinha();
      const indice = labs[0];
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
  // A largura do mapa define a distância em pixels entre duas cidades, e é ela
  // que decide o agrupamento. Mudou a largura, o agrupamento precisa ser
  // refeito: sem isso, quem diminui a janela ou gira o tablet fica com o
  // agrupamento da largura anterior e os pontos voltam a se sobrepor.
  //
  // Observar a caixa do mapa pega mais casos do que ouvir o resize da janela —
  // a fonte que termina de carregar e empurra o layout, por exemplo. Um quadro
  // de espera evita refazer a conta a cada pixel do arraste da borda.
  // O adiamento é por temporizador, e não por quadro de animação: numa aba em
  // segundo plano o navegador não entrega quadros, e o recálculo ficaria preso
  // até a aba voltar à frente.
  let recalcPendente = null;
  const recalcular = () => {
    clearTimeout(recalcPendente);
    recalcPendente = setTimeout(() => {
      limitarPan();
      aplicarTransformacao();
    }, 60);
  };
  // Os dois caminhos, porque nenhum cobre tudo sozinho: o observador enxerga
  // mudanças da caixa que o evento de janela não vê (a coluna que muda de
  // largura, a fonte que termina de carregar), mas só é entregue enquanto a
  // página desenha; o evento da janela chega mesmo com a aba em segundo plano.
  // Chamar os dois é inofensivo — o recálculo é adiado e idempotente.
  window.addEventListener('resize', recalcular);
  if (window.ResizeObserver) new ResizeObserver(recalcular).observe(mapa);

  aplicarTransformacao();
})();
