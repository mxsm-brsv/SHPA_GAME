import './fonts/fonts.css';
import './styles.css';
import { App } from './ui/app';

const root = document.getElementById('app')!;
const app = new App(root);
app.start().catch((e) => {
  console.error(e);
  root.innerHTML = `<div style="padding:24px;text-align:center">Что-то пошло не так. Обнови страницу.<br><small>${String(e?.message ?? e)}</small></div>`;
});
// для отладки из консоли
(window as unknown as { pbApp: App }).pbApp = app;
