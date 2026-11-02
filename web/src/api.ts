import type {
  CloseoutClient,
  CloseoutSnapshot,
  ProblemDetails,
} from "./contracts";

export class ApiError extends Error {
  readonly status: number;
  readonly errors: Record<string, string[]>;

  constructor(status: number, problem: ProblemDetails) {
    super(problem.detail ?? problem.title);
    this.name = "ApiError";
    this.status = status;
    this.errors = problem.errors ?? {};
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isProblem(value: unknown): value is ProblemDetails {
  return (
    isRecord(value) &&
    typeof value.title === "string" &&
    (value.detail === undefined || typeof value.detail === "string") &&
    (value.errors === undefined ||
      (isRecord(value.errors) &&
        Object.values(value.errors).every(
          (messages) =>
            Array.isArray(messages) &&
            messages.every((message: unknown) => typeof message === "string"),
        )))
  );
}

async function send(path: string, init?: RequestInit): Promise<Response> {
  const response = await fetch(path, init);
  if (!response.ok) {
    const contentType = response.headers.get("content-type") ?? "";
    const body: unknown = contentType.includes("json") ? await response.json() : null;
    throw new ApiError(
      response.status,
      isProblem(body)
        ? body
        : {
            title: `Request failed (${response.status}).`,
            detail: "The service returned an error without a valid Problem Details body.",
          },
    );
  }
  return response;
}

async function snapshot(path: string, init?: RequestInit): Promise<CloseoutSnapshot> {
  const response = await send(path, init);
  return (await response.json()) as CloseoutSnapshot;
}

export const closeoutClient: CloseoutClient = {
  getCloseout: (signal) => snapshot("/api/closeout", { signal }),
  saveDraft: (request, signal) =>
    snapshot("/api/closeout/draft", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
      signal,
    }),
  finalize: (signal) =>
    snapshot("/api/closeout/finalize", { method: "POST", signal }),
};

export async function resetDemo(): Promise<CloseoutSnapshot> {
  return snapshot("/demo/reset", { method: "POST" });
}

export async function configureDemo(
  delayMilliseconds: number,
  failNextMutation: boolean,
): Promise<void> {
  await send("/demo/behavior", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ delayMilliseconds, failNextMutation }),
  });
}
