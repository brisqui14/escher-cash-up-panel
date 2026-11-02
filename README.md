# React track - embedded cash-up panel

Read the supplied `PROBLEM.md` and `API-CONTRACT.md` first; both are
alongside this README.

## Prerequisites and setup

- .NET 10 **SDK** to run the supplied C# service.
- A supported Node.js release (22.12+ on 22.x, 24.x, or 26+) and npm.

```powershell
# Terminal 1, from this directory
dotnet run --project api

# Terminal 2
Set-Location web
npm ci
npm run dev
```

Open Vite's printed URL, normally `http://localhost:5173`. The page should
report that the API is connected. The API itself is at
`http://localhost:5091`; `/health` is a simple connectivity check.

Setup is outside the three-hour effort budget. Contact the interviewer
if the starter does not run. You are expected to be able to run the C#
service, not implement or redesign it.

## Implement

Replace the placeholder in `web\src\CashUpPanel.tsx` with the operator's
cash-up interface. It is embedded inside a supplied host, not a separate
application with its own routing or global page ownership.

- Present the expected balance and supporting activity.
- Accept and save a count; clearly show match, shortage, or surplus.
- Allow draft revisions and collect an explanation when needed.
- Finalize the saved count and show the read-only result.
- Handle loading, failures, and retries without losing useful input or
  finalizing stale saved data after a failed save.
- Use labeled controls, visible errors, and normal keyboard operation.
- Call `onFinalized` once when this panel first observes its finalized
  result, not again on every render. The host displays callback events.

The provided `CloseoutClient` supports abort signals and exposes field
errors through `ApiError`. You may use it or replace it. JavaScript or
TypeScript is acceptable; the starter uses TypeScript. Keep the externally
supplied API behavior and host callback contract intact.

The host already provides reset, latency, and fail-next-request controls.
Reset starts a new panel instance. Do not use it to bypass finalization
rules. The API, its tests, and host controls are supplied infrastructure,
not additional work you need to implement.

## Checks

```powershell
# From web
npm run check
npm test

# Optional: verify the supplied API, from the track root
dotnet test CashUp.React.sln
```

The starter includes API-client tests and a DOM-capable Vitest setup.
Add a few focused checks of the behavior you implement. Styling is a
starting point, not a design contest; visual extras are not rewarded.

## Submit

Commit the source and tests, including `package-lock.json`, with short
submission notes as described in `PROBLEM.md`. Do not commit
`node_modules`, `dist`, `bin`, or `obj`. No Node backend is required.
