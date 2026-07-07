/**
 * Abre um documento da CVM como ARQUIVO (PDF inline) — Lastro.
 * ────────────────────────────────────────────────────────────────────
 * O link de download da CVM entrega um ZIP (com o PDF dentro). Este proxy
 * baixa o ZIP, extrai o PDF e o devolve como application/pdf inline — assim
 * o navegador abre o documento puro (como um arquivo baixado), sem a moldura
 * do site da CVM. Se não houver PDF, redireciona para o visualizador oficial.
 *
 * Uso: GET /api/document?u=<URL de download da CVM, URL-encoded>
 * SSRF-guard: só aceita URLs de www.rad.cvm.gov.br.
 */
import { inflateRawSync } from 'zlib';

function viewerFallback(u) {
  const m = String(u || '').match(/numProtocolo=(\d+)/i);
  return m ? `https://www.rad.cvm.gov.br/ENET/frmExibirArquivoIPEExterno.aspx?NumeroProtocoloEntrega=${m[1]}` : u;
}

// Extrai o primeiro arquivo cujo nome casa `test` de um ZIP (via central directory).
function unzipFind(buf, test) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 22 - 65536; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) return null;
  const cdOffset = buf.readUInt32LE(eocd + 16);
  const cdCount = buf.readUInt16LE(eocd + 10);
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
    if (test(name)) {
      const lhFnLen = buf.readUInt16LE(localOff + 26);
      const lhExtraLen = buf.readUInt16LE(localOff + 28);
      const dataStart = localOff + 30 + lhFnLen + lhExtraLen;
      const comp = buf.subarray(dataStart, dataStart + compSize);
      const raw = method === 8 ? inflateRawSync(comp) : comp;
      return { name, bytes: raw };
    }
    p += 46 + fnLen + extraLen + commentLen;
  }
  return null;
}

export default async function handler(req, res) {
  const u = String((req.query || {}).u || '');
  if (!/^https:\/\/www\.rad\.cvm\.gov\.br\//i.test(u)) {
    return res.status(400).json({ error: 'URL inválida' });
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 25000);
  try {
    const r = await fetch(u, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LastroBot/1.0)', 'Accept': '*/*' }, signal: ctrl.signal });
    if (!r.ok) { res.writeHead(302, { Location: viewerFallback(u) }); return res.end(); }
    const buf = Buffer.from(await r.arrayBuffer());

    let pdf = null;
    if (buf.slice(0, 4).toString('latin1') === '%PDF') {
      pdf = buf;                                   // já é PDF
    } else if (buf[0] === 0x50 && buf[1] === 0x4b) {
      const found = unzipFind(buf, (n) => /\.pdf$/i.test(n)); // ZIP → acha o PDF
      if (found) pdf = found.bytes;
    }

    if (pdf) {
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'inline; filename="documento.pdf"');
      res.setHeader('Cache-Control', 'public, s-maxage=86400, stale-while-revalidate=604800');
      return res.status(200).send(pdf);
    }
    // sem PDF (ex.: planilha, imagem, múltiplos arquivos) → visualizador oficial
    res.writeHead(302, { Location: viewerFallback(u) });
    return res.end();
  } catch (e) {
    res.writeHead(302, { Location: viewerFallback(u) });
    return res.end();
  } finally {
    clearTimeout(timer);
  }
}
