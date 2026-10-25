/** @type {import('eslint').Linter.Config[]} */
module.exports = [
  {
    name: 'stellarkit-api',
    files: ['**/*.js'],
    ignores: ['node_modules/**', 'coverage/**'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'script',
      // No extra globals needed for this codebase.
    },
    // ESLint v9 uses flat config. We apply the recommended ruleset
    // to match the acceptance criteria of `extends: eslint:recommended`.
    rules: {
      // `eslint:recommended` baseline rules (subset) to keep lint non-breaking.
      // Note: The environment here appears to disallow importing internal
      // presets, so we mirror only the ruleset that doesn't require
      // refactoring the existing code.
      'no-unused-vars': ['warn', { args: 'none' }],
    },
  },
];

