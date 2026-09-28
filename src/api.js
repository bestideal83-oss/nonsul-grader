// 서버(/api/rpc) 호출과 로그인 정보 보관
const KEY = 'nonsul.session';

export function getSession() {
  try { return JSON.parse(sessionStorage.getItem(KEY)); } catch (e) { return null; }
}
export function setSession(s) {
  try { if (s) sessionStorage.setItem(KEY, JSON.stringify(s)); else sessionStorage.removeItem(KEY); } catch (e) { /* 무시 */ }
}

let onExpired = () => {};
export function setOnExpired(f) { onExpired = f; }

export async function rpc(fn, ...args) {
  const s = getSession();
  let res;
  try {
    res = await fetch('/api/rpc', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ fn, token: s && s.token, args })
    });
  } catch (e) {
    throw new Error('서버에 연결할 수 없습니다. 인터넷 연결을 확인하세요.');
  }
  let j;
  try { j = await res.json(); } catch (e) {
    if (res.status === 504) throw new Error('서버 응답 시간이 초과되었습니다. 잠시 후 다시 시도하세요.');
    if (res.status === 413) throw new Error('보내는 자료가 너무 큽니다.');
    throw new Error('서버 오류(' + res.status + ')');
  }
  if (!j.ok) {
    if (j.error === 'SESSION_EXPIRED') { onExpired(); throw new Error('로그인이 만료되었습니다. 다시 로그인하세요.'); }
    throw new Error(j.error);
  }
  return j.data;
}

/* ---------- 큰 파일(PDF·이미지)을 조각으로 나눠 올리기 ---------- */
const CHUNK = 900000;

export function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] || '');
    r.onerror = () => reject(new Error('파일을 읽지 못했습니다: ' + file.name));
    r.readAsDataURL(file);
  });
}

export async function uploadFile(file, mime, onProgress) {
  const b64 = await fileToBase64(file);
  const parts = Math.max(1, Math.ceil(b64.length / CHUNK));
  const { id } = await rpc('t_uploadStart', file.name, mime, parts);
  for (let i = 0; i < parts; i++) {
    await rpc('t_uploadPart', id, i, b64.slice(i * CHUNK, (i + 1) * CHUNK));
    if (onProgress) onProgress((i + 1) / parts);
  }
  return id;
}
