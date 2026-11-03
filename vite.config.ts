import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { resolve } from 'node:path';

// mode "single" — один HTML-файл для превью (артефакт), обычная сборка — для GitHub Pages.
// BANK_PATH — путь к полному банку вопросов (только для приватного превью, в репозиторий не попадает).
export default defineConfig(({ mode }) => {
  const single = mode === 'single';
  const bank = process.env.BANK_PATH;
  return {
    base: './',
    plugins: single ? [viteSingleFile()] : [],
    resolve: {
      alias: {
        '@bank': bank ? resolve(bank) : resolve(__dirname, 'src/data/sample-questions.json'),
      },
    },
    build: {
      outDir: single ? 'dist-single' : 'dist',
      assetsInlineLimit: single ? 100000000 : 4096,
      target: 'es2020',
    },
  };
});
