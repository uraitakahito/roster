// uraitakahito/hello-typescript-vitest の設定をもとにする。
import eslint from '@eslint/js';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';
import stylistic from '@stylistic/eslint-plugin';
import globals from 'globals';
import tsdoc from 'eslint-plugin-tsdoc';

export default defineConfig(
  // gen/ は cli/gen/gen.sh が作った client（生成した TS と build した JS）。手で直さないので見ない。
  {
    ignores: ['node_modules/**', 'eslint.config.mjs', 'gen/**'],
  },

  eslint.configs.recommended,
  tseslint.configs.recommendedTypeChecked,
  stylistic.configs.recommended,

  {
    languageOptions: {
      globals: {
        ...globals.node,
      },
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },

  {
    rules: {
      '@stylistic/semi': ['error', 'always'],
    },
  },

  // /** */ のコメントが TSDoc の形かを見る。字の中の <…> や @ は HTML や TSDoc の tag と読まれるので、`…` で囲む。
  {
    files: ['src/**/*.ts'],
    plugins: { tsdoc },
    rules: {
      'tsdoc/syntax': 'error',
    },
  },
);
