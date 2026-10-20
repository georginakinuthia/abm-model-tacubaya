import * as tsPlugin from '@typescript-eslint/eslint-plugin'
import typescriptParser from '@typescript-eslint/parser'
import { defineConfig } from 'eslint/config'
import eslintConfigPrettier from 'eslint-config-prettier/flat'
import simpleImportSort from 'eslint-plugin-simple-import-sort'
import pluginVue from 'eslint-plugin-vue'
import tsParser from 'vue-eslint-parser'

export default defineConfig([
  {
    ignores: [
      'dist/**',
      '**/*.geojson',
      'node_modules/**',
      'src/stores/runtime-core.esm-bundler.js',
    ],
  },
  {
    files: ['**/*.vue'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        parser: typescriptParser,
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
    },
  },
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.mts', '**/*.cts'],
    languageOptions: {
      parser: typescriptParser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
    },
  },
  ...pluginVue.configs['flat/recommended'],
  {
    plugins: {
      'simple-import-sort': simpleImportSort,
      '@typescript-eslint': tsPlugin,
    },
    rules: {
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      'simple-import-sort/imports': 'error',
      'simple-import-sort/exports': 'error',
      'vue/multi-word-component-names': 'off',
    },
  },
  {
    files: ['**/*.vue', '**/*.jsx', '**/*.tsx'],
    rules: {
      'tailwindcss/no-custom-classname': 'off',
    },
  },
  eslintConfigPrettier,
])
