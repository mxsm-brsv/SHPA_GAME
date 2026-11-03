// Слой Яндекс Карт (JavaScript API 3.0). Включается, если при сборке задан VITE_YANDEX_MAPS_KEY.
// Ключ бесплатный (кабинет разработчика Яндекса), в настройках ключа нужно указать адрес игры в «HTTP Referer».
// Копирайты и кнопку «Открыть в Яндекс Картах» не скрываем — это условие бесплатного использования.
import { MAP_BOUNDS, MAP_CENTER } from '../config/map';

/* eslint-disable @typescript-eslint/no-explicit-any */
declare global { interface Window { ymaps3?: any } }

let loading: Promise<any> | null = null;

export function yandexKey(): string | undefined {
  const k = import.meta.env.VITE_YANDEX_MAPS_KEY as string | undefined;
  return k && k.length > 10 ? k : undefined;
}

function loadApi(key: string): Promise<any> {
  if (loading) return loading;
  loading = new Promise((resolve, reject) => {
    if (window.ymaps3) { window.ymaps3.ready.then(() => resolve(window.ymaps3), reject); return; }
    const s = document.createElement('script');
    s.src = `https://api-maps.yandex.ru/v3/?apikey=${encodeURIComponent(key)}&lang=ru_RU`;
    s.onload = () => window.ymaps3 ? window.ymaps3.ready.then(() => resolve(window.ymaps3), reject) : reject(new Error('no ymaps3'));
    s.onerror = () => reject(new Error('Яндекс Карты не загрузились'));
    document.head.appendChild(s);
    setTimeout(() => reject(new Error('timeout')), 8000);
  });
  loading.catch(() => { loading = null; });
  return loading;
}

export interface YMarkerSpec { key: string; geo: [number, number]; html: string; onClick: () => void }

export interface YandexView {
  setMarkers(list: YMarkerSpec[]): void;
  setDraggable(on: boolean, onMoved: (key: string, geo: [number, number]) => void): void;
  focus(geo: [number, number], zoom?: number): void;
  destroy(): void;
}

export async function createYandexMap(container: HTMLElement): Promise<YandexView> {
  const key = yandexKey();
  if (!key) throw new Error('no key');
  const y = await loadApi(key);
  const { YMap, YMapDefaultSchemeLayer, YMapDefaultFeaturesLayer, YMapMarker } = y;
  const map = new YMap(container, {
    location: { center: [MAP_CENTER[1], MAP_CENTER[0]], zoom: 15.6 },
    theme: 'dark',
    zoomRange: { min: 14, max: 19 },
    restrictMapArea: [[MAP_BOUNDS[0][1], MAP_BOUNDS[0][0]], [MAP_BOUNDS[1][1], MAP_BOUNDS[1][0]]],
  });
  map.addChild(new YMapDefaultSchemeLayer({}));
  map.addChild(new YMapDefaultFeaturesLayer({}));

  let markers: { key: string; m: any; el: HTMLElement }[] = [];
  let drag = false;
  let onMoved: (key: string, geo: [number, number]) => void = () => {};

  const make = (spec: YMarkerSpec) => {
    const el = document.createElement('div');
    el.className = 'ymk';
    el.innerHTML = spec.html;
    el.addEventListener('click', (e) => { e.stopPropagation(); if (!drag) spec.onClick(); });
    const m = new YMapMarker({
      coordinates: [spec.geo[1], spec.geo[0]],
      draggable: drag,
      onDragEnd: (c: [number, number]) => onMoved(spec.key, [Math.round(c[1] * 1e6) / 1e6, Math.round(c[0] * 1e6) / 1e6]),
    }, el);
    map.addChild(m);
    return { key: spec.key, m, el };
  };

  let last: YMarkerSpec[] = [];
  const setMarkers = (list: YMarkerSpec[]) => {
    last = list;
    markers.forEach((x) => map.removeChild(x.m));
    markers = list.map(make);
  };
  const view: YandexView = {
    setMarkers,
    setDraggable(on, cb) {
      drag = on; onMoved = cb;
      setMarkers(last);
    },
    focus(geo, zoom) { map.update({ location: { center: [geo[1], geo[0]], zoom: zoom ?? 16.5, duration: 400 } }); },
    destroy() { try { map.destroy(); } catch { /* уже уничтожена */ } },
  };
  return view;
}
