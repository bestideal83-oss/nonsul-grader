// 교사: 학생 명단 (선택 기능 — 명단에 있는 학생만 로그인하게 할 수 있음)
import { useEffect, useState } from 'react';
import { rpc } from '../api.js';

const toText = (list) => list.map((r) => `${r.sid}\t${r.name}`).join('\n');
const parse = (text) => text.split('\n').map((l) => l.trim().split(/[\t,\s]+/)).filter((p) => p.length >= 2 && p[0]).map((p) => ({ sid: p[0], name: p.slice(1).join('') }));

export default function Roster() {
  const [text, setText] = useState('');
  const [required, setRequired] = useState(false);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    rpc('t_roster').then((r) => { setText(toText(r.list)); setRequired(r.required); }).catch((e) => setMsg(e.message));
  }, []);

  const fromExcel = async (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    try {
      const { readRosterFile } = await import('../lib/excel.js');
      const list = await readRosterFile(f);
      setText(toText(list));
      setMsg(`엑셀에서 ${list.length}명을 읽었습니다. [저장]을 눌러야 반영됩니다.`);
    } catch (x) { setMsg('엑셀을 읽지 못했습니다: ' + x.message); }
  };

  const save = async () => {
    setBusy(true);
    try {
      const r = await rpc('t_saveRoster', parse(text), required);
      setMsg(`${r.count}명을 저장했습니다.`);
    } catch (e) { setMsg(e.message); }
    setBusy(false);
  };

  const n = parse(text).length;

  return (
    <div className="card">
      <h2 className="m0">학생 명단</h2>
      <p className="muted">한 줄에 한 명씩 <b>학번 이름</b>을 적거나, 엑셀에서 두 열을 복사해 붙여 넣으세요. '학번'·'이름' 열이 있는 엑셀 파일도 읽을 수 있습니다.
        명단에 있는 학번은 이름이 맞아야 로그인됩니다.</p>
      <div className="row gap mb">
        <label className="btn sm file-btn">엑셀 파일에서 불러오기<input type="file" accept=".xlsx,.xls,.csv" hidden onChange={fromExcel} /></label>
        <span className="muted">현재 {n}명</span>
      </div>
      <textarea className="roster-ta" rows={16} value={text} onChange={(e) => setText(e.target.value)} placeholder={'30101\t김가온\n30102\t이나래'} />
      <label className="check"><input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} /> 명단에 있는 학생만 로그인 허용 (권장: 외부인이 시험 자료를 볼 수 없게 함)</label>
      {msg && <div className="alert">{msg}</div>}
      <button className="btn primary" onClick={save} disabled={busy}>{busy ? '저장 중…' : '저장'}</button>
    </div>
  );
}
