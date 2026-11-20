# Pull Request Checklist

Before submitting your PR, confirm each item below. A reviewer may request changes if any box is unchecked.

## Code Quality

- [ ] My changes follow the existing code style and conventions of the project
- [ ] I have removed all debugging statements (`console.log`, breakpoints, etc.)
- [ ] No commented-out code is included unless accompanied by an explanation

## Testing

- [ ] Existing tests pass locally (`npm test`)
- [ ] I have added or updated tests to cover my changes
- [ ] **No test output files are committed** (e.g. `coverage/`, `*.log`, Jest snapshots not part of the test suite)

## Files and Directory Structure

- [ ] **No implementation summary or analysis documents are committed** (e.g. `SUMMARY.md`, `ANALYSIS.md`, `IMPLEMENTATION_NOTES.md`, or any one-off markdown file describing what this PR does)
- [ ] **No ad-hoc or one-off scripts are added to the project root** — utility scripts belong in `scripts/`; documentation belongs in `docs/`
- [ ] **No one-off verification files are included** (e.g. `test-output.txt`, `verify-fix.js`, `debug-run.sh`)
- [ ] All new files are placed in the correct directory (`src/routes/`, `src/utils/`, `docs/`, `scripts/`, etc.)
- [ ] No unrelated files are staged (run `git diff --stat` to double-check)

## Documentation

- [ ] Public-facing behaviour changes are documented in the relevant `docs/` file
- [ ] `CHANGELOG.md` is updated if the change is user-facing (new endpoint, changed response shape, new config option, etc.)
- [ ] Any new environment variables are documented in both `README.md` and `docs/environment-configuration.md`

## Pull Request Hygiene

- [ ] The PR title is concise and descriptive (under 70 characters)
- [ ] The PR description explains **what** changed and **why**
- [ ] The PR references the relevant issue number (e.g. `closes #123`)
- [ ] The branch is up to date with the base branch (rebase or merge before opening)
