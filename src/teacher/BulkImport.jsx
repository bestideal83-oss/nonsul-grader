// 교사: 시험 여러 개를 파일로 한꺼번에 가져오기 (Claude가 만든 시험 JSON, 여러 파일·묶음 파일 가능)
import { useState } from 'react';
import { rpc } from '../api.js';
import { parseLooseJson, collectExamJsons, examJsonToDraft } from '../lib/interchange.js';
import { examTypeLabel } from '../lib/util.js';

const key = (e) => [e.univ, e.year, e.kind === '자체' ? '자체' : e.type, e.title].map((x) => String(x || '').trim()).join('|');

export default function BulkImport({ existing, onDone, onClose }) {
  const [files, setFiles] = useState([]);
  const [drafts, setDrafts] = useState(null);
  const [publish, setPublish] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [log, setLog] = useState([]);

  const have = new Set((existing || []).map(key));

  const read = async (list) => {
    setMsg(''); setLog([]);
    try {
      const docs = [];
      for (const f of list) docs.push(...parseLooseJson(await f.text()));
      const exams = collectExamJsons(docs);
      if (!exams.length) throw new Error('시험 데이터(문항 목록이 있는 JSON)를 찾지 못했습니다.');
      setDrafts(exams.map((o) => {
        const d = examJsonToDraft(o);
        return { d, dup: have.has(key(d)), on: !have.has(key(d)) };
      }));
    } catch (e) { setDrafts(null); setMsg(e.message); }
  };

  const run = async () => {
    setBusy(true); setLog([]);
    let ok = 0;
    for (const x of drafts.filter((y) => y.on)) {
      const { warnings, ...body } = x.d;
      const label = `${x.d.univ} ${x.d.year} ${examTypeLabel(x.d)}${x.d.title ? ' · ' + x.d.title : ''}`;
      try {
        await rpc('t_saveExam', { ...body, published: publish });
        ok++;
        setLog((l) => [...l, `✅ ${label}`]);
      } catch (e) {
        setLog((l) => [...l, `❌ ${label}: ${e.message}`]);
      }
    }
    setLog((l) => [...l, `— ${ok}개 저장 완료${publish ? '(학생에게 공개)' : '(비공개: 아래 목록에서 확인 후 공개하세요)'}`]);
    setBusy(false);
    onDone && onDone();
  };

  const toggleAll = (v) => setDrafts(drafts.map((x) => ({ ...x, on: v })));
  const n = drafts ? drafts.filter((x) => x.on).length : 0;

  return (
    <div className="card bulk">
      <div className="row gap">
        <h3 className="m0">시험 파일로 한꺼번에 가져오기</h3>
        <div className="grow" />
        <button className="btn sm ghost" onClick={onClose}>닫기</button>
      </div>
      <p className="muted small">Claude가 만든 시험 JSON 파일(여러 개 선택 가능, 여러 시험이 든 묶음 파일도 가능)을 올리면 시험이 한꺼번에 만들어집니다. 같은 대학·학년도·구분·제목의 시험이 이미 있으면 기본으로 건너뜁니다.</p>
      <label className="btn sm file-btn">JSON 파일 고르기<input type="file" multiple accept=".json,.txt,.md" hidden onChange={(e) => { const l = Array.from(e.target.files); e.target.value = ''; setFiles(l); read(l); }} /></label>
      {files.length > 0 && <span className="muted small"> {files.map((f) => f.name).join(', ')}</span>}
      {msg && <div className="alert err mt-s">{msg}</div>}
      {drafts && (
        <>
          <div className="row gap mt-s">
            <b>{drafts.length}개 시험 발견</b>
            <button className="btn xs" onClick={() => toggleAll(true)}>모두 선택</button>
            <button className="btn xs" onClick={() => toggleAll(false)}>모두 해제</button>
          </div>
          <div className="table-wrap mt-s">
            <table className="tbl small">
              <thead><tr><th /><th>대학</th><th>학년도</th><th>구분</th><th>제목</th><th>문항</th><th>총점</th><th>시간</th><th>확인</th></tr></thead>
              <tbody>
                {drafts.map((x, i) => (
                  <tr key={i}>
                    <td><input type="checkbox" checked={x.on} onChange={(e) => setDrafts(drafts.map((y, k) => (k === i ? { ...y, on: e.target.checked } : y)))} /></td>
                    <td>{x.d.univ}</td><td>{x.d.year}</td><td>{examTypeLabel(x.d)}</td><td>{x.d.title}</td>
                    <td>{x.d.questions.length}</td>
                    <td>{x.d.questions.reduce((t, q) => t + (Number(q.points) || 0), 0)}</td>
                    <td>{x.d.minutes || <span className="err-text">없음</span>}분</td>
                    <td className="small">{x.dup ? <span className="st st-pending">이미 있음</span> : x.d.warnings.length ? <span title={x.d.warnings.join('\n')}>⚠️ {x.d.warnings.length}건</span> : '✓'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="row gap wrap mt-s">
            <label className="check m0"><input type="checkbox" checked={publish} onChange={(e) => setPublish(e.target.checked)} /> 가져오면서 바로 학생에게 공개</label>
            <div className="grow" />
            <button className="btn primary" onClick={run} disabled={busy || !n}>{busy ? '저장 중…' : `선택한 ${n}개 가져오기`}</button>
          </div>
        </>
      )}
      {log.length > 0 && <pre className="log mt-s">{log.join('\n')}</pre>}
    </div>
  );
}
