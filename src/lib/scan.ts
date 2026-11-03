// Сканер QR: в Telegram — встроенный, в браузере — камера через BarcodeDetector (Chrome на Android).
// Где камеры нет (iPhone в браузере, компьютер) — возвращаем null, и игра просит ввести код под QR.
import { canScanQr, scanQr } from '../core/telegram';

interface Detector { detect(src: CanvasImageSource): Promise<{ rawValue: string }[]> }
type DetectorCtor = new (o: { formats: string[] }) => Detector;

const detectorCtor = (): DetectorCtor | null => (typeof window !== 'undefined' && 'BarcodeDetector' in window ? (window as unknown as { BarcodeDetector: DetectorCtor }).BarcodeDetector : null);

export const canScanAny = () => canScanQr() || (!!detectorCtor() && !!navigator.mediaDevices?.getUserMedia);

export async function scanAny(text = 'Наведи камеру на QR-код'): Promise<string | null> {
  if (canScanQr()) return scanQr(text);
  const Ctor = detectorCtor();
  if (!Ctor || !navigator.mediaDevices?.getUserMedia) return null;
  let stream: MediaStream;
  try { stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false }); } catch { return null; }
  return new Promise((resolve) => {
    const det = new Ctor({ formats: ['qr_code'] });
    const box = document.createElement('div');
    box.className = 'cam-scan';
    box.innerHTML = `<video playsinline muted></video><div class="cam-frame"></div><div class="cam-text"></div><button class="btn btn-ghost" type="button">Отмена</button>`;
    (box.querySelector('.cam-text') as HTMLElement).textContent = text;
    const video = box.querySelector('video') as HTMLVideoElement;
    video.srcObject = stream;
    document.body.appendChild(box);
    let done = false;
    const finish = (v: string | null) => {
      if (done) return;
      done = true;
      stream.getTracks().forEach((t) => t.stop());
      box.remove();
      resolve(v);
    };
    (box.querySelector('button') as HTMLButtonElement).addEventListener('click', () => finish(null));
    video.play().catch(() => finish(null));
    const loop = async () => {
      if (done) return;
      try {
        if (video.readyState >= 2) {
          const r = await det.detect(video);
          if (r[0]?.rawValue) { finish(r[0].rawValue); return; }
        }
      } catch { /* кадр не готов */ }
      setTimeout(loop, 250);
    };
    loop();
  });
}
