# Contributing to StellarKit API

Thank you for your interest in contributing! StellarKit API participates in the **[Stellar Wave Program on Drips](https://www.drips.network/wave/stellar)**, which means you can earn real rewards for solving issues here.

---

## 🌊 Stellar Wave Issues

Issues with the **`Stellar Wave`** label are part of the Stellar Wave Program on Drips.

1. The label means the issue is included in the active Wave and should be handled under Wave rules.
2. Issues with this label carry **Point rewards** in Drips Wave.
3. You must **apply via Drips Wave before starting work** on the issue.
4. Your PR must be **merged before the current Wave ends** for points to be awarded.

**Get started:** [drips.network/wave/stellar](https://www.drips.network/wave/stellar)

---

## 📖 Documentation

- [Testing Guide](docs/testing.md) — how the test suite is structured, how to run tests, mocking patterns, and coverage expectations

---

## 🛠️ Development Setup

```bash
git clone https://github.com/stellarkit-lab-devtools/stellarkit-api.git
cd stellarkit-api
npm install
cp .env.example .env
npm run dev
```

---

## 📋 How to Contribute

1. **Find an issue** — Check the [Issues tab](../../issues) for open tasks. Wave issues are labeled with their complexity (`trivial`, `medium`, `high`).
2. **Comment or apply** — Leave a comment on the issue or apply via Drips Wave before starting.
3. **Branch** — Create a branch: `git checkout -b feat/short-description` or `fix/short-description`.
4. **Code** — Make your changes. Follow the existing patterns.
5. **Test** — Run `npm test` and make sure all tests pass. Add new tests for new functionality.
6. **PR** — Open a Pull Request with a clear title and description referencing the issue: `Closes #123`.

---

## ✅ PR Checklist

- [ ] `npm test` passes
- [ ] New functionality has tests
- [ ] Code follows existing patterns (async/await, centralised error handling)
- [ ] PR description explains what was changed and why
- [ ] Issue number is referenced in the PR description

---

## 🧱 Code Style

- An `.editorconfig` file is included at the repo root. Make sure your editor supports it (most do natively or via a plugin: [editorconfig.org](https://editorconfig.org)). It enforces: 2-space indentation, LF line endings, UTF-8 charset, and a final newline on all files.
- **Line endings:** This repo enforces LF (`\n`) line endings via `.gitattributes`. If you're on Windows, configure Git to not convert line endings: `git config core.autocrlf false`. Your editor should also be set to save files with LF endings.
- Use `async/await` — no raw promise chains
- All routes must use the `next(err)` pattern for errors
- Use the `success()` helper from `src/utils/response.js` for consistent responses
- Validate all user inputs with helpers from `src/utils/validators.js`

## 🔍 Linting

This project uses ESLint with `eslint:recommended` rules.

- Run: `npm run lint`
- To auto-fix issues: `npm run lint:fix`
- Expected: lint should pass with no errors before opening a PR.



---

## 💬 Questions?

Open a [GitHub Discussion](../../discussions) or reach out on the [Stellar Discord](https://discord.gg/stellardev).
