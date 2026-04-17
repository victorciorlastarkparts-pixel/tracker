using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

public sealed class Worker : BackgroundService
{
    private readonly ILogger<Worker> _logger;
    private readonly AgentFileLog _fileLog;
    private readonly ActivityRepository _repository;
    private readonly WindowTracker _tracker;
    private readonly SyncClient _syncClient;
    private readonly AgentOptions _options;
    private readonly string _sessionId = Guid.NewGuid().ToString("N");

    public Worker(
        ILogger<Worker> logger,
        IConfiguration configuration,
        AgentFileLog fileLog,
        ActivityRepository repository,
        WindowTracker tracker,
        SyncClient syncClient)
    {
        _logger = logger;
        _fileLog = fileLog;
        _repository = repository;
        _tracker = tracker;
        _syncClient = syncClient;
        _options = configuration.GetSection("Agent").Get<AgentOptions>() ?? new AgentOptions();
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _logger.LogInformation("MonitorGate Agent iniciado. SessionId={SessionId}", _sessionId);
        _fileLog.Info($"Agent started. sessionId={_sessionId} userId={_options.UserId} device={_options.DeviceName} syncEvery={_options.SyncIntervalSeconds}s");
        _fileLog.Info($"Sync log path: {_fileLog.LogPath}");

        TimeSpan pollInterval = TimeSpan.FromMilliseconds(Math.Max(250, _options.PollIntervalMs));
        TimeSpan syncInterval = TimeSpan.FromSeconds(Math.Max(30, _options.SyncIntervalSeconds));
        DateTimeOffset lastSync = DateTimeOffset.UtcNow;

        while (!stoppingToken.IsCancellationRequested)
        {
            ActivitySample? sample = _tracker.Poll(
                _sessionId,
                _options.UserId,
                _options.DeviceName,
                _options.ForegroundSliceSeconds,
                _options.IdleThresholdSeconds
            );
            if (sample is not null)
            {
                _repository.Insert(sample);
            }

            if (DateTimeOffset.UtcNow - lastSync >= syncInterval)
            {
                await TrySyncAsync(stoppingToken);
                lastSync = DateTimeOffset.UtcNow;
            }

            await Task.Delay(pollInterval, stoppingToken);
        }
    }

    public override async Task StopAsync(CancellationToken cancellationToken)
    {
        ActivitySample? finalSample = _tracker.Flush(_sessionId, _options.UserId, _options.DeviceName);
        if (finalSample is not null)
        {
            _repository.Insert(finalSample);
        }

        await TrySyncAsync(cancellationToken);
        await base.StopAsync(cancellationToken);
    }

    private async Task TrySyncAsync(CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(_options.ApiBaseUrl) || string.IsNullOrWhiteSpace(_options.ApiToken))
        {
            _fileLog.Warn("Sync skipped: ApiBaseUrl or ApiToken is empty.");
            return;
        }

        IReadOnlyList<ActivitySample> pending = _repository.GetPending(_options.BatchSize);
        if (pending.Count == 0)
        {
            _fileLog.Info("Sync skipped: no pending events.");
            return;
        }

        try
        {
            _fileLog.Info($"Sync attempt: pending={pending.Count} batchSize={_options.BatchSize} endpoint={_options.ApiBaseUrl.TrimEnd('/')}/api/activity");
            bool ok = await _syncClient.SendBatchAsync(
                _options.ApiBaseUrl,
                _options.ApiToken,
                _options.UserId,
                pending,
                _options.SendFullUrl,
                cancellationToken
            );

            if (ok)
            {
                _repository.MarkSynced(pending.Where(x => x.Id.HasValue).Select(x => x.Id!.Value));
                _fileLog.Info($"Sync success: sent={pending.Count}");
            }
            else
            {
                _fileLog.Warn($"Sync failed with non-success HTTP status. pending={pending.Count}");
            }
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Falha no sync remoto.");
            _fileLog.Error($"Sync exception: {ex.GetType().Name} - {ex.Message}");
        }
    }
}
