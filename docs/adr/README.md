# Architecture Decision Records

This folder records the reasoning behind StellarKit API's core conventions, so
questions like "why does every response look like this?" can be answered with a
link instead of a thread.

Each record is short and cites the files that implement it. When the code and an
ADR disagree, the ADR should be updated (or superseded) in the same PR that
changes the behaviour.

## Index

| ADR | Title | Status |
| --- | --- | --- |
| [0001](0001-response-envelope.md) | Every response uses the `{ success, data \| error }` envelope | Accepted |
| [0002](0002-amounts-as-seven-decimal-strings.md) | Amounts are seven-decimal strings | Accepted |
| [0003](0003-single-shared-stellar-config.md) | A single shared Stellar config module | Accepted |

## Writing a new ADR

1. Copy [0000-template.md](0000-template.md) to `NNNN-short-title.md`, using the next free number.
2. Fill in status, date, context, decision and consequences. Cite real files and verify the paths exist.
3. Add a row to the index above.
4. To change an accepted decision, write a new ADR and mark the old one `Superseded by …` rather than rewriting history.
