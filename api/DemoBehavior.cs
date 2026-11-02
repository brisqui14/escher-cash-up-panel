namespace CashUp.React.Api;

public sealed class DemoBehavior
{
    private readonly object _gate = new();
    private DemoSettings _settings = new(0, false);

    public void Configure(int delayMilliseconds, bool failNextMutation)
    {
        lock (_gate)
        {
            _settings = new(delayMilliseconds, failNextMutation);
        }
    }

    public DemoSettings Take(bool isMutation)
    {
        lock (_gate)
        {
            var fail = isMutation && _settings.FailNextMutation;
            var result = new DemoSettings(_settings.DelayMilliseconds, fail);
            if (fail)
            {
                _settings = _settings with { FailNextMutation = false };
            }
            return result;
        }
    }

    public void Reset() => Configure(0, false);
}

public sealed record DemoSettings(int DelayMilliseconds, bool FailNextMutation);
