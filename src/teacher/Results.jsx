// 교사: 응시 결과 목록 · 상세 · 엑셀 다운로드
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { rpc } from '../api.js';
import ResultView from '../pages/ResultView.jsx';
import FileGrading from './FileGrading.jsx';
import { fmtDate, pct, STATUS_TEXT } from '../lib/util.js';

export default function Results() {
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState('');
  const [exam, setExam] = useState('');
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(null);
  const [bg, setBg] = useState('');
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState('manual');
  const autoRan = useRef(false);

  const load = useCallback(() => rpc('t_attempts').then((r) => { setRows(r); return r; }).catch((e) => { setErr(e.message); return null; }), []);

  const processPending = useCallback(async (silent) => {
    setBg('시간이 지난 미제출 답안을 제출 처리하는 중…');
    try {
      const r = await rpc('t_gradePending');
      const msg = r.manual ? `시간이 지난 미제출 답안 ${r.finalized}건을 제출 처리했습니다.`
        : `처리 완료: 자동 제출 ${r.finalized}건, 채점 ${r.graded}건` + (r.failed ? `, 실패 ${r.failed}건` : '') + (r.remaining ? `, 남은 ${r.remaining}건(다시 누르세요)` : '');
      setBg(silent && !r.finalized && !r.graded && !r.failed ? '' : msg);
    } catch (e) { setBg('처리 중 오류: ' + e.message); }
    await load();
  }, [load]);

  useEffect(() => { rpc('t_settings').then((s) => setMode(s.gradingMode)).catch(() => {}); }, []);

  useEffect(() => {
    load().then((r) => {
      if (!r || autoRan.current) return;
      autoRan.current = true;
      const now = Date.now();
      const need = r.some((a) => ['pending', 'error'].includes(a.status) || (a.status === 'inprogress' && now > a.deadline + 180000));
      if (need) processPending(true);
    });
  }, [load, processPending]);

  const exams = useMemo(() => {
    const m = new Map();
    (rows || []).forEach((a) => m.set(a.examId, a.examTitle));
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1], 'ko'));
  }, [rows]);

  const shown = useMemo(() => (rows || []).filter((a) =>
    (!exam || a.examId === exam) && (!status || a.status === status) &&
    (!q || (a.sid + ' ' + a.name).includes(q.trim()))), [rows, exam, status, q]);

  const stats = useMemo(() => {
    const d = shown.filter((a) => a.status === 'done' && a.max);
    if (!d.length) return null;
    const ps = d.map((a) => (a.total / a.max) * 100);
    return { n: d.length, avg: Math.round(ps.reduce((t, x) => t + x, 0) / ps.length * 10) / 10, max: Math.round(Math.max(...ps) * 10) / 10, min: Math.round(Math.min(...ps) * 10) / 10 };
  }, [shown]);

  const excel = async () => {
    setBusy(true);
    try {
      let data = await rpc('t_export', exam || '');
      const ids = new Set(shown.map((a) => a.id));
      data = data.filter((r) => ids.has(r.summary.id));
      if (!data.length) { alert('내보낼 채점 완료 결과가 없습니다.'); setBusy(false); return; }
      const d = new Date();
      const name = (exam ? exams.find((x) => x[0] === exam)[1] : '전체') + `_${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
      const { downloadResults } = await import('../lib/excel.js');
      downloadResults(data, `논술채점_${name.replace(/[\\/:*?"<>|\s]+/g, '_')}.xlsx`);
    } catch (e) { alert(e.message); }
    setBusy(false);
  };

  const act = async (fn, id, confirmMsg) => {
    if (confirmMsg && !window.confirm(confirmMsg)) return;
    try { await rpc(fn, id); await load(); if (fn === 't_deleteAttempt') setSel(null); } catch (e) { alert(e.message); }
  };

  if (sel) {
    const a = (rows || []).find((x) => x.id === sel);
    return (
      <div>
        <div className="row gap wrap mb">
          <button className="btn sm ghost" onClick={() => { setSel(null); load(); }}>← 목록</button>
          <div className="grow" />
          {a && a.status === 'inprogress' && <button className="btn sm" onClick={() => act('t_forceSubmit', sel, '이 학생의 응시를 지금 종료하고 제출 처리할까요?')}>강제 종료</button>}
          <button className="btn sm danger" onClick={() => act('t_deleteAttempt', sel, '이 응시 기록을 삭제할까요? 되돌릴 수 없습니다.')}>기록 삭제</button>
        </div>
        <ResultView attemptId={sel} teacher onChanged={load} />
      </div>
    );
  }

  return (
    <div>
      <div className="row gap wrap mb">
        <select value={exam} onChange={(e) => setExam(e.target.value)}>
          <option value="">전체 시험</option>
          {exams.map(([id, t]) => <option key={id} value={id}>{t}</option>)}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">전체 상태</option>
          {Object.entries(STATUS_TEXT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <input placeholder="학번·이름 검색" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 150 }} />
        <div className="grow" />
        <button className="btn" onClick={() => load()}>새로고침</button>
        {mode === 'api' && <button className="btn" onClick={() => processPending(false)} disabled={!!bg && bg.includes('중…')}>밀린 채점 처리</button>}
        <button className="btn primary" onClick={excel} disabled={busy}>{busy ? '만드는 중…' : '엑셀 다운로드'}</button>
      </div>
      {bg && <div className="alert">{bg}</div>}
      {mode !== 'api' && rows && (
        <FileGrading examId={exam} pending={(rows || []).filter((a) => ['pending', 'error', 'grading'].includes(a.status) && (!exam || a.examId === exam)).length} onDone={load} />
      )}
      {err && <div className="alert err">{err}</div>}
      {stats && <div className="stat-row"><span>채점 완료 <b>{stats.n}</b>명</span><span>평균 <b>{stats.avg}</b>%</span><span>최고 <b>{stats.max}</b>%</span><span>최저 <b>{stats.min}</b>%</span></div>}
      {!rows && !err && <div className="muted pad">불러오는 중…</div>}
      {rows && (
        <div className="card table-wrap">
          <table className="tbl">
            <thead><tr><th>응시일</th><th>학번</th><th>이름</th><th>시험</th><th>상태</th><th>점수</th><th>제출</th><th /></tr></thead>
            <tbody>
              {shown.map((a) => (
                <tr key={a.id} className="clickable" onClick={() => setSel(a.id)}>
                  <td className="nowrap">{fmtDate(a.startedAt)}</td>
                  <td>{a.sid}</td>
                  <td>{a.name}</td>
                  <td>{a.examTitle}</td>
                  <td><span className={'st st-' + a.status} title={a.error}>{a.statusText}</span></td>
                  <td className="nowrap">{a.status === 'done' ? `${a.total}/${a.max} (${pct(a.total, a.max)}%)` : '-'}</td>
                  <td className="small">{a.mode}</td>
                  <td><button className="btn sm">보기</button></td>
                </tr>
              ))}
              {!shown.length && <tr><td colSpan={8} className="muted center">응시 기록이 없습니다.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
