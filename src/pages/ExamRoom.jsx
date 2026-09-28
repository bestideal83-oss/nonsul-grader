// 응시 화면: 제시문 + 문항별 답안, 타이머, 자동 저장, 시간 종료 시 자동 제출
import { useCallback, useEffect, useRef, useState } from 'react';
import { rpc } from '../api.js';
import RichText from '../lib/RichText.jsx';
import PdfViewer from '../lib/PdfViewer.jsx';
import { countChars, fmtClock, sleep } from '../lib/util.js';

const AUTOSAVE_MS = 30000;
const bkKey = (id) => 'nonsul.backup.' + id;
function readBackup(id) { try { return JSON.parse(localStorage.getItem(bkKey(id))); } catch (e) { return null; } }
function writeBackup(id, answers) { try { localStorage.setItem(bkKey(id), JSON.stringify({ ts: Date.now(), answers })); } catch (e) { /* 무시 */ } }
function clearBackup(id) { try { localStorage.removeItem(bkKey(id)); } catch (e) { /* 무시 */ } }

export default function ExamRoom({ examId, go }) {
  const [st, setSt] = useState(null);
  const [err, setErr] = useState('');
  const [answers, setAnswers] = useState({});
  const [now, setNow] = useState(Date.now());
  const [saveMsg, setSaveMsg] = useState('');
  const [tab, setTab] = useState('text');
  const [preview, setPreview] = useState({});
  const [submitting, setSubmitting] = useState('');
  const [warn, setWarn] = useState('');
  const ans = useRef({});
  const dirty = useRef(false);
  const done = useRef(false);
  const warned = useRef({});
  const stRef = useRef(null);

  // 시작 또는 이어서 응시
  useEffect(() => {
    rpc('s_start', examId).then((r) => {
      if (r.expired) { go('result', { attemptId: r.attemptId }); return; }
      let a = r.answers || {};
      const b = readBackup(r.attemptId);
      if (b && b.ts > (r.savedAt || 0) && b.answers) { a = { ...a, ...b.answers }; dirty.current = true; }
      ans.current = a;
      setAnswers(a);
      const s = { ...r, offset: r.serverNow - Date.now() };
      stRef.current = s;
      setSt(s);
      if (r.resumed) setSaveMsg('이전에 쓰던 답안을 불러왔습니다');
    }).catch((e) => setErr(e.message));
  }, [examId, go]);

  const save = useCallback(async () => {
    const s = stRef.current;
    if (!s || !dirty.current || done.current) return;
    dirty.current = false;
    setSaveMsg('저장 중…');
    try {
      const r = await rpc('s_save', s.attemptId, ans.current);
      if (r.closed) { done.current = true; clearBackup(s.attemptId); go('result', { attemptId: s.attemptId }); return; }
      if (r.late) { setSaveMsg('시험 시간이 끝났습니다'); return; }
      const d = new Date();
      setSaveMsg(`자동 저장됨 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`);
    } catch (e) {
      dirty.current = true;
      setSaveMsg('저장 실패 – 잠시 후 다시 시도합니다(이 기기에는 보관 중)');
    }
  }, [go]);

  const submit = useCallback(async (auto) => {
    const s = stRef.current;
    if (!s || done.current) return;
    if (!auto && !window.confirm('답안을 제출할까요? 제출하면 더 이상 고칠 수 없습니다.')) return;
    done.current = true;
    setSubmitting(auto ? '시험 시간이 끝나 답안을 제출하는 중…' : '답안을 제출하는 중…');
    for (let i = 0; i < 6; i++) {
      try {
        await rpc('s_submit', s.attemptId, ans.current, !!auto);
        clearBackup(s.attemptId);
        go('result', { attemptId: s.attemptId });
        return;
      } catch (e) {
        if (!auto && i === 0) { done.current = false; setSubmitting(''); alert('제출하지 못했습니다: ' + e.message); return; }
        setSubmitting('제출 연결이 불안정합니다. 다시 시도하는 중… (' + (i + 1) + '/6)');
        await sleep(3000);
      }
    }
    setSubmitting('제출 연결에 실패했습니다. 답안은 서버와 이 기기에 저장되어 있으며, 다시 로그인하면 자동 제출·채점됩니다.');
  }, [go]);

  // 1초 타이머
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // 자동 저장
  useEffect(() => {
    const t = setInterval(save, AUTOSAVE_MS);
    return () => clearInterval(t);
  }, [save]);

  // 창 닫기 경고
  useEffect(() => {
    const h = (e) => { if (!done.current) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, []);

  const remaining = st ? Math.min(st.deadline - (now + st.offset), st.exam.minutes * 60000) : 0;

  // 경고 · 자동 제출
  useEffect(() => {
    if (!st || done.current) return;
    for (const [ms, text] of [[600000, '종료 10분 전입니다.'], [300000, '종료 5분 전입니다. 마무리하세요.'], [60000, '종료 1분 전입니다! 시간이 끝나면 자동 제출됩니다.']]) {
      if (remaining <= ms && remaining > ms - 5000 && !warned.current[ms]) { warned.current[ms] = true; setWarn(text); setTimeout(() => setWarn(''), 15000); }
    }
    if (remaining <= 0) submit(true);
  }, [remaining, st, submit]);

  const onChange = (no, v) => {
    if (done.current || remaining <= 0) return;
    ans.current = { ...ans.current, [no]: v };
    setAnswers(ans.current);
    dirty.current = true;
    if (st) writeBackup(st.attemptId, ans.current);
  };

  if (err) return <div className="container pad"><div className="alert err">{err}</div><button className="btn" onClick={() => go('home')}>목록으로</button></div>;
  if (!st) return <div className="container pad muted">시험지를 준비하는 중…</div>;

  const e = st.exam;
  const low = remaining <= 300000;
  const over = remaining <= 0;

  return (
    <div className="exam-page">
      <header className="exam-bar">
        <div className="exam-bar-title">
          <b>{e.fullTitle}</b>
        </div>
        <div className={'timer' + (low ? ' low' : '')} title="남은 시간">⏱ {fmtClock(remaining)}</div>
        <div className="save-msg hide-sm">{saveMsg}</div>
        <button className="btn sm" onClick={() => { dirty.current = true; save(); }} disabled={!!submitting}>저장</button>
        <button className="btn primary sm" onClick={() => submit(false)} disabled={!!submitting}>제출</button>
      </header>
      {warn && <div className="warn-banner">{warn}</div>}
      {submitting && <div className="overlay"><div className="card pad center"><div className="spinner" />{submitting}</div></div>}

      <div className="exam-body">
        <section className="pane pane-passage">
          <div className="pane-tabs">
            <button className={tab === 'text' ? 'on' : ''} onClick={() => setTab('text')}>제시문</button>
            {e.hasPdf && <button className={tab === 'pdf' ? 'on' : ''} onClick={() => setTab('pdf')}>원본 문제지(PDF)</button>}
          </div>
          <div className="pane-scroll">
            {tab === 'text'
              ? (e.passage ? <RichText text={e.passage} className="passage" /> : <div className="muted pad">제시문은 [원본 문제지]를 보세요.</div>)
              : <PdfViewer examId={e.id} />}
          </div>
        </section>

        <section className="pane pane-answers">
          <div className="pane-scroll">
            {e.questions.map((q) => {
              const v = answers[q.no] || '';
              const c = countChars(v);
              const state = q.maxChars && c.withSpace > q.maxChars ? 'over' : q.minChars && c.withSpace < q.minChars ? 'under' : 'ok';
              return (
                <div key={q.no} className="q-block">
                  <div className="q-head">
                    <span className="q-no">[문항 {q.no}]</span>
                    <span className="tag">{q.points}점</span>
                    {q.qtype && <span className="tag tag-soft">{q.qtype}</span>}
                    {q.lengthRule && <span className="muted">분량: {q.lengthRule}</span>}
                  </div>
                  <RichText text={q.prompt} className="q-prompt" />
                  <textarea
                    className="answer" value={v} spellCheck={false} readOnly={over || !!submitting}
                    placeholder="여기에 답안을 작성하세요."
                    onChange={(x) => onChange(q.no, x.target.value)}
                    onBlur={save}
                  />
                  <div className="q-foot">
                    <span className={'count ' + state}>
                      공백 포함 <b>{c.withSpace}</b>자 · 공백 제외 {c.noSpace}자
                      {q.minChars || q.maxChars ? ` (기준 ${q.minChars || 0}~${q.maxChars || '∞'}자)` : ''}
                      {state === 'over' && ' · 초과'}{state === 'under' && ' · 부족'}
                    </span>
                    <button className="btn sm ghost" onClick={() => setPreview((p) => ({ ...p, [q.no]: !p[q.no] }))}>
                      {preview[q.no] ? '미리보기 닫기' : '수식 미리보기'}
                    </button>
                  </div>
                  {preview[q.no] && <div className="preview"><RichText text={v || '(내용 없음)'} /></div>}
                </div>
              );
            })}
            <div className="center pad">
              <button className="btn primary lg" onClick={() => submit(false)} disabled={!!submitting}>답안 제출</button>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
