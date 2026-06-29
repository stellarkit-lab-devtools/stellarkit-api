# Pagination Guide

Many list endpoints in StellarKit support cursor-based pagination so clients can walk through large result sets without requesting everything at once.

## What cursor-based pagination means

Cursor-based pagination works by sending a small page of results and then using a token from that page to request the next page.

- `limit` controls how many records are returned in each page.
- `cursor` is an opaque token returned by a previous response. It tells StellarKit where to continue reading.
- The cursor value usually represents the paging position of the last record on the current page, so the next request resumes from that point.
- You should treat the cursor as an opaque string. Do not try to parse it or infer page numbers from it.

## Request parameters

The pagination parameters used by StellarKit are:

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `limit` | number | varies by endpoint | Maximum number of records to return in one response. |
| `cursor` | string | none | Token from a previous response that resumes pagination from the next item. |
| `order` | string | `desc` | Optional sort direction (`asc` or `desc`) on endpoints that support it. |

## How to paginate

1. Send the first request without a `cursor`.
2. Read the response. The response payload includes the next page token in the pagination fields, usually as `data.cursor`.
3. If the cursor is `null`, you have reached the last page and there is nothing else to fetch.
4. If the cursor contains a value, repeat the request with the same endpoint and the new `cursor` value.

## How to detect the last page

A paginated response is complete when one of these is true:

- `data.cursor` is `null`
- the returned items are fewer than the requested `limit`
- the endpoint explicitly reports that no more results are available

In practice, the simplest rule is: if the response has no cursor, stop paging.

## Endpoints that use this pattern

The same cursor-based pattern is used by endpoints such as:

- `GET /account/:id/payments`
- `GET /account/:id/offers`
- `GET /account/:id/offer-history`
- `GET /transactions/:id`
- `GET /transactions/:id/operations`
- `GET /account/:id/transactions/search`
- `GET /asset/:code/:issuer/holders`

## Step-by-step example: paginate through all payments for an account

The following example walks through every payment for a Stellar account using `/account/:id/payments`.

### Step 1: Request the first page

```http
GET /account/GA.../payments?limit=2
```

Example response:

```json
{
  "success": true,
  "data": {
    "items": [
      {
        "type": "payment",
        "amount": "10.0000000",
        "sender": "GABC...",
        "receiver": "GXYZ..."
      },
      {
        "type": "payment",
        "amount": "25.0000000",
        "sender": "G123...",
        "receiver": "GXYZ..."
      }
    ],
    "total": 2,
    "limit": 2,
    "cursor": "page-2-token"
  }
}
```

The response tells you that there are more results because `data.cursor` contains a value.

### Step 2: Request the next page

Use the returned cursor in the next request:

```http
GET /account/GA.../payments?limit=2&cursor=page-2-token
```

Example response:

```json
{
  "success": true,
  "data": {
    "items": [
      {
        "type": "payment",
        "amount": "5.0000000",
        "sender": "G999...",
        "receiver": "GXYZ..."
      }
    ],
    "total": 1,
    "limit": 2,
    "cursor": null
  }
}
```

Because `data.cursor` is `null`, this is the last page.

### Step 3: Stop paging

When the cursor is `null`, stop making requests. You have fetched all available pages for that account and the collection is complete.

## Example loop in JavaScript

```js
async function fetchAllPayments(accountId) {
  const allPayments = [];
  let cursor = null;

  while (true) {
    const url = new URL(`/account/${accountId}/payments`, "http://localhost:3000");
    url.searchParams.set("limit", "2");
    if (cursor) {
      url.searchParams.set("cursor", cursor);
    }

    const response = await fetch(url);
    const payload = await response.json();

    allPayments.push(...payload.data.items);

    if (!payload.data.cursor) {
      break;
    }

    cursor = payload.data.cursor;
  }

  return allPayments;
}
```

## Best practices

- Keep the same `limit` value across pages for consistent page sizes.
- Preserve the cursor exactly as returned by the API.
- Stop paging as soon as the cursor becomes `null`.
- If you need a specific ordering, include `order=asc` or `order=desc` consistently on each request.
