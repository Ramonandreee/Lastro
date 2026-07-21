import { withObs } from "../lib/log.js";
/**
 * Dados REAIS de FII via CVM (Informe Mensal FII — dados abertos) — Lastro.
 * ────────────────────────────────────────────────────────────────────
 * O brapi cobre bem AÇÕES, mas para FIIs o `priceToBook` (P/VP) quase sempre
 * vem NULO — daí FIIs sem valor patrimonial. A CVM publica o **Informe Mensal
 * FII** (patrimônio líquido, nº de cotas e valor patrimonial da cota) nos dados
 * abertos; a partir dele calculamos VP/cota REAL e, com o preço, o P/VP REAL.
 *
 * Fonte: https://dados.cvm.gov.br/dados/FII/DOC/INF_MENSAL/DADOS/
 *   inf_mensal_fii_AAAA.zip  →  contém vários CSVs (geral, ativo_passivo,
 *   complemento). Usamos o "geral" (nome do fundo → resolve CNPJ) e o
 *   "complemento" (patrimônio líquido, cotas emitidas, valor patrimonial da
 *   cota e, quando houver, vacância).
 *
 * Só é alcançável a partir do Brasil — a Vercel roda em gru1 (São Paulo).
 * Descompactamos o ZIP com zlib nativo (sem dependência), como api/documents.js.
 *
 * Mapeamento CNPJ↔ticker: o informe é por CNPJ e NÃO traz o ticker. Resolvemos
 * o CNPJ casando o `name` (nome curado do fundo, que o front já envia) contra o
 * "Nome_Fundo" do próprio informe — sem hardcode de CNPJ (nada inventado). O
 * `cnpj` também pode ser passado explicitamente para forçar. Sempre devolvemos
 * `nomeFundo` (eco do fundo que casou) para auditoria do match.
 *
 * Uso: GET /api/fii?ticker=HGLG11&name=CSHG%20Logistica[&price=150.99][&cnpj=...]
 * Resposta: { ticker, cnpj, cnpjSource, nomeFundo, dataRef, vp,
 *             patrimonioLiquido, cotasEmitidas, vacancia, pvp, source:'cvm' }
 */
import { inflateRawSync } from 'zlib';

const INF_BASE = 'https://dados.cvm.gov.br/dados/FII/DOC/INF_MENSAL/DADOS';

function normalize(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}
const onlyDigits = (s) => String(s || '').replace(/\D/g, '');

// número em formato pt-BR/en variável: "1.234.567,89", "1234567,89", "1234567.89"
function parseNum(s) {
  let t = String(s == null ? '' : s).trim();
  if (!t) return null;
  const hasComma = t.includes(',');
  const hasDot = t.includes('.');
  if (hasComma && hasDot) t = t.replace(/\./g, '').replace(',', '.'); // ponto = milhar
  else if (hasComma) t = t.replace(',', '.');                          // vírgula = decimal
  const n = Number(t);
  return isFinite(n) ? n : null;
}

// Baixa um arquivo binário. Retorna { buf, status, url, err }.
async function fetchBuf(url, ms = 25000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LastroBot/1.0)', 'Accept': '*/*' },
      signal: ctrl.signal,
    });
    if (!r.ok) return { buf: null, status: r.status, url };
    const ab = await r.arrayBuffer();
    return { buf: Buffer.from(ab), status: r.status, url };
  } catch (e) {
    return { buf: null, status: 0, url, err: String((e && e.message) || e) };
  } finally {
    clearTimeout(timer);
  }
}

// Extrai TODOS os CSVs de um ZIP (via central directory), decodifica latin1.
// Retorna [{ name, text }].
function unzipCsvs(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 22 - 65536; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) return [];
  const cdOffset = buf.readUInt32LE(eocd + 16);
  const cdCount = buf.readUInt16LE(eocd + 10);
  const out = [];
  let p = cdOffset;
  for (let n = 0; n < cdCount; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const fnLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOff = buf.readUInt32LE(p + 42);
    const name = buf.toString('latin1', p + 46, p + 46 + fnLen);
    if (/\.csv$/i.test(name)) {
      const lhFnLen = buf.readUInt16LE(localOff + 26);
      const lhExtraLen = buf.readUInt16LE(localOff + 28);
      const dataStart = localOff + 30 + lhFnLen + lhExtraLen;
      const comp = buf.subarray(dataStart, dataStart + compSize);
      try {
        const raw = method === 8 ? inflateRawSync(comp) : comp; // 8=deflate, 0=stored
        out.push({ name, text: raw.toString('latin1') });
      } catch { /* ignora CSV corrompido, segue os demais */ }
    }
    p += 46 + fnLen + extraLen + commentLen;
  }
  return out;
}

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (!lines.length) return { header: [], rows: [] };
  const header = lines[0].split(';').map((h) => h.trim());
  const rows = lines.slice(1).map((l) => l.split(';'));
  return { header, rows };
}

function colIndex(header, ...names) {
  const norm = header.map((h) => normalize(h).replace(/ /g, '_'));
  for (const n of names) {
    const i = norm.indexOf(n);
    if (i >= 0) return i;
  }
  return -1;
}

// Baixa o informe mensal do ano (ZIP → CSVs). Retorna [{name,text}] ou [].
async function fetchInforme(year, ms = 25000) {
  const url = `${INF_BASE}/inf_mensal_fii_${year}.zip`;
  const r = await fetchBuf(url, ms);
  if (!r.buf) return { csvs: [], status: r.status, url, err: r.err };
  try {
    return { csvs: unzipCsvs(r.buf), status: r.status, url };
  } catch (e) {
    return { csvs: [], status: r.status, url, err: 'unzip: ' + String((e && e.message) || e) };
  }
}

const pickCsv = (csvs, re) => (csvs.find((c) => re.test(c.name.toLowerCase())) || null);

// Resolve o CNPJ a partir do nome do fundo, casando tokens contra o "geral".
function resolveCnpjByName(geral, nameTokens) {
  if (!geral || !nameTokens.length) return null;
  const { header, rows } = parseCsv(geral.text);
  const iCnpj = colIndex(header, 'cnpj_fundo', 'cnpj_fundo_classe', 'cnpj');
  const iNome = colIndex(header, 'nome_fundo', 'denominacao_social', 'nome_fundo_classe');
  if (iCnpj < 0 || iNome < 0) return null;
  let best = null;
  for (const r of rows) {
    const nome = normalize(r[iNome]);
    if (!nome) continue;
    if (nameTokens.every((t) => nome.includes(t))) {
      const cnpj = onlyDigits(r[iCnpj]);
      if (cnpj) { best = { cnpj, nomeFundo: (r[iNome] || '').trim() }; break; }
    }
  }
  return best;
}

// Extrai patrimônio/cotas/VP/vacância do "complemento" para um CNPJ,
// pegando o registro mais recente (maior Data_Referencia, depois maior Versao).
function extractFromComplemento(comp, cnpj) {
  if (!comp) return null;
  const { header, rows } = parseCsv(comp.text);
  const iCnpj = colIndex(header, 'cnpj_fundo', 'cnpj_fundo_classe', 'cnpj');
  if (iCnpj < 0) return null;
  const iData = colIndex(header, 'data_referencia');
  const iVersao = colIndex(header, 'versao');
  const iVp = colIndex(header, 'valor_patrimonial_cotas', 'valor_patrimonial_da_cota', 'valor_patrimonial_cota');
  const iPl = colIndex(header, 'patrimonio_liquido', 'patrimonio_liquido_fundo', 'patrimonio_liquido_classe');
  const iCotas = colIndex(header, 'cotas_emitidas', 'numero_cotas', 'quantidade_cotas');
  const iVacF = colIndex(header, 'percentual_vacancia_financeira');
  const iVacI = colIndex(header, 'percentual_vacancia_fisica', 'percentual_vacancia');
  const iNome = colIndex(header, 'nome_fundo');

  let latest = null;
  for (const r of rows) {
    if (onlyDigits(r[iCnpj]) !== cnpj) continue;
    const data = iData >= 0 ? String(r[iData] || '').trim() : '';
    const ver = iVersao >= 0 ? parseNum(r[iVersao]) || 0 : 0;
    if (!latest || data > latest._data || (data === latest._data && ver >= latest._ver)) {
      latest = { _data: data, _ver: ver, row: r };
    }
  }
  if (!latest) return null;
  const r = latest.row;
  const pl = iPl >= 0 ? parseNum(r[iPl]) : null;
  const cotas = iCotas >= 0 ? parseNum(r[iCotas]) : null;
  let vp = iVp >= 0 ? parseNum(r[iVp]) : null;
  if (vp == null && pl != null && cotas) vp = Math.round((pl / cotas) * 100) / 100; // fallback PL/cotas
  const vacF = iVacF >= 0 ? parseNum(r[iVacF]) : null;
  const vacI = iVacI >= 0 ? parseNum(r[iVacI]) : null;
  return {
    dataRef: latest._data || null,
    vp: vp != null ? Math.round(vp * 100) / 100 : null,
    patrimonioLiquido: pl,
    cotasEmitidas: cotas,
    vacancia: vacF != null ? vacF : (vacI != null ? vacI : null),
    nomeFundo: iNome >= 0 ? (r[iNome] || '').trim() || null : null,
  };
}

// Extrai o registro mais recente por CNPJ de TODO o complemento (para o modo índice).
function extractAllFromComplemento(comp) {
  const map = new Map();
  if (!comp) return map;
  const { header, rows } = parseCsv(comp.text);
  const iCnpj = colIndex(header, 'cnpj_fundo', 'cnpj_fundo_classe', 'cnpj');
  if (iCnpj < 0) return map;
  const iData = colIndex(header, 'data_referencia');
  const iVersao = colIndex(header, 'versao');
  const iVp = colIndex(header, 'valor_patrimonial_cotas', 'valor_patrimonial_da_cota', 'valor_patrimonial_cota');
  const iPl = colIndex(header, 'patrimonio_liquido', 'patrimonio_liquido_fundo', 'patrimonio_liquido_classe');
  const iCotas = colIndex(header, 'cotas_emitidas', 'numero_cotas', 'quantidade_cotas');
  const iVacF = colIndex(header, 'percentual_vacancia_financeira');
  const iVacI = colIndex(header, 'percentual_vacancia_fisica', 'percentual_vacancia');
  for (const r of rows) {
    const cnpj = onlyDigits(r[iCnpj]); if (!cnpj) continue;
    const data = iData >= 0 ? String(r[iData] || '').trim() : '';
    const ver = iVersao >= 0 ? (parseNum(r[iVersao]) || 0) : 0;
    const prev = map.get(cnpj);
    if (prev && !(data > prev._data || (data === prev._data && ver >= prev._ver))) continue;
    const pl = iPl >= 0 ? parseNum(r[iPl]) : null;
    const cotas = iCotas >= 0 ? parseNum(r[iCotas]) : null;
    let vp = iVp >= 0 ? parseNum(r[iVp]) : null;
    if (vp == null && pl != null && cotas) vp = Math.round((pl / cotas) * 100) / 100;
    const vacF = iVacF >= 0 ? parseNum(r[iVacF]) : null;
    const vacI = iVacI >= 0 ? parseNum(r[iVacI]) : null;
    map.set(cnpj, { _data: data, _ver: ver, vp: vp != null ? Math.round(vp * 100) / 100 : null, vacancia: vacF != null ? vacF : (vacI != null ? vacI : null) });
  }
  return map;
}

// MODO ÍNDICE: todos os fundos do informe, compacto, para o front casar a listagem inteira.
async function handleIndex(res) {
  const year = new Date().getFullYear();
  const [cur, prev] = await Promise.all([fetchInforme(year), fetchInforme(year - 1)]);
  const at = cur.csvs.length ? cur : prev;
  if (!at.csvs.length) { res.setHeader('Cache-Control', 'no-store'); return res.status(200).json({ funds: [], note: 'informe indisponível' }); }
  const geral = pickCsv(at.csvs, /geral/) || pickCsv(at.csvs, /inf_mensal_fii_\d{4}\.csv$/);
  const comp = pickCsv(at.csvs, /complement/);
  const compMap = extractAllFromComplemento(comp);
  const funds = [];
  if (geral) {
    const { header, rows } = parseCsv(geral.text);
    const iCnpj = colIndex(header, 'cnpj_fundo', 'cnpj_fundo_classe', 'cnpj');
    const iNome = colIndex(header, 'nome_fundo', 'denominacao_social', 'nome_fundo_classe');
    if (iCnpj >= 0) {
      const seen = new Set();
      for (const r of rows) {
        const cnpj = onlyDigits(r[iCnpj]); if (!cnpj || seen.has(cnpj)) continue;
        seen.add(cnpj);
        const c = compMap.get(cnpj); if (!c || c.vp == null) continue;
        funds.push({ cnpj, nome: iNome >= 0 ? (r[iNome] || '').trim() : '', vp: c.vp, vacancia: c.vacancia, dataRef: c._data || null });
      }
    }
  }
  res.setHeader('Cache-Control', 'public, s-maxage=43200, stale-while-revalidate=86400');
  return res.status(200).json({ funds, count: funds.length, source: 'cvm' });
}

async function handler(req, res) {
  const q = req.query || {};
  if (q.index) {
    try { return await handleIndex(res); }
    catch (e) { res.setHeader('Cache-Control', 'no-store'); return res.status(200).json({ funds: [], error: String((e && e.message) || e) }); }
  }
  const ticker = String(q.ticker || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  const wantName = normalize(q.name);
  const paramCnpj = onlyDigits(q.cnpj);
  const price = parseNum(q.price);
  const nameTokens = wantName.split(' ').filter((t) => t.length >= 4).slice(0, 2);

  if (!ticker && !paramCnpj && !wantName) {
    return res.status(400).json({ error: 'informe ticker + name (ou cnpj)' });
  }

  try {
    const year = new Date().getFullYear();
    // o ZIP anual acumula todos os meses do ano; no começo do ano pode estar vazio → tenta o anterior
    const [cur, prev] = await Promise.all([fetchInforme(year), fetchInforme(year - 1)]);
    const attempts = [cur, prev];

    let resolved = null;   // { cnpj, cnpjSource, csvs }
    let diag = [];
    for (const at of attempts) {
      diag.push({ url: at.url, status: at.status, csvs: at.csvs.map((c) => c.name), err: at.err || null });
      if (!at.csvs.length) continue;
      const geral = pickCsv(at.csvs, /geral/) || pickCsv(at.csvs, /inf_mensal_fii_\d{4}\.csv$/);
      let cnpj = paramCnpj;
      let cnpjSource = paramCnpj ? 'param' : null;
      let nomeFundo = null;
      if (!cnpj) {
        const hit = resolveCnpjByName(geral, nameTokens);
        if (hit) { cnpj = hit.cnpj; cnpjSource = 'nome'; nomeFundo = hit.nomeFundo; }
      }
      if (cnpj) { resolved = { cnpj, cnpjSource, nomeFundo, csvs: at.csvs }; break; }
    }

    if (!resolved) {
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json({
        ticker, source: 'cvm', vp: null, pvp: null,
        note: 'CNPJ não resolvido (informe indisponível ou nome sem correspondência)',
        diag,
      });
    }

    const comp = pickCsv(resolved.csvs, /complement/);
    const data = extractFromComplemento(comp, resolved.cnpj);
    if (!data || data.vp == null) {
      res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=43200');
      return res.status(200).json({
        ticker, cnpj: resolved.cnpj, cnpjSource: resolved.cnpjSource,
        nomeFundo: resolved.nomeFundo, source: 'cvm', vp: null, pvp: null,
        note: 'sem valor patrimonial no complemento do informe',
      });
    }

    const pvp = (price && data.vp) ? Math.round((price / data.vp) * 100) / 100 : null;

    // dado mensal muda devagar: cacheia 12h na borda + serve obsoleto por 24h
    res.setHeader('Cache-Control', 'public, s-maxage=43200, stale-while-revalidate=86400');
    return res.status(200).json({
      ticker,
      cnpj: resolved.cnpj,
      cnpjSource: resolved.cnpjSource,
      nomeFundo: data.nomeFundo || resolved.nomeFundo || null,
      dataRef: data.dataRef,
      vp: data.vp,
      patrimonioLiquido: data.patrimonioLiquido,
      cotasEmitidas: data.cotasEmitidas,
      vacancia: data.vacancia,
      pvp,
      source: 'cvm',
    });
  } catch (e) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(502).json({ error: 'falha ao consultar CVM (informe FII)', detail: String((e && e.message) || e), vp: null, pvp: null });
  }
}

export default withObs("fii", handler);
