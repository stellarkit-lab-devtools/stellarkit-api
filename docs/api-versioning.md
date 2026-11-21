# API Versioning

StellarKit keeps existing endpoint behaviour stable for as long as possible. When
an endpoint must be replaced, maintainers announce the change with the standard
`Deprecation`, `Sunset`, and `Link` response headers before optionally enforcing
a shutdown date.

## Deprecating an endpoint in practice

Use the `deprecate` route wrapper in `src/middleware/deprecation.js`. Apply it as
middleware immediately before the handler you are retiring:

```js
const express = require("express");
const deprecate = require("../middleware/deprecation");

const router = express.Router();

router.get(
  "/old-endpoint",
  deprecate({
    since: "2026-01-01T00:00:00Z",
    sunset: "2026-07-01T00:00:00Z",
    replacement: "/v2/new-endpoint",
    enforce: true,
  }),
  (req, res) => res.json({ ok: true }),
);
```

Every response from that route includes:

- `Deprecation: @<unix-seconds-of-since>` — when deprecation started.
- `Sunset: <HTTP-date>` — when the endpoint is scheduled to stop working.
- `Link: </v2/new-endpoint>; rel="successor-version"` — the replacement.

Successful response bodies are unchanged. With `enforce: true`, requests made on
or after the sunset date receive `410 Gone` naming the replacement; before that
date the handler runs normally. Omit `enforce` (or set it to `false`) to publish
the headers without ever blocking traffic.
