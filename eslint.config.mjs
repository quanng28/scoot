import tseslint from 'typescript-eslint';
export default [
  { ignores: ['dist/**', 'node_modules/**', 'public/pose/**'] },
  ...tseslint.configs.recommended,
  { files: ['**/*.ts', '**/*.tsx'], rules: { 'no-console': 'error', '@typescript-eslint/no-explicit-any': 'error' } },
];
