// 원본 PDF 보기 (Firestore에 조각으로 저장된 PDF를 받아 화면에 그림)
import { useEffect, useRef, useState } from 'react';
import { rpc } from '../api.js';

let pdfjsPromise = null;
function loadPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = Promise.all([
      import('pdfjs-dist/legacy/build/pdf.mjs'),
      import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url')
    ]).then(([lib, worker]) => {
      lib.GlobalWorkerOptions.workerSrc = worker.default;
      return lib;
    });
  }
  return pdfjsPromise;
}

const cache = {};

async function fetchPdf(examId) {
  if (cache[examId]) return cache[examId];
  const info = await rpc('s_pdfInfo', examId);
  let b64 = '';
  for (let i = 0; i < info.parts; i++) b64 += await rpc('s_pdfPart', examId, i);
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  cache[examId] = bytes;
  return bytes;
}

export default function PdfViewer({ examId }) {
  const box = useRef(null);
  const [msg, setMsg] = useState('원본 PDF를 불러오는 중…');
  const [zoom, setZoom] = useState(1);
  const [doc, setDoc] = useState(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [lib, bytes] = await Promise.all([loadPdfjs(), fetchPdf(examId)]);
        const d = await lib.getDocument({ data: bytes.slice() }).promise;
        if (alive) { setDoc(d); setMsg(''); }
      } catch (e) {
        if (alive) setMsg('PDF를 불러오지 못했습니다: ' + e.message);
      }
    })();
    return () => { alive = false; };
  }, [examId]);

  useEffect(() => {
    if (!doc || !box.current) return;
    let alive = true;
    const el = box.current;
    el.innerHTML = '';
    (async () => {
      const width = Math.max(300, el.clientWidth - 8);
      for (let p = 1; p <= doc.numPages && alive; p++) {
        const page = await doc.getPage(p);
        const base = page.getViewport({ scale: 1 });
        const scale = (width / base.width) * zoom;
        const vp = page.getViewport({ scale: scale * (window.devicePixelRatio || 1) });
        const c = document.createElement('canvas');
        c.width = vp.width; c.height = vp.height;
        c.style.width = (vp.width / (window.devicePixelRatio || 1)) + 'px';
        c.className = 'pdf-page';
        el.appendChild(c);
        await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
      }
    })();
    return () => { alive = false; };
  }, [doc, zoom]);

  return (
    <div className="pdf-viewer">
      {doc && (
        <div className="pdf-tools">
          <button className="btn sm" onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))}>－</button>
          <span>{Math.round(zoom * 100)}%</span>
          <button className="btn sm" onClick={() => setZoom((z) => Math.min(3, z + 0.25))}>＋</button>
          <span className="muted">{doc.numPages}쪽</span>
        </div>
      )}
      {msg && <div className="muted pad">{msg}</div>}
      <div ref={box} className="pdf-pages" />
    </div>
  );
}
