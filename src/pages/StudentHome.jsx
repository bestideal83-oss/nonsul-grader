import { useEffect, useMemo, useState } from 'react';
import { rpc } from '../api.js';
import { fmtDate, examTypeLabel, univLabel, pct } from '../lib/util.js';

export default function StudentHome({ session, go, onLogout }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [univ, setUniv] = useState(null);

  const load = () => { setErr(''); rpc('s_home').then(setData).catch((e) => setErr(e.message)); };
  useEffect(load, []);

  const groups = useMemo(() => {
    const m = new Map();
    (data ? data.exams : []).forEach((e) => {
      const k = univLabel(e);
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(e);
    });
    for (const list of m.values()) list.sort((a, b) => String(b.year).localeCompare(String(a.year)) || a.fullTitle.localeCompare(b.fullTitle));
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0], 'ko'));
  }, [data]);

  const attemptsByExam = useMemo(() => {
    const m = {};
    (data ? data.attempts : []).forEach((a) => { (m[a.examId] = m[a.examId] || []).push(a); });
    return m;
  }, [data]);

  const current = univ && groups.find((g) => g[0] === univ);

  return (
    <div className="page">
      <header className="topbar">
        <div className="brand sm">✍️ 논술 기출 풀이</div>
        <div className="grow" />
        <span className="muted">{session.sid} {session.name}</span>
        <button className="btn sm ghost" onClick={onLogout}>로그아웃</button>
      </header>
      <main className="container">
        {err && <div className="alert err">{err} <button className="btn sm" onClick={load}>다시 시도</button></div>}
        {!data && !err && <div className="muted pad">불러오는 중…</div>}

        {data && !current && (
          <>
            <h2>대학 선택</h2>
            {!groups.length && <div className="card muted">아직 공개된 시험이 없습니다.</div>}
            <div className="grid-cards">
              {groups.map(([name, list]) => (
                <button key={name} className="card univ-card" onClick={() => setUniv(name)}>
                  <div className="univ-name">{name}</div>
                  <div className="muted">시험 {list.length}개 · {[...new Set(list.map((e) => e.year).filter(Boolean))].slice(0, 4).join(', ')}</div>
                </button>
              ))}
            </div>
          </>
        )}

        {data && current && (
          <>
            <div className="row gap">
              <button className="btn sm ghost" onClick={() => setUniv(null)}>← 대학 목록</button>
              <h2 className="m0">{current[0]}</h2>
            </div>
            <div className="exam-list">
              {current[1].map((e) => {
                const mine = attemptsByExam[e.id] || [];
                const open = mine.find((a) => a.status === 'inprogress');
                const last = mine.find((a) => a.status === 'done');
                return (
                  <div key={e.id} className="card exam-item">
                    <div className="grow">
                      <div className="row gap wrap">
                        {e.year && <span className="tag">{e.year}학년도</span>}
                        <span className={'tag ' + (e.kind === '자체' ? 'tag-own' : e.type === '모의논술' ? 'tag-mock' : 'tag-real')}>{examTypeLabel(e)}</span>
                        {e.track && <span className="tag tag-soft">{e.track}</span>}
                      </div>
                      <div className="exam-title">{e.title || `${e.univ} ${e.year ? e.year + '학년도 ' : ''}${examTypeLabel(e)}`}</div>
                      <div className="muted">{e.qCount}문항 · {e.totalPoints}점 · {e.minutes}분
                        {last && <> · 최근 점수 <b>{last.total}</b>/{last.max}</>}
                        {mine.length > 0 && <> · 응시 {mine.length}회</>}
                      </div>
                    </div>
                    <button className="btn primary" onClick={() => go('intro', { examId: e.id })}>{open ? '이어서 응시' : '응시하기'}</button>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {data && data.attempts.length > 0 && (
          <>
            <h2 className="mt">내 응시 기록</h2>
            <div className="card table-wrap">
              <table className="tbl">
                <thead><tr><th>응시일</th><th>시험</th><th>상태</th><th>점수</th><th /></tr></thead>
                <tbody>
                  {data.attempts.map((a) => (
                    <tr key={a.id}>
                      <td className="nowrap">{fmtDate(a.startedAt)}</td>
                      <td>{a.examTitle}</td>
                      <td><span className={'st st-' + a.status}>{a.statusText}</span></td>
                      <td className="nowrap">{a.total !== null && a.status === 'done' ? `${a.total} / ${a.max} (${pct(a.total, a.max)}%)` : '-'}</td>
                      <td className="nowrap right">
                        {a.status === 'inprogress'
                          ? <button className="btn sm" onClick={() => go('exam', { examId: a.examId })}>이어서 응시</button>
                          : <button className="btn sm" onClick={() => go('result', { attemptId: a.id })}>결과 보기</button>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
