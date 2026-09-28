import { useState } from 'react';
import { rpc } from '../api.js';

export default function Login({ onLogin }) {
  const [role, setRole] = useState('student');
  const [sid, setSid] = useState('');
  const [name, setName] = useState('');
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const submit = async (ev) => {
    ev.preventDefault();
    setErr(''); setBusy(true);
    try {
      const r = role === 'teacher' ? await rpc('login', 'teacher', pw) : await rpc('login', 'student', sid, name);
      onLogin(r);
    } catch (e) { setErr(e.message); }
    setBusy(false);
  };

  return (
    <div className="login-wrap">
      <form className="card login-card" onSubmit={submit}>
        <div className="brand">✍️ 논술 기출 풀이·채점</div>
        <div className="seg">
          <button type="button" className={role === 'student' ? 'on' : ''} onClick={() => { setRole('student'); setErr(''); }}>학생</button>
          <button type="button" className={role === 'teacher' ? 'on' : ''} onClick={() => { setRole('teacher'); setErr(''); }}>교사</button>
        </div>
        {role === 'student' ? (
          <>
            <label>학번<input value={sid} onChange={(e) => setSid(e.target.value)} inputMode="numeric" placeholder="예: 30215" autoFocus /></label>
            <label>이름<input value={name} onChange={(e) => setName(e.target.value)} placeholder="예: 홍길동" /></label>
          </>
        ) : (
          <label>교사 비밀번호<input type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoFocus /></label>
        )}
        {err && <div className="alert err">{err}</div>}
        <button className="btn primary block" disabled={busy}>{busy ? '확인 중…' : '로그인'}</button>
      </form>
    </div>
  );
}
