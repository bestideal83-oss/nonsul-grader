// 교사용 엑셀 다운로드 (요약 + 문항별 상세)
import * as XLSX from 'xlsx';
import { fmtDate, finalScore, pct, examTypeLabel } from './util.js';

const list = (a) => (Array.isArray(a) ? a.filter(Boolean).map((x) => '· ' + x).join('\n') : '');

export function downloadResults(rows, filename) {
  const summary = [];
  const detail = [];
  for (const r of rows) {
    const s = r.summary, g = r.grading || { questions: [] }, e = r.exam || {};
    const total = g.questions.reduce((t, q) => t + finalScore(q), 0);
    summary.push({
      학번: s.sid, 이름: s.name, 대학: e.univ || '', 연도: e.year || '', 구분: e.kind ? examTypeLabel(e) : '',
      시험: s.examTitle, 응시시작: fmtDate(s.startedAt), 제출: fmtDate(s.submittedAt), 제출방식: s.mode,
      총점: total, 만점: g.max, '백분율(%)': pct(total, g.max),
      문항별점수: g.questions.map((q) => `${q.no}번 ${finalScore(q)}/${q.points}`).join(', '),
      교사총평: g.teacherOverall || ''
    });
    for (const q of g.questions) {
      const ans = (r.answers || {})[q.no] || '';
      const prompt = ((e.questions || []).find((x) => x.no === q.no) || {}).prompt || '';
      detail.push({
        학번: s.sid, 이름: s.name, 시험: s.examTitle, 문항: q.no, 논제: prompt.slice(0, 300),
        배점: q.points, AI점수: q.score, 교사점수: q.teacherScore ?? '', 최종점수: finalScore(q),
        한줄평: q.oneLine || '',
        기준별점수: (q.criteria || []).map((c) => `${c.기준}: ${c.득점}/${c.배점}`).join('\n'),
        잘한점: list(q.strengths),
        감점사유: (q.deductions || []).map((d) => `· ${d.내용}${d.감점 ? ` (-${d.감점})` : ''}${d.학생답안 ? `\n  답안: ${d.학생답안}` : ''}${d.예시답안대조 ? `\n  대조: ${d.예시답안대조}` : ''}`).join('\n'),
        누락논점: list(q.missing), 보완방향: q.improve || '', 분량평가: q.lengthNote || '',
        교사코멘트: q.teacherComment || '',
        '글자수(공백포함)': q.chars ? q.chars.withSpace : '', 답안: ans
      });
    }
  }
  const wb = XLSX.utils.book_new();
  const ws1 = XLSX.utils.json_to_sheet(summary);
  ws1['!cols'] = [8, 8, 12, 6, 12, 30, 16, 16, 16, 6, 6, 9, 40, 30].map((w) => ({ wch: w }));
  XLSX.utils.book_append_sheet(wb, ws1, '요약');
  const ws2 = XLSX.utils.json_to_sheet(detail);
  ws2['!cols'] = [8, 8, 30, 5, 40, 5, 7, 7, 7, 30, 30, 40, 60, 40, 50, 25, 30, 8, 80].map((w) => ({ wch: w }));
  XLSX.utils.book_append_sheet(wb, ws2, '문항별 상세');
  XLSX.writeFile(wb, filename);
}

/** 학생 명단 엑셀 읽기: '학번','이름' 열을 찾고, 없으면 앞의 두 열 */
export async function readRosterFile(file) {
  const buf = await file.arrayBuffer();
  let wb;
  if (/\.(csv|txt)$/i.test(file.name)) {
    // 한국어 CSV는 UTF-8 또는 EUC-KR(엑셀 기본)로 저장됨
    let text;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(buf); }
    catch (e) { text = new TextDecoder('euc-kr').decode(buf); }
    wb = XLSX.read(text.replace(/^﻿/, ''), { type: 'string' });
  } else {
    wb = XLSX.read(buf, { type: 'array' });
  }
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false });
  let si = 0, ni = 1, start = 0;
  for (let r = 0; r < Math.min(rows.length, 10); r++) {
    const row = (rows[r] || []).map((c) => String(c || '').replace(/\s/g, ''));
    const a = row.findIndex((c) => c === '학번'), b = row.findIndex((c) => c === '이름' || c === '성명');
    if (a >= 0 && b >= 0) { si = a; ni = b; start = r + 1; break; }
  }
  return rows.slice(start).map((r) => ({ sid: String(r[si] || '').trim(), name: String(r[ni] || '').trim() }))
    .filter((r) => r.sid && r.name);
}
