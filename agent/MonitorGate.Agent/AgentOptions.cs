public sealed class AgentOptions
{
    public string UserId { get; set; } = "demo-user";
    public string DeviceName { get; set; } = Environment.MachineName;
    public int PollIntervalMs { get; set; } = 1000;
    public int SyncIntervalSeconds { get; set; } = 120;
    public int ForegroundSliceSeconds { get; set; } = 2;
    public int IdleThresholdSeconds { get; set; } = 40;
    public int BatchSize { get; set; } = 300;
    public string ApiBaseUrl { get; set; } = string.Empty;
    public string ApiToken { get; set; } = string.Empty;
    public bool SendFullUrl { get; set; }
}
