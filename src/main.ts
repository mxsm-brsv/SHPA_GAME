import './fonts/fonts.css';
import './styles.css';
import { App } from './ui/app';

// Высота окна: берём фактическую высоту страницы при каждом изменении. Переменную Telegram «стабильной высоты»
// не используем — после сворачивания мини-приложения она может остаться маленькой, и игра сжималась в полоску.
const setAppH = () => document.documentElement.style.setProperty('--app-h', `${window.innerHeight}px`);
setAppH();
window.addEventListener('resize', setAppH);
window.visualViewport?.addEventListener('resize', setAppH);
document.addEventListener('visibilitychange', () => { if (!document.hidden) setTimeout(setAppH, 50); });

const root = document.getElementById('app')!;
const app = new App(root);
app.start().catch((e) => {
  console.error(e);
  root.innerHTML = `<div style="padding:24px;text-align:center">Что-то пошло не так. Обнови страницу.<br><small>${String(e?.message ?? e)}</small></div>`;
});
// для отладки из консоли
(window as unknown as { pbApp: App }).pbApp = app;
