// AI 호출 (Claude 기본, 또는 Gemini). API 키는 Vercel 환경변수에만 둡니다.
//   GEMINI_API_KEY  또는  ANTHROPIC_API_KEY

import { extractJsonObjects } from './jsonfix.js';

export const DEFAULT_MODELS = { gemini: 'gemini-3.8-flash', claude: 'claude-sonnet-5' };

export function modelName(cfg) {
  return cfg.provider === 'claude' ? (cfg.claudeModel || DEFAULT_MODELS.claude) : (cfg.geminiModel || DEFAULT_MODELS.gemini);
}

export function keyStatus() {
  return { gemini: !!process.env.GEMINI_API_KEY, claude: !!process.env.ANTHROPIC_API_KEY, mock: !!process.env.AI_MOCK };
}

function build(item, cfg) {
  if (cfg.provider === 'claude') {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) throw new Error('Vercel 환경변수 ANTHROPIC_API_KEY가 없습니다.');
    const content = item.parts.map((x) => x.text !== undefined
      ? { type: 'text', text: x.text }
      : x.mime === 'application/pdf'
        ? { type: 'document', source: { type: 'base64', media_type: x.mime, data: x.data } }
        : { type: 'image', source: { type: 'base64', media_type: x.mime, data: x.data } });
    return {
      provider: 'claude',
      url: 'https://api.anthropic.com/v1/messages',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: {
        model: cfg.claudeModel || DEFAULT_MODELS.claude,
        max_tokens: Math.min(item.maxTokens || 8000, 16000),
        system: item.system + '\n\n출력은 JSON 객체 하나만 쓴다. 코드블록 표시(```)나 다른 말은 쓰지 않는다.',
        messages: [{ role: 'user', content }]
      }
    };
  }
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('Vercel 환경변수 GEMINI_API_KEY가 없습니다.');
  const model = cfg.geminiModel || DEFAULT_MODELS.gemini;
  const gen = { responseMimeType: 'application/json', maxOutputTokens: item.maxTokens || 8000 };
  const th = cfg.thinking || 'low';
  if (/^gemini-([3-9]|\d{2})/.test(model)) gen.thinkingConfig = { thinkingLevel: th };
  else if (/^gemini-2\.5/.test(model)) gen.thinkingConfig = { thinkingBudget: th === 'high' ? 8192 : th === 'medium' ? 2048 : 512 };
  return {
    provider: 'gemini',
    url: 'https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
    body: {
      systemInstruction: { parts: [{ text: item.system }] },
      contents: [{ role: 'user', parts: item.parts.map((x) => x.text !== undefined ? { text: x.text } : { inlineData: { mimeType: x.mime, data: x.data } }) }],
      generationConfig: gen
    }
  };
}

function parseReply(provider, code, j, raw) {
  if (code !== 200) {
    const msg = j && j.error ? (j.error.message || JSON.stringify(j.error)) : String(raw).slice(0, 300);
    return { ok: false, retry: code === 429 || code >= 500, err: `AI 오류(${code}): ${msg}` };
  }
  if (provider === 'claude') {
    if (j.stop_reason === 'max_tokens') return { ok: false, err: 'AI 출력이 너무 길어 잘렸습니다.' };
    return { ok: true, text: (j.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('') };
  }
  const cand = j.candidates && j.candidates[0];
  if (!cand) return { ok: false, err: 'AI가 응답을 거부했습니다: ' + JSON.stringify(j.promptFeedback || {}).slice(0, 200) };
  if (cand.finishReason === 'MAX_TOKENS') return { ok: false, err: 'AI 출력이 너무 길어 잘렸습니다.' };
  const text = ((cand.content && cand.content.parts) || []).filter((p) => p.text && !p.thought).map((p) => p.text).join('');
  if (!text) return { ok: false, retry: true, err: `AI 응답이 비어 있습니다(${cand.finishReason}).` };
  return { ok: true, text };
}

export function parseJson(t) {
  const list = extractJsonObjects(t);
  if (!list.length) throw new Error('JSON 없음');
  return list[0];
}

async function callOnce(item, cfg) {
  if (process.env.AI_MOCK) return { ok: true, text: JSON.stringify(mockReply(item)) };
  const r = build(item, cfg);
  let res;
  try {
    res = await fetch(r.url, { method: 'POST', headers: r.headers, body: JSON.stringify(r.body), signal: AbortSignal.timeout(270000) });
  } catch (e) {
    return { ok: false, retry: true, err: '네트워크 오류: ' + (e.name === 'TimeoutError' ? 'AI 응답 시간 초과' : e.message) };
  }
  const raw = await res.text();
  let j = null;
  try { j = JSON.parse(raw); } catch (e) { /* 무시 */ }
  return parseReply(r.provider, res.status, j, raw);
}

/** 여러 요청을 병렬로 보내고, 일시 오류는 최대 2번 재시도 */
export async function aiMany(items, cfg) {
  const out = new Array(items.length);
  let pending = items.map((_, i) => i);
  const t0 = Date.now();
  for (let attempt = 0; attempt < 3 && pending.length; attempt++) {
    if (attempt > 0 && Date.now() - t0 > 100000) break; // 서버 함수 5분 한도 안에서만 재시도
    if (attempt > 0) await new Promise((r) => setTimeout(r, attempt * 5000 + Math.random() * 3000));
    const results = await Promise.all(pending.map(async (i) => {
      const r = await callOnce(items[i], cfg);
      if (!r.ok) return [i, r];
      try { return [i, { ok: true, data: parseJson(r.text) }]; } catch (e) { return [i, { ok: false, retry: true, err: 'AI 응답 형식 오류' }]; }
    }));
    const next = [];
    for (const [i, r] of results) { out[i] = r; if (!r.ok && r.retry) next.push(i); }
    pending = next;
  }
  return out;
}

/* ---------------- 테스트용 가짜 응답 (AI_MOCK=1) ---------------- */
function mockReply(item) {
  const text = item.parts.filter((p) => p.text).map((p) => p.text).join('\n');
  if (item.system.includes('채점위원')) {
    const max = Number((text.match(/\[배점\] (\d+(?:\.\d+)?)점/) || [])[1] || 10);
    const ans = (text.match(/<학생답안>\n([\s\S]*?)\n<\/학생답안>/) || [])[1] || '';
    const ratio = Math.min(1, ans.replace(/\s/g, '').length / 400);
    const s1 = Math.round(max * 0.6 * ratio * 2) / 2, s2 = Math.round(max * 0.4 * ratio * 0.8 * 2) / 2;
    return {
      점수: s1 + s2,
      기준별: [
        { 기준: '논제 요구 과제 수행', 배점: max * 0.6, 득점: s1, 근거: '요구한 비교를 수행함' },
        { 기준: '제시문 근거 활용', 배점: max * 0.4, 득점: s2, 근거: '근거 제시가 일부 부족함' }
      ],
      잘한점: ['제시문 (가)의 핵심 주장을 정확히 파악함'],
      감점사유: [{ 내용: '(나)의 관점을 적용하지 않음', 학생답안: ans.slice(0, 30), 예시답안대조: '예시답안은 (나)의 기준으로 (가)를 평가함', 감점: 2 }],
      누락논점: ['(나)의 공동체적 관점'],
      보완방향: '(나)의 기준을 명시한 뒤 (가)의 주장을 평가하는 구조로 다시 써 보자.',
      분량평가: '분량 조건을 대체로 충족함',
      한줄평: '핵심 파악은 좋으나 평가 근거가 약함'
    };
  }
  if (item.system.includes('문제지를')) {
    return {
      대학: '가상대학교', 연도: '2026', 유형: '논술고사', 계열: '인문', 시간: 100,
      안내문: '답안은 검은색 펜으로 작성하시오.',
      제시문: '(가) 개인의 자유는 최대한 보장되어야 한다.\n\n(나) 공동체의 이익이 개인에 앞선다. 함수 $f(x)=x^2$을 생각하자.\n\n| 연도 | 비율 |\n|---|---|\n| 2020 | 30% |\n| 2021 | 35% |',
      문항: [
        { 번호: '1', 문항유형: '인문', 논제: '(가)와 (나)를 비교하시오.', 배점: 40, 분량조건: '400±40자', 최소자: 360, 최대자: 440 },
        { 번호: '2', 문항유형: '수리', 논제: '$f(2)$의 값을 구하고 그 과정을 설명하시오.', 배점: 60, 분량조건: '', 최소자: null, 최대자: null }
      ]
    };
  }
  if (item.system.includes('예시답안·해설')) {
    return {
      문항: [
        { 번호: '1', 예시답안: '(가)는 개인을, (나)는 공동체를 중시한다...', 채점기준: '- 비교 기준 제시 (20점)\n- 차이점 서술 (20점)', 해설: '비교 문항' },
        { 번호: '2', 예시답안: '$f(2)=4$', 채점기준: '[AI 작성·검토 필요]\n- 대입 (30점)\n- 계산 (30점)', 해설: '대입' }
      ],
      총평해설: '전체 총평'
    };
  }
  return { ok: true, msg: '연결 성공(테스트 모드)' };
}
