// AI가 준 JSON을 너그럽게 읽기 (서버·화면 공용)
// - LaTeX 백슬래시를 이스케이프하지 않은 경우(\frac, \sqrt, \times …) 복구
// - 끝의 쉼표, 둥근 따옴표 보정

const CTRL_TO_LETTER = { '\f': 'f', '\b': 'b', '\t': 't', '\r': 'r' };

/** 수식($…$) 안에 잘못 들어간 제어문자를 백슬래시+글자로 되돌림 */
export function fixMathText(s) {
  if (typeof s !== 'string') return s;
  // 폼피드·백스페이스는 정상 글에 쓰일 일이 없으므로 어디서든 복구
  s = s.replace(/\f/g, '\\f').replace(/\x08/g, '\\b');
  return s.replace(/\$\$[\s\S]+?\$\$|\$[^$]+?\$/g, (m) =>
    m.replace(/[\t\r]/g, (c) => '\\' + CTRL_TO_LETTER[c]).replace(/\n(?=[a-zA-Z])/g, '\\n'));
}

function walk(v) {
  if (typeof v === 'string') return fixMathText(v);
  if (Array.isArray(v)) return v.map(walk);
  if (v && typeof v === 'object') { for (const k of Object.keys(v)) v[k] = walk(v[k]); return v; }
  return v;
}

/** JSON 하나를 읽고, 실패하면 흔한 실수를 고쳐 다시 시도 */
export function parseJsonLenient(chunk) {
  try { return walk(JSON.parse(chunk)); } catch (e) { /* 보정 후 재시도 */ }
  const fixed = chunk
    .replace(/[“”]/g, '"')
    .replace(/\\u(?![0-9a-fA-F]{4})/g, '\\\\u')
    .replace(/\\(?!["\\/bfnrtu])/g, '\\\\')
    .replace(/,\s*([}\]])/g, '$1');
  return walk(JSON.parse(fixed));
}

/** 문자열 안의 최상위 {...} 덩어리들을 순서대로 잘라냄(문자열 안의 괄호는 무시) */
export function splitTopLevel(s) {
  const res = [];
  let depth = 0, start = -1, inStr = false, esc = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') { inStr = true; continue; }
    if (ch === '{') { if (depth === 0) start = i; depth++; }
    else if (ch === '}') { depth--; if (depth === 0 && start >= 0) { res.push(s.slice(start, i + 1)); start = -1; } }
  }
  return res;
}

/** 글 전체에서 JSON 객체들을 찾아 읽음(코드블록·앞뒤 설명 허용) */
export function extractJsonObjects(text) {
  const t = String(text || '').replace(/^﻿/, '');
  const blocks = [];
  const fence = /```(?:json)?\s*([\s\S]*?)```/gi;
  let m;
  while ((m = fence.exec(t))) blocks.push(m[1]);
  if (!blocks.length) blocks.push(t);
  const out = [];
  for (const b of blocks) {
    for (const chunk of splitTopLevel(b)) {
      try { out.push(parseJsonLenient(chunk)); } catch (e) { /* 건너뜀 */ }
    }
  }
  return out;
}
