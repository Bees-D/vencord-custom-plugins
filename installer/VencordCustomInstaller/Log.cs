using System.Diagnostics;
using System.Text;
using System.Text.RegularExpressions;

namespace VencordCustomInstaller;

enum LogKind { Info, Step, Output, Warning, Error, Success }

readonly record struct LogLine(LogKind Kind, string Text);

static partial class Log
{
    const int MaxLines = 4000;
    static readonly List<LogLine> lines = [];
    static readonly object gate = new();
    public static int Version { get; private set; }

    [GeneratedRegex(@"\x1B\[[0-?]*[ -/]*[@-~]|\x1B\][^\x07]*\x07")]
    private static partial Regex AnsiRegex();

    public static void Write(LogKind kind, string text)
    {
        text = AnsiRegex().Replace(text, "").TrimEnd();
        lock (gate)
        {
            lines.Add(new LogLine(kind, text));
            if (lines.Count > MaxLines)
                lines.RemoveRange(0, lines.Count - MaxLines);
            Version++;
        }
        try
        {
            Directory.CreateDirectory(Paths.Root);
            File.AppendAllText(Paths.LogFile, $"[{DateTime.Now:HH:mm:ss}] {kind,-7} {text}{Environment.NewLine}");
        }
        catch { }
    }

    public static void Info(string text) => Write(LogKind.Info, text);
    public static void Step(string text) => Write(LogKind.Step, text);
    public static void Warn(string text) => Write(LogKind.Warning, text);
    public static void Error(string text) => Write(LogKind.Error, text);
    public static void Success(string text) => Write(LogKind.Success, text);

    public static LogLine[] Snapshot()
    {
        lock (gate)
            return [.. lines];
    }

    public static string AllText()
    {
        var builder = new StringBuilder();
        foreach (var line in Snapshot())
            builder.AppendLine(line.Text);
        return builder.ToString();
    }
}

sealed class CommandFailedException(string message) : Exception(message);

static class ProcessRunner
{
    public static async Task<int> RunAsync(string fileName, IEnumerable<string> args, string? workingDirectory, CancellationToken token, bool logOutput = true, Action<string>? onLine = null)
    {
        var info = new ProcessStartInfo(fileName)
        {
            WorkingDirectory = workingDirectory ?? Paths.Root,
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            RedirectStandardInput = true,
            StandardOutputEncoding = Encoding.UTF8,
            StandardErrorEncoding = Encoding.UTF8
        };
        foreach (var arg in args)
            info.ArgumentList.Add(arg);

        info.Environment["Path"] = Tools.CurrentPath;
        info.Environment["CI"] = "true";
        info.Environment["FORCE_COLOR"] = "0";
        info.Environment["NO_COLOR"] = "1";
        info.Environment["COREPACK_ENABLE_DOWNLOAD_PROMPT"] = "0";
        info.Environment["GIT_TERMINAL_PROMPT"] = "0";
        foreach (var (key, value) in Tools.ExtraEnvironment)
            info.Environment[key] = value;

        using var process = new Process { StartInfo = info, EnableRaisingEvents = true };
        void Handle(string? data)
        {
            if (data is null)
                return;
            onLine?.Invoke(data);
            if (logOutput && data.Trim().Length > 0)
                Log.Write(LogKind.Output, data);
        }
        process.OutputDataReceived += (_, e) => Handle(e.Data);
        process.ErrorDataReceived += (_, e) => Handle(e.Data);

        if (!process.Start())
            throw new CommandFailedException($"Could not start {fileName}.");
        process.StandardInput.Close();
        process.BeginOutputReadLine();
        process.BeginErrorReadLine();

        try
        {
            await process.WaitForExitAsync(token);
        }
        catch (OperationCanceledException)
        {
            try { process.Kill(entireProcessTree: true); } catch { }
            throw;
        }
        process.WaitForExit();
        return process.ExitCode;
    }

    public static async Task RunCheckedAsync(string fileName, IEnumerable<string> args, string? workingDirectory, CancellationToken token, string failure)
    {
        var code = await RunAsync(fileName, args, workingDirectory, token);
        if (code != 0)
            throw new CommandFailedException($"{failure} (exit code {code}).");
    }

    public static async Task<string> CaptureAsync(string fileName, IEnumerable<string> args, string? workingDirectory, CancellationToken token)
    {
        var output = new StringBuilder();
        var code = await RunAsync(fileName, args, workingDirectory, token, logOutput: false, onLine: line => output.AppendLine(line));
        return code == 0 ? output.ToString().Trim() : "";
    }
}
