// 교사: 자료 올리기 → (파일 모드) 등록 요청 파일 → Claude 대화창 → 결과 가져오기 → 편집 화면
//                   (API 모드) AI 추출 → 편집 화면
// kind = '기출'(대학 논술고사·모의논술) | '자체'(자체 모의논술)
import { useEffect, useState } from 'react';
import { rpc, uploadFile } from '../api.js';
import { buildExamMd, downloadText, parseLooseJson, pickExamJson, examJsonToDraft, safeName } from '../lib/interchange.js';

const ROLES = [
  ['problem', '문제지', '필수 · 제시문과 논제가 있는 파일'],
  ['answer', '예시답안 · 정답', '선택'],
  ['commentary', '해설 · 채점기준', '선택 · 선행학습 영향평가 보고서 등']
];
const ACCEPT = '.hwp,.hwpx,.docx,.pdf,.png,.jpg,.jpeg,.webp,.txt';

export default function Upload({ kind, onDraft }) {
  const own = kind === '자체';
  const [meta, setMeta] = useState({ univ: '', year: '', type: own ? '자체모의논술' : '논술고사', track: '인문', minutes: '', title: '' });
  const [files, setFiles] = useState({ problem: [], answer: [], commentary: [] });
  const [paste, setPaste] = useState('');
  const [keepPdf, setKeepPdf] = useState(true);
  const [log, setLog] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [mode, setMode] = useState('manual');
  const [resFiles, setResFiles] = useState([]);
  const [resPaste, setResPaste] = useState('');
  const [made, setMade] = useState('');

  useEffect(() => { rpc('t_settings').then((x) => setMode(x.gradingMode)).catch(() => {}); }, []);

  const set = (k) => (e) => setMeta({ ...meta, [k]: e.target.value });
  const add = (role) => (e) => { setFiles({ ...files, [role]: [...files[role], ...Array.from(e.target.files)] }); e.target.value = ''; };
  const remove = (role, i) => setFiles({ ...files, [role]: files[role].filter((_, k) => k !== i) });
  const say = (m) => setLog((l) => [...l, m]);

  const manual = () => onDraft({
    kind, univ: meta.univ, year: meta.year, type: meta.type, track: meta.track, minutes: meta.minutes, title: meta.title,
    questions: [{ no: '1', qtype: '인문' }]
  });

  const check = () => {
    if (!own && !meta.univ.trim()) { setErr('대학명을 입력하세요.'); return false; }
    if (own && !meta.title.trim()) { setErr('회차명(제목)을 입력하세요.'); return false; }
    return true;
  };

  // ① 등록 요청 파일 만들기 (HWP·HWPX는 여기서 글자로 바꿔 파일 안에 넣음)
  const makeRequest = async () => {
    setErr(''); setMade('');
    if (!check()) return;
    if (!files.problem.length && !paste.trim()) { setErr('문제지 파일을 올리거나 문제 텍스트를 붙여 넣으세요.'); return; }
    setBusy(true); setLog([]);
    try {
      const { readForAI } = await import('../lib/files.js');
      const texts = [], attach = [];
      for (const [role] of ROLES) {
        for (const f of files[role]) {
          say(`📄 ${f.name} 읽는 중…`);
          const r = await readForAI(f);
          if (r.kind === 'text') {
            texts.push({ role, name: f.name, text: r.text });
            say(`   → 텍스트 ${r.text.length.toLocaleString()}자 (수식 ${(r.text.match(/\[수식/g) || []).length}개, 표 ${(r.text.match(/\[표\]/g) || []).length}개, 그림 ${(r.text.match(/\[그림\]/g) || []).length}개)`);
          } else {
            attach.push({ role, name: f.name });
            say('   → PDF·이미지: 요청 파일과 함께 Claude 대화창에 올려야 합니다.');
          }
        }
      }
      if (paste.trim()) texts.push({ role: 'problem', name: '붙여 넣은 문제 텍스트', text: paste });
      const name = `시험등록요청_${safeName(meta.univ || meta.title || '시험')}${meta.year ? '_' + meta.year : ''}.md`;
      downloadText(name, buildExamMd({ kind, meta, texts, attachNames: attach }));
      setMade(attach.length
        ? `"${name}"을 받았습니다. Claude 대화창에 이 파일과 함께 ${attach.map((a) => a.name).join(', ')} 파일을 올리고 "이 파일대로 시험 등록 JSON을 만들어 줘"라고 하세요.`
        : `"${name}"을 받았습니다. Claude 대화창에 이 파일을 올리고 "이 파일대로 시험 등록 JSON을 만들어 줘"라고 하세요.`);
      if (texts.some((t) => /\[그림\]/.test(t.text))) say('⚠️ 한글 파일에 그림이 있습니다. 그림 내용이 중요하면 한글에서 PDF로 저장해 함께 올리세요.');
    } catch (e) { setErr(e.message); }
    setBusy(false);
  };

  // ② Claude가 만든 결과(JSON) 가져오기 → 편집 화면
  const importResult = async () => {
    setErr('');
    if (!check()) return;
    setBusy(true);
    try {
      const docs = [];
      for (const f of resFiles) docs.push(...parseLooseJson(await f.text()));
      if (resPaste.trim()) docs.push(...parseLooseJson(resPaste));
      if (!docs.length) throw new Error('Claude가 만든 결과 파일을 고르거나, 답을 붙여 넣으세요.');
      const draft = examJsonToDraft(pickExamJson(docs), kind, meta);
      const pdf = files.problem.find((f) => /\.pdf$/i.test(f.name));
      if (keepPdf && pdf) {
        say(`📤 학생 화면용 원본 PDF(${pdf.name}) 올리는 중 0%`);
        draft.pdfId = await uploadFile(pdf, 'application/pdf', (p) => setLog((l) => [...l.slice(0, -1), `📤 학생 화면용 원본 PDF(${pdf.name}) 올리는 중 ${Math.round(p * 100)}%`]));
      } else if (keepPdf) {
        draft.warnings.push('학생 화면에 보여 줄 원본 PDF가 없습니다(필요하면 편집 화면에서 PDF를 올리세요).');
      }
      onDraft(draft);
    } catch (e) { setErr(e.message); }
    setBusy(false);
  };

  const run = async () => {
    setErr('');
    if (!own && !meta.univ.trim()) { setErr('대학명을 입력하세요.'); return; }
    if (own && !meta.title.trim()) { setErr('회차명(제목)을 입력하세요.'); return; }
    if (!files.problem.length && !paste.trim()) { setErr('문제지 파일을 올리거나 문제 텍스트를 붙여 넣으세요.'); return; }
    setBusy(true); setLog([]);
    const uploaded = [];
    try {
      const { readForAI } = await import('../lib/files.js');
      const out = [];
      for (const [role] of ROLES) {
        for (const f of files[role]) {
          say(`📄 ${f.name} 읽는 중…`);
          const r = await readForAI(f);
          if (r.kind === 'text') {
            out.push({ role, name: f.name, kind: 'text', text: r.text });
            say(`   → 텍스트 ${r.text.length.toLocaleString()}자 추출 (수식 ${(r.text.match(/\[수식/g) || []).length}개, 표 ${(r.text.match(/\[표\]/g) || []).length}개, 그림 ${(r.text.match(/\[그림\]/g) || []).length}개)`);
          } else {
            say('   → 서버로 올리는 중 0%');
            const id = await uploadFile(f, r.mime, (p) => setLog((l) => [...l.slice(0, -1), `   → 서버로 올리는 중 ${Math.round(p * 100)}%`]));
            uploaded.push(id);
            out.push({ role, name: f.name, kind: r.kind, mime: r.mime, uploadId: id });
          }
        }
      }
      if (paste.trim()) out.push({ role: 'problem', name: '붙여 넣은 문제 텍스트', kind: 'text', text: paste });
      const payload = { kind, meta, files: out, keepPdf };
      say('🤖 1/2 AI가 문제지에서 제시문·논제·배점을 나누는 중… (보통 1~3분)');
      const first = await rpc('t_extract', payload);
      say(`   → 문항 ${first.questions.length}개를 찾았습니다.`);
      say('🤖 2/2 AI가 문항별 예시답안·채점기준·해설을 정리하는 중… (보통 1~3분)');
      const draft = await rpc('t_extractAnswers', payload, first);
      for (const id of uploaded) if (id !== draft.pdfId) rpc('t_deleteUpload', id).catch(() => {});
      say('✅ 완료. 편집 화면에서 확인 후 저장하세요.');
      onDraft(draft);
    } catch (e) {
      setErr(e.message);
      for (const id of uploaded) rpc('t_deleteUpload', id).catch(() => {});
    }
    setBusy(false);
  };

  return (
    <div className="card">
      <h2 className="m0">{own ? '자체 모의논술 올리기' : '대학 기출 · 모의논술 올리기'}</h2>
      <p className="muted">
        {own ? '학교에서 만든 모의논술 문제·예시답안·채점기준으로 응시용 시험을 만듭니다.'
          : '대학이 공개한 논술고사·모의논술 문제와 예시답안·해설로 응시용 시험을 만듭니다.'}
        {mode === 'api'
          ? ' HWP·HWPX는 이 브라우저에서 텍스트로 바꿔 보내고, PDF·이미지는 AI가 직접 읽습니다.'
          : ' 자료를 고르고 등록 요청 파일을 만든 뒤, Claude 대화창에서 받은 결과를 가져오면 됩니다.'}
      </p>

      <div className="form-grid">
        {own
          ? <label>회차명 *<input value={meta.title} onChange={set('title')} placeholder="예: 3학년 1차 자체 모의논술" /></label>
          : <label>대학 *<input value={meta.univ} onChange={set('univ')} placeholder="예: 경북대학교" /></label>}
        {own && <label>대상 대학(선택)<input value={meta.univ} onChange={set('univ')} placeholder="비우면 '자체 모의논술(공통)'" /></label>}
        <label>학년도<input value={meta.year} onChange={set('year')} inputMode="numeric" placeholder="비우면 문제지에서 찾음" /></label>
        {!own && (
          <label>구분
            <select value={meta.type} onChange={set('type')}>
              <option>논술고사</option><option>모의논술</option>
            </select>
          </label>
        )}
        <label>계열
          <select value={meta.track} onChange={set('track')}>
            {['인문', '사회', '인문사회', '경상', '자연', '의학', '약술형', '기타'].map((x) => <option key={x}>{x}</option>)}
          </select>
        </label>
        <label>시험 시간(분)<input value={meta.minutes} onChange={set('minutes')} inputMode="numeric" placeholder="비우면 문제지에서 찾음" /></label>
        {!own && <label>부제(선택)<input value={meta.title} onChange={set('title')} placeholder="예: 오전 인문계열" /></label>}
      </div>

      {ROLES.map(([role, label, hint]) => (
        <div key={role} className="file-row">
          <div className="file-label"><b>{label}</b><span className="muted small"> {hint}</span></div>
          <div className="grow">
            {files[role].map((f, i) => (
              <span key={i} className="chip">{f.name} <button onClick={() => remove(role, i)} aria-label="삭제">×</button></span>
            ))}
            <label className="btn sm file-btn">파일 추가<input type="file" multiple accept={ACCEPT} onChange={add(role)} hidden /></label>
          </div>
        </div>
      ))}

      <details className="fold">
        <summary>문제 텍스트 직접 붙여 넣기 (선택)</summary>
        <textarea className="small-ta" rows={6} value={paste} onChange={(e) => setPaste(e.target.value)} placeholder="한글 파일에서 복사해 붙여 넣어도 됩니다." />
      </details>

      <label className="check"><input type="checkbox" checked={keepPdf} onChange={(e) => setKeepPdf(e.target.checked)} /> 문제지 PDF를 학생 응시 화면에 원본으로 함께 보여 주기 (그림·도표가 있는 문제에 권장)</label>

      {err && <div className="alert err">{err}</div>}
      {log.length > 0 && <pre className="log">{log.join('\n')}</pre>}

      {mode === 'api' ? (
        <div className="row gap">
          <button className="btn primary" onClick={run} disabled={busy}>{busy ? '처리 중…' : 'AI로 문항 만들기'}</button>
          <button className="btn" onClick={manual} disabled={busy}>파일 없이 직접 입력</button>
        </div>
      ) : (
        <ol className="steps">
          <li>
            <b>등록 요청 파일 만들기</b> — 한글 파일은 글자로 바꿔 넣고, PDF·이미지는 목록만 적습니다.
            <div className="row gap mt-s"><button className="btn primary" onClick={makeRequest} disabled={busy}>등록 요청 파일 만들기</button></div>
            {made && <div className="alert ok mt-s">{made}</div>}
          </li>
          <li><b>Claude 대화창에서 변환</b> — 요청 파일(과 PDF·이미지)을 claude.ai에 올리고 <code>이 파일대로 시험 등록 JSON을 만들어 줘</code>라고 합니다.</li>
          <li>
            <b>등록 결과 가져오기</b> — Claude가 만든 <code>.json</code> 파일을 올리거나 답을 붙여 넣으면 편집 화면이 열립니다.
            <div className="row gap wrap mt-s">
              <label className="btn sm file-btn">결과 파일 고르기<input type="file" accept=".json,.txt,.md" hidden onChange={(e) => { setResFiles(Array.from(e.target.files)); e.target.value = ''; }} /></label>
              {resFiles.map((f, i) => <span key={i} className="chip">{f.name} <button onClick={() => setResFiles([])}>×</button></span>)}
            </div>
            <textarea className="small-ta mt-s" rows={4} value={resPaste} onChange={(e) => setResPaste(e.target.value)} placeholder="또는 Claude의 답(JSON)을 여기에 붙여 넣기" />
            <div className="row gap">
              <button className="btn primary" onClick={importResult} disabled={busy}>등록 결과 가져오기</button>
              <button className="btn" onClick={manual} disabled={busy}>파일 없이 직접 입력</button>
            </div>
          </li>
        </ol>
      )}
    </div>
  );
}
