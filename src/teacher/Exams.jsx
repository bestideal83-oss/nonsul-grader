// 교사: 시험 관리 (공개/비공개, 편집, 삭제)
import { useEffect, useState } from 'react';
import { rpc } from '../api.js';
import { fmtDate, examTypeLabel } from '../lib/util.js';
import BulkImport from './BulkImport.jsx';

export default function Exams({ onEdit, onNew }) {
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState('');
  const [kind, setKind] = useState('');
  const [bulk, setBulk] = useState(false);

  const load = () => rpc('t_exams').then(setRows).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, []);

  const toggle = async (e) => {
    try { await rpc('t_publish', e.id, !e.published); load(); } catch (x) { alert(x.message); }
  };
  const del = async (e) => {
    if (!window.confirm(`"${e.fullTitle}" 시험을 삭제할까요?\n학생 응시 기록은 남지만 문제·정답은 지워집니다.`)) return;
    try { await rpc('t_deleteExam', e.id); load(); } catch (x) { alert(x.message); }
  };

  const shown = (rows || []).filter((e) => !kind || e.kind === kind);

  return (
    <div>
      <div className="row gap wrap mb">
        <div className="seg sm">
          {[['', '전체'], ['기출', '대학 기출·모의'], ['자체', '자체 모의논술']].map(([k, l]) => (
            <button key={k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>{l}</button>
          ))}
        </div>
        <div className="grow" />
        <button className="btn primary" onClick={() => setBulk(!bulk)}>파일로 한꺼번에 가져오기</button>
        <button className="btn" onClick={() => onNew('기출')}>+ 기출 직접 입력</button>
        <button className="btn" onClick={() => onNew('자체')}>+ 자체 모의 직접 입력</button>
      </div>
      {bulk && <BulkImport existing={rows} onDone={load} onClose={() => setBulk(false)} />}
      {err && <div className="alert err">{err}</div>}
      {!rows && !err && <div className="muted pad">불러오는 중…</div>}
      {rows && (
        <div className="card table-wrap">
          <table className="tbl">
            <thead><tr><th>대학</th><th>학년도</th><th>구분</th><th>제목</th><th>문항</th><th>시간</th><th>PDF</th><th>응시</th><th>공개</th><th>수정일</th><th /></tr></thead>
            <tbody>
              {shown.map((e) => (
                <tr key={e.id}>
                  <td>{e.univ || '-'}</td>
                  <td>{e.year}</td>
                  <td><span className={'tag ' + (e.kind === '자체' ? 'tag-own' : e.type === '모의논술' ? 'tag-mock' : 'tag-real')}>{examTypeLabel(e)}</span></td>
                  <td>{e.title}</td>
                  <td className="nowrap">{e.qCount}문항 {e.totalPoints}점</td>
                  <td>{e.minutes}분</td>
                  <td>{e.hasPdf ? '○' : ''}</td>
                  <td>{e.attempts}</td>
                  <td>
                    <label className="switch" title={e.published ? '공개 중' : '비공개'}>
                      <input type="checkbox" checked={e.published} onChange={() => toggle(e)} /><span />
                    </label>
                  </td>
                  <td className="small nowrap">{fmtDate(e.updatedAt)}</td>
                  <td className="nowrap">
                    <button className="btn sm" onClick={() => onEdit(e.id)}>편집</button>{' '}
                    <button className="btn sm danger" onClick={() => del(e)}>삭제</button>
                  </td>
                </tr>
              ))}
              {!shown.length && <tr><td colSpan={11} className="muted center">등록된 시험이 없습니다. 위 탭에서 자료를 올려 만드세요.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
