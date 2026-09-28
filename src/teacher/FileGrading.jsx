// 교사: Claude 대화창으로 채점하기 (채점용 파일 내보내기 → 결과 가져오기)
import { useState } from 'react';
import { rpc } from '../api.js';
import { buildGradingMd, downloadText, parseLooseJson, safeName, stamp } from '../lib/interchange.js';

export default function FileGrading({ examId, pending, onDone }) {
  const [size, setSize] = useState('10');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [files, setFiles] = useState([]);
  const [paste, setPaste] = useState('');
  const [overwrite, setOverwrite] = useState(false);
  const [report, setReport] = useState(null);

  const doExport = async () => {
    setBusy(true); setMsg(''); setReport(null);
    try {
      const groups = await rpc('t_gradingExport', examId || '');
      const n = Number(size) || 9999;
      const out = [];
      for (const g of groups) {
        const parts = Math.ceil(g.attempts.length / n);
        for (let i = 0; i < parts; i++) {
          const part = { exam: g.exam, attempts: g.attempts.slice(i * n, (i + 1) * n) };
          out.push({ name: `채점요청_${safeName(g.exam.fullTitle)}${parts > 1 ? `_${i + 1}of${parts}` : ''}.md`, text: buildGradingMd(part, i + 1, parts) });
        }
      }
      if (!out.length) { setMsg('채점을 기다리는 답안이 없습니다.'); setBusy(false); onDone && onDone(); return; }
      if (out.length === 1) downloadText(out[0].name, out[0].text);
      else {
        const JSZip = (await import('jszip')).default;
        const zip = new JSZip();
        out.forEach((f) => zip.file(f.name, '﻿' + f.text));
        downloadText(`채점요청_${stamp()}.zip`, await zip.generateAsync({ type: 'blob' }));
      }
      const total = groups.reduce((t, g) => t + g.attempts.length, 0);
      setMsg(`답안 ${total}건을 파일 ${out.length}개로 내보냈습니다${out.length > 1 ? '(압축 파일)' : ''}. Claude 대화창에 파일을 하나씩 올리고 "이 파일대로 채점해 줘"라고 하세요.`);
      onDone && onDone();
    } catch (e) { setMsg('내보내기 실패: ' + e.message); }
    setBusy(false);
  };

  const doImport = async () => {
    setBusy(true); setMsg(''); setReport(null);
    try {
      const docs = [];
      for (const f of files) docs.push(...parseLooseJson(await f.text()));
      if (paste.trim()) docs.push(...parseLooseJson(paste));
      if (!docs.length) throw new Error('가져올 결과 파일을 고르거나, Claude의 답을 붙여 넣으세요.');
      const r = await rpc('t_gradingImport', docs, overwrite);
      setReport(r);
      if (r.imported) { setFiles([]); setPaste(''); }
      onDone && onDone();
    } catch (e) { setMsg(e.message); }
    setBusy(false);
  };

  return (
    <div className="card file-grading">
      <h3 className="m0">Claude로 채점하기 <span className="muted small">채점대기 {pending}건</span></h3>
      <ol className="steps">
        <li>
          <b>채점용 파일 내보내기</b> — 채점을 기다리는 답안을 문제·예시답안·채점기준과 함께 파일로 받습니다. 학생 이름은 넣지 않습니다.
          <div className="row gap wrap mt-s">
            <label className="row gap m0">한 파일에
              <select value={size} onChange={(e) => setSize(e.target.value)}>
                <option value="5">5명</option><option value="10">10명</option><option value="15">15명</option><option value="all">전부</option>
              </select>
            </label>
            <button className="btn primary" onClick={doExport} disabled={busy}>채점용 파일 내보내기</button>
          </div>
        </li>
        <li><b>Claude 대화창에서 채점</b> — 받은 파일을 claude.ai 대화창에 올리고 <code>이 파일대로 채점해 줘</code>라고 합니다. 답안이 길면 한 파일에 5~10명씩이 안전합니다.</li>
        <li>
          <b>채점 결과 가져오기</b> — Claude가 만든 <code>.json</code> 파일을 올리거나, Claude의 답(JSON)을 복사해 붙여 넣습니다.
          <div className="row gap wrap mt-s">
            <label className="btn sm file-btn">결과 파일 고르기<input type="file" multiple accept=".json,.txt,.md" hidden onChange={(e) => { setFiles([...files, ...Array.from(e.target.files)]); e.target.value = ''; }} /></label>
            {files.map((f, i) => <span key={i} className="chip">{f.name} <button onClick={() => setFiles(files.filter((_, k) => k !== i))}>×</button></span>)}
          </div>
          <textarea className="small-ta mt-s" rows={4} value={paste} onChange={(e) => setPaste(e.target.value)} placeholder="또는 Claude의 답을 여기에 붙여 넣기 (```json … ``` 포함해도 됨)" />
          <div className="row gap wrap">
            <label className="check m0"><input type="checkbox" checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} /> 이미 채점된 답안도 덮어쓰기</label>
            <div className="grow" />
            <button className="btn primary" onClick={doImport} disabled={busy}>채점 결과 가져오기</button>
          </div>
        </li>
      </ol>
      {msg && <div className="alert">{msg}</div>}
      {report && (
        <div className={'alert ' + (report.imported ? 'ok' : 'warn')}>
          <b>{report.imported}건 반영</b>{report.imported ? ' — 학생 화면에 점수와 피드백이 공개되었습니다.' : ''}
          {report.skipped.length > 0 && (
            <ul>{report.skipped.map((s, i) => <li key={i}>{s.id}: {s.reason}</li>)}</ul>
          )}
        </div>
      )}
    </div>
  );
}
