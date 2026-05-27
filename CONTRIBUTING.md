# Contributing to StellarKit API

Thank you for your interest in contributing! StellarKit API participates in the **[Stellar Wave Program on Drips](https://www.drips.network/wave/stellar)**, which means you can earn real rewards for solving issues here.

---

## 🌊 Stellar Wave Program

This repo is part of the Stellar Wave Program. During each monthly Wave (a 7-day sprint), contributors can:

1. Browse open issues labeled with point values
2. Apply to work on an issue via the Drips Wave app
3. Submit a Pull Request
4. Earn Points → converted to real rewards

**Get started:** [drips.network/wave/stellar](https://www.drips.network/wave/stellar)

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
- Use `async/await` — no raw promise chains
- All routes must use the `next(err)` pattern for errors
- Use the `success()` helper from `src/utils/response.js` for consistent responses
- Validate all user inputs with helpers from `src/utils/validators.js`

---

## 💬 Questions?

Open a [GitHub Discussion](../../discussions) or reach out on the [Stellar Discord](https://discord.gg/stellardev).
