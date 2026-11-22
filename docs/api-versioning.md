# API and SDK versioning

The API version is the root `package.json` version, exposed as
`data.version` by `GET /health`. The SDK has its own package version when
published. API and SDK version numbers need not match.

For releases at or above 1.0.0:

- **Major:** removed endpoints/fields, renamed fields or error identifiers,
  changed JSON types/envelopes, incompatible validation or authentication,
  or other changes that require consumers to change working code.
- **Minor:** compatible new endpoints, opt-in features, or optional fields.
  Consumers should tolerate additional object fields and documented enum growth.
- **Patch:** fixes that preserve the documented contract, including documentation
  corrections. Calling a breaking response change a fix does not make it a patch.

Apply the same rules to SDK public methods, exports, parameters, return types and
error behavior. An API change may require a separate SDK release. A breaking
change in either product requires a major release of that product.

## Deprecations

Before retiring a supported endpoint or field, maintainers should publish the
replacement and a migration example, mark the old contract deprecated in the
README/API reference and changelog, and announce its planned removal release.
Retain working deprecated behavior throughout the current major version; remove
it only in a major release. If a retirement date is announced, record it with
the replacement and give consumers at least one minor release to migrate.
Do not replace a successful endpoint with HTTP 410 in a patch or minor release.

Historical checkouts have not consistently followed these rules. Consult
[response migrations](migrations.md) for confirmed changes since 1.0.0, including
the existing sponsorship HTTP 410 response. This policy does not imply that
those historical changes were already assigned new release numbers.

Every future breaking change must add a migration entry with before/after JSON,
the introducing PR, affected endpoints, and a consumer fix. Move its changelog
entry into the version that actually ships it. Follow the
[manual release checklist](release-process.md).
