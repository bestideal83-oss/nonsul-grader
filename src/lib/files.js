// 교사가 올린 파일을 읽어 AI에 보낼 형태로 바꾼다.
//  - HWP(한글 5.x) / HWPX: 브라우저에서 바로 텍스트 추출 (수식은 [수식: ...]으로 보존)
//  - PDF / 이미지: 그대로 서버에 올려 AI가 직접 읽음
//  - TXT: 텍스트
import CFB from 'cfb';
import { inflateRaw, inflate } from 'pako';
import JSZip from 'jszip';

export function fileKind(name, type) {
  const n = String(name).toLowerCase();
  if (n.endsWith('.hwp')) return 'hwp';
  if (n.endsWith('.hwpx')) return 'hwpx';
  if (n.endsWith('.pdf') || type === 'application/pdf') return 'pdf';
  if (/\.(png|jpe?g|webp|gif)$/.test(n) || /^image\//.test(type || '')) return 'image';
  if (/\.(txt|md)$/.test(n)) return 'txt';
  return 'unknown';
}

export function imageMime(name, type) {
  if (type && type.startsWith('image/')) return type;
  const n = name.toLowerCase();
  if (n.endsWith('.png')) return 'image/png';
  if (n.endsWith('.webp')) return 'image/webp';
  if (n.endsWith('.gif')) return 'image/gif';
  return 'image/jpeg';
}

/* ======================== HWP 5.x ======================== */
const TAG_PARA_TEXT = 67;   // HWPTAG_BEGIN(16) + 51
const TAG_EQEDIT = 88;      // HWPTAG_BEGIN(16) + 72
const ONE_WCHAR = new Set([0, 10, 13, 24, 25, 26, 27, 28, 29, 30, 31]);

function u8(x) { return x instanceof Uint8Array ? x : new Uint8Array(x); }

function records(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const out = [];
  let p = 0;
  while (p + 4 <= buf.length) {
    const h = dv.getUint32(p, true); p += 4;
    const tag = h & 0x3ff;
    let size = h >>> 20;
    if (size === 0xfff) { size = dv.getUint32(p, true); p += 4; }
    out.push({ tag, data: buf.subarray(p, p + size) });
    p += size;
  }
  return out;
}

function paraText(d) {
  const dv = new DataView(d.buffer, d.byteOffset, d.byteLength);
  const n = d.length >> 1;
  let s = '';
  for (let i = 0; i < n;) {
    const c = dv.getUint16(i * 2, true);
    if (c >= 32) { s += String.fromCharCode(c); i++; continue; }
    if (ONE_WCHAR.has(c)) {
      if (c === 10) s += '\n';
      else if (c === 30 || c === 31 || c === 24) s += ' ';
      i++;
      continue;
    }
    // 8 WCHAR 크기의 인라인·확장 컨트롤
    if (c === 9) s += '\t';
    else if (i * 2 + 6 <= d.length) {
      const o = i * 2;
      const id = String.fromCharCode(d[o + 5], d[o + 4], d[o + 3], d[o + 2]);
      if (id === 'eqed') s += '\u0001';        // 수식 자리(뒤에서 채움)
      else if (id === 'tbl ') s += '[표]';
      else if (id === 'gso ') s += '[그림]';
    }
    i += 8;
  }
  return s;
}

function eqScript(d) {
  if (d.length < 6) return '';
  const dv = new DataView(d.buffer, d.byteOffset, d.byteLength);
  const len = dv.getUint16(4, true);
  let s = '';
  for (let i = 0; i < len && 6 + i * 2 + 1 < d.length; i++) s += String.fromCharCode(dv.getUint16(6 + i * 2, true));
  return s.trim();
}

function findEntry(cfb, name) {
  const i = cfb.FullPaths.findIndex((p) => p.replace(/\/$/, '').toLowerCase().endsWith('/' + name.toLowerCase()));
  return i >= 0 ? cfb.FileIndex[i] : null;
}

export function hwpToText(arrayBuffer) {
  const data = new Uint8Array(arrayBuffer);
  if (data[0] !== 0xd0 || data[1] !== 0xcf) throw new Error('한글 5.0 이상 형식의 HWP가 아닙니다. 한글에서 다시 저장하거나 PDF로 올려 주세요.');
  const cfb = CFB.read(data, { type: 'array' });
  const header = findEntry(cfb, 'FileHeader');
  if (!header) throw new Error('HWP 파일 구조를 읽지 못했습니다.');
  const h = u8(header.content);
  const flags = h[36] | (h[37] << 8) | (h[38] << 16) | (h[39] << 24);
  if (flags & 2) throw new Error('암호가 걸린 HWP입니다. 암호를 해제해 저장하거나 PDF로 올려 주세요.');
  if (flags & 4) throw new Error('배포용(복사 방지) HWP는 읽을 수 없습니다. 한글에서 PDF로 저장해 올려 주세요.');
  const compressed = !!(flags & 1);
  const paras = [];
  const eqs = [];
  for (let i = 0; ; i++) {
    const sec = findEntry(cfb, 'Section' + i);
    if (!sec) break;
    let buf = u8(sec.content);
    if (compressed) {
      try { buf = inflateRaw(buf); } catch (e) { buf = inflate(buf); }
    }
    for (const r of records(buf)) {
      if (r.tag === TAG_PARA_TEXT) paras.push(paraText(r.data));
      else if (r.tag === TAG_EQEDIT) eqs.push(eqScript(r.data));
    }
  }
  if (!paras.length) throw new Error('본문을 찾지 못했습니다.');
  let k = 0;
  const text = paras.join('\n').replace(/\u0001/g, () => {
    const e = eqs[k++];
    return e ? ` [수식: ${e}] ` : ' [수식] ';
  });
  return tidy(text);
}

/* ======================== HWPX ======================== */
export async function hwpxToText(arrayBuffer) {
  const zip = await JSZip.loadAsync(arrayBuffer);
  const names = Object.keys(zip.files)
    .filter((n) => /contents\/section\d+\.xml$/i.test(n))
    .sort((a, b) => Number(a.match(/(\d+)\.xml$/i)[1]) - Number(b.match(/(\d+)\.xml$/i)[1]));
  if (!names.length) throw new Error('HWPX 본문을 찾지 못했습니다.');
  let out = '';
  const walk = (node) => {
    for (const ch of node.childNodes) {
      if (ch.nodeType === 3) continue;
      if (ch.nodeType !== 1) continue;
      const tag = ch.localName;
      if (tag === 't') {
        for (const x of ch.childNodes) {
          if (x.nodeType === 3) out += x.nodeValue;
          else if (x.localName === 'tab') out += '\t';
          else if (x.localName === 'lineBreak') out += '\n';
        }
      } else if (tag === 'equation') {
        const sc = Array.from(ch.getElementsByTagNameNS('*', 'script'))[0];
        out += sc ? ` [수식: ${sc.textContent.trim()}] ` : ' [수식] ';
      } else if (tag === 'pic') {
        out += '[그림]';
      } else if (tag === 'tbl') {
        out += '[표]\n';
        walk(ch);
      } else if (tag === 'p') {
        walk(ch);
        out += '\n';
      } else if (tag === 'lineBreak') {
        out += '\n';
      } else {
        walk(ch);
      }
    }
  };
  for (const n of names) {
    const xml = await zip.file(n).async('string');
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    walk(doc.documentElement);
  }
  return tidy(out);
}

function tidy(s) {
  return s.replace(/\r/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** 파일 하나를 읽어 {kind:'text', text} 또는 {kind:'pdf'|'image', mime} 로 */
export async function readForAI(file) {
  const k = fileKind(file.name, file.type);
  if (k === 'hwp') return { kind: 'text', text: hwpToText(await file.arrayBuffer()) };
  if (k === 'hwpx') return { kind: 'text', text: await hwpxToText(await file.arrayBuffer()) };
  if (k === 'txt') return { kind: 'text', text: await file.text() };
  if (k === 'pdf') return { kind: 'pdf', mime: 'application/pdf' };
  if (k === 'image') return { kind: 'image', mime: imageMime(file.name, file.type) };
  throw new Error('지원하지 않는 파일 형식입니다: ' + file.name + ' (HWP, HWPX, PDF, 이미지, TXT)');
}
