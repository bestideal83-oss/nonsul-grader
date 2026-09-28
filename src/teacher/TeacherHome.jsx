import { useState } from 'react';
import Results from './Results.jsx';
import Upload from './Upload.jsx';
import Exams from './Exams.jsx';
import Roster from './Roster.jsx';
import Settings from './Settings.jsx';
import ExamEditor from './ExamEditor.jsx';

const TABS = [
  ['results', '응시 결과'],
  ['upload-gichul', '기출·모의논술 올리기'],
  ['upload-own', '자체 모의논술 올리기'],
  ['exams', '시험 관리'],
  ['roster', '학생 명단'],
  ['settings', '설정']
];

export default function TeacherHome({ onLogout }) {
  const [tab, setTab] = useState('results');
  const [editing, setEditing] = useState(null); // {examId} 또는 {draft}
  const [notice, setNotice] = useState('');

  const openEditor = (x) => { setEditing(x); window.scrollTo(0, 0); };
  const closeEditor = (msg) => { setEditing(null); if (msg) { setNotice(msg); setTab('exams'); } };

  return (
    <div className="page">
      <header className="topbar">
        <div className="brand sm">✍️ 논술 채점 · 교사</div>
        <div className="grow" />
        <button className="btn sm ghost" onClick={onLogout}>로그아웃</button>
      </header>
      <nav className="tabs">
        {TABS.map(([k, label]) => (
          <button key={k} className={tab === k && !editing ? 'on' : ''} onClick={() => { setEditing(null); setNotice(''); setTab(k); }}>{label}</button>
        ))}
      </nav>
      <main className="container wide">
        {notice && !editing && <div className="alert ok">{notice}</div>}
        {editing ? <ExamEditor {...editing} onClose={closeEditor} /> : (
          <>
            {tab === 'results' && <Results />}
            {tab === 'upload-gichul' && <Upload kind="기출" onDraft={(draft) => openEditor({ draft })} />}
            {tab === 'upload-own' && <Upload kind="자체" onDraft={(draft) => openEditor({ draft })} />}
            {tab === 'exams' && <Exams onEdit={(examId) => openEditor({ examId })} onNew={(kind) => openEditor({ draft: { kind, questions: [{}] } })} />}
            {tab === 'roster' && <Roster />}
            {tab === 'settings' && <Settings onLogout={onLogout} />}
          </>
        )}
      </main>
    </div>
  );
}
