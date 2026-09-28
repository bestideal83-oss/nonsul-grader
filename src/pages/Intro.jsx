// 대기 화면 (논술고사 안내)
import { useEffect, useState } from 'react';
import { rpc } from '../api.js';
import RichText from '../lib/RichText.jsx';
import { examTypeLabel } from '../lib/util.js';

const RULES = [
  '[시작]을 누르는 순간부터 시험 시간이 흐릅니다. 창을 닫거나 새로고침해도 시간은 멈추지 않습니다.',
  '답안은 자동으로 저장됩니다. 연결이 끊겨도 같은 학번으로 다시 로그인하면 이어서 쓸 수 있습니다.',
  '시간이 끝나면 그때까지 쓴 답안이 자동으로 제출됩니다. 먼저 끝냈다면 [제출] 버튼을 누르세요.',
  '글자 수는 띄어쓰기를 포함해 셉니다(공백 제외 글자 수도 함께 표시). 분량 조건을 지키세요.',
  '수식은 x^2, sqrt(x), a/b 처럼 쓰거나 $x^2$ 처럼 $로 감싸 쓰면 미리보기로 확인할 수 있습니다.',
  '제출하면 AI가 채점해 점수와 문항별 피드백을 바로 보여 줍니다.'
];

export default function Intro({ examId, go }) {
  const [e, setE] = useState(null);
  const [err, setErr] = useState('');
  const [agree, setAgree] = useState(false);

  useEffect(() => { rpc('s_intro', examId).then(setE).catch((x) => setErr(x.message)); }, [examId]);

  return (
    <div className="page">
      <header className="topbar">
        <button className="btn sm ghost" onClick={() => go('home')}>← 목록</button>
        <div className="grow" />
      </header>
      <main className="container narrow">
        {err && <div className="alert err">{err}</div>}
        {!e && !err && <div className="muted pad">불러오는 중…</div>}
        {e && (
          <div className="card intro">
            <div className="intro-univ">{e.univ || '자체 모의논술'}</div>
            <h1 className="intro-title">{e.year ? e.year + '학년도 ' : ''}{examTypeLabel(e)}{e.title ? ' · ' + e.title : ''}</h1>
            {e.track && <div className="muted center">{e.track} 계열</div>}
            <div className="intro-stats">
              <div><b>{e.minutes}</b><span>분</span><small>시험 시간</small></div>
              <div><b>{e.qCount}</b><span>문항</span><small>문항 수</small></div>
              <div><b>{e.totalPoints}</b><span>점</span><small>총점</small></div>
            </div>
            <table className="tbl small">
              <thead><tr><th>문항</th><th>배점</th><th>분량 조건</th></tr></thead>
              <tbody>
                {e.questions.map((q) => <tr key={q.no}><td>{q.no}번{q.qtype ? ` (${q.qtype})` : ''}</td><td>{q.points}점</td><td>{q.lengthRule || '-'}</td></tr>)}
              </tbody>
            </table>
            {e.notice && (<><h3>수험생 유의사항</h3><div className="notice"><RichText text={e.notice} /></div></>)}
            <h3>응시 안내</h3>
            <ol className="rules">{RULES.map((r) => <li key={r}>{r}</li>)}</ol>
            <label className="check"><input type="checkbox" checked={agree} onChange={(x) => setAgree(x.target.checked)} /> 안내를 모두 읽었습니다.</label>
            <button className="btn primary block lg" disabled={!agree} onClick={() => go('exam', { examId })}>시작</button>
          </div>
        )}
      </main>
    </div>
  );
}
