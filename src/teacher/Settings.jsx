// 교사: 설정 (비밀번호, AI 모델, 공개 옵션)
import { useEffect, useState } from 'react';
import { rpc } from '../api.js';

export default function Settings({ onLogout }) {
  const [s, setS] = useState(null);
  const [pw, setPw] = useState({ a: '', b: '' });
  const [msg, setMsg] = useState('');
  const [test, setTest] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () => rpc('t_settings').then(setS).catch((e) => setMsg(e.message));
  useEffect(() => { load(); }, []);

  if (!s) return <div className="muted pad">{msg || '불러오는 중…'}</div>;
  const set = (k, v) => setS({ ...s, [k]: v });

  const save = async () => {
    setBusy(true); setMsg('');
    try {
      await rpc('t_saveSettings', { gradingMode: s.gradingMode, provider: s.provider, geminiModel: s.geminiModel, claudeModel: s.claudeModel, thinking: s.thinking, showModelAnswer: s.showModelAnswer, allowRetake: s.allowRetake });
      setMsg('저장했습니다.');
      load();
    } catch (e) { setMsg(e.message); }
    setBusy(false);
  };

  const changePw = async () => {
    if (pw.a.length < 4) { setMsg('새 비밀번호는 4자 이상이어야 합니다.'); return; }
    if (pw.a !== pw.b) { setMsg('새 비밀번호 두 칸이 다릅니다.'); return; }
    try {
      await rpc('t_saveSettings', { newPw: pw.a });
      alert('비밀번호를 바꿨습니다. 새 비밀번호로 다시 로그인하세요.');
      onLogout();
    } catch (e) { setMsg(e.message); }
  };

  const runTest = async () => {
    setTest('확인 중…');
    try { await save(); const r = await rpc('t_testAI'); setTest(`✅ 연결 성공 — ${r.model}, ${(r.ms / 1000).toFixed(1)}초`); }
    catch (e) { setTest('❌ ' + e.message); }
  };

  const keyOk = s.provider === 'claude' ? s.keys.claude : s.keys.gemini;

  return (
    <div className="settings">
      <div className="card">
        <h3 className="m0">채점 방식</h3>
        <label className="check"><input type="radio" name="gm" checked={s.gradingMode !== 'api'} onChange={() => set('gradingMode', 'manual')} />
          <span><b>교사가 Claude 대화창에서 채점</b> (기본 · API 키 불필요) — 학생이 제출하면 '채점대기'로 두고, [응시 결과]에서 채점용 파일을 내보내 Claude에게 채점받은 뒤 결과를 가져오면 학생에게 공개됩니다.</span></label>
        <label className="check"><input type="radio" name="gm" checked={s.gradingMode === 'api'} onChange={() => set('gradingMode', 'api')} />
          <span><b>API로 즉시 자동 채점</b> — 제출 즉시 채점해 공개합니다. Vercel 환경변수에 API 키(유료)가 필요합니다.</span></label>
        <button className="btn primary" onClick={save} disabled={busy}>설정 저장</button>
      </div>

      {s.gradingMode === 'api' && (
      <div className="card">
        <h3 className="m0">API 자동 채점 설정</h3>
        <div className="seg">
          <button className={s.provider === 'claude' ? 'on' : ''} onClick={() => set('provider', 'claude')}>Anthropic Claude</button>
          <button className={s.provider === 'gemini' ? 'on' : ''} onClick={() => set('provider', 'gemini')}>Google Gemini</button>
        </div>
        <p className={keyOk ? 'ok-text' : 'err-text'}>
          API 키: {keyOk ? '설정됨' : '없음'} — Vercel 프로젝트의 환경변수 <code>{s.provider === 'claude' ? 'ANTHROPIC_API_KEY' : 'GEMINI_API_KEY'}</code>에 넣습니다(보안상 이 화면에서는 입력하지 않음).
          {s.keys.mock && ' (테스트 모드: 가짜 채점)'}
        </p>
        <div className="form-grid">
          {s.provider === 'gemini' ? (
            <>
              <label>Gemini 모델<input value={s.geminiModel} onChange={(e) => set('geminiModel', e.target.value)} placeholder="gemini-3.8-flash" /></label>
              <label>사고 수준<select value={s.thinking} onChange={(e) => set('thinking', e.target.value)}>
                <option value="low">low (빠름·저렴)</option><option value="medium">medium</option><option value="high">high (정밀·느림)</option>
              </select></label>
            </>
          ) : (
            <label>Claude 모델<input value={s.claudeModel} onChange={(e) => set('claudeModel', e.target.value)} placeholder="claude-sonnet-5" /></label>
          )}
        </div>
        <p className="muted small">현재 사용 모델: {s.model}. 비워 두면 기본 모델을 씁니다. 모델 이름이 바뀌면 여기에 새 이름을 적으세요.</p>
        <div className="row gap"><button className="btn" onClick={runTest}>연결 테스트</button><span>{test}</span></div>
      </div>
      )}

      <div className="card">
        <h3 className="m0">학생 화면</h3>
        <label className="check"><input type="checkbox" checked={s.showModelAnswer} onChange={(e) => set('showModelAnswer', e.target.checked)} /> 채점 후 예시답안·채점기준·해설을 학생에게 보여 주기</label>
        <label className="check"><input type="checkbox" checked={s.allowRetake} onChange={(e) => set('allowRetake', e.target.checked)} /> 같은 시험 다시 응시 허용</label>
        <button className="btn primary" onClick={save} disabled={busy}>설정 저장</button>
      </div>

      <div className="card">
        <h3 className="m0">교사 비밀번호 변경</h3>
        <p className="muted small">{s.customPw ? '변경한 비밀번호를 쓰고 있습니다.' : '초기 비밀번호(2580)를 쓰고 있습니다. 학생들이 추측하기 어렵게 바꾸는 것을 권합니다.'}</p>
        <div className="form-grid">
          <label>새 비밀번호<input type="password" value={pw.a} onChange={(e) => setPw({ ...pw, a: e.target.value })} /></label>
          <label>한 번 더<input type="password" value={pw.b} onChange={(e) => setPw({ ...pw, b: e.target.value })} /></label>
        </div>
        <button className="btn" onClick={changePw}>비밀번호 변경</button>
      </div>
      {msg && <div className="alert">{msg}</div>}
    </div>
  );
}
