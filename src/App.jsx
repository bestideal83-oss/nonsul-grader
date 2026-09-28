import { useEffect, useState } from 'react';
import { getSession, setSession, setOnExpired } from './api.js';
import Login from './pages/Login.jsx';
import StudentHome from './pages/StudentHome.jsx';
import Intro from './pages/Intro.jsx';
import ExamRoom from './pages/ExamRoom.jsx';
import ResultView from './pages/ResultView.jsx';
import TeacherHome from './teacher/TeacherHome.jsx';

export default function App() {
  const [session, setS] = useState(getSession());
  const [view, setView] = useState({ name: 'home' });

  useEffect(() => {
    setOnExpired(() => { setSession(null); setS(null); setView({ name: 'home' }); });
  }, []);

  const login = (s) => { setSession(s); setS(s); setView({ name: 'home' }); };
  const logout = () => { setSession(null); setS(null); setView({ name: 'home' }); };
  const go = (name, params = {}) => { setView({ name, ...params }); window.scrollTo(0, 0); };

  if (!session) return <Login onLogin={login} />;

  if (session.role === 'teacher') return <TeacherHome onLogout={logout} />;

  switch (view.name) {
    case 'intro': return <Intro examId={view.examId} go={go} />;
    case 'exam': return <ExamRoom examId={view.examId} go={go} />;
    case 'result': return <ResultView attemptId={view.attemptId} onBack={() => go('home')} />;
    default: return <StudentHome session={session} go={go} onLogout={logout} />;
  }
}
