# Rate limiting for batch endpoints

Batch endpoints are convenient for reducing round trips, but they can create concentrated load on Horizon and your application server. A request that looks small from the client side may still fan out into many upstream lookups.

## Why batch endpoints need extra care

These endpoints often do the following:

- validate a list of IDs or hashes before making any request
- call Horizon in parallel for every item in the payload
- aggregate results into a single response

That means the effective load is roughly:

- 1 request from the client
- N Horizon requests from the API server
- 1 response to the client

For a batch size of 20, the API may trigger 20 separate Horizon lookups in a single request. If your client retries aggressively or multiple workers issue large batches at once, the upstream quota can be exhausted quickly.

## Recommended limits

For batch write-like or lookup-heavy endpoints, keep the request sizes conservative:

- prefer a maximum of 10–20 IDs or hashes per request
- reject empty arrays with a clear validation error or return an empty list rapidly
- enforce strict per-request validation before any network calls

The API should validate the payload before the Horizon fan-out begins. This preserves predictable latency and prevents expensive upstream work for obviously invalid input.

## Rate limiting strategy

Use a combination of request-level and payload-level controls:

1. Apply a lower per-minute limit to batch endpoints than to single-item endpoints.
2. Use a burst cap to avoid sudden spikes from a single client.
3. Track the number of items processed, not just the number of requests.
4. Log oversized or repeated batch payloads so they can be investigated.

A practical rule is:

- single-item endpoints: normal API rate limit
- batch endpoints: stricter limit, often 1/2 to 1/5 of the normal rate
- large batches: reject early with a validation error

## Examples

### Good

- 5 account IDs in one request
- 10 tx hashes in one request
- a request whose body is validated before any network calls

### Risky

- 100 account IDs in a single batch
- a client retry loop that resubmits the same oversized payload
- calls that hit Horizon for every item without checking request size first

## Operational guidance

When designing or consuming batch endpoints:

- prefer a small page size and let the client paginate
- batch only when the payload is naturally related and small
- avoid using batch endpoints for repeated polling loops
- consider caching repeated account or transaction lookups when safe

> In short: batch endpoints are efficient for coordination, but they multiply upstream pressure. Keep payloads bounded, validate early, and apply stricter throttling than standard single-item routes.
