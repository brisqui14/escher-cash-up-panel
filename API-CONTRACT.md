# Cash-up HTTP contract

This describes the HTTP API your panel calls. The API is already built:
it is the C# service in this track's `api` folder, which you start with
`dotnet run --project api`. You do not need to change it.

## Endpoints at a glance

| Method and path | Purpose | Success response |
|---|---|---|
| `GET /api/closeout` | Read the drawer and current closeout | 200 + closeout |
| `PUT /api/closeout/draft` | Save or revise the draft count and explanation | 200 + closeout |
| `POST /api/closeout/finalize` | Finalize the last saved draft | 200 + closeout |
| `GET /health` | Connectivity check | 200 |
| `POST /demo/reset`, `PUT /demo/behavior` | Development fixture controls used by the supplied host page | See below |

## Addresses and state

- The API listens at `http://localhost:5091`.
- The Vite dev server proxies `/api`, `/demo`, and `/health` to it, so the
  browser calls same-origin paths such as `/api/closeout`.
- The API holds one in-memory drawer with one closeout. All browser tabs
  share it. There is no session identifier.
- Restart the API to reset it, or use the host page's reset control.

## The closeout object

All three `/api/closeout` endpoints return the same JSON object on
success: the drawer's fixed data plus the current state of its closeout.
For example, before any count has been saved:

```json
{
  "drawerId": "counter-01",
  "currency": "EUR",
  "openingCashMinor": 10000,
  "transactions": [
    {
      "id": "sale-001",
      "kind": "sale",
      "amountMinor": 5500,
      "description": "Cash sale"
    },
    {
      "id": "sale-002",
      "kind": "sale",
      "amountMinor": 2750,
      "description": "Cash sale"
    },
    {
      "id": "refund-001",
      "kind": "refund",
      "amountMinor": 750,
      "description": "Cash refund"
    }
  ],
  "expectedCashMinor": 17500,
  "countedCashMinor": null,
  "varianceMinor": null,
  "explanation": "",
  "status": "draft",
  "finalizedAtUtc": null
}
```

Transaction amounts are positive; `kind` determines whether they add to
or subtract from the expected balance. Status is `draft` or `finalized`.
`finalizedAtUtc` is an ISO 8601 UTC timestamp when finalized, otherwise
`null`. Count and variance are `null` until a count has been saved.

The starter models this object as the `CloseoutSnapshot` type in
`web\src\contracts.ts`.

## GET /api/closeout

Returns HTTP 200 and the current closeout object. It does not change state.

## PUT /api/closeout/draft

```json
{
  "countedCashMinor": 17300,
  "explanation": "Recounted; drawer is still short."
}
```

- `countedCashMinor` is required: a JSON integer from 0 through
  `9007199254740991`. Fractional minor units and numeric strings are invalid.
- `explanation` is an optional string or `null`; omitted/null means empty.
- Saving replaces the previous draft count and explanation.
- HTTP 200 returns the updated closeout object.
- A missing/invalid count or malformed request returns HTTP 400.
- Saving a draft with a variance and no explanation is allowed.
- Editing a finalized closeout returns HTTP 409, without changing it.

## POST /api/closeout/finalize

No request body. Finalizes the **last saved draft**, not unsaved UI input.

- HTTP 200 returns the finalized closeout object.
- No saved count: HTTP 400 with a `countedCashMinor` error.
- Nonzero variance and blank/whitespace-only explanation: HTTP 400 with an
  `explanation` error.
- An already-finalized closeout: HTTP 200 with the same closeout object
  and timestamp as before.

A UI must save pending edits successfully before finalizing, or clearly
require the operator to save them first. A failed save must not be
followed by a finalization of an older draft.

## Errors

Errors are returned as `application/problem+json`, using standard Problem
Details fields:

```json
{
  "type": "about:blank",
  "title": "One or more validation errors occurred.",
  "status": 400,
  "errors": {
    "explanation": [
      "Explain the shortage or surplus before finalizing."
    ]
  }
}
```

Field-validation errors have an `errors` dictionary. Conflict and general
errors may instead have a `detail` string. Clients should not depend on
the exact English wording or the value of `type`.

## Health and fixture controls

`GET /health` returns HTTP 200 with `{"status":"ok"}`.

The supplied host page uses these development controls; your panel does
not need to call them:

- `POST /demo/reset`: reset to the original, uncounted draft and clear
  simulated latency/failure settings; returns the closeout object.
- `PUT /demo/behavior` with
  `{"delayMilliseconds":1000,"failNextMutation":false}`: configure a delay
  of 0 through 3000 ms for `/api/closeout` requests and optionally fail
  the next draft save or finalize request. Returns HTTP 204.

A simulated failure returns HTTP 503 **before** applying the change.
Reading the closeout does not consume the pending failure. The delay
applies only to `/api/closeout` endpoints; the controls stay responsive.
Do not reset while a request is in flight; these are manual development
controls, not part of the assessed workflow.

There is no authentication or CORS setup: use the supplied same-origin
Vite proxy. These fixtures are intended for local development only.
