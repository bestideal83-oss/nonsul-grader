// 논술 기출 풀이·자동 채점 — 서버 로직 (Vercel 함수 /api/rpc 에서 호출)
import { db } from './db.js';
import { sign, verify, samePw, hashPw, newSalt } from './auth.js';
import { aiMany, modelName, keyStatus } from './ai.js';
import { SYS_GRADE, SYS_EXTRACT_Q, EXTRACT_Q_FORMAT, SYS_EXTRACT_A, EXTRACT_A_FORMAT } from './prompts.js';

/* ============================== 상수 ============================== */
const GRACE_SAVE_MS = 90 * 1000;        // 마감 후 자동저장 허용 여유(네트워크 지연)
const GRACE_SUBMIT_MS = 3 * 60 * 1000;  // 마감 후 제출 답안 반영 여유
const GRADING_STALE_MS = 6 * 60 * 1000; // '채점중'이 이보다 오래되면 다시 채점
const MAX_RETRY = 5;
const CHUNK = 900000;                   // Firestore 문서 1개당 base64 조각 크기

const DEFAULT_CFG = {
  gradingMode: 'manual',            // manual: 교사가 Claude 대화창에서 채점(파일 주고받기) / api: API 키로 즉시 자동 채점
  provider: 'claude', geminiModel: '', claudeModel: '', thinking: 'low',
  rosterRequired: false, showModelAnswer: true, allowRetake: true, pwVersion: 0
};

export const STATUS = { inprogress: '응시중', pending: '채점대기', grading: '채점중', done: '채점완료', error: '채점오류' };

/* ============================== 도우미 ============================== */
const str = (v) => (v === null || v === undefined ? '' : String(v));
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const numOrNull = (v) => { if (v === '' || v === null || v === undefined) return null; const n = Number(v); return Number.isFinite(n) ? n : null; };
const half = (n) => Math.round(num(n) * 2) / 2;
const fmt = (ms) => ms ? new Date(ms).toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' }).replace('T', ' ') : '';

export function countChars(s) {
  s = str(s).replace(/\r/g, '');
  return { withSpace: s.replace(/\n/g, '').length, noSpace: s.replace(/\s/g, '').length };
}

async function getConfig() {
  const c = await db().get('config', 'app');
  return { ...DEFAULT_CFG, ...(c || {}) };
}

function asStudent(token) {
  const s = verify(token);
  if (s.role !== 'student') throw new Error('학생만 이용할 수 있습니다.');
  return s;
}

async function asTeacher(token) {
  const s = verify(token);
  if (s.role !== 'teacher') throw new Error('교사만 이용할 수 있습니다.');
  const cfg = await getConfig();
  if ((s.pv || 0) !== (cfg.pwVersion || 0)) throw new Error('SESSION_EXPIRED');
  return cfg;
}

function examTitle(e) {
  if (e.kind === '자체') return [e.univ ? `[${e.univ} 대비]` : '', e.title || '자체 모의논술'].map(str).filter(Boolean).join(' ');
  return [e.univ, e.year ? e.year + '학년도' : '', e.type, e.title].map(str).filter(Boolean).join(' ');
}

function examMeta(e) {
  const qs = e.questions || [];
  return {
    id: e.id, kind: e.kind, univ: str(e.univ), year: str(e.year), type: str(e.type), track: str(e.track),
    title: str(e.title), fullTitle: examTitle(e), minutes: num(e.minutes), published: !!e.published,
    qCount: qs.length, totalPoints: qs.reduce((t, q) => t + num(q.points), 0), hasPdf: !!e.pdfId,
    updatedAt: e.updatedAt || 0
  };
}

/** 학생 응시용 문제(정답·채점기준·해설 제외) */
function examForStudent(e) {
  return {
    ...examMeta(e), notice: str(e.notice), passage: str(e.passage),
    questions: (e.questions || []).map((q) => ({
      no: q.no, qtype: q.qtype, prompt: q.prompt, points: num(q.points),
      lengthRule: str(q.lengthRule), minChars: numOrNull(q.minChars), maxChars: numOrNull(q.maxChars)
    }))
  };
}

function attSummary(a) {
  return {
    id: a.id, sid: a.sid, name: a.name, examId: a.examId, examTitle: a.examTitle, status: a.status,
    statusText: STATUS[a.status] || a.status, mode: str(a.mode), startedAt: a.startedAt || 0,
    submittedAt: a.submittedAt || 0, deadline: a.deadline || 0,
    total: a.total ?? null, max: a.max ?? null, error: str(a.error)
  };
}

function finalizeFields(mode, when) {
  return { status: 'pending', mode, submittedAt: when || Date.now() };
}

function cleanAnswers(answers, exam) {
  const out = {};
  for (const q of exam.questions || []) {
    const v = answers && answers[q.no];
    if (v !== undefined && v !== null) out[q.no] = String(v).slice(0, 20000);
  }
  return out;
}

async function getExam(id) {
  if (!id) return null;
  return db().get('exams', id);
}

async function ownAttempt(s, id) {
  const a = await db().get('attempts', id);
  if (!a || a.sid !== s.sid) throw new Error('응시 기록을 찾을 수 없습니다.');
  return a;
}

/* ============================== 로그인 ============================== */
async function login(_t, role, a, b) {
  const cfg = await getConfig();
  const exp = Date.now() + 12 * 3600 * 1000;
  if (role === 'teacher') {
    if ((cfg.lockUntil || 0) > Date.now()) throw new Error('비밀번호를 여러 번 틀려 10분간 교사 로그인이 잠겼습니다.');
    if (!samePw(a, cfg)) {
      const fails = (cfg.failCount || 0) + 1;
      await db().set('config', 'app', { ...cfg, failCount: fails >= 10 ? 0 : fails, lockUntil: fails >= 10 ? Date.now() + 600000 : 0 });
      throw new Error('교사 비밀번호가 올바르지 않습니다.');
    }
    if (cfg.failCount) await db().set('config', 'app', { ...cfg, failCount: 0, lockUntil: 0 });
    return { token: sign({ role: 'teacher', pv: cfg.pwVersion || 0, exp }), role: 'teacher', name: '교사' };
  }
  const sid = str(a).trim(), name = str(b).replace(/\s+/g, '');
  if (!/^[0-9A-Za-z-]{3,12}$/.test(sid)) throw new Error('학번을 정확히 입력하세요(숫자 3~12자리).');
  if (!name || name.length > 20) throw new Error('이름을 입력하세요.');
  const hit = await db().get('roster', sid);
  if (hit && str(hit.name).replace(/\s+/g, '') !== name) throw new Error('학번과 이름이 학생 명단과 일치하지 않습니다.');
  if (!hit && cfg.rosterRequired) throw new Error('학생 명단에 없는 학번입니다. 선생님께 문의하세요.');
  return { token: sign({ role: 'student', sid, name, exp }), role: 'student', sid, name };
}

/* ============================== 학생 ============================== */
async function s_home(token) {
  const s = asStudent(token);
  const exams = (await db().list('exams', [['published', '==', true]])).map(examMeta);
  let mine = await db().list('attempts', [['sid', '==', s.sid]]);
  // 창을 닫고 나간 뒤 시간이 지난 응시는 자동 제출 처리
  for (const a of mine) {
    if (a.status === 'inprogress' && Date.now() > a.deadline + GRACE_SAVE_MS) {
      const f = finalizeFields('시간종료(재접속 시 자동제출)', a.deadline);
      await db().update('attempts', a.id, f);
      Object.assign(a, f);
    }
  }
  mine = mine.map(attSummary).sort((x, y) => y.startedAt - x.startedAt);
  return { exams, attempts: mine, sid: s.sid, name: s.name };
}

async function s_intro(token, examId) {
  asStudent(token);
  const e = await getExam(examId);
  if (!e || !e.published) throw new Error('공개되지 않은 시험입니다.');
  const x = examForStudent(e);
  return { ...x, passage: undefined, questions: x.questions.map((q) => ({ no: q.no, points: q.points, lengthRule: q.lengthRule, qtype: q.qtype })) };
}

async function s_start(token, examId) {
  const s = asStudent(token);
  const cfg = await getConfig();
  const e = await getExam(examId);
  if (!e || !e.published) throw new Error('공개되지 않은 시험입니다.');
  if (!(e.questions || []).length) throw new Error('문항이 없는 시험입니다.');
  if (!(num(e.minutes) > 0)) throw new Error('시험 시간이 설정되지 않았습니다.');
  const D = db();
  const res = await D.tx(async (t) => {
    const mine = await t.list('attempts', [['sid', '==', s.sid], ['examId', '==', examId]]);
    const open = mine.find((a) => a.status === 'inprogress');
    const now = Date.now();
    if (open) {
      if (now > open.deadline + GRACE_SAVE_MS) {
        t.update('attempts', open.id, finalizeFields('시간종료(재접속 시 자동제출)', open.deadline));
        return { expired: true, id: open.id };
      }
      return { attempt: open, resumed: true };
    }
    if (mine.length && !cfg.allowRetake) throw new Error('이미 응시한 시험입니다(재응시 불가).');
    const id = D.newId();
    const a = {
      sid: s.sid, name: s.name, examId, examTitle: examTitle(e), status: 'inprogress', mode: '',
      startedAt: now, deadline: now + num(e.minutes) * 60000, submittedAt: 0,
      total: null, max: examMeta(e).totalPoints, answers: {}, grading: null, error: '', retry: 0, gradingStartedAt: 0, savedAt: 0
    };
    t.set('attempts', id, a);
    return { attempt: { id, ...a }, resumed: false };
  });
  if (res.expired) return { expired: true, attemptId: res.id };
  const a = res.attempt;
  return {
    attemptId: a.id, exam: examForStudent(e), answers: a.answers || {}, savedAt: a.savedAt || 0,
    resumed: res.resumed, deadline: a.deadline, serverNow: Date.now()
  };
}

async function s_save(token, attemptId, answers) {
  const s = asStudent(token);
  const a0 = await ownAttempt(s, attemptId);
  const e = await getExam(a0.examId);
  return db().tx(async (t) => {
    const a = await t.get('attempts', attemptId);
    if (!a || a.sid !== s.sid) throw new Error('응시 기록을 찾을 수 없습니다.');
    if (a.status !== 'inprogress') return { closed: true, serverNow: Date.now() };
    if (Date.now() > a.deadline + GRACE_SAVE_MS) return { late: true, serverNow: Date.now(), deadline: a.deadline };
    t.update('attempts', attemptId, { answers: cleanAnswers(answers, e || { questions: [] }), savedAt: Date.now() });
    return { ok: true, serverNow: Date.now(), deadline: a.deadline };
  });
}

async function s_submit(token, attemptId, answers, auto) {
  const s = asStudent(token);
  const a0 = await ownAttempt(s, attemptId);
  const e = await getExam(a0.examId);
  return db().tx(async (t) => {
    const a = await t.get('attempts', attemptId);
    if (!a || a.sid !== s.sid) throw new Error('응시 기록을 찾을 수 없습니다.');
    if (a.status !== 'inprogress') return { status: a.status };
    const upd = finalizeFields(auto ? '시간종료 자동제출' : '직접 제출', Math.min(Date.now(), a.deadline));
    if (answers && e && Date.now() <= a.deadline + GRACE_SUBMIT_MS) upd.answers = cleanAnswers(answers, e);
    t.update('attempts', attemptId, upd);
    return { status: 'pending' };
  });
}

async function s_grade(token, attemptId) {
  const s = asStudent(token);
  const a = await ownAttempt(s, attemptId);
  const cfg = await getConfig();
  if (cfg.gradingMode !== 'api') return { status: a.status, manual: true };
  return { status: await gradeAttempt(attemptId, false) };
}

async function s_result(token, attemptId) {
  const s = asStudent(token);
  const a = await ownAttempt(s, attemptId);
  const cfg = await getConfig();
  // 예시답안·채점기준·해설은 채점이 끝난 뒤에만 학생에게 보여 줌
  const r = await buildResult(a, cfg.showModelAnswer && a.status === 'done');
  r.gradingMode = cfg.gradingMode;
  return r;
}

async function buildResult(a, withModel) {
  const out = attSummary(a);
  out.answers = a.answers || {};
  const e = await getExam(a.examId);
  if (e) {
    out.exam = {
      id: e.id, fullTitle: examTitle(e), passage: str(e.passage), hasPdf: !!e.pdfId,
      overall: withModel ? str(e.overall) : '',
      questions: (e.questions || []).map((q) => ({
        no: q.no, prompt: q.prompt, points: num(q.points), lengthRule: str(q.lengthRule), qtype: str(q.qtype),
        ...(withModel ? { model: str(q.model), rubric: str(q.rubric), commentary: str(q.commentary) } : {})
      }))
    };
  }
  if (a.status === 'done' && a.grading) out.grading = a.grading;
  return out;
}

/* ---------- 원본 PDF (Firestore에 조각으로 저장) ---------- */
async function pdfAccess(token, examId) {
  const who = verify(token);
  if (who.role === 'teacher') { await asTeacher(token); }
  else {
    const mine = await db().list('attempts', [['sid', '==', who.sid], ['examId', '==', examId]]);
    if (!mine.length) throw new Error('응시한 시험의 자료만 볼 수 있습니다.');
  }
  const e = await getExam(examId);
  if (!e || !e.pdfId) throw new Error('원본 PDF가 없습니다.');
  const up = await db().get('uploads', e.pdfId);
  if (!up) throw new Error('원본 PDF를 찾을 수 없습니다.');
  return up;
}
async function s_pdfInfo(token, examId) { const up = await pdfAccess(token, examId); return { parts: up.parts, name: up.name }; }
async function s_pdfPart(token, examId, i) {
  const up = await pdfAccess(token, examId);
  const c = await db().get(`uploads/${up.id}/chunks`, String(i));
  if (!c) throw new Error('PDF 조각이 없습니다.');
  return c.data;
}

/* ============================== 채점 ============================== */
export async function gradeAttempt(attemptId, force) {
  const D = db();
  const claim = await D.tx(async (t) => {
    const a = await t.get('attempts', attemptId);
    if (!a) throw new Error('응시 기록이 없습니다.');
    if (a.status === 'inprogress') return { skip: a.status };
    if (a.status === 'done' && !force) return { skip: a.status };
    if (a.status === 'grading' && !force && Date.now() - (a.gradingStartedAt || 0) < GRADING_STALE_MS) return { skip: a.status };
    t.update('attempts', attemptId, { status: 'grading', gradingStartedAt: Date.now() });
    return { a };
  });
  if (claim.skip) return claim.skip;

  let result = null, error = '';
  try { result = await gradeCore(claim.a); } catch (e) { error = String(e && e.message || e); console.error('grade', attemptId, error); }

  const cur = await D.get('attempts', attemptId);
  if (!cur) return 'deleted';
  if (result) {
    await D.update('attempts', attemptId, { grading: result, total: result.total, max: result.max, status: 'done', error: '' });
    return 'done';
  }
  await D.update('attempts', attemptId, { status: 'error', error: error.slice(0, 500), retry: (cur.retry || 0) + 1 });
  return 'error';
}

function gradeRequest(e, q, ans, len, pdfPart) {
  const t = [];
  t.push('[시험] ' + examTitle(e));
  t.push('\n[제시문]\n' + (str(e.passage) || '(제시문 텍스트 없음 - 첨부 PDF 참고)'));
  t.push('\n[문항 번호] ' + q.no + (q.qtype ? ` (${q.qtype})` : ''));
  t.push('[논제]\n' + q.prompt);
  t.push('[배점] ' + num(q.points) + '점');
  t.push(`[분량 조건] ${q.lengthRule || '없음'} / 학생 답안 글자 수: 공백 포함 ${len.withSpace}자, 공백 제외 ${len.noSpace}자`);
  t.push('\n[채점기준]\n' + (q.rubric || '(별도 기준 없음 - 예시답안과 해설로 평가요소를 정할 것)'));
  t.push('\n[예시답안]\n' + (q.model || '(없음)'));
  t.push('\n[해설·출제의도]\n' + (q.commentary || '(없음)'));
  t.push('\n<학생답안>\n' + ans + '\n</학생답안>');
  t.push('\n위 학생 답안을 채점해 지정한 JSON으로만 답하라.');
  const parts = pdfPart ? [pdfPart, { text: t.join('\n') }] : [{ text: t.join('\n') }];
  return { system: SYS_GRADE, parts, maxTokens: 8000 };
}

const arr = (v) => Array.isArray(v) ? v.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).filter(Boolean) : (v ? [String(v)] : []);

export function normalizeGrade(q, d, len) {
  const max = num(q.points);
  const crit = Array.isArray(d.기준별) ? d.기준별.map((c) => ({ 기준: str(c.기준), 배점: half(c.배점), 득점: half(c.득점), 근거: str(c.근거) })) : [];
  crit.forEach((c) => { if (c.배점 > 0) c.득점 = Math.max(0, Math.min(c.득점, c.배점)); });
  let score = half(d.점수);
  const critMax = crit.reduce((t, c) => t + c.배점, 0);
  if (crit.length && Math.abs(critMax - max) < 0.01) score = crit.reduce((t, c) => t + c.득점, 0);
  score = Math.max(0, Math.min(max, half(score)));
  return {
    no: q.no, points: max, score, criteria: crit,
    strengths: arr(d.잘한점),
    deductions: Array.isArray(d.감점사유) ? d.감점사유.map((x) => typeof x === 'string'
      ? { 내용: x, 학생답안: '', 예시답안대조: '', 감점: null }
      : { 내용: str(x.내용), 학생답안: str(x.학생답안), 예시답안대조: str(x.예시답안대조), 감점: numOrNull(x.감점) }) : [],
    missing: arr(d.누락논점), improve: str(d.보완방향), lengthNote: str(d.분량평가), oneLine: str(d.한줄평),
    chars: len, teacherScore: null, teacherComment: ''
  };
}

function emptyGrade(q, len) {
  return {
    no: q.no, points: num(q.points), score: 0, criteria: [], strengths: [],
    deductions: [{ 내용: '답안을 작성하지 않았거나 분량이 지나치게 적어 평가할 수 없음', 학생답안: '(해당 내용 없음)', 예시답안대조: '', 감점: num(q.points) }],
    missing: [], improve: '논제가 요구하는 과제를 먼저 확인하고, 제시문을 근거로 답안을 완성해 보자.',
    lengthNote: '미작성', oneLine: '미작성 답안', chars: len, teacherScore: null, teacherComment: '', empty: true
  };
}

export const finalScore = (g) => (g.teacherScore !== null && g.teacherScore !== undefined && g.teacherScore !== '' ? num(g.teacherScore) : num(g.score));

async function loadUpload(id) {
  const up = await db().get('uploads', id);
  if (!up) throw new Error('업로드한 파일을 찾을 수 없습니다. 다시 올려 주세요.');
  let data = '';
  for (let i = 0; i < up.parts; i++) {
    const c = await db().get(`uploads/${id}/chunks`, String(i));
    if (!c) throw new Error('파일 조각이 빠졌습니다. 다시 올려 주세요.');
    data += c.data;
  }
  return { ...up, data };
}

async function gradeCore(a) {
  const cfg = await getConfig();
  const e = await getExam(a.examId);
  if (!e) throw new Error('시험이 삭제되어 채점할 수 없습니다.');
  const qs = e.questions || [];
  if (!qs.length) throw new Error('문항이 없습니다.');
  const answers = a.answers || {};
  let pdfPart = null;
  if (e.pdfId && str(e.passage).replace(/\s/g, '').length < 100) {
    try { const up = await loadUpload(e.pdfId); pdfPart = { mime: 'application/pdf', data: up.data }; } catch (err) { /* 텍스트로만 채점 */ }
  }
  const reqs = [], idx = [];
  const res = qs.map((q, i) => {
    const ans = str(answers[q.no]);
    const len = countChars(ans);
    if (len.noSpace === 0) return emptyGrade(q, len);
    reqs.push(gradeRequest(e, q, ans, len, pdfPart));
    idx.push(i);
    return null;
  });
  const out = await aiMany(reqs, cfg);
  out.forEach((r, k) => {
    const i = idx[k], q = qs[i];
    if (!r.ok) throw new Error(`${q.no}번 채점 실패: ${r.err}`);
    res[i] = normalizeGrade(q, r.data, countChars(str(answers[q.no])));
  });
  const total = res.reduce((t, g) => t + g.score, 0);
  const max = res.reduce((t, g) => t + g.points, 0);
  return { gradedAt: Date.now(), model: modelName(cfg), questions: res, total, max, teacherOverall: '' };
}

/* ============================== 교사: 결과 ============================== */
async function t_attempts(token) {
  await asTeacher(token);
  return (await db().list('attempts')).map(attSummary).sort((x, y) => y.startedAt - x.startedAt);
}

async function t_attempt(token, id) {
  const cfg = await asTeacher(token);
  const a = await db().get('attempts', id);
  if (!a) throw new Error('응시 기록이 없습니다.');
  const r = await buildResult(a, true);
  r.gradingMode = cfg.gradingMode;
  return r;
}

async function t_updateScores(token, id, edits, overall) {
  await asTeacher(token);
  return db().tx(async (t) => {
    const a = await t.get('attempts', id);
    if (!a || a.status !== 'done' || !a.grading) throw new Error('채점이 끝난 응시만 수정할 수 있습니다.');
    const g = a.grading;
    for (const e of edits || []) {
      const q = g.questions.find((x) => x.no === e.no);
      if (!q) continue;
      const v = e.teacherScore === '' || e.teacherScore === null || e.teacherScore === undefined ? null : Number(e.teacherScore);
      if (v !== null && (!Number.isFinite(v) || v < 0 || v > q.points)) throw new Error(`${q.no}번 점수는 0~${q.points} 사이여야 합니다.`);
      q.teacherScore = v;
      q.teacherComment = str(e.teacherComment);
    }
    g.teacherOverall = str(overall);
    g.total = g.questions.reduce((s, q) => s + finalScore(q), 0);
    t.update('attempts', id, { grading: g, total: g.total });
    return { total: g.total };
  });
}

async function t_regrade(token, id) {
  const cfg = await asTeacher(token);
  if (cfg.gradingMode !== 'api') throw new Error('API 자동 채점 모드에서만 쓸 수 있습니다. [채점용 파일 내보내기]를 이용하세요.');
  return { status: await gradeAttempt(id, true) };
}

async function t_forceSubmit(token, id) {
  await asTeacher(token);
  const a = await db().get('attempts', id);
  if (!a || a.status !== 'inprogress') throw new Error('응시 중인 기록이 아닙니다.');
  await db().update('attempts', id, finalizeFields('교사 강제 종료', Date.now()));
  return true;
}

async function t_deleteAttempt(token, id) {
  await asTeacher(token);
  await db().del('attempts', id);
  return true;
}

/** 시간이 지난 미제출 응시를 제출 처리하고, 밀린 채점을 최대 약 3분간 처리 */
async function finalizeExpired(all) {
  let finalized = 0;
  for (const a of all) {
    if (a.status === 'inprogress' && Date.now() > a.deadline + GRACE_SUBMIT_MS) {
      const f = finalizeFields('시간종료(미접속 자동제출)', a.deadline);
      await db().update('attempts', a.id, f);
      Object.assign(a, f);
      finalized++;
    }
  }
  return finalized;
}

async function t_gradePending(token) {
  const cfg = await asTeacher(token);
  const t0 = Date.now();
  const all = await db().list('attempts');
  const finalized = await finalizeExpired(all);
  if (cfg.gradingMode !== 'api') return { finalized, graded: 0, failed: 0, remaining: 0, manual: true };
  const todo = all.filter((a) => a.status === 'pending' || (a.status === 'error' && (a.retry || 0) < MAX_RETRY) ||
    (a.status === 'grading' && Date.now() - (a.gradingStartedAt || 0) > GRADING_STALE_MS));
  let graded = 0, failed = 0, i = 0;
  const worker = async () => {
    while (i < todo.length && Date.now() - t0 < 180000) {
      const a = todo[i++];
      const st = await gradeAttempt(a.id, false).catch(() => 'error');
      if (st === 'done') graded++; else if (st === 'error') failed++;
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  return { finalized, graded, failed, remaining: Math.max(0, todo.length - i) };
}

async function t_export(token, examId) {
  await asTeacher(token);
  const filters = [['status', '==', 'done']];
  if (examId) filters.push(['examId', '==', examId]);
  const rows = await db().list('attempts', filters);
  const exams = {};
  const out = [];
  for (const a of rows.sort((x, y) => x.startedAt - y.startedAt)) {
    if (!(a.examId in exams)) exams[a.examId] = await getExam(a.examId);
    const e = exams[a.examId];
    out.push({
      summary: attSummary(a), grading: a.grading, answers: a.answers || {},
      exam: e ? { univ: str(e.univ), year: str(e.year), type: str(e.type), kind: e.kind, questions: (e.questions || []).map((q) => ({ no: q.no, prompt: q.prompt })) } : null
    });
  }
  return out;
}

/* ============================== 교사: 파일로 채점(Claude 대화창) ============================== */
/** 채점 대기 답안을 시험별로 묶어 보냄(학생 이름은 빼고 응시 코드만) */
async function t_gradingExport(token, examId, includeDone) {
  await asTeacher(token);
  const all = await db().list('attempts');
  await finalizeExpired(all);
  const states = includeDone ? ['pending', 'error', 'grading', 'done'] : ['pending', 'error', 'grading'];
  const todo = all.filter((a) => states.includes(a.status) && (!examId || a.examId === examId))
    .sort((x, y) => x.startedAt - y.startedAt);
  const groups = new Map();
  for (const a of todo) {
    if (!groups.has(a.examId)) groups.set(a.examId, []);
    groups.get(a.examId).push(a);
  }
  const out = [];
  for (const [eid, list] of groups) {
    const e = await getExam(eid);
    if (!e) continue;
    out.push({
      exam: {
        id: eid, fullTitle: examTitle(e), passage: str(e.passage), overall: str(e.overall),
        questions: (e.questions || []).map((q) => ({ no: q.no, qtype: q.qtype, prompt: q.prompt, points: num(q.points), lengthRule: str(q.lengthRule), model: str(q.model), rubric: str(q.rubric), commentary: str(q.commentary) }))
      },
      attempts: list.map((a) => ({
        id: a.id,
        answers: Object.fromEntries((e.questions || []).map((q) => [q.no, str((a.answers || {})[q.no])]))
      }))
    });
  }
  return out;
}

/** Claude가 만든 채점 결과(JSON)를 받아 저장 */
async function t_gradingImport(token, docs, overwrite) {
  await asTeacher(token);
  const out = { imported: 0, skipped: [] };
  const exams = {};
  const skip = (id, reason) => out.skipped.push({ id, reason });
  for (const doc of Array.isArray(docs) ? docs : [docs]) {
    const results = Array.isArray(doc) ? doc : (doc && (doc.results || doc.결과)) || [];
    for (const r of results) {
      const id = str(r.attemptId || r.응시ID || r.id).trim();
      const a = id ? await db().get('attempts', id) : null;
      if (!a) { skip(id || '(없음)', '응시 기록을 찾을 수 없음'); continue; }
      if (a.status === 'inprogress') { skip(id, '아직 응시 중'); continue; }
      if (a.status === 'done' && !overwrite) { skip(id, '이미 채점됨(덮어쓰기를 켜면 바꿈)'); continue; }
      if (!(a.examId in exams)) exams[a.examId] = await getExam(a.examId);
      const e = exams[a.examId];
      if (!e) { skip(id, '시험이 삭제됨'); continue; }
      const byNo = {};
      (r.문항 || r.questions || []).forEach((x) => { byNo[normNo(x.번호 ?? x.no)] = x; });
      const qs = [], missing = [];
      for (const q of e.questions || []) {
        const ans = str((a.answers || {})[q.no]);
        const len = countChars(ans);
        if (len.noSpace === 0) { qs.push(emptyGrade(q, len)); continue; }
        const x = byNo[normNo(q.no)];
        if (!x) { missing.push(q.no); continue; }
        qs.push(normalizeGrade(q, x, len));
      }
      if (missing.length) { skip(id, missing.join(', ') + '번 채점 결과가 없음'); continue; }
      const total = qs.reduce((t, g) => t + g.score, 0), max = qs.reduce((t, g) => t + g.points, 0);
      await db().update('attempts', id, {
        grading: { gradedAt: Date.now(), model: 'Claude 대화창(교사 채점)', questions: qs, total, max, teacherOverall: (a.grading && a.grading.teacherOverall) || '' },
        total, max, status: 'done', error: ''
      });
      out.imported++;
    }
  }
  return out;
}

/** AI 없이 교사가 점수·코멘트를 직접 입력해 채점 */
async function t_manualGrade(token, id, edits, overall) {
  await asTeacher(token);
  const a = await db().get('attempts', id);
  if (!a) throw new Error('응시 기록이 없습니다.');
  if (a.status === 'inprogress') throw new Error('아직 응시 중입니다. 먼저 강제 종료하세요.');
  const e = await getExam(a.examId);
  if (!e) throw new Error('시험이 삭제되었습니다.');
  const byNo = {};
  (edits || []).forEach((x) => { byNo[x.no] = x; });
  const qs = (e.questions || []).map((q) => {
    const x = byNo[q.no] || {};
    const v = x.teacherScore === '' || x.teacherScore === null || x.teacherScore === undefined ? NaN : Number(x.teacherScore);
    if (!Number.isFinite(v) || v < 0 || v > num(q.points)) throw new Error(`${q.no}번 점수를 0~${num(q.points)} 사이로 입력하세요.`);
    return {
      no: q.no, points: num(q.points), score: v, criteria: [], strengths: [], deductions: [], missing: [],
      improve: '', lengthNote: '', oneLine: '', chars: countChars(str((a.answers || {})[q.no])),
      teacherScore: null, teacherComment: str(x.teacherComment), manual: true
    };
  });
  const total = qs.reduce((t, g) => t + g.score, 0), max = qs.reduce((t, g) => t + g.points, 0);
  await db().update('attempts', id, {
    grading: { gradedAt: Date.now(), model: '교사 직접 채점', questions: qs, total, max, teacherOverall: str(overall) },
    total, max, status: 'done', error: ''
  });
  return { total };
}

/* ============================== 교사: 시험 관리 ============================== */
async function t_exams(token) {
  await asTeacher(token);
  const atts = await db().list('attempts');
  const cnt = {};
  atts.forEach((a) => { cnt[a.examId] = (cnt[a.examId] || 0) + 1; });
  return (await db().list('exams')).map((e) => ({ ...examMeta(e), attempts: cnt[e.id] || 0 }))
    .sort((x, y) => (y.updatedAt || 0) - (x.updatedAt || 0));
}

async function t_exam(token, id) {
  await asTeacher(token);
  const e = await getExam(id);
  if (!e) throw new Error('시험을 찾을 수 없습니다.');
  return e;
}

async function t_saveExam(token, x) {
  await asTeacher(token);
  if (!x) throw new Error('자료가 없습니다.');
  const kind = x.kind === '자체' ? '자체' : '기출';
  if (kind === '기출' && !str(x.univ).trim()) throw new Error('대학명을 입력하세요.');
  const minutes = num(x.minutes);
  if (!(minutes > 0 && minutes <= 600)) throw new Error('시험 시간(분)을 입력하세요.');
  const qs = Array.isArray(x.questions) ? x.questions : [];
  if (!qs.length) throw new Error('문항을 1개 이상 입력하세요.');
  const seen = new Set();
  const questions = qs.map((q, i) => {
    const no = str(q.no).trim() || String(i + 1);
    if (seen.has(no)) throw new Error('문항 번호가 겹칩니다: ' + no);
    seen.add(no);
    if (!str(q.prompt).trim()) throw new Error(no + '번 논제가 비어 있습니다.');
    if (!(num(q.points) > 0)) throw new Error(no + '번 배점을 입력하세요.');
    return {
      no, qtype: str(q.qtype), prompt: str(q.prompt), points: num(q.points), lengthRule: str(q.lengthRule),
      minChars: numOrNull(q.minChars), maxChars: numOrNull(q.maxChars),
      model: str(q.model), rubric: str(q.rubric), commentary: str(q.commentary)
    };
  });
  const doc = {
    kind, univ: str(x.univ).trim(), year: str(x.year).trim(), type: str(x.type).trim(), track: str(x.track).trim(),
    title: str(x.title).trim(), minutes, notice: str(x.notice), passage: str(x.passage), overall: str(x.overall),
    pdfId: str(x.pdfId), questions, updatedAt: Date.now()
  };
  if (JSON.stringify(doc).length > 900000) throw new Error('시험 자료가 너무 큽니다(약 90만 자 초과). 제시문을 줄여 주세요.');
  const D = db();
  const old = x.id ? await D.get('exams', x.id) : null;
  const id = old ? x.id : D.newId();
  doc.published = old ? (x.published !== undefined ? !!x.published : !!old.published) : !!x.published;
  doc.createdAt = old ? old.createdAt || Date.now() : Date.now();
  if (old && old.pdfId && old.pdfId !== doc.pdfId) await deleteUpload(old.pdfId);
  if (doc.pdfId) { const up = await D.get('uploads', doc.pdfId); if (up && !up.keep) await D.update('uploads', doc.pdfId, { keep: true }); }
  await D.set('exams', id, doc);
  return { id };
}

async function t_publish(token, id, on) {
  await asTeacher(token);
  const e = await getExam(id);
  if (!e) throw new Error('시험을 찾을 수 없습니다.');
  if (on && !(e.questions || []).length) throw new Error('문항이 없는 시험은 공개할 수 없습니다.');
  await db().update('exams', id, { published: !!on });
  return true;
}

async function t_deleteExam(token, id) {
  await asTeacher(token);
  const e = await getExam(id);
  if (e && e.pdfId) await deleteUpload(e.pdfId);
  await db().del('exams', id);
  return true;
}

/* ============================== 교사: 파일 업로드 · AI 추출 ============================== */
async function deleteUpload(id) {
  if (!id) return;
  await db().delAll(`uploads/${id}/chunks`);
  await db().del('uploads', id);
}

async function t_uploadStart(token, name, mime, parts) {
  await asTeacher(token);
  if (!(parts > 0 && parts < 60)) throw new Error('파일이 너무 큽니다(약 40MB 이하).');
  const id = db().newId();
  await db().set('uploads', id, { name: str(name), mime: str(mime), parts, createdAt: Date.now(), keep: false });
  return { id };
}

async function t_uploadPart(token, id, i, data) {
  await asTeacher(token);
  if (typeof data !== 'string' || data.length > CHUNK + 10) throw new Error('조각 크기가 잘못되었습니다.');
  await db().set(`uploads/${id}/chunks`, String(i), { data });
  return true;
}

async function t_deleteUpload(token, id) {
  await asTeacher(token);
  const up = await db().get('uploads', id);
  if (up && !up.keep) await deleteUpload(id);
  return true;
}

const normNo = (s) => str(s).replace(/\s|번|문항|논제/g, '').replace(/[()（）]/g, '-').replace(/-+$/, '');

async function filesToParts(files) {
  const parts = [];
  for (const f of files) {
    if (f.kind === 'text') parts.push({ text: `===== 파일: ${f.name} =====\n${str(f.text).slice(0, 150000)}` });
    else if (f.uploadId) {
      const up = await loadUpload(f.uploadId);
      parts.push({ text: `===== 첨부 파일: ${f.name} (아래 첨부) =====` });
      parts.push({ mime: up.mime || f.mime, data: up.data });
    }
  }
  return parts;
}

// AI 추출은 두 번의 요청으로 나눈다(각각 서버 함수 5분 한도를 따로 씀)
//  1) t_extract: 문제지 → 제시문·논제·배점·분량
//  2) t_extractAnswers: 예시답안·해설 파일 → 문항별 예시답안·채점기준·해설
async function t_extract(token, payload) {
  const cfg = await asTeacher(token);
  const files = (payload && payload.files) || [];
  const meta = (payload && payload.meta) || {};
  const prob = files.filter((f) => f.role === 'problem');
  if (!prob.length) throw new Error('문제 파일을 올려 주세요.');
  const warnings = [];

  const hint = `참고 정보(교사 입력): 대학=${meta.univ || '미상'}, 연도=${meta.year || '미상'}, 유형=${meta.type || '미상'}\n\n출력 형식:\n`;
  const [A] = await aiMany([{ system: SYS_EXTRACT_Q, parts: [...await filesToParts(prob), { text: hint + EXTRACT_Q_FORMAT }], maxTokens: 32000 }], cfg);
  if (!A.ok) throw new Error('문제 추출 실패: ' + A.err);
  const a = A.data || {};
  const questions = (Array.isArray(a.문항) ? a.문항 : []).map((q, i) => ({
    no: str(q.번호) || String(i + 1), qtype: str(q.문항유형), prompt: str(q.논제), points: numOrNull(q.배점),
    lengthRule: str(q.분량조건), minChars: numOrNull(q.최소자), maxChars: numOrNull(q.최대자),
    model: '', rubric: '', commentary: ''
  }));
  if (!questions.length) warnings.push('문항(논제)을 찾지 못했습니다. 직접 입력해 주세요.');
  const pdf = prob.find((f) => f.uploadId && f.mime === 'application/pdf');
  if (payload.keepPdf && !pdf) warnings.push('학생 화면에 보여 줄 원본 PDF가 없습니다(HWP는 PDF로 저장해 편집 화면에서 따로 올리면 표시됩니다).');

  return {
    id: '', kind: payload.kind === '자체' ? '자체' : '기출',
    univ: meta.univ || str(a.대학), year: meta.year || str(a.연도), type: meta.type || str(a.유형),
    track: meta.track || str(a.계열), title: meta.title || '',
    minutes: num(meta.minutes) || num(a.시간) || '', notice: str(a.안내문), passage: str(a.제시문), overall: '',
    pdfId: payload.keepPdf && pdf ? pdf.uploadId : '', questions, warnings, published: false
  };
}

async function t_extractAnswers(token, payload, draft) {
  const cfg = await asTeacher(token);
  const files = (payload && payload.files) || [];
  const d = { ...draft, questions: (draft.questions || []).map((q) => ({ ...q })), warnings: [...(draft.warnings || [])] };
  const questions = d.questions;
  if (questions.length) {
    const ans = files.filter((f) => f.role !== 'problem');
    const list = questions.map((q) => `- ${q.no}번 (${q.points || '배점 미상'}점): ${str(q.prompt).slice(0, 300)}`).join('\n');
    if (!ans.length) d.warnings.push('정답·해설 파일이 없어 문제 파일에서 찾거나 AI가 초안을 작성했습니다. 반드시 검토하세요.');
    const src = ans.length ? ans : files.filter((f) => f.role === 'problem');
    const [B] = await aiMany([{ system: SYS_EXTRACT_A, parts: [...await filesToParts(src), { text: `문항 목록:\n${list}\n\n출력 형식:\n${EXTRACT_A_FORMAT}` }], maxTokens: 32000 }], cfg);
    if (!B.ok) d.warnings.push('정답·해설 추출 실패: ' + B.err + ' — 직접 입력하거나 다시 시도하세요.');
    else {
      const byNo = {};
      (Array.isArray(B.data.문항) ? B.data.문항 : []).forEach((x) => { byNo[normNo(x.번호)] = x; });
      for (const q of questions) {
        const x = byNo[normNo(q.no)];
        if (!x) { d.warnings.push(q.no + '번의 예시답안·해설을 찾지 못했습니다.'); continue; }
        q.model = str(x.예시답안); q.rubric = str(x.채점기준); q.commentary = str(x.해설);
      }
      d.overall = str(B.data.총평해설);
    }
  }
  questions.forEach((q) => { if (!q.points) d.warnings.push(q.no + '번 배점을 확인하세요.'); });
  if (JSON.stringify(questions).includes('[AI 작성·검토 필요]')) d.warnings.push('"[AI 작성·검토 필요]" 표시가 있는 부분은 AI가 만든 초안입니다. 확인 후 표시를 지우세요.');
  return d;
}

/* ============================== 교사: 명단 · 설정 ============================== */
async function t_roster(token) {
  const cfg = await asTeacher(token);
  const list = (await db().list('roster')).map((r) => ({ sid: r.id, name: r.name })).sort((x, y) => x.sid.localeCompare(y.sid));
  return { list, required: !!cfg.rosterRequired };
}

async function t_saveRoster(token, list, required) {
  const cfg = await asTeacher(token);
  const clean = new Map();
  for (const r of list || []) {
    const sid = str(r.sid).trim(), name = str(r.name).replace(/\s+/g, '');
    if (/^[0-9A-Za-z-]{3,12}$/.test(sid) && name) clean.set(sid, name);
  }
  const old = await db().list('roster');
  for (const r of old) if (!clean.has(r.id)) await db().del('roster', r.id);
  for (const [sid, name] of clean) {
    const o = old.find((r) => r.id === sid);
    if (!o || o.name !== name) await db().set('roster', sid, { name });
  }
  await db().set('config', 'app', { ...cfg, rosterRequired: !!required });
  return { count: clean.size };
}

async function t_settings(token) {
  const cfg = await asTeacher(token);
  return {
    gradingMode: cfg.gradingMode,
    provider: cfg.provider, geminiModel: cfg.geminiModel || '', claudeModel: cfg.claudeModel || '', thinking: cfg.thinking,
    showModelAnswer: !!cfg.showModelAnswer, allowRetake: !!cfg.allowRetake, keys: keyStatus(), model: modelName(cfg),
    customPw: !!cfg.pwHash
  };
}

async function t_saveSettings(token, s) {
  const cfg = await asTeacher(token);
  s = s || {};
  const next = { ...cfg };
  let relogin = false;
  if (s.newPw) {
    if (String(s.newPw).length < 4) throw new Error('비밀번호는 4자 이상이어야 합니다.');
    next.pwSalt = newSalt();
    next.pwHash = hashPw(s.newPw, next.pwSalt);
    next.pwVersion = (cfg.pwVersion || 0) + 1;
    relogin = true;
  }
  if (s.gradingMode === 'manual' || s.gradingMode === 'api') next.gradingMode = s.gradingMode;
  if (s.provider === 'gemini' || s.provider === 'claude') next.provider = s.provider;
  if (s.geminiModel !== undefined) next.geminiModel = str(s.geminiModel).trim();
  if (s.claudeModel !== undefined) next.claudeModel = str(s.claudeModel).trim();
  if (['low', 'medium', 'high'].includes(s.thinking)) next.thinking = s.thinking;
  if (s.showModelAnswer !== undefined) next.showModelAnswer = !!s.showModelAnswer;
  if (s.allowRetake !== undefined) next.allowRetake = !!s.allowRetake;
  await db().set('config', 'app', next);
  return { relogin };
}

async function t_testAI(token) {
  const cfg = await asTeacher(token);
  const t0 = Date.now();
  const [r] = await aiMany([{ system: 'JSON으로만 답한다.', parts: [{ text: '{"ok": true, "msg": "연결 성공"} 을 그대로 출력하라.' }], maxTokens: 2000 }], cfg);
  if (!r.ok) throw new Error(r.err);
  return { model: modelName(cfg), ms: Date.now() - t0, reply: r.data };
}

/* ============================== 라우터 ============================== */
const API = {
  login,
  s_home, s_intro, s_start, s_save, s_submit, s_grade, s_result, s_pdfInfo, s_pdfPart,
  t_attempts, t_attempt, t_updateScores, t_regrade, t_gradingExport, t_gradingImport, t_manualGrade, t_forceSubmit, t_deleteAttempt, t_gradePending, t_export,
  t_exams, t_exam, t_saveExam, t_publish, t_deleteExam,
  t_uploadStart, t_uploadPart, t_deleteUpload, t_extract, t_extractAnswers,
  t_roster, t_saveRoster, t_settings, t_saveSettings, t_testAI
};

export async function handle(fn, token, args) {
  try {
    const f = API[fn];
    if (!f) throw new Error('알 수 없는 요청입니다: ' + fn);
    const data = await f(token, ...(Array.isArray(args) ? args : []));
    return { ok: true, data: data === undefined ? null : data };
  } catch (e) {
    const msg = String(e && e.message || e);
    if (msg !== 'SESSION_EXPIRED') console.error(fn, e);
    return { ok: false, error: msg };
  }
}

export { fmt };
