# Manual release checklist

This is a manual process for repository maintainers. Only a maintainer with
repository release/tag permissions may cut an API release. SDK publishing also
requires publish access to the verified npm package and an account with 2FA.
Contributors can prepare release changes for maintainer review. Never share npm
tokens, recovery codes, or one-time passwords in issues or release notes.

## Choose the release

- [ ] Read [API versioning](api-versioning.md) and [migration notes](migrations.md).
  Review changes since the last released tag, not just the latest commit.
- [ ] Select API and SDK versions independently: major for incompatible public
  behavior, minor for compatible additions, patch for compatible fixes. Include
  response shapes, JSON types, error identifiers and validation in the API review;
  include public methods, signatures, exports and types in the SDK review.
- [ ] Identify the release maintainer and the exact reviewed commit to release.
- [ ] Confirm the intended deployment environment and SDK npm package name.

## Prepare and review

- [ ] Move the applicable bullets from `[Unreleased]` in `CHANGELOG.md` to a
  new `## [X.Y.Z] - YYYY-MM-DD` section, using the actual release date. Keep an
  empty `[Unreleased]` section for subsequent work. Keep Added/Changed/Fixed/
  Removed sections as appropriate. List breaking changes explicitly and link
  the corresponding migrations. Do not relabel 1.0.0's historical date.
- [ ] Bump `version` in root `package.json` to the API version. Update the root
  package version in `package-lock.json` as well, preserving dependency versions.
- [ ] Bump `version` in `sdk/package.json` to the SDK version when releasing the
  SDK; update its lockfile if present. **Current checkout prerequisite:** this
  repository has SDK source but no `sdk/package.json`. A maintainer must first
  prepare and review the SDK package manifest, package name, entry points, build
  output and included files. Do not publish the repository root as a substitute.
- [ ] Manually run the project's tests and lint checks, and inspect the SDK build
  and package contents using the SDK's documented build/package instructions.
  Verify examples and ensure no secrets or unintended files are packaged.
- [ ] Have another maintainer review the final release diff, versions, migration
  instructions, changelog and package contents. Commit the reviewed changes.

## Tag and create the GitHub Release

- [ ] Tag the reviewed API release commit as **`vX.Y.Z`**, for example `v2.0.0`,
  and push that specific tag. Verify it resolves to the reviewed commit.
- [ ] Create a GitHub Release against that existing tag. Use the title
  `StellarKit API vX.Y.Z`; mark prereleases explicitly when applicable.
- [ ] Paste and complete this release notes template, omitting empty sections:

```markdown
## StellarKit API vX.Y.Z — YYYY-MM-DD

### Breaking changes and migration
- Affected endpoint/field, before → after, consumer action, introducing PR.
- [Migration guide](docs/migrations.md) (replace with a link at the release tag).

### Added
- User-visible feature and PR.

### Fixed
- User-visible fix and PR.

### SDK
- Package name and version, compatibility requirements, installation command.

### Deployment verification
- Environment and GET /health version confirmed by the release maintainer.

Full changelog: link to CHANGELOG.md at this tag.
```

## Publish the SDK manually

- [ ] From **`sdk/`**, verify the package manifest name and version and confirm
  the logged-in npm account is an authorized publisher (`npm whoami`).
- [ ] Confirm npm 2FA is enabled and the publishing device can complete the npm
  authentication challenge. Run `npm publish` from `sdk/`, using the package's
  approved access setting. Complete the 2FA prompt locally; never paste the OTP
  into a shared terminal transcript or commit it.
- [ ] Confirm the published version and package contents on npm, and install
  that exact version in a clean consumer project for a smoke check. Do not
  overwrite or reuse a published version. Record the SDK version in release notes.
- [ ] If the SDK is released separately from the API, use its own release notes
  and a namespaced SDK tag agreed by maintainers; `vX.Y.Z` identifies API releases.

## Deploy and verify

- [ ] Deploy the reviewed tagged API commit using the environment's manual
  deployment procedure in [deployment.md](deployment.md).
- [ ] Request **`GET /health`** on the deployed environment. Confirm
  `data.version` exactly matches the API version, `data.network` is correct,
  and service/Horizon health is acceptable. Check `data.horizon.host` when
  failover is configured; no URL credentials should appear.
- [ ] Smoke-check an ordinary endpoint and any changed response contracts using
  the examples in migration notes. Confirm the SDK can call the deployed API.
- [ ] Publish/finalize the GitHub Release and record the deployment verification.
  If deployment verification fails, restore the previous deployment and resolve
  the failure before announcing success. Do not move a published release tag.

## Hotfix flow

- [ ] Start from the affected released `vX.Y.Z` tag, apply the smallest fix, and
  review its compatibility. Use a new patch version only for a compatible fix;
  a contract break still requires a major version.
- [ ] Add the fix to the changelog with its PR and date, update the relevant
  package version(s), run manual checks, and obtain maintainer review.
- [ ] Repeat the tagging, release notes, SDK publishing (if affected), deployment
  and `/health` verification steps above using a new immutable version.
- [ ] Bring the fix and release record back to the development branch so the
  next regular release retains them.

## Deprecation check

- [ ] Follow [the deprecation policy](api-versioning.md#deprecations): ship and
  document a replacement, announce removal, preserve behavior in the current
  major, and record before/after JSON and consumer actions before removal.
