export interface CashTransaction {
  id: string;
  kind: "sale" | "refund";
  amountMinor: number;
  description: string;
}

export interface CloseoutSnapshot {
  drawerId: string;
  currency: string;
  openingCashMinor: number;
  transactions: CashTransaction[];
  expectedCashMinor: number;
  countedCashMinor: number | null;
  varianceMinor: number | null;
  explanation: string;
  status: "draft" | "finalized";
  finalizedAtUtc: string | null;
}

export interface SaveDraftRequest {
  countedCashMinor: number;
  explanation?: string | null;
}

export interface CloseoutClient {
  getCloseout(signal?: AbortSignal): Promise<CloseoutSnapshot>;
  saveDraft(request: SaveDraftRequest, signal?: AbortSignal): Promise<CloseoutSnapshot>;
  finalize(signal?: AbortSignal): Promise<CloseoutSnapshot>;
}

export interface ProblemDetails {
  title: string;
  detail?: string;
  errors?: Record<string, string[]>;
}
