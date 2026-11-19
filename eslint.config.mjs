// uraitakahito/hello-typescript-vitest の設定をもとにする。
import eslint from '@eslint/js';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';
import stylistic from '@stylistic/eslint-plugin';
import globals from 'globals';

export default defineConfig(
  {
    // docs-site/ は自分の依存と tsconfig を持つ別の project（Astro が検査する）
    ignores: ['dist/**', 'node_modules/**', 'eslint.config.mjs', 'docs-site/**'],
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

  // .mjs（release-age.mjs）は型を付けていないので、型つきの規則を外す。
  {
    files: ['**/*.mjs'],
    extends: [tseslint.configs.disableTypeChecked],
  },
);
