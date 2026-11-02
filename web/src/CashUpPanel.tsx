import { useCallback, useEffect, useId, useRef, useState, type Ref, type SubmitEvent } from "react";
import { flushSync } from "react-dom";
import { ApiError } from "./api";
import type { CashTransaction, CloseoutClient, CloseoutSnapshot } from "./contracts";
import {
  classifyVariance,
  currencySymbol,
  describeVariance,
  formatCountForInput,
  formatMoney,
  formatUtcTimestamp,
  parseCount,
} from "./money";
import "./CashUpPanel.css";

export interface CashUpPanelProps {
  client: CloseoutClient;
  onFinalized: (snapshot: CloseoutSnapshot) => void;
}

type PendingRequest = "load" | "save" | "finalize" | null;

type FailedAction = "save" | "saveBeforeFinalize" | "finalize";

// Gives up on any one request after 15 seconds, so a stalled network can't leave the panel
// stuck on "Saving...". Retrying is always safe: a save replaces the draft, and finalizing
// twice returns the same record.
const REQUEST_TIMEOUT_MS = 15_000;

function withTimeout(panelSignal: AbortSignal): AbortSignal {
  return AbortSignal.any([panelSignal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]);
}

function isTimeout(error: unknown): boolean {
  return error instanceof DOMException && error.name === "TimeoutError";
}

interface FieldErrors {
  countedCashMinor?: string;
  explanation?: string;
}

// The operator's typed inputs are compared with the closeout the server last saved.
// Anything that differs is shown as unsaved.
function hasUnsavedChanges(
  savedCloseout: CloseoutSnapshot,
  typedCount: string,
  typedExplanation: string,
): boolean {
  if (typedExplanation !== savedCloseout.explanation) {
    return true;
  }
  if (typedCount.trim() === "") {
    return savedCloseout.countedCashMinor !== null;
  }
  const parsed = parseCount(typedCount);
  return !parsed.ok || parsed.minor !== savedCloseout.countedCashMinor;
}

// Rule 4, checked against what's typed before the operator is asked to confirm: a valid count,
// and an explanation whenever the count doesn't match. Returns the problems to show, or null.
function finalizeErrors(
  typedCount: string,
  typedExplanation: string,
  expectedCashMinor: number,
): FieldErrors | null {
  const parsed = parseCount(typedCount);
  if (!parsed.ok) {
    return { countedCashMinor: parsed.error };
  }
  const variance = parsed.minor - expectedCashMinor;
  if (variance !== 0 && typedExplanation.trim() === "") {
    return { explanation: `Explain the ${classifyVariance(variance)} before finalizing.` };
  }
  return null;
}

function failureMessage(error: unknown, action: FailedAction): string {
  const suffix =
    error instanceof ApiError
      ? ` (HTTP ${error.status})`
      : isTimeout(error)
        ? ` (no answer within ${REQUEST_TIMEOUT_MS / 1000} seconds)`
        : "";
  if (action === "save") {
    return `The draft could not be saved${suffix}. Your entries are still here, so you can save again.`;
  }
  if (action === "saveBeforeFinalize") {
    return `Nothing was finalized, because the draft could not be saved first${suffix}. Your entries are still here, so you can try again.`;
  }
  return `The closeout could not be confirmed as finalized${suffix}. Trying again is safe: it will not create a second closeout.`;
}

function confirmQuestion(countMinor: number, varianceMinor: number, currency: string): string {
  const counted = formatMoney(countMinor, currency);
  if (varianceMinor === 0) {
    return `Finalize with ${counted} counted, matching the expected cash?`;
  }
  const amount = formatMoney(Math.abs(varianceMinor), currency);
  return `Finalize with ${counted} counted, a ${classifyVariance(varianceMinor)} of ${amount}?`;
}

export function CashUpPanel({ client, onFinalized }: CashUpPanelProps) {
  const id = useId();
  const [savedCloseout, setSavedCloseout] = useState<CloseoutSnapshot | null>(null);
  const [typedCount, setTypedCount] = useState("");
  const [typedExplanation, setTypedExplanation] = useState("");
  const [pendingRequest, setPendingRequest] = useState<PendingRequest>("load");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [confirming, setConfirming] = useState(false);
  const abortController = useRef<AbortController | null>(null);
  const inputsFilled = useRef(false);
  const hostNotified = useRef(false);
  const countInput = useRef<HTMLInputElement>(null);
  const explanationInput = useRef<HTMLTextAreaElement>(null);
  const finalizedHeading = useRef<HTMLHeadingElement>(null);
  const finalizeButton = useRef<HTMLButtonElement>(null);
  const goBackButton = useRef<HTMLButtonElement>(null);
  const formWasShown = useRef(false);

  const loadCloseout = useCallback(
    async (signal: AbortSignal) => {
      setPendingRequest("load");
      setErrorMessage(null);
      try {
        const next = await client.getCloseout(withTimeout(signal));
        if (signal.aborted) {
          return;
        }
        if (!inputsFilled.current) {
          inputsFilled.current = true;
          setTypedCount(next.countedCashMinor === null ? "" : formatCountForInput(next.countedCashMinor));
          setTypedExplanation(next.explanation);
        }
        setSavedCloseout(next);
      } catch {
        if (!signal.aborted) {
          setErrorMessage("The drawer could not be loaded.");
        }
      } finally {
        if (!signal.aborted) {
          setPendingRequest(null);
        }
      }
    },
    [client],
  );

  // One controller per mounted panel: unmounting (for example, the host's reset)
  // aborts whatever this panel still has in flight.
  useEffect(() => {
    const controller = new AbortController();
    abortController.current = controller;
    void loadCloseout(controller.signal);
    return () => controller.abort();
  }, [loadCloseout]);

  // Report the finalized result the first time this panel instance observes it,
  // whether it finalized it or opened on a closeout that was already finalized.
  useEffect(() => {
    if (savedCloseout?.status === "finalized" && !hostNotified.current) {
      hostNotified.current = true;
      onFinalized(savedCloseout);
    }
  }, [savedCloseout, onFinalized]);

  // Move focus to the finalized record when the operator finalizes from the form, so keyboard
  // and screen reader users aren't left on a button that no longer exists. Never on first load.
  useEffect(() => {
    if (savedCloseout?.status === "draft") {
      formWasShown.current = true;
    } else if (savedCloseout?.status === "finalized" && formWasShown.current) {
      formWasShown.current = false;
      finalizedHeading.current?.focus();
    }
  }, [savedCloseout]);

  // Re-reads the server's state after it rejects something this panel believed was valid.
  async function refreshCloseout(signal: AbortSignal) {
    try {
      const next = await client.getCloseout(withTimeout(signal));
      if (!signal.aborted) {
        setSavedCloseout(next);
      }
    } catch {
      // The error already shown stands; the operator's next action retries.
    }
  }

  // Draws field errors immediately, then moves focus to the first field that has one, so a
  // screen reader reads its message out.
  function showFieldErrors(errors: FieldErrors) {
    flushSync(() => setFieldErrors(errors));
    if (errors.countedCashMinor) {
      countInput.current?.focus();
    } else if (errors.explanation) {
      explanationInput.current?.focus();
    }
  }

  async function handleSaveOrFinalizeError(
    error: unknown,
    action: FailedAction,
    signal: AbortSignal,
  ) {
    if (error instanceof ApiError && error.status === 409) {
      setErrorMessage("This closeout has already been finalized, so it can't be changed.");
      await refreshCloseout(signal);
      return;
    }
    if (error instanceof ApiError && error.status === 400) {
      showFieldErrors({
        countedCashMinor: error.errors.countedCashMinor?.[0],
        explanation: error.errors.explanation?.[0],
      });
      setErrorMessage(
        action === "save"
          ? "The draft was not saved. Check the highlighted fields."
          : "The closeout was not finalized. Check the highlighted fields.",
      );
      await refreshCloseout(signal);
      return;
    }
    setErrorMessage(failureMessage(error, action));
  }

  async function handleSave(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const controller = abortController.current;
    if (pendingRequest || confirming || !savedCloseout || !controller) {
      return;
    }
    const parsed = parseCount(typedCount);
    if (!parsed.ok) {
      setErrorMessage(null);
      showFieldErrors({ countedCashMinor: parsed.error });
      return;
    }
    const signal = controller.signal;
    setPendingRequest("save");
    setErrorMessage(null);
    setFieldErrors({});
    try {
      const next = await client.saveDraft(
        { countedCashMinor: parsed.minor, explanation: typedExplanation },
        withTimeout(signal),
      );
      if (signal.aborted) {
        return;
      }
      setSavedCloseout(next);
    } catch (error: unknown) {
      if (!signal.aborted) {
        await handleSaveOrFinalizeError(error, "save", signal);
      }
    } finally {
      if (!signal.aborted) {
        setPendingRequest(null);
      }
    }
  }

  // Checks rule 4 against what's typed. Problems are shown at their field; otherwise the operator
  // is asked to confirm, with focus on "Go back" so a stray double Enter can't finalize.
  function handleFinalize() {
    if (pendingRequest || confirming || !savedCloseout) {
      return;
    }
    setErrorMessage(null);
    const errors = finalizeErrors(typedCount, typedExplanation, savedCloseout.expectedCashMinor);
    if (errors) {
      showFieldErrors(errors);
      return;
    }
    flushSync(() => {
      setFieldErrors({});
      setConfirming(true);
    });
    goBackButton.current?.focus();
  }

  // Closes the confirm step and returns focus to the Finalize button, which reappears.
  function closeConfirmation() {
    flushSync(() => setConfirming(false));
    finalizeButton.current?.focus();
  }

  function handleGoBack() {
    if (!pendingRequest) {
      closeConfirmation();
    }
  }

  // Saves exactly what's on screen, then finalizes it. If the save fails, nothing is finalized,
  // so an older saved draft can never be locked in by mistake.
  async function handleConfirm() {
    const controller = abortController.current;
    const parsed = parseCount(typedCount);
    if (pendingRequest || !controller || !parsed.ok) {
      return;
    }
    const signal = controller.signal;
    setPendingRequest("finalize");
    setErrorMessage(null);
    let step: FailedAction = "saveBeforeFinalize";
    try {
      const saved = await client.saveDraft(
        { countedCashMinor: parsed.minor, explanation: typedExplanation },
        withTimeout(signal),
      );
      if (signal.aborted) {
        return;
      }
      setSavedCloseout(saved);
      step = "finalize";
      const finalized = await client.finalize(withTimeout(signal));
      if (signal.aborted) {
        return;
      }
      setConfirming(false);
      setSavedCloseout(finalized);
    } catch (error: unknown) {
      if (!signal.aborted) {
        closeConfirmation();
        await handleSaveOrFinalizeError(error, step, signal);
      }
    } finally {
      if (!signal.aborted) {
        setPendingRequest(null);
      }
    }
  }

  function handleRetryLoad() {
    if (abortController.current) {
      void loadCloseout(abortController.current.signal);
    }
  }

  const isBusy = pendingRequest !== null;
  const isDraft = savedCloseout?.status === "draft";
  const unsaved = isDraft && hasUnsavedChanges(savedCloseout, typedCount, typedExplanation);
  const saveStatus =
    pendingRequest === "save"
      ? "Saving..."
      : unsaved
        ? "You have unsaved changes."
        : isDraft && savedCloseout.countedCashMinor !== null
          ? "Draft saved."
          : "";
  const parsedCount = parseCount(typedCount);
  const typedCountMinor = parsedCount.ok ? parsedCount.minor : null;
  const typedVarianceMinor =
    isDraft && typedCountMinor !== null ? typedCountMinor - savedCloseout.expectedCashMinor : null;
  const statusMessage =
    pendingRequest === "load"
      ? "Loading the drawer..."
      : pendingRequest === "finalize"
        ? "Finalizing the closeout..."
        : "";

  return (
    <section className="cash-up-panel" aria-labelledby={`${id}-heading`} aria-busy={isBusy}>
      <h2 id={`${id}-heading`}>Drawer count</h2>
      {savedCloseout && <ShiftActivity closeout={savedCloseout} />}

      {savedCloseout?.status === "finalized" && <FinalizedRecord closeout={savedCloseout} headingRef={finalizedHeading} />}

      {savedCloseout?.status === "draft" && (
        <div className="cash-up-count">
          <form onSubmit={(event) => void handleSave(event)} noValidate>
            {/* Label on the left, amount on the right, so the count lines up under expected cash. */}
            <div className="cash-up-ledger-row">
              <label htmlFor={`${id}-count`}>Counted cash ({savedCloseout.currency})</label>
              <div className="cash-up-ledger-value">
                <div className="cash-up-money-input">
                  <span className="cash-up-currency" aria-hidden="true">
                    {currencySymbol(savedCloseout.currency)}
                  </span>
                  <input
                    ref={countInput}
                    id={`${id}-count`}
                    type="text"
                    inputMode="decimal"
                    autoComplete="off"
                    value={typedCount}
                    readOnly={isBusy || confirming}
                    aria-invalid={Boolean(fieldErrors.countedCashMinor)}
                    aria-describedby={fieldErrors.countedCashMinor ? `${id}-count-error` : undefined}
                    onChange={(event) => {
                      setTypedCount(event.target.value);
                      setFieldErrors((errors) => ({ ...errors, countedCashMinor: undefined }));
                    }}
                  />
                </div>
                {fieldErrors.countedCashMinor && (
                  <p id={`${id}-count-error`} className="cash-up-field-error">
                    {fieldErrors.countedCashMinor}
                  </p>
                )}
              </div>
            </div>

            <dl className="cash-up-ledger-row">
              <dt>Variance</dt>
              <dd className="cash-up-ledger-value">
                {typedVarianceMinor !== null ? (
                  <VarianceText varianceMinor={typedVarianceMinor} currency={savedCloseout.currency} />
                ) : (
                  <NoValue>{typedCount.trim() === "" ? "Not counted yet" : "Not a valid amount yet"}</NoValue>
                )}
              </dd>
            </dl>

            <div className="cash-up-field">
              <label htmlFor={`${id}-explanation`}>Explanation</label>
              {/* The hint already states the rule, so when the explanation is missing it becomes the */}
              {/* error itself (red, bold, with a "!" mark) instead of a second message saying the same. */}
              <p
                id={`${id}-explanation-hint`}
                className={fieldErrors.explanation ? "cash-up-hint cash-up-hint-error" : "cash-up-hint"}
              >
                Required when expected cash does not equal counted cash.
              </p>
              <textarea
                ref={explanationInput}
                id={`${id}-explanation`}
                rows={3}
                value={typedExplanation}
                readOnly={isBusy || confirming}
                aria-invalid={Boolean(fieldErrors.explanation)}
                aria-describedby={`${id}-explanation-hint`}
                onChange={(event) => {
                  setTypedExplanation(event.target.value);
                  setFieldErrors((errors) => ({ ...errors, explanation: undefined }));
                }}
              />
            </div>

            {confirming && typedCountMinor !== null && typedVarianceMinor !== null ? (
              <div className="cash-up-confirm" role="group" aria-labelledby={`${id}-confirm-question`}>
                <p id={`${id}-confirm-question`}>
                  {`${confirmQuestion(typedCountMinor, typedVarianceMinor, savedCloseout.currency)} This can't be undone.`}
                </p>
                <div className="cash-up-actions">
                  <button ref={goBackButton} type="button" aria-disabled={isBusy} onClick={handleGoBack}>
                    Go back
                  </button>
                  <button
                    type="button"
                    className="cash-up-primary"
                    aria-disabled={isBusy}
                    onClick={() => void handleConfirm()}
                  >
                    Confirm and finalize
                  </button>
                </div>
              </div>
            ) : (
              <div className="cash-up-actions">
                {/* Whether the entries on screen are saved: "Draft saved.", "You have unsaved changes.", */}
                {/* or nothing before anything is saved or typed. Kept in the page so changes are announced. */}
                <span role="status" className="cash-up-hint">
                  {saveStatus}
                </span>
                <button type="submit" aria-disabled={isBusy}>
                  Save draft
                </button>
                <button
                  ref={finalizeButton}
                  type="button"
                  className="cash-up-primary"
                  aria-disabled={isBusy}
                  onClick={handleFinalize}
                >
                  Finalize closeout
                </button>
              </div>
            )}
          </form>
        </div>
      )}

      {/* After the actions, so progress and failures appear next to what the operator just did. */}
      <p role="status" className="cash-up-status">
        {statusMessage}
      </p>
      {errorMessage && (
        <div role="alert" className="cash-up-failure">
          <p>{errorMessage}</p>
          {!savedCloseout && !isBusy && (
            <button type="button" onClick={handleRetryLoad}>
              Try again
            </button>
          )}
        </div>
      )}
    </section>
  );
}

// An empty value: a grey dash on screen, and words for screen readers, which would otherwise
// read the dash as "dash" or "minus".
function NoValue({ children }: { children: string }) {
  return (
    <>
      <span className="cash-up-no-value" aria-hidden="true">
        –
      </span>
      <span className="cash-up-visually-hidden">{children}</span>
    </>
  );
}

function VarianceText({ varianceMinor, currency }: { varianceMinor: number; currency: string }) {
  return (
    <span className={`cash-up-variance cash-up-variance-${classifyVariance(varianceMinor)}`}>
      {describeVariance(varianceMinor, currency)}
    </span>
  );
}

// A summary that stays four rows long however busy the shift, with every transaction on
// request. Expected cash is the server's figure; it is never recalculated here.
function ShiftActivity({ closeout }: { closeout: CloseoutSnapshot }) {
  const { currency, transactions } = closeout;
  const sales = transactions.filter((transaction) => transaction.kind === "sale");
  const refunds = transactions.filter((transaction) => transaction.kind === "refund");
  const total = (list: CashTransaction[]) =>
    list.reduce((sum, transaction) => sum + transaction.amountMinor, 0);
  return (
    <div className="cash-up-activity">
      <table>
        <caption>Shift activity</caption>
        <tbody>
          <tr>
            <th scope="row">Opening cash</th>
            <td className="cash-up-amount">{formatMoney(closeout.openingCashMinor, currency)}</td>
          </tr>
          <tr>
            <th scope="row">Sales ({sales.length})</th>
            <td className="cash-up-amount">
              {formatMoney(total(sales), currency, { signed: true })}
            </td>
          </tr>
          <tr>
            <th scope="row">Refunds ({refunds.length})</th>
            <td className="cash-up-amount">
              {formatMoney(-total(refunds), currency, { signed: true })}
            </td>
          </tr>
        </tbody>
        <tfoot>
          <tr>
            <th scope="row">Expected cash</th>
            <td className="cash-up-amount">{formatMoney(closeout.expectedCashMinor, currency)}</td>
          </tr>
        </tfoot>
      </table>

      {transactions.length > 0 && (
        <details className="cash-up-transactions">
          <summary>All transactions ({transactions.length})</summary>
          {/* A long list scrolls inside this box, so it can be focused for keyboard scrolling. */}
          <div
            className="cash-up-transactions-list"
            role="region"
            aria-label="All transactions"
            tabIndex={0}
          >
            <table>
              <thead>
                <tr>
                  <th scope="col">Activity</th>
                  <th scope="col">Reference</th>
                  <th scope="col" className="cash-up-amount">
                    Amount
                  </th>
                </tr>
              </thead>
              <tbody>
                {transactions.map((transaction) => (
                  <tr key={transaction.id}>
                    <th scope="row">{transaction.description}</th>
                    <td>{transaction.id}</td>
                    <td className="cash-up-amount">
                      {formatMoney(
                        transaction.kind === "refund" ? -transaction.amountMinor : transaction.amountMinor,
                        currency,
                        { signed: true },
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </div>
  );
}

// The finished record: a centered summary, like a receipt. The heading says it's finalized, so
// nothing else repeats it; the missing input boxes make it plain that it can't be edited.
function FinalizedRecord({
  closeout,
  headingRef,
}: {
  closeout: CloseoutSnapshot;
  headingRef: Ref<HTMLHeadingElement>;
}) {
  const { currency } = closeout;
  return (
    <div className="cash-up-finalized">
      <h3 ref={headingRef} tabIndex={-1}>
        Closeout finalized
      </h3>
      <dl>
        <div className="cash-up-ledger-row">
          <dt>Expected cash</dt>
          <dd className="cash-up-ledger-value">{formatMoney(closeout.expectedCashMinor, currency)}</dd>
        </div>
        <div className="cash-up-ledger-row">
          <dt>Counted cash</dt>
          <dd className="cash-up-ledger-value">
            {closeout.countedCashMinor === null
              ? "Not recorded"
              : formatMoney(closeout.countedCashMinor, currency)}
          </dd>
        </div>
        <div className="cash-up-ledger-row">
          <dt>Variance</dt>
          <dd className="cash-up-ledger-value">
            {closeout.varianceMinor === null ? (
              "Not recorded"
            ) : (
              <VarianceText varianceMinor={closeout.varianceMinor} currency={currency} />
            )}
          </dd>
        </div>
        {/* The explanation belongs with the variance it explains, and only appears when there is one. */}
        {closeout.explanation.trim() !== "" && (
          <div className="cash-up-finalized-note">
            <dt>Explanation</dt>
            <dd>{closeout.explanation}</dd>
          </div>
        )}
        <div className="cash-up-ledger-row">
          <dt>Finalized at</dt>
          <dd className="cash-up-ledger-value">
            {closeout.finalizedAtUtc === null ? (
              "Not recorded"
            ) : (
              <time dateTime={closeout.finalizedAtUtc}>
                {formatUtcTimestamp(closeout.finalizedAtUtc)}
              </time>
            )}
          </dd>
        </div>
      </dl>
    </div>
  );
}
