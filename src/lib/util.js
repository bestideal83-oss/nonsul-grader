export const STATUS_TEXT = { inprogress: '응시중', pending: '채점대기', grading: '채점중', done: '채점완료', error: '채점오류' };

export function fmtDate(ms) {
  if (!ms) return '';
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function fmtClock(ms) {
  ms = Math.max(0, ms);
  const t = Math.ceil(ms / 1000);
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
  const p = (n) => String(n).padStart(2, '0');
  return h ? `${h}:${p(m)}:${p(s)}` : `${p(m)}:${p(s)}`;
}

export function countChars(s) {
  s = String(s || '').replace(/\r/g, '');
  return { withSpace: s.replace(/\n/g, '').length, noSpace: s.replace(/\s/g, '').length };
}

export function finalScore(g) {
  return g.teacherScore !== null && g.teacherScore !== undefined && g.teacherScore !== '' ? Number(g.teacherScore) : Number(g.score || 0);
}

export function pct(total, max) {
  if (total === null || total === undefined || !max) return '';
  return Math.round((total / max) * 1000) / 10;
}

export function examTypeLabel(e) {
  if (e.kind === '자체') return '자체 모의논술';
  return e.type || '논술고사';
}

export function univLabel(e) {
  return e.univ || (e.kind === '자체' ? '자체 모의논술(공통)' : '미분류');
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
