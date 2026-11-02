import { StrictMode } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "./api";
import { CashUpPanel } from "./CashUpPanel";
import type { CloseoutClient, CloseoutSnapshot } from "./contracts";

const FINALIZED_AT = "2026-11-03T09:30:00Z";

function initialSnapshot(): CloseoutSnapshot {
  return {
    drawerId: "counter-01",
    currency: "EUR",
    openingCashMinor: 10000,
    transactions: [
      { id: "sale-001", kind: "sale", amountMinor: 5500, description: "Cash sale" },
      { id: "sale-002", kind: "sale", amountMinor: 2750, description: "Cash sale" },
      { id: "refund-001", kind: "refund", amountMinor: 750, description: "Cash refund" },
    ],
    expectedCashMinor: 17500,
    countedCashMinor: null,
    varianceMinor: null,
    explanation: "",
    status: "draft",
    finalizedAtUtc: null,
  };
}

function serviceUnavailableError() {
  return new ApiError(503, { title: "Simulated service failure", detail: "No change was saved." });
}

function validationError(field: string, message: string) {
  return new ApiError(400, { title: "Validation failed", errors: { [field]: [message] } });
}

// An in-memory stand-in that follows API-CONTRACT.md, including the fixture's
// one-shot failure that is consumed by the next save or finalize.
function fakeService(initial: CloseoutSnapshot = initialSnapshot()) {
  let state: CloseoutSnapshot = structuredClone(initial);
  let nextFailure: ApiError | null = null;

  function failIfScheduled() {
    const failure = nextFailure;
    nextFailure = null;
    if (failure) {
      throw failure;
    }
  }

  const client = {
    getCloseout: vi.fn<CloseoutClient["getCloseout"]>(async () => structuredClone(state)),
    saveDraft: vi.fn<CloseoutClient["saveDraft"]>(async (request) => {
      failIfScheduled();
      if (state.status === "finalized") {
        throw new ApiError(409, { title: "Closeout already finalized" });
      }
      state = {
        ...state,
        countedCashMinor: request.countedCashMinor,
        varianceMinor: request.countedCashMinor - state.expectedCashMinor,
        explanation: request.explanation ?? "",
      };
      return structuredClone(state);
    }),
    finalize: vi.fn<CloseoutClient["finalize"]>(async () => {
      failIfScheduled();
      if (state.status === "draft") {
        if (state.countedCashMinor === null) {
          throw validationError("countedCashMinor", "Save a count before finalizing.");
        }
        if (state.varianceMinor !== 0 && state.explanation.trim() === "") {
          throw validationError("explanation", "Explain the shortage or surplus before finalizing.");
        }
        state = { ...state, status: "finalized", finalizedAtUtc: FINALIZED_AT };
      }
      return structuredClone(state);
    }),
  } satisfies CloseoutClient;

  return {
    client,
    failNextMutation: (error: ApiError) => {
      nextFailure = error;
    },
    finalizeElsewhere: (countedCashMinor: number) => {
      state = {
        ...state,
        countedCashMinor,
        varianceMinor: countedCashMinor - state.expectedCashMinor,
        status: "finalized",
        finalizedAtUtc: FINALIZED_AT,
      };
    },
  };
}

async function renderPanel(service = fakeService()) {
  const onFinalized = vi.fn<(snapshot: CloseoutSnapshot) => void>();
  const view = render(<CashUpPanel client={service.client} onFinalized={onFinalized} />);
  await screen.findByRole("table", { name: "Shift activity" });
  return { ...view, service, onFinalized };
}

const countInput = () => screen.getByLabelText("Counted cash (EUR)");
const explanationInput = () => screen.getByLabelText("Explanation");
const saveButton = () => screen.getByRole("button", { name: "Save draft" });
const finalizeButton = () => screen.getByRole("button", { name: "Finalize closeout" });
const confirmButton = () => screen.getByRole("button", { name: "Confirm and finalize" });
const goBackButton = () => screen.getByRole("button", { name: "Go back" });
const confirmStep = () => screen.queryByRole("group", { name: /^Finalize with/ });

function enter(count: string, explanation?: string) {
  fireEvent.change(countInput(), { target: { value: count } });
  if (explanation !== undefined) {
    fireEvent.change(explanationInput(), { target: { value: explanation } });
  }
}

async function saveDraft(count: string, explanation?: string) {
  enter(count, explanation);
  fireEvent.click(saveButton());
  await screen.findByText("Draft saved.");
  await waitFor(() => expect(saveButton()).toHaveAttribute("aria-disabled", "false"));
}

describe("CashUpPanel", () => {
  it("shows the expected cash and its activity, with count and variance absent rather than zero", async () => {
    await renderPanel();

    const activity = screen.getByRole("table", { name: "Shift activity" });
    expect(within(activity).getByRole("row", { name: /Opening cash\s+€100\.00/ })).toBeVisible();
    expect(within(activity).getByRole("row", { name: /Sales \(2\)\s+\+€82\.50/ })).toBeVisible();
    expect(within(activity).getByRole("row", { name: /Refunds \(1\)\s+-€7\.50/ })).toBeVisible();
    expect(within(activity).getByRole("row", { name: /Expected cash\s+€175\.00/ })).toBeVisible();
    expect(screen.getByText("Not counted yet")).toBeInTheDocument();
    expect(screen.getByText("–")).toHaveAttribute("aria-hidden", "true");
    expect(screen.queryByText("€0.00")).not.toBeInTheDocument();
    expect(countInput()).toHaveValue("");
  });

  it("keeps a long shift short: a summary up front, every transaction on request", async () => {
    const transactions = Array.from({ length: 40 }, (_, index) => ({
      id: `sale-${String(index + 1).padStart(3, "0")}`,
      kind: "sale" as const,
      amountMinor: 100,
      description: "Cash sale",
    }));
    await renderPanel(fakeService({ ...initialSnapshot(), transactions, expectedCashMinor: 14000 }));

    const activity = screen.getByRole("table", { name: "Shift activity" });
    expect(within(activity).getAllByRole("row")).toHaveLength(4);
    expect(within(activity).getByRole("row", { name: /Sales \(40\)\s+\+€40\.00/ })).toBeVisible();

    const list = screen.getByRole("region", { name: "All transactions", hidden: true });
    expect(list).not.toBeVisible();
    fireEvent.click(screen.getByText("All transactions (40)"));
    expect(list).toBeVisible();
    expect(list).toHaveAttribute("tabindex", "0");
    expect(within(list).getAllByRole("row")).toHaveLength(41);
  });

  it("says next to Save draft whether the entries are saved", async () => {
    const { service } = await renderPanel();
    const status = () => saveButton().parentElement!;
    // Hold the next save until the test lets it finish, to see the "Saving..." state.
    const saveForReal = service.client.saveDraft.getMockImplementation()!;
    let finishSave = () => {};
    service.client.saveDraft.mockImplementationOnce(async (request, signal) => {
      await new Promise<void>((resolve) => {
        finishSave = resolve;
      });
      return saveForReal(request, signal);
    });

    expect(status()).not.toHaveTextContent(/saved|unsaved|saving/i);
    enter("173");
    expect(status()).toHaveTextContent("You have unsaved changes.");
    fireEvent.click(saveButton());
    expect(status()).toHaveTextContent("Saving...");
    expect(screen.queryByText("Saving the draft...")).not.toBeInTheDocument();
    finishSave();
    expect(await screen.findByText("Draft saved.")).toBeVisible();
    enter("174");
    expect(status()).toHaveTextContent("You have unsaved changes.");
    enter("173.00");
    expect(status()).toHaveTextContent("Draft saved.");
  });

  it("saves a draft, including an unfinished explanation, without finalizing it", async () => {
    const { service, onFinalized } = await renderPanel();

    await saveDraft("173", "Recounted once, still che");

    expect(service.client.saveDraft).toHaveBeenLastCalledWith(
      { countedCashMinor: 17300, explanation: "Recounted once, still che" },
      expect.any(AbortSignal),
    );
    expect(service.client.finalize).not.toHaveBeenCalled();
    expect(onFinalized).not.toHaveBeenCalled();
    expect(saveButton()).toBeVisible();
  });

  it("shows a field error from the server at its box, and re-reads the server's state", async () => {
    const { service } = await renderPanel();
    const readsBefore = service.client.getCloseout.mock.calls.length;
    service.client.saveDraft.mockRejectedValueOnce(
      validationError("countedCashMinor", "Supply a nonnegative integer count within the documented limit."),
    );

    enter("173");
    fireEvent.click(saveButton());

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The draft was not saved. Check the highlighted fields.",
    );
    expect(countInput()).toHaveAttribute("aria-invalid", "true");
    expect(countInput()).toHaveAccessibleDescription(
      "Supply a nonnegative integer count within the documented limit.",
    );
    expect(countInput()).toHaveFocus();
    await waitFor(() => expect(service.client.getCloseout.mock.calls.length).toBe(readsBefore + 1));
  });

  it("rejects an invalid count at the field without calling the API", async () => {
    const { service } = await renderPanel();

    // A screen reader reads the box when focus arrives, so its error must already be attached.
    let invalidWhenFocused: string | null = null;
    countInput().addEventListener("focus", () => {
      invalidWhenFocused = countInput().getAttribute("aria-invalid");
    });
    fireEvent.change(countInput(), { target: { value: "12.345" } });
    fireEvent.click(saveButton());

    expect(countInput()).toHaveAttribute("aria-invalid", "true");
    expect(countInput()).toHaveFocus();
    expect(invalidWhenFocused).toBe("true");
    expect(countInput()).toHaveAccessibleDescription(/Use at most two decimal places\./);
    expect(service.client.saveDraft).not.toHaveBeenCalled();
  });

  it("shows the variance of what is typed, in words, as the operator types", async () => {
    const { service } = await renderPanel();

    enter("173");
    expect(screen.getByText("Shortage of €2.00")).toBeVisible();
    enter("177.50");
    expect(screen.getByText("Surplus of €2.50")).toBeVisible();
    enter("175");
    expect(screen.getByText("None")).toHaveClass("cash-up-variance-match");
    enter("17x");
    expect(screen.getByText("Not a valid amount yet")).toBeInTheDocument();
    expect(service.client.saveDraft).not.toHaveBeenCalled();
  });

  it("checks rule 4 when Finalize is clicked: a valid count, and an explanation for a mismatch", async () => {
    const { service } = await renderPanel();

    fireEvent.click(finalizeButton());
    expect(countInput()).toHaveAccessibleDescription(/Enter the counted amount\./);
    expect(countInput()).toHaveFocus();

    enter("173");
    fireEvent.click(finalizeButton());
    expect(explanationInput()).toHaveAttribute("aria-invalid", "true");
    expect(explanationInput()).toHaveAccessibleDescription(
      "Required when expected cash does not equal counted cash.",
    );
    expect(screen.getByText("Required when expected cash does not equal counted cash.")).toHaveClass(
      "cash-up-hint-error",
    );
    expect(screen.queryByText(/Explain the shortage/)).not.toBeInTheDocument();
    expect(explanationInput()).toHaveFocus();

    enter("173", "   ");
    fireEvent.click(finalizeButton());
    expect(explanationInput()).toHaveAttribute("aria-invalid", "true");

    expect(confirmStep()).not.toBeInTheDocument();
    expect(service.client.saveDraft).not.toHaveBeenCalled();
    expect(service.client.finalize).not.toHaveBeenCalled();
  });

  it("confirms what is on screen, then saves and finalizes it and reports the result once", async () => {
    const { service, onFinalized, rerender } = await renderPanel();

    enter("173", "Recounted; drawer is still short.");
    fireEvent.click(finalizeButton());

    expect(confirmStep()).toHaveAccessibleName(
      "Finalize with €173.00 counted, a shortage of €2.00? This can't be undone.",
    );
    expect(goBackButton()).toHaveFocus();
    expect(countInput()).toHaveAttribute("readonly");
    expect(explanationInput()).toHaveAttribute("readonly");
    expect(service.client.saveDraft).not.toHaveBeenCalled();

    fireEvent.click(confirmButton());

    const heading = await screen.findByRole("heading", { name: "Closeout finalized" });
    await waitFor(() => expect(heading).toHaveFocus());
    expect(screen.getByText("Variance").parentElement!.nextElementSibling).toHaveTextContent(
      "ExplanationRecounted; drawer is still short.",
    );
    expect(service.client.saveDraft).toHaveBeenCalledWith(
      { countedCashMinor: 17300, explanation: "Recounted; drawer is still short." },
      expect.any(AbortSignal),
    );
    expect(service.client.finalize).toHaveBeenCalledTimes(1);
    expect(service.client.saveDraft.mock.invocationCallOrder[0]).toBeLessThan(
      service.client.finalize.mock.invocationCallOrder[0],
    );
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.getByText("3 Nov 2026, 09:30:00 UTC")).toBeVisible();
    await waitFor(() => expect(onFinalized).toHaveBeenCalledTimes(1));
    expect(onFinalized).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "finalized",
        countedCashMinor: 17300,
        varianceMinor: -200,
        finalizedAtUtc: FINALIZED_AT,
      }),
    );

    const replacementCallback = vi.fn();
    rerender(<CashUpPanel client={service.client} onFinalized={replacementCallback} />);
    expect(onFinalized).toHaveBeenCalledTimes(1);
    expect(replacementCallback).not.toHaveBeenCalled();
  });

  it("going back from the confirm step sends nothing and returns focus to Finalize", async () => {
    const { service } = await renderPanel();

    enter("175");
    fireEvent.click(finalizeButton());
    fireEvent.click(goBackButton());

    expect(confirmStep()).not.toBeInTheDocument();
    expect(finalizeButton()).toHaveFocus();
    expect(countInput()).not.toHaveAttribute("readonly");
    expect(service.client.saveDraft).not.toHaveBeenCalled();
    expect(service.client.finalize).not.toHaveBeenCalled();
  });

  it("finalizes a matching count without an explanation", async () => {
    const { onFinalized } = await renderPanel();

    enter("175");
    fireEvent.click(finalizeButton());
    expect(confirmStep()).toHaveAccessibleName(
      "Finalize with €175.00 counted, matching the expected cash? This can't be undone.",
    );
    fireEvent.click(confirmButton());

    expect(await screen.findByRole("heading", { name: "Closeout finalized" })).toBeVisible();
    expect(screen.queryByText("Explanation")).not.toBeInTheDocument();
    expect(screen.queryByText("None given")).not.toBeInTheDocument();
    await waitFor(() => expect(onFinalized).toHaveBeenCalledTimes(1));
  });

  it("never finalizes when the save before it fails, so an older draft can't be locked in", async () => {
    const { service } = await renderPanel();
    await saveDraft("175");

    service.failNextMutation(serviceUnavailableError());
    enter("173", "Short after recount");
    fireEvent.click(finalizeButton());
    fireEvent.click(confirmButton());

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Nothing was finalized, because the draft could not be saved first (HTTP 503).",
    );
    expect(service.client.finalize).not.toHaveBeenCalled();
    expect(countInput()).toHaveValue("173");
    expect(explanationInput()).toHaveValue("Short after recount");
    expect(finalizeButton()).toHaveFocus();

    fireEvent.click(finalizeButton());
    fireEvent.click(confirmButton());
    expect(await screen.findByRole("heading", { name: "Closeout finalized" })).toBeVisible();
    expect(service.client.finalize).toHaveBeenCalledTimes(1);
    expect(screen.getByText("€173.00")).toBeVisible();
  });

  it("retries a failed finalization safely and reports the result once", async () => {
    const { service, onFinalized } = await renderPanel();
    service.client.finalize.mockRejectedValueOnce(serviceUnavailableError());

    enter("175");
    fireEvent.click(finalizeButton());
    fireEvent.click(confirmButton());
    expect(await screen.findByRole("alert")).toHaveTextContent("Trying again is safe");
    expect(onFinalized).not.toHaveBeenCalled();

    fireEvent.click(finalizeButton());
    fireEvent.click(confirmButton());
    expect(await screen.findByRole("heading", { name: "Closeout finalized" })).toBeVisible();
    expect(service.client.finalize).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(onFinalized).toHaveBeenCalledTimes(1));
  });

  it("gives every request a 15-second timeout, and a timeout unlocks the panel with a reason", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    const { service } = await renderPanel();
    expect(timeout).toHaveBeenCalledWith(15_000);

    const callsBeforeSave = timeout.mock.calls.length;
    service.client.saveDraft.mockRejectedValueOnce(
      new DOMException("The operation timed out.", "TimeoutError"),
    );
    enter("173");
    fireEvent.click(saveButton());

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The draft could not be saved (no answer within 15 seconds).",
    );
    expect(timeout.mock.calls.length).toBe(callsBeforeSave + 1);
    expect(saveButton()).toHaveAttribute("aria-disabled", "false");
    expect(countInput()).not.toHaveAttribute("readonly");
    expect(countInput()).toHaveValue("173");
  });

  it("lets the operator retry when the drawer cannot be loaded", async () => {
    const service = fakeService();
    service.client.getCloseout.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    render(<CashUpPanel client={service.client} onFinalized={vi.fn()} />);

    expect(await screen.findByRole("alert")).toHaveTextContent("The drawer could not be loaded.");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByRole("table", { name: "Shift activity" })).toBeVisible();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows the finalized record when another session finalized first", async () => {
    const { service, onFinalized } = await renderPanel();

    service.finalizeElsewhere(17500);
    fireEvent.change(countInput(), { target: { value: "170" } });
    fireEvent.click(saveButton());

    expect(await screen.findByRole("heading", { name: "Closeout finalized" })).toBeVisible();
    expect(screen.getByRole("alert")).toHaveTextContent("already been finalized");
    await waitFor(() => expect(onFinalized).toHaveBeenCalledTimes(1));
    expect(onFinalized).toHaveBeenCalledWith(expect.objectContaining({ countedCashMinor: 17500 }));
  });

  it("reports a closeout that was already finalized once when it opens, even under StrictMode", async () => {
    const service = fakeService({
      ...initialSnapshot(),
      countedCashMinor: 17500,
      varianceMinor: 0,
      status: "finalized",
      finalizedAtUtc: FINALIZED_AT,
    });
    const onFinalized = vi.fn();
    render(
      <StrictMode>
        <CashUpPanel client={service.client} onFinalized={onFinalized} />
      </StrictMode>,
    );

    const heading = await screen.findByRole("heading", { name: "Closeout finalized" });
    expect(heading).toBeVisible();
    expect(screen.queryByRole("button", { name: "Save draft" })).not.toBeInTheDocument();
    await waitFor(() => expect(onFinalized).toHaveBeenCalledTimes(1));
    expect(heading).not.toHaveFocus();
  });

  it("aborts its in-flight request when the host removes the panel", async () => {
    const { service, unmount } = await renderPanel();
    let signal: AbortSignal | undefined;
    service.client.saveDraft.mockImplementationOnce((_request, requestSignal) => {
      signal = requestSignal;
      return new Promise(() => {});
    });

    fireEvent.change(countInput(), { target: { value: "175" } });
    fireEvent.click(saveButton());
    expect(signal?.aborted).toBe(false);

    unmount();
    expect(signal?.aborted).toBe(true);
  });
});
