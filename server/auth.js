import crypto from 'node:crypto';

function secret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  // 별도 설정이 없으면 서비스 계정 키에서 유도 (브라우저에는 절대 노출되지 않음)
  return crypto.createHash('sha256').update('nonsul:' + (process.env.FIREBASE_SERVICE_ACCOUNT || 'local-dev')).digest('hex');
}

export function sign(obj) {
  const body = Buffer.from(JSON.stringify(obj)).toString('base64url');
  const sig = crypto.createHmac('sha256', secret()).update(body).digest('base64url');
  return body + '.' + sig;
}

export function verify(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) throw new Error('SESSION_EXPIRED');
  const [body, sig] = token.split('.');
  const exp = crypto.createHmac('sha256', secret()).update(body).digest('base64url');
  const a = Buffer.from(sig || ''), b = Buffer.from(exp);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw new Error('SESSION_EXPIRED');
  const obj = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  if (!obj.exp || obj.exp < Date.now()) throw new Error('SESSION_EXPIRED');
  return obj;
}

export function hashPw(pw, salt) {
  return crypto.scryptSync(String(pw), salt, 32).toString('hex');
}

export function newSalt() {
  return crypto.randomBytes(16).toString('hex');
}

export function samePw(pw, cfg) {
  if (cfg.pwHash && cfg.pwSalt) {
    const a = Buffer.from(hashPw(pw, cfg.pwSalt), 'hex'), b = Buffer.from(cfg.pwHash, 'hex');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }
  return String(pw) === String(process.env.TEACHER_PASSWORD || '2580');
}
