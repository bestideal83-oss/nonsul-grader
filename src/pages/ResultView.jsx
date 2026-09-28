// 채점 결과 · 문항별 피드백 (학생·교사 공용, 교사는 점수 조정 가능)
import { useCallback, useEffect, useRef, useState } from 'react';
import { rpc } from '../api.js';
import RichText from '../lib/RichText.jsx';
import PdfViewer from '../lib/PdfViewer.jsx';
import { fmtDate, finalScore, pct, sleep, STATUS_TEXT } from '../lib/util.js';

function Fold({ title, children, open = false }) {
  return <details className="fold" open={open}><summary>{title}</summary><div className="fold-body">{children}</div></details>;
}

export default function ResultView({ attemptId, onBack, teacher = false, onChanged }) {
  const [r, setR] = useState(null);
  const [err, setErr] = useState('');
  const [grading, setGrading] = useState('');
  const [edits, setEdits] = useState({});
  const [overall, setOverall] = useState('');
  const [saving, setSaving] = useState(false);
  const tries = useRef(0);
  const alive = useRef(true);

  const load = useCallback(async () => {
    const x = await rpc(teacher ? 't_attempt' : 's_result', attemptId);
    if (!alive.current) return x;
    setR(x);
    if (x.grading) {
      const e = {};
      x.grading.questions.forEach((q) => { e[q.no] = { teacherScore: q.teacherScore ?? '', teacherComment: q.teacherComment || '' }; });
      setEdits(e);
      setOverall(x.grading.teacherOverall || '');
    }
    return x;
  }, [attemptId, teacher]);

  // 학생: 채점이 안 끝났으면 채점을 요청하고 결과를 기다림
  const runGrading = useCallback(async () => {
    setGrading('AI가 답안을 채점하고 있습니다. 보통 30초~2분 걸립니다…');
    await sleep(Math.random() * 4000);
    while (alive.current) {
      let st;
      try { st = (await rpc('s_grade', attemptId)).status; } catch (e) { st = 'error'; }
      const x = await load().catch(() => null);
      if (!alive.current) return;
      const s = x ? x.status : st;
      if (s === 'done') { setGrading(''); return; }
      if (s === 'grading' || s === 'pending') { await sleep(8000); continue; }
      tries.current++;
      if (tries.current >= 3) { setGrading(''); return; }
      setGrading(`채점 요청이 몰려 다시 시도합니다(${tries.current}/3)…`);
      await sleep(15000 + Math.random() * 10000);
    }
  }, [attemptId, load]);

  useEffect(() => {
    alive.current = true;
    load().then((x) => {
      if (!teacher && x && x.gradingMode === 'api' && ['pending', 'grading', 'error'].includes(x.status)) runGrading();
    }).catch((e) => setErr(e.message));
    return () => { alive.current = false; };
  }, [load, runGrading, teacher]);

  const saveScores = async () => {
    setSaving(true);
    try {
      await rpc('t_updateScores', attemptId, Object.entries(edits).map(([no, v]) => ({ no, ...v })), overall);
      await load();
      onChanged && onChanged();
      alert('저장했습니다. 학생 화면에도 반영됩니다.');
    } catch (e) { alert(e.message); }
    setSaving(false);
  };

  const manualGrade = async () => {
    setSaving(true);
    try {
      await rpc('t_manualGrade', attemptId, Object.entries(edits).map(([no, v]) => ({ no, ...v })), overall);
      await load();
      onChanged && onChanged();
    } catch (e) { alert(e.message); }
    setSaving(false);
  };

  const regrade = async () => {
    if (r.status === 'done' && !window.confirm('AI로 다시 채점할까요? 교사가 조정한 점수와 코멘트는 지워집니다.')) return;
    setGrading('AI가 다시 채점하고 있습니다…');
    try { await rpc('t_regrade', attemptId); } catch (e) { alert(e.message); }
    await load().catch(() => {});
    setGrading('');
    onChanged && onChanged();
  };

  if (err) return <div className="container pad"><div className="alert err">{err}</div>{onBack && <button className="btn" onClick={onBack}>돌아가기</button>}</div>;
  if (!r) return <div className="container pad muted">불러오는 중…</div>;

  const g = r.grading;
  const ex = r.exam || { questions: [] };
  const manual = r.gradingMode !== 'api';
  const ungraded = !g && ['pending', 'error', 'grading'].includes(r.status);
  const total = g ? g.questions.reduce((t, q) => t + finalScore(q), 0) : null;

  return (
    <div className={teacher ? '' : 'page'}>
      {!teacher && (
        <header className="topbar">
          <button className="btn sm ghost" onClick={onBack}>← 목록</button>
          <div className="grow" />
        </header>
      )}
      <main className={teacher ? '' : 'container'}>
        <div className="card result-head">
          <div className="grow">
            <div className="muted">{r.sid} {r.name} · {fmtDate(r.startedAt)} 응시 · {r.mode || STATUS_TEXT[r.status]}</div>
            <h2 className="m0">{r.examTitle}</h2>
          </div>
          {g ? (
            <div className="score-big">
              <b>{total}</b><span> / {g.max}</span>
              <small>{pct(total, g.max)}%</small>
            </div>
          ) : <span className={'st st-' + r.status}>{STATUS_TEXT[r.status]}</span>}
        </div>

        {grading && <div className="card pad center"><div className="spinner" />{grading}</div>}
        {!teacher && manual && ungraded && (
          <div className="card pad center waiting">
            <div className="big-emoji">📨</div>
            <b>답안이 제출되었습니다.</b>
            <div className="muted">선생님이 채점하면 이 화면에서 점수와 문항별 피드백을 볼 수 있습니다. 목록의 [결과 보기]로 다시 들어오세요.</div>
          </div>
        )}
        {teacher && manual && ungraded && (
          <div className="alert">채점 대기 중인 답안입니다. [응시 결과] 목록의 <b>채점용 파일 내보내기</b>로 Claude에게 채점을 맡기거나, 아래 각 문항에 점수를 넣고 <b>직접 채점 저장</b>을 누르세요.</div>
        )}
        {!grading && !g && !manual && r.status === 'error' && (
          <div className="alert err">
            채점 중 오류가 났습니다: {r.error}
            {!teacher && <> <button className="btn sm" onClick={() => { tries.current = 0; runGrading(); }}>다시 채점 요청</button></>}
          </div>
        )}
        {!grading && !g && teacher && r.status === 'inprogress' && <div className="alert">아직 응시 중입니다(마감 {fmtDate(r.deadline)}).</div>}

        {teacher && (
          <div className="row gap wrap mb">
            {!manual && ['pending', 'error', 'done', 'grading'].includes(r.status) && <button className="btn" onClick={regrade} disabled={!!grading}>{r.status === 'done' ? 'AI 재채점' : '지금 채점'}</button>}
            {g && <button className="btn primary" onClick={saveScores} disabled={saving}>{saving ? '저장 중…' : '교사 조정 저장'}</button>}
            {ungraded && <button className="btn primary" onClick={manualGrade} disabled={saving}>{saving ? '저장 중…' : '직접 채점 저장'}</button>}
          </div>
        )}

        {((g && (g.teacherOverall || teacher)) || (teacher && ungraded)) && (
          <div className="card">
            <h3 className="m0">선생님 총평</h3>
            {teacher
              ? <textarea className="small-ta" value={overall} onChange={(e) => setOverall(e.target.value)} placeholder="학생에게 보여 줄 총평(선택)" />
              : <p className="pre">{g.teacherOverall}</p>}
          </div>
        )}

        {ex.passage && <Fold title="제시문 다시 보기"><RichText text={ex.passage} className="passage" /></Fold>}
        {ex.hasPdf && <Fold title="원본 문제지(PDF) 보기"><PdfViewer examId={ex.id} /></Fold>}

        {ex.questions.map((q) => {
          const gq = g && g.questions.find((x) => x.no === q.no);
          const ans = (r.answers || {})[q.no] || '';
          const ed = edits[q.no] || { teacherScore: '', teacherComment: '' };
          return (
            <div key={q.no} className="card q-result">
              <div className="q-result-head">
                <div className="grow">
                  <span className="q-no">[문항 {q.no}]</span> <span className="muted">{q.points}점{q.lengthRule ? ` · 분량 ${q.lengthRule}` : ''}</span>
                </div>
                {gq && (
                  <div className="q-score">
                    <b>{finalScore(gq)}</b> / {gq.points}
                    {gq.teacherScore !== null && gq.teacherScore !== undefined && gq.teacherScore !== '' && <small className="tag tag-own">교사 조정 (AI {gq.score})</small>}
                  </div>
                )}
              </div>
              <RichText text={q.prompt} className="q-prompt" />
              {gq && gq.oneLine && <div className="oneline">💬 {gq.oneLine}</div>}

              {gq && (
                <>
                  {gq.criteria.length > 0 && (
                    <table className="tbl small crit">
                      <thead><tr><th>평가 요소</th><th>점수</th><th>판단 근거</th></tr></thead>
                      <tbody>{gq.criteria.map((c, i) => <tr key={i}><td>{c.기준}</td><td className="nowrap">{c.득점} / {c.배점}</td><td>{c.근거}</td></tr>)}</tbody>
                    </table>
                  )}
                  {gq.strengths.length > 0 && (
                    <div className="fb good"><h4>잘한 점</h4><ul>{gq.strengths.map((s, i) => <li key={i}>{s}</li>)}</ul></div>
                  )}
                  {gq.deductions.length > 0 && (
                    <div className="fb bad">
                      <h4>감점 이유 (예시답안과 대조)</h4>
                      <ol>
                        {gq.deductions.map((d, i) => (
                          <li key={i}>
                            <div><b>{d.내용}</b>{d.감점 ? <span className="minus"> −{d.감점}점</span> : null}</div>
                            {d.학생답안 && <div className="quote">내 답안: 「{d.학생답안}」</div>}
                            {d.예시답안대조 && <div className="contrast">예시답안 대조: {d.예시답안대조}</div>}
                          </li>
                        ))}
                      </ol>
                    </div>
                  )}
                  {gq.missing.length > 0 && <div className="fb miss"><h4>빠뜨린 핵심 논점</h4><ul>{gq.missing.map((s, i) => <li key={i}>{s}</li>)}</ul></div>}
                  {gq.improve && <div className="fb tip"><h4>보완 방향</h4><p>{gq.improve}</p></div>}
                  {gq.lengthNote && <div className="muted small">📏 {gq.lengthNote} (공백 포함 {gq.chars ? gq.chars.withSpace : 0}자)</div>}
                  {!teacher && gq.teacherComment && <div className="fb teacher"><h4>선생님 코멘트</h4><p className="pre">{gq.teacherComment}</p></div>}
                  {teacher && (
                    <div className="teacher-edit">
                      <label>교사 점수
                        <input type="number" step="0.5" min="0" max={gq.points} value={ed.teacherScore}
                          placeholder={'AI ' + gq.score}
                          onChange={(e) => setEdits({ ...edits, [q.no]: { ...ed, teacherScore: e.target.value } })} />
                      </label>
                      <label className="grow">학생에게 보일 코멘트
                        <textarea className="small-ta" value={ed.teacherComment}
                          onChange={(e) => setEdits({ ...edits, [q.no]: { ...ed, teacherComment: e.target.value } })} />
                      </label>
                    </div>
                  )}
                </>
              )}

              {!gq && teacher && ungraded && (
                <div className="teacher-edit">
                  <label>점수 (0~{q.points})
                    <input type="number" step="0.5" min="0" max={q.points} value={ed.teacherScore}
                      onChange={(e) => setEdits({ ...edits, [q.no]: { ...ed, teacherScore: e.target.value } })} />
                  </label>
                  <label className="grow">학생에게 보일 코멘트
                    <textarea className="small-ta" value={ed.teacherComment}
                      onChange={(e) => setEdits({ ...edits, [q.no]: { ...ed, teacherComment: e.target.value } })} />
                  </label>
                </div>
              )}
              <Fold title={`${teacher ? '학생' : '내'} 답안 (공백 포함 ${ans.replace(/\r|\n/g, '').length}자)`} open={!gq}>
                <div className="answer-view pre">{ans || '(작성하지 않음)'}</div>
              </Fold>
              {q.model && <Fold title="예시답안"><RichText text={q.model} /></Fold>}
              {q.rubric && <Fold title="채점 기준"><RichText text={q.rubric} /></Fold>}
              {q.commentary && <Fold title="해설 · 출제 의도"><RichText text={q.commentary} /></Fold>}
            </div>
          );
        })}
        {ex.overall && <Fold title="시험 총평 · 출제 의도"><RichText text={ex.overall} /></Fold>}
        {g && <div className="muted small center pad">채점: {g.model} · {fmtDate(g.gradedAt)}{g.model === '교사 직접 채점' ? '' : ' — AI 채점은 참고용이며 선생님이 조정할 수 있습니다.'}</div>}
      </main>
    </div>
  );
}
