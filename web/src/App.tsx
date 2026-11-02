import { useCallback, useEffect, useState } from "react";
import { closeoutClient, configureDemo, resetDemo } from "./api";
import { CashUpPanel } from "./CashUpPanel";
import type { CloseoutSnapshot } from "./contracts";

function message(error: unknown): string {
  return error instanceof Error ? error.message : "An unexpected error occurred.";
}

export function App() {
  const [run, setRun] = useState(0);
  const [connection, setConnection] = useState("Checking API connection...");
  const [slow, setSlow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [hostError, setHostError] = useState<string | null>(null);
  const [outcomes, setOutcomes] = useState<CloseoutSnapshot[]>([]);
  const handleFinalized = useCallback((result: CloseoutSnapshot) => {
    setOutcomes((previous) => [...previous, result]);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    closeoutClient.getCloseout(controller.signal).then(
      (result) => {
        if (!controller.signal.aborted) {
          setConnection(`API connected: ${result.drawerId} (${result.status}).`);
        }
      },
      (error: unknown) => {
        if (!controller.signal.aborted) {
          setConnection(`API connection failed: ${message(error)}`);
        }
      },
    );
    return () => controller.abort();
  }, [run]);

  async function hostAction(action: () => Promise<void>) {
    setBusy(true);
    setHostError(null);
    try {
      await action();
    } catch (error: unknown) {
      setHostError(message(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="host">
      <header className="host-header">
        <p className="eyebrow">Supplied host application</p>
        <h1>Service counter</h1>
        <p role="status">{connection}</p>
      </header>

      <CashUpPanel
        key={run}
        client={closeoutClient}
        onFinalized={handleFinalized}
      />

      <aside className="fixture-controls" aria-labelledby="fixture-heading">
        <h2 id="fixture-heading">Development fixture controls</h2>
        <p>
          These are supplied tools, not part of your implementation. Use them
          only when no cash-up request is in flight.
        </p>
        <div className="host-actions">
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              void hostAction(async () => {
                await resetDemo();
                setSlow(false);
                setOutcomes([]);
                setRun((previous) => previous + 1);
              })
            }
          >
            Reset drawer and start a new panel
          </button>
          <button
            type="button"
            disabled={busy}
            aria-pressed={slow}
            onClick={() =>
              void hostAction(async () => {
                await configureDemo(slow ? 0 : 1000, false);
                setSlow(!slow);
              })
            }
          >
            {slow ? "Disable" : "Enable"} one-second API delay
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              void hostAction(() => configureDemo(slow ? 1000 : 0, true))
            }
          >
            Fail next save or finalize
          </button>
        </div>
        {hostError && <p role="alert">{hostError}</p>}
        <p aria-live="polite">Finalization callbacks received: {outcomes.length}</p>
        {outcomes.length > 0 && (
          <pre aria-label="Host finalization notifications">
            {JSON.stringify(outcomes, null, 2)}
          </pre>
        )}
      </aside>
    </main>
  );
}
