namespace CashUp.React.Api;

public sealed class CloseoutStore
{
    private const long MaximumCount = 9_007_199_254_740_991;
    private readonly object _gate = new();
    private readonly DrawerFixture _fixture;
    private readonly TimeProvider _timeProvider;
    private readonly long _expectedCashMinor;
    private long? _countedCashMinor;
    private string _explanation = "";
    private DateTimeOffset? _finalizedAtUtc;

    public CloseoutStore(DrawerFixture fixture, TimeProvider timeProvider)
    {
        _fixture = fixture;
        _timeProvider = timeProvider;
        _expectedCashMinor = checked(fixture.OpeningCashMinor
            + fixture.Transactions.Sum(transaction => transaction.Kind switch
            {
                "sale" => transaction.AmountMinor,
                "refund" => -transaction.AmountMinor,
                _ => throw new InvalidDataException(
                    $"Unknown fixture transaction kind: {transaction.Kind}")
            }));
    }

    public CloseoutSnapshot GetSnapshot()
    {
        lock (_gate)
        {
            return Snapshot();
        }
    }

    public MutationResult SaveDraft(SaveDraftRequest request)
    {
        lock (_gate)
        {
            if (_finalizedAtUtc is not null)
            {
                return new MutationResult.Conflict(
                    "A finalized closeout cannot be edited. Reset the demo to start again.");
            }
            if (request.CountedCashMinor is null or < 0 or > MaximumCount)
            {
                return new MutationResult.Invalid(new Dictionary<string, string[]>
                {
                    ["countedCashMinor"] =
                        ["Supply a nonnegative integer count within the documented limit."]
                });
            }
            _countedCashMinor = request.CountedCashMinor;
            _explanation = request.Explanation ?? "";
            return new MutationResult.Success(Snapshot());
        }
    }

    public MutationResult FinalizeCloseout()
    {
        lock (_gate)
        {
            if (_finalizedAtUtc is not null)
            {
                return new MutationResult.Success(Snapshot());
            }
            if (_countedCashMinor is null)
            {
                return new MutationResult.Invalid(new Dictionary<string, string[]>
                {
                    ["countedCashMinor"] = ["Save a count before finalizing."]
                });
            }
            if (_countedCashMinor != _expectedCashMinor
                && string.IsNullOrWhiteSpace(_explanation))
            {
                return new MutationResult.Invalid(new Dictionary<string, string[]>
                {
                    ["explanation"] =
                        ["Explain the shortage or surplus before finalizing."]
                });
            }
            _finalizedAtUtc = _timeProvider.GetUtcNow();
            return new MutationResult.Success(Snapshot());
        }
    }

    public CloseoutSnapshot Reset()
    {
        lock (_gate)
        {
            _countedCashMinor = null;
            _explanation = "";
            _finalizedAtUtc = null;
            return Snapshot();
        }
    }

    private CloseoutSnapshot Snapshot() => new(
        _fixture.DrawerId,
        _fixture.Currency,
        _fixture.OpeningCashMinor,
        _fixture.Transactions,
        _expectedCashMinor,
        _countedCashMinor,
        _countedCashMinor - _expectedCashMinor,
        _explanation,
        _finalizedAtUtc is null ? "draft" : "finalized",
        _finalizedAtUtc);
}

public abstract record MutationResult
{
    public sealed record Success(CloseoutSnapshot Snapshot) : MutationResult;
    public sealed record Invalid(Dictionary<string, string[]> Errors) : MutationResult;
    public sealed record Conflict(string Detail) : MutationResult;
}
