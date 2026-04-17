using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;

public static class NativeMethods
{
    [StructLayout(LayoutKind.Sequential)]
    private struct LastInputInfo
    {
        public uint Size;
        public uint Time;
    }

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool GetLastInputInfo(ref LastInputInfo plii);

    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll", SetLastError = true)]
    private static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern int GetWindowTextLength(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);

    public static PresenceState ReadPresenceState(int idleThresholdSeconds)
    {
        int safeThreshold = Math.Max(1, idleThresholdSeconds);
        double idleSeconds = GetIdleSeconds();
        string state = idleSeconds >= safeThreshold ? "ocioso" : "ativo";
        return new PresenceState(state);
    }

    private static double GetIdleSeconds()
    {
        LastInputInfo lii = new()
        {
            Size = (uint)Marshal.SizeOf<LastInputInfo>()
        };

        if (!GetLastInputInfo(ref lii))
        {
            return 0;
        }

        long tickNow = Environment.TickCount64;
        long tickLastInput = lii.Time;
        long idleMs = Math.Max(0, tickNow - tickLastInput);
        return idleMs / 1000d;
    }

    public static ForegroundState? ReadForegroundWindow(BrowserInspector browserInspector)
    {
        IntPtr hwnd = GetForegroundWindow();
        if (hwnd == IntPtr.Zero)
        {
            return null;
        }

        int length = GetWindowTextLength(hwnd);
        if (length <= 0)
        {
            return null;
        }

        StringBuilder builder = new(length + 1);
        _ = GetWindowText(hwnd, builder, builder.Capacity);
        string title = builder.ToString().Trim();

        _ = GetWindowThreadProcessId(hwnd, out uint processId);
        Process process;
        try
        {
            process = Process.GetProcessById((int)processId);
        }
        catch
        {
            return null;
        }

        string processName = process.ProcessName;
        
        // Determinar appName: se for navegador, usar nome formatado; senão, usar window title ou process name
        string appName = GetFriendlyAppName(processName, process.MainWindowTitle);

        (string? url, string? domain) = browserInspector.Inspect(processName, title);

        return new ForegroundState(
            hwnd,
            appName,
            processName,
            title,
            url,
            domain
        );
    }

    private static string GetFriendlyAppName(string processName, string windowTitle)
    {
        return processName.ToLowerInvariant() switch
        {
            "firefox" => "Mozilla Firefox",
            "chrome" => "Google Chrome",
            "msedge" => "Microsoft Edge",
            "spotify" => "Spotify",
            _ => string.IsNullOrWhiteSpace(windowTitle) ? processName : windowTitle
        };
    }
}
