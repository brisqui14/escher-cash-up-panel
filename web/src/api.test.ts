import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, closeoutClient } from "./api";

afterEach(() => vi.unstubAllGlobals());

describe("supplied API client", () => {
  it("preserves server validation errors instead of treating a failed save as success", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          title: "Validation failed",
          errors: { countedCashMinor: ["Enter a valid count."] },
        }),
        { status: 400, headers: { "Content-Type": "application/problem+json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = closeoutClient.saveDraft({ countedCashMinor: -1 });

    await expect(result).rejects.toBeInstanceOf(ApiError);
    await expect(result).rejects.toMatchObject({
      status: 400,
      errors: { countedCashMinor: ["Enter a valid count."] },
    });
  });

  it("forwards cancellation so an embedded panel can abort its pending requests", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockRejectedValue(
      new DOMException("The request was aborted.", "AbortError"),
    );
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();
    controller.abort();

    await expect(closeoutClient.getCloseout(controller.signal)).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(fetchMock).toHaveBeenCalledWith("/api/closeout", {
      signal: controller.signal,
    });
  });
});
