// Claude 대화창과 파일로 주고받기: 요청 파일 만들기 · 결과(JSON) 읽기
import {
  GRADE_FILE_GUIDE, GRADE_FILE_FORMAT, gradeFileOutputExample,
  EXAM_FILE_GUIDE, EXAM_FILE_FORMAT, EXAM_FILE_EXAMPLE
} from '../../server/prompts.js';
import { countChars } from './util.js';
import { extractJsonObjects } from '../../server/jsonfix.js';

export function downloadText(name, text, type = 'text/markdown;charset=utf-8') {
  const blob = text instanceof Blob ? text : new Blob(['﻿' + text], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

export function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
}

export const safeName = (s) => String(s || '').replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 60);

/** Claude가 준 글(또는 .json 파일)에서 JSON을 찾아 읽는다. 코드블록·앞뒤 설명·LaTeX 백슬래시 실수 허용 */
export function parseLooseJson(text) {
  const out = extractJsonObjects(text);
  if (!out.length) throw new Error('JSON을 찾지 못했습니다. Claude가 준 결과 전체(또는 .json 파일)를 넣었는지 확인하세요. 답이 중간에 끊겼다면 Claude에게 "계속"이라고 한 뒤 이어진 부분도 함께 넣으세요.');
  return out;
}

/* ============================== 채점 요청 파일 ============================== */
export function buildGradingMd(group, part, parts) {
  const e = group.exam;
  const L = [];
  L.push(`# 논술 채점 요청 (${GRADE_FILE_FORMAT})`);
  L.push(`- 시험: ${e.fullTitle}`);
  L.push(`- 시험ID: ${e.id}`);
  L.push(`- 답안 수: ${group.attempts.length}명${parts > 1 ? ` (${part}/${parts}번째 파일)` : ''}`);
  L.push('');
  L.push(GRADE_FILE_GUIDE);
  L.push('');
  L.push('---');
  L.push('## 시험 자료');
  L.push('### 제시문');
  L.push(e.passage || '(제시문 텍스트 없음)');
  for (const q of e.questions) {
    L.push('');
    L.push(`### 문항 ${q.no} (${q.points}점${q.qtype ? `, ${q.qtype}` : ''}${q.lengthRule ? `, 분량: ${q.lengthRule}` : ''})`);
    L.push('**논제**');
    L.push(q.prompt);
    L.push('');
    L.push('**채점기준**');
    L.push(q.rubric || '(별도 기준 없음 - 예시답안과 해설로 평가요소를 정할 것)');
    L.push('');
    L.push('**예시답안**');
    L.push(q.model || '(없음)');
    L.push('');
    L.push('**해설·출제의도**');
    L.push(q.commentary || '(없음)');
  }
  L.push('');
  L.push('---');
  L.push(`## 학생 답안 (${group.attempts.length}명)`);
  group.attempts.forEach((a, i) => {
    L.push('');
    L.push(`### 답안 ${i + 1} — attemptId: ${a.id}`);
    for (const q of e.questions) {
      const ans = a.answers[q.no] || '';
      const c = countChars(ans);
      L.push(`#### 문항 ${q.no} (공백 포함 ${c.withSpace}자, 공백 제외 ${c.noSpace}자)`);
      if (c.noSpace < 10) { L.push('(미작성)'); continue; }
      L.push('<학생답안>');
      L.push(ans);
      L.push('</학생답안>');
    }
  });
  L.push('');
  L.push('---');
  L.push('## [출력 형식]');
  L.push('results 배열에 위 답안 전부를 넣고, 각 답안의 문항 배열에 모든 문항을 넣습니다. 아래는 형식 예시입니다.');
  L.push('```json');
  L.push(gradeFileOutputExample(e.id, group.attempts[0] ? group.attempts[0].id : 'attemptId', e.questions[0] ? e.questions[0].no : '1'));
  L.push('```');
  return L.join('\n');
}

/* ============================== 시험 등록 요청 파일 ============================== */
const ROLE_LABEL = { problem: '문제지', answer: '예시답안·정답', commentary: '해설·채점기준' };

export function buildExamMd({ kind, meta, texts, attachNames }) {
  const L = [];
  L.push(`# 논술 시험 등록 요청 (${EXAM_FILE_FORMAT})`);
  L.push('');
  L.push(EXAM_FILE_GUIDE);
  L.push('');
  L.push('---');
  L.push('## 교사가 입력한 정보');
  L.push(`- 구분: ${kind === '자체' ? '자체 모의논술' : '대학 기출'}`);
  if (meta.univ) L.push(`- 대학: ${meta.univ}`);
  if (meta.year) L.push(`- 학년도: ${meta.year}`);
  if (meta.type && kind !== '자체') L.push(`- 유형: ${meta.type}`);
  if (meta.track) L.push(`- 계열: ${meta.track}`);
  if (meta.minutes) L.push(`- 시험 시간: ${meta.minutes}분`);
  if (meta.title) L.push(`- 제목: ${meta.title}`);
  if (attachNames.length) {
    L.push('');
    L.push('## 이 파일과 함께 올린 파일');
    attachNames.forEach((f) => L.push(`- ${f.name} (${ROLE_LABEL[f.role]})`));
  }
  L.push('');
  L.push('## [파일 텍스트]');
  if (!texts.length) L.push('(없음 — 함께 올린 파일을 읽으세요)');
  texts.forEach((f) => {
    L.push('');
    L.push(`### [${ROLE_LABEL[f.role]}] ${f.name}`);
    L.push(f.text);
  });
  L.push('');
  L.push('---');
  L.push('## [출력 형식]');
  L.push('```json');
  L.push(EXAM_FILE_EXAMPLE);
  L.push('```');
  return L.join('\n');
}

const numOrNull = (v) => { if (v === '' || v === null || v === undefined) return null; const n = Number(v); return Number.isFinite(n) ? n : null; };
const s = (v) => (v === null || v === undefined ? '' : String(v));

/** Claude가 만든 시험 JSON → 편집 화면 초안 */
export function examJsonToDraft(obj, kind, meta = {}) {
  if (!kind) kind = /자체/.test(s(obj.구분) + s(obj.유형)) ? '자체' : '기출';
  const qs = Array.isArray(obj.문항 || obj.questions) ? (obj.문항 || obj.questions) : [];
  const questions = qs.map((q, i) => ({
    no: s(q.번호 ?? q.no) || String(i + 1), qtype: s(q.문항유형 ?? q.qtype) || '인문', prompt: s(q.논제 ?? q.prompt),
    points: numOrNull(q.배점 ?? q.points), lengthRule: s(q.분량조건 ?? q.lengthRule),
    minChars: numOrNull(q.최소자 ?? q.minChars), maxChars: numOrNull(q.최대자 ?? q.maxChars),
    model: s(q.예시답안 ?? q.model), rubric: s(q.채점기준 ?? q.rubric), commentary: s(q.해설 ?? q.commentary)
  }));
  const warnings = [];
  if (!questions.length) warnings.push('문항(논제)이 없습니다. 직접 입력해 주세요.');
  questions.forEach((q) => {
    if (!q.points) warnings.push(q.no + '번 배점을 확인하세요.');
    if (!q.model) warnings.push(q.no + '번 예시답안이 비어 있습니다(채점의 기준이 되므로 채워 주세요).');
  });
  if (JSON.stringify(questions).includes('[AI 작성·검토 필요]')) warnings.push('"[AI 작성·검토 필요]" 표시가 있는 부분은 AI가 만든 초안입니다. 확인 후 표시를 지우세요.');
  return {
    id: '', kind: kind === '자체' ? '자체' : '기출',
    univ: meta.univ || s(obj.대학), year: meta.year || s(obj.연도), type: kind === '자체' ? '자체모의논술' : (meta.type || s(obj.유형) || '논술고사'),
    track: meta.track || s(obj.계열), title: meta.title || s(obj.제목),
    minutes: Number(meta.minutes) || Number(obj.시간) || '', notice: s(obj.안내문), passage: s(obj.제시문), overall: s(obj.총평해설),
    pdfId: '', questions, warnings, published: false
  };
}

export function pickExamJson(list) {
  const hit = list.find((o) => o && (o.format === EXAM_FILE_FORMAT || Array.isArray(o.문항) || Array.isArray(o.questions)));
  if (!hit) throw new Error('시험 등록 결과(JSON)가 아닙니다. "문항" 목록이 있는 JSON을 넣어 주세요.');
  return hit;
}

/** 여러 시험 JSON(파일 여러 개, 배열, {exams:[...]} 묶음)을 시험 목록으로 */
export function collectExamJsons(docs) {
  const out = [];
  const visit = (o) => {
    if (!o || typeof o !== 'object') return;
    if (Array.isArray(o)) { o.forEach(visit); return; }
    if (Array.isArray(o.exams) || Array.isArray(o.시험)) { (o.exams || o.시험).forEach(visit); return; }
    if (Array.isArray(o.문항) || Array.isArray(o.questions)) out.push(o);
  };
  docs.forEach(visit);
  return out;
}
