// Vercel 서버 함수: 화면의 모든 요청이 이 한 곳으로 들어옵니다 (POST /api/rpc).
import { handle } from '../server/app.js';

export const config = { maxDuration: 300 };

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'POST만 허용됩니다.' });
    return;
  }
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  body = body || {};
  const out = await handle(body.fn, body.token, body.args);
  res.status(200).json(out);
}
