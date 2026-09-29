// 교사: 시험 편집 (AI 추출 결과 검토 · 직접 입력 · 기존 시험 수정)
import { useEffect, useRef, useState } from 'react';
import { rpc, uploadFile } from '../api.js';
import RichText from '../lib/RichText.jsx';
import PdfViewer from '../lib/PdfViewer.jsx';

const blankQ = (n) => ({ no: String(n), qtype: '인문', prompt: '', points: '', lengthRule: '', minChars: '', maxChars: '', model: '', rubric: '', commentary: '' });

function Area({ label, value, onChange, rows = 4, preview }) {
  const [pv, setPv] = useState(false);
  return (
    <label className="area">
      <span className="row gap">{label}{preview && <button type="button" className="btn xs ghost" onClick={() => setPv(!pv)}>{pv ? '편집' : '미리보기'}</button>}</span>
      {pv ? <div className="preview"><RichText text={value || ''} /></div>
        : <textarea rows={rows} value={value ?? ''} onChange={(e) => onChange(e.target.value)} />}
    </label>
  );
}

export default function ExamEditor({ examId, draft, onClose }) {
  const [x, setX] = useState(null);
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);
  const [pdfMsg, setPdfMsg] = useState('');
  const origPdf = useRef('');

  useEffect(() => {
    if (examId) rpc('t_exam', examId).then((e) => { origPdf.current = e.pdfId || ''; setX({ ...e, id: examId }); }).catch((e) => setErr(e.message));
    else {
      const d = { kind: '기출', univ: '', year: '', type: '논술고사', track: '', title: '', minutes: '', notice: '', passage: '', overall: '', pdfId: '', published: false, ...draft };
      d.questions = (d.questions && d.questions.length ? d.questions : [{}]).map((q, i) => ({ ...blankQ(i + 1), ...q }));
      setX(d);
    }
  }, [examId, draft]);

  if (err && !x) return <div className="alert err">{err}</div>;
  if (!x) return <div className="muted pad">불러오는 중…</div>;

  const own = x.kind === '자체';
  const set = (k, v) => setX({ ...x, [k]: v });
  const setQ = (i, k, v) => setX({ ...x, questions: x.questions.map((q, j) => (j === i ? { ...q, [k]: v } : q)) });
  const moveQ = (i, d) => {
    const qs = [...x.questions];
    const j = i + d;
    if (j < 0 || j >= qs.length) return;
    [qs[i], qs[j]] = [qs[j], qs[i]];
    setX({ ...x, questions: qs });
  };
  const delQ = (i) => { if (window.confirm(`${x.questions[i].no}번 문항을 지울까요?`)) setX({ ...x, questions: x.questions.filter((_, j) => j !== i) }); };
  const addQ = () => setX({ ...x, questions: [...x.questions, blankQ(x.questions.length + 1)] });
  const total = x.questions.reduce((t, q) => t + (Number(q.points) || 0), 0);

  const pickPdf = async (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    if (!/\.pdf$/i.test(f.name)) { alert('PDF 파일만 올릴 수 있습니다. 한글에서 [PDF로 저장]한 뒤 올려 주세요.'); return; }
    setPdfMsg('올리는 중 0%');
    try {
      const id = await uploadFile(f, 'application/pdf', (p) => setPdfMsg(`올리는 중 ${Math.round(p * 100)}%`));
      if (x.pdfId && x.pdfId !== origPdf.current) rpc('t_deleteUpload', x.pdfId).catch(() => {});
      setX((cur) => ({ ...cur, pdfId: id }));
      setPdfMsg('');
    } catch (er) { setPdfMsg('실패: ' + er.message); }
  };

  const cancel = () => {
    if (!window.confirm('저장하지 않고 나갈까요?')) return;
    if (x.pdfId && x.pdfId !== origPdf.current) rpc('t_deleteUpload', x.pdfId).catch(() => {});
    onClose();
  };

  const save = async () => {
    setErr(''); setSaving(true);
    try {
      const { warnings, ...body } = x;
      await rpc('t_saveExam', body);
      onClose(`"${x.univ || x.title}" 시험을 저장했습니다.` + (x.published ? ' 학생에게 공개되었습니다.' : ' 아직 비공개입니다. [시험 관리]에서 공개할 수 있습니다.'));
    } catch (e) { setErr(e.message); window.scrollTo(0, 0); }
    setSaving(false);
  };

  return (
    <div className="editor">
      <div className="row gap wrap mb">
        <h2 className="m0">{examId ? '시험 수정' : '새 시험 검토 · 저장'} <span className="tag">{own ? '자체 모의논술' : '대학 기출'}</span></h2>
        <div className="grow" />
        <button className="btn" onClick={cancel}>취소</button>
        <button className="btn primary" onClick={save} disabled={saving}>{saving ? '저장 중…' : '저장'}</button>
      </div>
      {err && <div className="alert err">{err}</div>}
      {x.warnings && x.warnings.length > 0 && (
        <div className="alert warn"><b>확인할 점</b><ul>{x.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul></div>
      )}

      <div className="card">
        <div className="form-grid">
          <label>{own ? '대상 대학(선택)' : '대학 *'}<input value={x.univ} onChange={(e) => set('univ', e.target.value)} /></label>
          <label>학년도<input value={x.year} onChange={(e) => set('year', e.target.value)} /></label>
          {!own && (
            <label>구분<select value={x.type} onChange={(e) => set('type', e.target.value)}><option>논술고사</option><option>모의논술</option></select></label>
          )}
          <label>계열<input value={x.track} onChange={(e) => set('track', e.target.value)} /></label>
          <label>{own ? '회차명 *' : '부제(선택)'}<input value={x.title} onChange={(e) => set('title', e.target.value)} /></label>
          <label>시험 시간(분) *<input value={x.minutes} onChange={(e) => set('minutes', e.target.value)} inputMode="numeric" /></label>
        </div>
        <Area label="수험생 유의사항(대기 화면에 표시)" value={x.notice} onChange={(v) => set('notice', v)} rows={3} />
        <Area label="제시문 (수식은 $...$, 표는 | 칸 | 칸 |)" value={x.passage} onChange={(v) => set('passage', v)} rows={14} preview />
        <div className="pdf-box">
          <b>학생용 원본 PDF</b>{' '}
          {x.pdfId ? <span className="tag tag-real">있음</span> : <span className="muted">없음</span>}{' '}
          <label className="btn sm file-btn">{x.pdfId ? 'PDF 교체' : 'PDF 올리기'}<input type="file" accept=".pdf" hidden onChange={pickPdf} /></label>
          {x.pdfId && <button className="btn sm ghost" onClick={() => set('pdfId', '')}>제거</button>}
          <span className="muted small"> {pdfMsg || '그림·도표·수식이 많은 문제는 원본 PDF를 함께 보여 주세요.'}</span>
          {x.pdfId && examId && x.pdfId === origPdf.current && <details className="fold"><summary>현재 PDF 보기</summary><PdfViewer examId={examId} /></details>}
        </div>
      </div>

      <h3>문항 ({x.questions.length}개 · 총 {total}점)</h3>
      {x.questions.map((q, i) => (
        <div key={i} className="card q-edit">
          <div className="form-grid q-grid">
            <label>번호<input value={q.no} onChange={(e) => setQ(i, 'no', e.target.value)} /></label>
            <label>유형<select value={q.qtype} onChange={(e) => setQ(i, 'qtype', e.target.value)}>
              {[...new Set(['인문', '수리', '자료해석', '단답형', '단문형', '선택형', q.qtype].filter(Boolean))].map((t) => <option key={t}>{t}</option>)}
            </select></label>
            <label>배점 *<input value={q.points ?? ''} onChange={(e) => setQ(i, 'points', e.target.value)} inputMode="decimal" /></label>
            <label>분량 조건<input value={q.lengthRule} onChange={(e) => setQ(i, 'lengthRule', e.target.value)} placeholder="예: 600±60자" /></label>
            <label>최소 자<input value={q.minChars ?? ''} onChange={(e) => setQ(i, 'minChars', e.target.value)} inputMode="numeric" /></label>
            <label>최대 자<input value={q.maxChars ?? ''} onChange={(e) => setQ(i, 'maxChars', e.target.value)} inputMode="numeric" /></label>
            <div className="q-tools">
              <button className="btn xs" onClick={() => moveQ(i, -1)} title="위로">↑</button>
              <button className="btn xs" onClick={() => moveQ(i, 1)} title="아래로">↓</button>
              <button className="btn xs danger" onClick={() => delQ(i)}>삭제</button>
            </div>
          </div>
          <Area label="논제 *" value={q.prompt} onChange={(v) => setQ(i, 'prompt', v)} rows={3} preview />
          <Area label="예시답안 (채점의 기준이 됨)" value={q.model} onChange={(v) => setQ(i, 'model', v)} rows={6} preview />
          <Area label="채점 기준 (평가요소별 배점)" value={q.rubric} onChange={(v) => setQ(i, 'rubric', v)} rows={4} preview />
          <Area label="해설 · 출제 의도" value={q.commentary} onChange={(v) => setQ(i, 'commentary', v)} rows={4} preview />
        </div>
      ))}
      <button className="btn" onClick={addQ}>+ 문항 추가</button>
      <Area label="시험 총평 · 출제 의도(선택)" value={x.overall} onChange={(v) => set('overall', v)} rows={3} />

      <div className="card row gap wrap">
        <label className="check m0"><input type="checkbox" checked={!!x.published} onChange={(e) => set('published', e.target.checked)} /> 저장하면서 학생에게 공개</label>
        <div className="grow" />
        <button className="btn" onClick={cancel}>취소</button>
        <button className="btn primary" onClick={save} disabled={saving}>{saving ? '저장 중…' : '저장'}</button>
      </div>
    </div>
  );
}
