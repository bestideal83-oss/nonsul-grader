// Firestore 저장소 어댑터 (서버 전용, firebase-admin 사용)
// 브라우저는 Firestore에 직접 접근하지 않으므로 보안 규칙은 "모두 거부"로 두면 됩니다.
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

let impl = null;

/** 테스트용: 메모리 DB 등으로 교체 */
export function setDb(d) { impl = d; }

export function db() {
  if (!impl) impl = firestoreDb();
  return impl;
}

export function serviceAccount() {
  const raw = (process.env.FIREBASE_SERVICE_ACCOUNT || '').trim();
  if (!raw) throw new Error('서버 설정 누락: Vercel 환경변수 FIREBASE_SERVICE_ACCOUNT를 넣어 주세요.');
  const json = raw.startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8');
  const sa = JSON.parse(json);
  if (sa.private_key) sa.private_key = sa.private_key.replace(/\\n/g, '\n');
  return sa;
}

function firestoreDb() {
  const app = getApps()[0] || initializeApp({ credential: cert(serviceAccount()) });
  // 데이터베이스 ID를 (default)가 아닌 이름으로 만들었다면 Vercel 환경변수 FIRESTORE_DATABASE_ID에 그 이름을 넣음
  const dbId = (process.env.FIRESTORE_DATABASE_ID || '').trim();
  const fs = dbId && dbId !== '(default)' ? getFirestore(app, dbId) : getFirestore(app);
  try { fs.settings({ ignoreUndefinedProperties: true }); } catch (e) { /* 이미 설정됨 */ }

  const ref = (c, id) => fs.collection(c).doc(id);
  const snap = (s) => (s.exists ? { id: s.id, ...s.data() } : null);
  const query = (c, filters) => {
    let q = fs.collection(c);
    for (const [k, op, v] of filters || []) q = q.where(k, op, v);
    return q;
  };

  return {
    newId: () => fs.collection('_ids').doc().id,
    get: async (c, id) => snap(await ref(c, id).get()),
    set: (c, id, o) => ref(c, id).set(o),
    update: (c, id, o) => ref(c, id).update(o),
    del: (c, id) => ref(c, id).delete(),
    list: async (c, filters) => (await query(c, filters).get()).docs.map((d) => ({ id: d.id, ...d.data() })),
    /** 트랜잭션: 읽기(get/list)를 모두 끝낸 뒤 쓰기(set/update/del) */
    tx: (fn) => fs.runTransaction((t) => fn({
      get: async (c, id) => snap(await t.get(ref(c, id))),
      list: async (c, filters) => (await t.get(query(c, filters))).docs.map((d) => ({ id: d.id, ...d.data() })),
      set: (c, id, o) => { t.set(ref(c, id), o); },
      update: (c, id, o) => { t.update(ref(c, id), o); },
      del: (c, id) => { t.delete(ref(c, id)); }
    })),
    /** 하위 컬렉션 문서 일괄 삭제 */
    delAll: async (c) => {
      const docs = (await fs.collection(c).get()).docs;
      for (let i = 0; i < docs.length; i += 400) {
        const b = fs.batch();
        docs.slice(i, i + 400).forEach((d) => b.delete(d.ref));
        await b.commit();
      }
    }
  };
}
