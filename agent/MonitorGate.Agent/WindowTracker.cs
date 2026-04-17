public sealed class WindowTracker
{
    private PresenceState? _current;
    private DateTimeOffset _startedAtUtc;

    public WindowTracker()
    {
        _startedAtUtc = DateTimeOffset.UtcNow;
    }

    public ActivitySample? Poll(
        string sessionId,
        string userId,
        string deviceName,
        int stateSliceSeconds,
        int idleThresholdSeconds)
    {
        DateTimeOffset now = DateTimeOffset.UtcNow;
        PresenceState latest = NativeMethods.ReadPresenceState(idleThresholdSeconds);

        if (_current is null)
        {
            _current = latest;
            _startedAtUtc = now;
            return null;
        }

        bool changed = latest.State != _current.State;

        if (!changed)
        {
            int safeSliceSeconds = Math.Max(2, stateSliceSeconds);
            long elapsedMs = (long)(now - _startedAtUtc).TotalMilliseconds;
            long sliceMs = safeSliceSeconds * 1000L;

            if (elapsedMs >= sliceMs)
            {
                ActivitySample sliceSample = new(
                    Id: null,
                    SessionId: sessionId,
                    UserId: userId,
                    DeviceName: deviceName,
                    AppName: _current.State,
                    ProcessName: "presence",
                    WindowTitle: _current.State,
                    Url: null,
                    UrlDomain: null,
                    StartUtc: _startedAtUtc,
                    EndUtc: now,
                    DurationMs: elapsedMs,
                    Synced: false
                );

                _startedAtUtc = now;
                return sliceSample;
            }

            return null;
        }

        long durationMs = (long)(now - _startedAtUtc).TotalMilliseconds;
        if (durationMs < 250)
        {
            _current = latest;
            _startedAtUtc = now;
            return null;
        }

        ActivitySample sample = new(
            Id: null,
            SessionId: sessionId,
            UserId: userId,
            DeviceName: deviceName,
            AppName: _current.State,
            ProcessName: "presence",
            WindowTitle: _current.State,
            Url: null,
            UrlDomain: null,
            StartUtc: _startedAtUtc,
            EndUtc: now,
            DurationMs: durationMs,
            Synced: false
        );

        _current = latest;
        _startedAtUtc = now;
        return sample;
    }

    public ActivitySample? Flush(string sessionId, string userId, string deviceName)
    {
        if (_current is null)
        {
            return null;
        }

        DateTimeOffset now = DateTimeOffset.UtcNow;
        long durationMs = (long)(now - _startedAtUtc).TotalMilliseconds;
        if (durationMs <= 0)
        {
            return null;
        }

        ActivitySample sample = new(
            Id: null,
            SessionId: sessionId,
            UserId: userId,
            DeviceName: deviceName,
            AppName: _current.State,
            ProcessName: "presence",
            WindowTitle: _current.State,
            Url: null,
            UrlDomain: null,
            StartUtc: _startedAtUtc,
            EndUtc: now,
            DurationMs: durationMs,
            Synced: false
        );

        _current = null;
        _startedAtUtc = now;
        return sample;
    }
}

public sealed record PresenceState(string State);
