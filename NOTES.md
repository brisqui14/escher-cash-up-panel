# Submission notes: embedded cash-up panel

## How to run

```bash
dotnet run --project api          # terminal 1, from the track root
cd web && npm ci && npm run dev   # terminal 2, then open http://localhost:5173
```

Checks: `npm run check` and `npm test` from `web`; `dotnet test CashUp.React.sln` from the track
root.

## Design thinking

The panel keeps two things apart: what the operator has typed, and what the server has
confirmed. The variance updates as the count is typed, so the need for an explanation is clear
straight away, while expected cash, the saved draft, and the finalized record only ever come
from the server. Finalizing is one deliberate path: Finalize checks rule 4 against what is on
screen, then asks for confirmation in one line ("Finalize with €173.00 counted, a shortage of
€2.00?"). Confirming saves exactly what is on screen, then finalizes it. If the save fails, the
finalize is never sent, so an older saved draft can't be locked in by mistake.

Money never passes through floating point on the way in. The count is parsed as text into
integer minor units (`0.29` is 29, not 28.999...) and rejected at the field, with a specific
message, before any request is made. A missing count shows as a grey dash, read out as "Not
counted yet", never €0.00. The variance is named in words ("None", or a shortage or surplus with
its amount), so it doesn't depend on color or a minus sign.

Failures are normal at a till. Every request is aborted if the host removes the panel, and gives
up after 15 seconds so a stalled network can't leave the panel stuck. Only one request runs at a
time, and the operator's entries survive any failure. A failed save inside Confirm says nothing
was finalized; a failed finalize says retrying is safe, because the API makes finalization
idempotent. After a 400 or 409 the panel re-reads the server rather than trusting its own copy.
`onFinalized` is called once per panel instance, the first time it observes a finalized closeout.

## Decisions worth discussing

- **Finalize saves for you, after a confirmation.** The contract allows either. My first version
  made the operator save first, which took four steps for a shortage and kept Finalize greyed
  out. The confirm step does that review job more directly, and covers WCAG 3.3.4 (Error
  Prevention) for a financial record. It is inline rather than a dialog, which would block the
  host's page, and focus starts on Go back so pressing Enter twice can't finalize.
- **`onFinalized` when the panel opens on an already-finalized closeout.** I read "when this
  panel first observes its finalized result" as including a panel that loads one, for example
  after a reload. That is the resume-safe reading, but the host may then see the same result
  more than once across panel instances, so it should dedupe by drawer and `finalizedAtUtc`. I'd
  confirm this with whoever owns the host.
- **Laid out like a receipt.** Expected cash, counted cash, and the variance share one right-hand
  column. The activity is a four-row summary however busy the shift, with every transaction one
  click away in a scrolling `<details>` list, so the count stays on the first screen. The
  finished record is a centered summary under a single "Closeout finalized" heading.
- **Accessibility.** Focus moves to a rejected field, into and out of the confirm step, and to
  the finished record, but never on first load. A missing explanation turns the field's hint into
  the error, with a "!" mark so it doesn't rely on color. Briefly unavailable buttons use
  `aria-disabled`, so keyboard focus isn't lost when a request starts.
- **Embedded, not an application.** No routing, page-wide styles, or window listeners. Styles are
  scoped under `.cash-up-panel`, and element IDs come from `useId`.

## Spec questions I would raise

1. **Finalize has no precondition.** Another tab can save between this panel's save and its
   finalize, so the panel could lock in a draft it never showed. Sending them back to back
   narrows the window; an ETag sent with `If-Match` on finalize would close it.
2. **The finalized record doesn't say who counted or finalized it.** The server should stamp the
   operator from the till's signed-in session, as it stamps `finalizedAtUtc`. Login is out of
   scope, so I didn't invent a placeholder.
3. **Every transaction arrives in one response, with no paging or timestamps.** A busy shift
   would want server-side totals or paging, and times would help explain a discrepancy.
4. **The whitespace rule lives in two places.** The panel treats a whitespace-only explanation as
   blank, as the API does; the rule should have one owner.
5. **Minor units are assumed to be cents.** That is correct for EUR, but a multi-currency API
   should say how many minor digits each currency has.

## How I checked it

- `npm run check`: type-check, build, and 41 tests. `money.test.ts` covers parsing edge cases
  (`0.29`, `12.345`, `1e2`, `-1`, the API maximum and one cent over it) and formatting.
  `CashUpPanel.test.tsx` runs the panel against an in-memory fake that follows
  `API-CONTRACT.md`, including its one-shot failures. It covers the seven rules, the confirm
  step, the failed-save trap, retries, timeouts, a 409 from another session, StrictMode,
  unmounting, and where focus lands.
- I broke the code on purpose in more than a dozen ways (for example, confirming without saving,
  accepting a whitespace-only explanation, dropping the once-only guard on `onFinalized`, and
  parsing with `parseFloat`) and confirmed each one fails the suite.
- In headless Chrome against the real API: an end-to-end run using the host's latency and
  fail-next controls; hung save and finalize requests, each of which gave up after 15 seconds and
  recovered; and an axe-core scan in six states with no WCAG 2.2 AA violations. These scripts use
  Playwright and axe-core, so I kept them out of the repo rather than add dependencies.
- `dotnet test CashUp.React.sln` passes (18 tests). The API is unchanged.

## Known limitations

- The variance shown while typing is calculated in the browser from the server's expected cash;
  the finalized record shows the server's own figures.
- Confirm always saves first, so the host's "fail next" control always lands on that save. A
  failure at the finalize step is covered by the tests, but can't be triggered from the app.
- Input takes digits and a `.` only. Display is fixed to `en-IE`, with the finalize time in UTC.
- 15 seconds is a judgment call I'd tune against real network timings from the counters.

## What I'd do next

- **Autosave the draft**, so nothing typed is lost to an interruption.
- **Agree a suspend signal with the host**, so the panel can save before it is removed. It is the
  same problem a POS host runtime has when it suspends a journey mid-transaction.

## Starter files changed

- `web/src/CashUpPanel.tsx`: the placeholder, replaced as intended. The props are unchanged.
- Added: `web/src/CashUpPanel.css`, `web/src/money.ts`, `web/src/money.test.ts`,
  `web/src/CashUpPanel.test.tsx`, `.gitignore`, and these notes. Everything else is unchanged.

## Time spent

Approximately 3 hours on the core build, plus further time refining the UI and reviewing.

## Tools

Built AI-first with Claude Code, as the role describes. The design decisions and tradeoffs above
are mine, and I can walk through any part of the code.
