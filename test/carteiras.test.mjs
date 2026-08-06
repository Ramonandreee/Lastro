/**
 * Validador de /data/carteiras.json — Fase 1 da SPEC-carteiras-instituicoes (§1.2/§1.3).
 *
 * CONTRATO CENTRAL (o que derrubou a feature anterior): o ÚNICO dado externo
 * permitido no arquivo é a COMPOSIÇÃO PUBLICADA (instituição, nome, competência,
 * data, fonte e {ticker, peso}). Qualquer campo de rentabilidade, DY, volatilidade,
 * risco, nota, recomendação, preço-alvo etc. — em QUALQUER nível de aninhamento —
 * quebra o CI de propósito.
 *
 * Reusa `vendor/instport.js` (módulo puro, já testado em test/instport.test.mjs)
 * para procedência, soma dos pesos e ticker duplicado. O vendor fala
 * {instituicao, itens:[…]}; o JSON fala {inst, ativos:[…]} — o adaptador `paraIP`
 * abaixo traduz. NÃO alterar o vendor por causa disto.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const IP = require('../vendor/instport.js');

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ARQUIVO = join(ROOT, 'data', 'carteiras.json');
const SPEC = 'docs/SPEC-carteiras-instituicoes.md §1.2';

/* ─────────────────────────── tabelas da spec ─────────────────────────── */

const TIPOS = ['acoes', 'fiis', 'dividendos', 'small-caps', 'bdrs', 'mista'];
const FONTE_TIPOS = ['pdf', 'pagina', 'video'];

const OBRIGATORIOS = [
  'id', 'serieId', 'inst', 'instSlug', 'nome', 'tipo', 'competencia',
  'publicadoEm', 'fonteUrl', 'fonteTitulo', 'fonteTipo', 'acessoLivre',
  'coletadoPor', 'coletadoEm',
];

/** Lista negra da §1.3 — nenhum destes pode existir como chave, em nenhum nível. */
const PROIBIDOS = [
  'ret', 'retorno', 'rent', 'dy', 'yield', 'vol', 'volatilidade',
  'risco', 'score', 'nota', 'recomendacao', 'alvo', 'preco',
];

const RE_B3 = /^[A-Z]{4}\d{1,2}$/;
const RE_US = /^[A-Z.]{1,5}$/;

/** Lê os ids de cripto direto de lib/history.js (fonte única, o módulo não os exporta). */
function criptoIds() {
  const src = readFileSync(join(ROOT, 'lib', 'history.js'), 'utf8');
  const bloco = src.match(/const COINGECKO_IDS\s*=\s*\{([\s\S]*?)\}\s*;/);
  if (!bloco) return new Set();
  return new Set([...bloco[1].matchAll(/([A-Z0-9]+)\s*:/g)].map((m) => m[1]));
}
const CRIPTO = criptoIds();

/* ─────────────────────────────── helpers ─────────────────────────────── */

/** minúscula sem acento — pega `recomendação`, `Volatilidade`, `NOTA`… */
const chave = (k) => String(k).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

const vazio = (v) => v === undefined || v === null || (typeof v === 'string' && !v.trim());

const RE_YMD = /^\d{4}-\d{2}-\d{2}$/;
const RE_YM = /^\d{4}-(0[1-9]|1[0-2])$/;
const RE_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

/** ms do dia YYYY-MM-DD, ou null se a data não existe de verdade (ex.: 2026-02-30). */
function diaMs(s) {
  if (!RE_YMD.test(String(s))) return null;
  const ms = Date.parse(`${s}T00:00:00Z`);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString().slice(0, 10) === s ? ms : null;
}

const DIA = 86400000;

/** Adaptador JSON → contrato do vendor (instport). Não muda o vendor. */
export function paraIP(c) {
  return {
    instituicao: c && c.inst,
    nome: c && c.nome,
    competencia: c && c.competencia,
    publicadoEm: c && c.publicadoEm,
    fonteUrl: c && c.fonteUrl,
    itens: c && Array.isArray(c.ativos) ? c.ativos : [],
  };
}

/** Caminha o objeto inteiro procurando chave da lista negra. */
function chavesProibidas(valor, caminho, achados) {
  if (!valor || typeof valor !== 'object') return achados;
  if (Array.isArray(valor)) {
    valor.forEach((v, i) => chavesProibidas(v, `${caminho}[${i}]`, achados));
    return achados;
  }
  for (const k of Object.keys(valor)) {
    if (PROIBIDOS.includes(chave(k))) achados.push(`${caminho}.${k}`);
    chavesProibidas(valor[k], `${caminho}.${k}`, achados);
  }
  return achados;
}

/**
 * A lista negra acima olha NOMES de campo. Isso não basta: `obs`/`nome`/`fonteTitulo`
 * são texto livre e vão à tela verbatim, então uma frase como
 * "acumula +32% em 12 meses, vs +11% do IBOV" passaria no CI e publicaria um número
 * de rentabilidade de origem não verificada — exatamente o que aposentou a feature
 * anterior. Aqui o CONTEÚDO também é barrado.
 */
const CAMPOS_TEXTO = ['nome', 'fonteTitulo', 'obs'];
const RX_PERCENTUAL = /\d+([.,]\d+)?\s*%/;
const RX_DESEMPENHO = /\b(retorno|rentabilidade|rendeu|rendimento|valoriza\w*|desempenho|yield|dy|vol(atilidade)?|cdi|ibov(espa)?|ifix)\b/i;

function textoProibido(c, caminho, achados) {
  for (const campo of CAMPOS_TEXTO) {
    const v = c && c[campo];
    if (typeof v !== 'string' || !v) continue;
    if (RX_PERCENTUAL.test(v)) achados.push(`${caminho}.${campo}: contém percentual ("${v}")`);
    else if (RX_DESEMPENHO.test(v)) achados.push(`${caminho}.${campo}: fala de desempenho ("${v}")`);
  }
  return achados;
}

/* ───────────────────────────── o validador ───────────────────────────── */

/**
 * @param {object} doc  conteúdo de carteiras.json já parseado
 * @param {Date}   hoje referência de "não futura" (injetável para o teste ser determinístico)
 * @returns {string[]} problemas (vazio = arquivo válido)
 */
export function validarArquivo(doc, hoje = new Date()) {
  const e = [];
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return ['raiz: o arquivo deve ser um objeto'];

  if (doc.version !== 1) e.push(`raiz.version: esperado 1, veio ${JSON.stringify(doc.version)}`);
  if (diaMs(doc.updatedAt) === null) e.push('raiz.updatedAt: data inválida (esperado YYYY-MM-DD)');
  else if (diaMs(doc.updatedAt) > hoje.getTime()) e.push('raiz.updatedAt: data no futuro');
  if (!Array.isArray(doc.carteiras)) return e.concat('raiz.carteiras: deve ser um array');

  // lista negra: varre o documento inteiro de uma vez (pega campo solto na raiz também)
  const proibidas = chavesProibidas(doc, 'raiz', []);
  for (const p of proibidas) {
    e.push(
      `${p}: campo proibido pela lista negra (${PROIBIDOS.join(', ')}). ` +
      `Nenhum número de retorno, DY, volatilidade, risco, nota, recomendação ou preço ` +
      `pode entrar em /data/carteiras.json — ver ${SPEC}. Esses valores são DERIVADOS ` +
      `de dado real pelo app, nunca transcritos.`,
    );
  }

  const ids = new Map();

  doc.carteiras.forEach((c, i) => {
    const rot = `carteiras[${i}]${c && c.id ? ` (${c.id})` : ''}`;
    if (!c || typeof c !== 'object' || Array.isArray(c)) { e.push(`${rot}: deve ser um objeto`); return; }

    // 0. texto livre não pode carregar número/afirmação de desempenho (vai à tela verbatim)
    for (const p of textoProibido(c, rot, [])) {
      e.push(`${p}. Texto livre não pode trazer rentabilidade, percentual nem comparação com ` +
        `benchmark: esses números são DERIVADOS de dado real pelo app, nunca transcritos — ver ${SPEC}.`);
    }

    // 1. campos obrigatórios
    for (const f of OBRIGATORIOS) {
      if (f === 'acessoLivre') { if (typeof c.acessoLivre !== 'boolean') e.push(`${rot}.acessoLivre: obrigatório (booleano)`); continue; }
      if (vazio(c[f])) e.push(`${rot}.${f}: obrigatório e não vazio`);
    }
    if (!Array.isArray(c.ativos) || !c.ativos.length) e.push(`${rot}.ativos: obrigatório, ao menos 1 ativo`);
    if (c.pesoUniforme !== undefined && typeof c.pesoUniforme !== 'boolean') e.push(`${rot}.pesoUniforme: se presente, booleano`);

    // 2. id único global
    if (!vazio(c.id)) {
      if (ids.has(c.id)) e.push(`${rot}.id: duplicado (já usado em carteiras[${ids.get(c.id)}])`);
      else ids.set(c.id, i);
    }

    // 3. enums
    if (!vazio(c.tipo) && !TIPOS.includes(c.tipo)) e.push(`${rot}.tipo: "${c.tipo}" fora de ${TIPOS.join('|')}`);
    if (!vazio(c.fonteTipo) && !FONTE_TIPOS.includes(c.fonteTipo)) e.push(`${rot}.fonteTipo: "${c.fonteTipo}" fora de ${FONTE_TIPOS.join('|')}`);

    // 4. procedência + soma dos pesos + ticker repetido → vendor/instport.js
    IP.validar(paraIP(c)).forEach((p) => e.push(`${rot}: ${p}`));

    // 5. peso individual (o vendor descarta silenciosamente os inválidos; aqui é erro)
    if (Array.isArray(c.ativos)) {
      c.ativos.forEach((a, j) => {
        const r = `${rot}.ativos[${j}]`;
        if (!a || typeof a !== 'object') { e.push(`${r}: deve ser um objeto {tk, peso}`); return; }
        if (typeof a.peso !== 'number' || !Number.isFinite(a.peso) || a.peso <= 0 || a.peso > 100) {
          e.push(`${r}.peso: esperado número entre 0 (exclusivo) e 100, veio ${JSON.stringify(a.peso)}`);
        }
        // 6. formato do ticker
        const tk = typeof a.tk === 'string' ? a.tk.trim() : '';
        if (!tk) { e.push(`${r}.tk: obrigatório`); return; }
        if (tk !== tk.toUpperCase()) e.push(`${r}.tk: "${tk}" deve estar em MAIÚSCULAS`);
        const T = tk.toUpperCase();
        if (!(RE_B3.test(T) || CRIPTO.has(T) || RE_US.test(T))) {
          e.push(`${r}.tk: "${tk}" fora dos formatos aceitos (B3 XXXX9/XXXX99, EUA até 5 letras, ou cripto de COINGECKO_IDS)`);
        }
      });
    }

    // 7. datas válidas e não futuras
    const hojeMs = hoje.getTime();
    if (!RE_YM.test(String(c.competencia || ''))) e.push(`${rot}.competencia: esperado YYYY-MM, veio ${JSON.stringify(c.competencia)}`);
    const pub = diaMs(c.publicadoEm);
    if (pub === null) e.push(`${rot}.publicadoEm: data inválida (esperado YYYY-MM-DD)`);
    else if (pub > hojeMs) e.push(`${rot}.publicadoEm: data no futuro (${c.publicadoEm})`);

    if (!RE_ISO.test(String(c.coletadoEm || ''))) {
      e.push(`${rot}.coletadoEm: esperado YYYY-MM-DDTHH:mm:ssZ, veio ${JSON.stringify(c.coletadoEm)}`);
    } else if (Date.parse(c.coletadoEm) > hojeMs) {
      e.push(`${rot}.coletadoEm: data no futuro (${c.coletadoEm})`);
    }

    // 8. coerência publicadoEm × competencia: [1º dia da competência − 15d, +75d]
    if (pub !== null && RE_YM.test(String(c.competencia || ''))) {
      const base = Date.parse(`${c.competencia}-01T00:00:00Z`);
      if (pub < base - 15 * DIA || pub > base + 75 * DIA) {
        e.push(`${rot}: publicadoEm (${c.publicadoEm}) incoerente com competencia (${c.competencia}) — esperado entre 15 dias antes e 75 dias depois do 1º dia da competência`);
      }
    }

    // 9. fonteUrl https com host
    const url = String(c.fonteUrl || '');
    if (url) {
      let host = '';
      try { const u = new URL(url); host = u.protocol === 'https:' ? u.hostname : ''; } catch { host = ''; }
      if (!host) e.push(`${rot}.fonteUrl: precisa ser https:// com domínio válido, veio "${url}"`);
    }
  });

  return e;
}

/* ─────────────────────── carteira sintética de apoio ────────────────────
 * Tickers FICTÍCIOS de teste (AAAA3/BBBB3/CCCC11). Nunca usar ticker real aqui:
 * este arquivo não é fonte de dado de produto.                              */
const HOJE = new Date('2026-08-05T12:00:00Z');

const CART = {
  id: 'inst-x-carteira-teste-2026-08',
  serieId: 'inst-x-carteira-teste',
  inst: 'Instituição X',
  instSlug: 'inst-x',
  nome: 'Carteira Teste',
  tipo: 'acoes',
  competencia: '2026-08',
  publicadoEm: '2026-08-01',
  fonteUrl: 'https://exemplo.com/relatorio',
  fonteTitulo: 'Relatório de agosto',
  fonteTipo: 'pdf',
  acessoLivre: true,
  moeda: 'BRL',
  pesoUniforme: false,
  ativos: [{ tk: 'AAAA3', peso: 50 }, { tk: 'BBBB3', peso: 30 }, { tk: 'CCCC11', peso: 20 }],
  obs: '',
  coletadoPor: 'teste',
  coletadoEm: '2026-08-02T10:00:00Z',
};

const doc = (...carteiras) => ({ version: 1, updatedAt: '2026-08-05', carteiras });
/** clone profundo + patch raso da carteira */
const com = (patch) => doc({ ...structuredClone(CART), ...patch });
/** primeiro erro que menciona `trecho` (ajuda a mensagem de falha do assert) */
const temErro = (errs, trecho) => errs.some((x) => x.includes(trecho));

/* ───────────────────────── o arquivo de verdade ─────────────────────── */

test('/data/carteiras.json existe, é JSON válido e passa no validador', () => {
  const raw = readFileSync(ARQUIVO, 'utf8');
  const j = JSON.parse(raw);
  assert.equal(j.version, 1);
  assert.ok(Array.isArray(j.carteiras));
  assert.deepEqual(validarArquivo(j), [], 'validarArquivo apontou problemas no arquivo real');
});

test('arquivo com zero carteiras é válido (estado inicial da Fase 1)', () => {
  assert.deepEqual(validarArquivo({ version: 1, updatedAt: '2026-08-05', carteiras: [] }, HOJE), []);
});

test('/data não pode estar em .vercelignore nem em .gitignore (senão o JSON não vai ao ar)', () => {
  for (const f of ['.vercelignore', '.gitignore']) {
    const linhas = readFileSync(join(ROOT, f), 'utf8')
      .split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
    assert.ok(!linhas.some((l) => /^\/?data\/?$/.test(l)), `${f} está ignorando /data`);
  }
});

/* ───────────────────── raiz e carteira de referência ────────────────── */

test('carteira de referência completa passa', () => {
  assert.deepEqual(validarArquivo(doc(CART), HOJE), []);
});

test('raiz: version diferente de 1 falha', () => {
  assert.ok(temErro(validarArquivo({ ...doc(), version: 2 }, HOJE), 'raiz.version'));
});

test('raiz: updatedAt inválido falha', () => {
  assert.ok(temErro(validarArquivo({ ...doc(), updatedAt: '05/08/2026' }, HOJE), 'raiz.updatedAt'));
});

test('raiz: carteiras que não é array falha', () => {
  assert.ok(temErro(validarArquivo({ version: 1, updatedAt: '2026-08-05', carteiras: {} }, HOJE), 'raiz.carteiras'));
});

/* ───────────────────────── campos obrigatórios ──────────────────────── */

for (const f of OBRIGATORIOS) {
  test(`campo obrigatório ausente falha: ${f}`, () => {
    const c = structuredClone(CART); delete c[f];
    assert.ok(validarArquivo(doc(c), HOJE).length > 0, `faltando ${f} deveria falhar`);
  });
}

test('campo obrigatório vazio (string em branco) falha', () => {
  assert.ok(temErro(validarArquivo(com({ fonteTitulo: '   ' }), HOJE), 'fonteTitulo'));
});

test('sem ativos falha', () => {
  assert.ok(temErro(validarArquivo(com({ ativos: [] }), HOJE), 'ativos'));
});

test('acessoLivre não-booleano falha', () => {
  assert.ok(temErro(validarArquivo(com({ acessoLivre: 'sim' }), HOJE), 'acessoLivre'));
});

test('tipo fora do enum falha', () => {
  assert.ok(temErro(validarArquivo(com({ tipo: 'cripto' }), HOJE), '.tipo'));
});

test('fonteTipo fora do enum falha', () => {
  assert.ok(temErro(validarArquivo(com({ fonteTipo: 'planilha' }), HOJE), '.fonteTipo'));
});

/* ──────────────────────────── id único global ───────────────────────── */

test('id duplicado entre carteiras falha', () => {
  const a = structuredClone(CART);
  const b = { ...structuredClone(CART), serieId: 'inst-y-outra' };   // mesmo id, outra carteira
  assert.ok(temErro(validarArquivo(doc(a, b), HOJE), 'duplicado'));
});

test('ids distintos na mesma série passam (competências diferentes)', () => {
  const jul = {
    ...structuredClone(CART),
    id: 'inst-x-carteira-teste-2026-07', competencia: '2026-07',
    publicadoEm: '2026-07-01', coletadoEm: '2026-07-02T10:00:00Z',
  };
  assert.deepEqual(validarArquivo(doc(jul, CART), HOJE), []);
});

/* ────────────────── lista negra (qualquer nível de aninhamento) ─────── */

const CITA_SPEC = 'SPEC-carteiras-instituicoes';

for (const campo of PROIBIDOS) {
  test(`lista negra: "${campo}" na carteira falha citando a spec`, () => {
    const errs = validarArquivo(com({ [campo]: 1 }), HOJE);
    assert.ok(temErro(errs, 'lista negra'), `"${campo}" deveria ser rejeitado`);
    assert.ok(temErro(errs, CITA_SPEC), 'a mensagem precisa citar a spec');
  });
}

test('lista negra pega campo dentro de ativos[] (2º nível)', () => {
  const c = structuredClone(CART);
  c.ativos[0].preco = 31.4;
  assert.ok(temErro(validarArquivo(doc(c), HOJE), 'lista negra'));
});

test('lista negra pega campo em objeto aninhado arbitrário (3º nível)', () => {
  const c = structuredClone(CART);
  c.extra = { meta: { detalhe: { volatilidade: 0.2 } } };
  const errs = validarArquivo(doc(c), HOJE);
  assert.ok(temErro(errs, 'lista negra'));
  assert.ok(temErro(errs, 'volatilidade'));
});

test('lista negra pega campo na raiz do arquivo, fora de carteiras[]', () => {
  assert.ok(temErro(validarArquivo({ ...doc(CART), score: 10 }, HOJE), 'lista negra'));
});

test('lista negra ignora acento e caixa (recomendação/RET/Nota)', () => {
  assert.ok(temErro(validarArquivo(com({ 'recomendação': 'compra' }), HOJE), 'lista negra'));
  assert.ok(temErro(validarArquivo(com({ RET: 12 }), HOJE), 'lista negra'));
  assert.ok(temErro(validarArquivo(com({ Nota: 'A' }), HOJE), 'lista negra'));
});

test('lista negra não pega campos legítimos parecidos (nome, peso, pesoUniforme)', () => {
  assert.deepEqual(validarArquivo(com({ nome: 'Carteira Nota 10' }), HOJE), []);
});

/* ── texto livre: a lista negra olha CHAVES; estes olham o CONTEÚDO ──────
   `obs`/`nome`/`fonteTitulo` vão à tela verbatim. Sem isto, uma frase com
   rentabilidade passaria no CI e publicaria número de origem não verificada. */

test('obs com percentual falha (número de rentabilidade por texto livre)', () => {
  const errs = validarArquivo(com({ obs: 'a carteira acumula +32% em 12 meses' }), HOJE);
  assert.ok(temErro(errs, 'percentual'));
});

test('obs comparando com benchmark falha mesmo sem percentual', () => {
  assert.ok(temErro(validarArquivo(com({ obs: 'rendeu acima do IBOV no período' }), HOJE), 'desempenho'));
  assert.ok(temErro(validarArquivo(com({ obs: 'foco em dividend yield alto' }), HOJE), 'desempenho'));
});

test('nome e fonteTitulo também são barrados', () => {
  assert.ok(temErro(validarArquivo(com({ nome: 'Carteira 10% ao ano' }), HOJE), 'percentual'));
  assert.ok(temErro(validarArquivo(com({ fonteTitulo: 'Relatório: a carteira que rendeu mais' }), HOJE), 'desempenho'));
});

test('obs legítima (atribuição/ressalva) continua passando', () => {
  assert.deepEqual(validarArquivo(com({ obs: 'A fonte publica pesos iguais entre os ativos.' }), HOJE), []);
  assert.deepEqual(validarArquivo(com({ obs: 'Houve troca de um ativo na competência anterior.' }), HOJE), []);
});

/* ────────────────────── pesos (via vendor) e tickers ────────────────── */

test('soma dos pesos fora de 100% falha (checagem do instport)', () => {
  const errs = validarArquivo(com({ ativos: [{ tk: 'AAAA3', peso: 40 }, { tk: 'BBBB3', peso: 30 }] }), HOJE);
  assert.ok(temErro(errs, 'soma dos pesos'));
});

test('arredondamento de 1 casa do relatório é tolerado (99,9%)', () => {
  const ativos = [{ tk: 'AAAA3', peso: 33.3 }, { tk: 'BBBB3', peso: 33.3 }, { tk: 'CCCC11', peso: 33.3 }];
  assert.deepEqual(validarArquivo(com({ ativos }), HOJE), []);
});

test('peso zero ou negativo falha', () => {
  assert.ok(temErro(validarArquivo(com({ ativos: [{ tk: 'AAAA3', peso: 100 }, { tk: 'BBBB3', peso: 0 }] }), HOJE), '.peso'));
  assert.ok(temErro(validarArquivo(com({ ativos: [{ tk: 'AAAA3', peso: 110 }, { tk: 'BBBB3', peso: -10 }] }), HOJE), '.peso'));
});

test('peso acima de 100 falha', () => {
  assert.ok(temErro(validarArquivo(com({ ativos: [{ tk: 'AAAA3', peso: 100.5 }] }), HOJE), '.peso'));
});

test('ticker duplicado dentro da carteira falha (checagem do instport)', () => {
  const errs = validarArquivo(com({ ativos: [{ tk: 'AAAA3', peso: 50 }, { tk: 'AAAA3', peso: 50 }] }), HOJE);
  assert.ok(temErro(errs, 'repetido'));
});

test('formato de ticker: B3, EUA e cripto conhecidos passam', () => {
  const ativos = [{ tk: 'AAAA3', peso: 25 }, { tk: 'CCCC11', peso: 25 }, { tk: 'MSFT', peso: 25 }, { tk: 'BTC', peso: 25 }];
  assert.deepEqual(validarArquivo(com({ ativos }), HOJE), []);
});

test('formato de ticker inválido falha', () => {
  for (const tk of ['AA3', 'AAAA123', 'AAA3.SA', 'AAA-3', 'TICKERLONGO']) {
    assert.ok(temErro(validarArquivo(com({ ativos: [{ tk, peso: 100 }] }), HOJE), 'fora dos formatos'), `"${tk}" deveria falhar`);
  }
});

test('ticker minúsculo falha (o arquivo é a fonte, não normaliza)', () => {
  assert.ok(temErro(validarArquivo(com({ ativos: [{ tk: 'aaaa3', peso: 100 }] }), HOJE), 'MAIÚSCULAS'));
});

test('cripto fora da lista COINGECKO_IDS falha', () => {
  assert.ok(CRIPTO.has('BTC') && CRIPTO.size > 5, 'lista de cripto não foi lida de lib/history.js');
  assert.ok(temErro(validarArquivo(com({ ativos: [{ tk: 'MOEDAX', peso: 100 }] }), HOJE), 'fora dos formatos'));
});

/* ──────────────────────────────── datas ─────────────────────────────── */

test('competencia fora do formato YYYY-MM falha', () => {
  for (const v of ['2026-8', 'ago/2026', '2026-13', '2026-08-01']) {
    assert.ok(temErro(validarArquivo(com({ competencia: v }), HOJE), '.competencia'), `"${v}" deveria falhar`);
  }
});

test('publicadoEm inválido falha', () => {
  for (const v of ['01/08/2026', '2026-02-30', '2026-8-1']) {
    assert.ok(temErro(validarArquivo(com({ publicadoEm: v }), HOJE), '.publicadoEm'), `"${v}" deveria falhar`);
  }
});

test('publicadoEm no futuro falha', () => {
  const errs = validarArquivo(com({ competencia: '2026-09', publicadoEm: '2026-09-01', coletadoEm: '2026-08-02T10:00:00Z' }), HOJE);
  assert.ok(temErro(errs, 'no futuro'));
});

test('coletadoEm sem formato ISO-UTC falha; no futuro também', () => {
  assert.ok(temErro(validarArquivo(com({ coletadoEm: '2026-08-02' }), HOJE), '.coletadoEm'));
  assert.ok(temErro(validarArquivo(com({ coletadoEm: '2026-09-02T10:00:00Z' }), HOJE), 'no futuro'));
});

/* ──────────────── coerência publicadoEm × competencia ───────────────── */

test('publicadoEm até 15 dias antes do 1º dia da competência passa', () => {
  const c = { competencia: '2026-08', publicadoEm: '2026-07-25', coletadoEm: '2026-07-26T10:00:00Z' };
  assert.deepEqual(validarArquivo(com(c), HOJE), []);
});

test('publicadoEm muito antes da competência falha', () => {
  const c = { competencia: '2026-08', publicadoEm: '2026-06-01', coletadoEm: '2026-06-02T10:00:00Z' };
  assert.ok(temErro(validarArquivo(com(c), HOJE), 'incoerente'));
});

test('publicadoEm muito depois da competência falha (>75 dias)', () => {
  const c = { competencia: '2026-04', publicadoEm: '2026-07-30', coletadoEm: '2026-07-31T10:00:00Z' };
  assert.ok(temErro(validarArquivo(com(c), HOJE), 'incoerente'));
});

/* ─────────────────────────────── fonteUrl ───────────────────────────── */

test('fonteUrl http (sem TLS) falha', () => {
  assert.ok(temErro(validarArquivo(com({ fonteUrl: 'http://exemplo.com/rel' }), HOJE), '.fonteUrl'));
});

test('fonteUrl sem host ou malformada falha', () => {
  for (const v of ['https://', 'exemplo.com/rel', 'javascript:alert(1)']) {
    assert.ok(validarArquivo(com({ fonteUrl: v }), HOJE).length > 0, `"${v}" deveria falhar`);
  }
});
