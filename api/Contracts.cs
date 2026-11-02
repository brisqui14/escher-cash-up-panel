namespace CashUp.React.Api;

public sealed record CashTransaction(
    string Id, string Kind, long AmountMinor, string Description);

public sealed record DrawerFixture(
    string DrawerId,
    string Currency,
    long OpeningCashMinor,
    IReadOnlyList<CashTransaction> Transactions);

public sealed record SaveDraftRequest(long? CountedCashMinor, string? Explanation);

public sealed record CloseoutSnapshot(
    string DrawerId,
    string Currency,
    long OpeningCashMinor,
    IReadOnlyList<CashTransaction> Transactions,
    long ExpectedCashMinor,
    long? CountedCashMinor,
    long? VarianceMinor,
    string Explanation,
    string Status,
    DateTimeOffset? FinalizedAtUtc);

public sealed record DemoBehaviorRequest(int? DelayMilliseconds, bool FailNextMutation);
