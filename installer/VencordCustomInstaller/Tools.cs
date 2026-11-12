using System.Text.RegularExpressions;

namespace VencordCustomInstaller;

static partial class Tools
{
    public static string CurrentPath { get; private set; } = Environment.GetEnvironmentVariable("Path") ?? "";
    public static Dictionary<string, string> ExtraEnvironment { get; } = [];

    public static void RefreshPath()
    {
        var programFiles = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);
        var localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        var appData = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
        string[] extra =
        [
            Path.Combine(programFiles, "nodejs"),
            Path.Combine(programFiles, "Git", "cmd"),
            Path.Combine(localAppData, "Programs", "Git", "cmd"),
            Path.Combine(appData, "npm"),
            Path.Combine(localAppData, "Microsoft", "WindowsApps")
        ];
        var parts = extra.Where(Directory.Exists)
            .Concat((Environment.GetEnvironmentVariable("Path", EnvironmentVariableTarget.Machine) ?? "").Split(';'))
            .Concat((Environment.GetEnvironmentVariable("Path", EnvironmentVariableTarget.User) ?? "").Split(';'))
            .Concat((Environment.GetEnvironmentVariable("Path") ?? "").Split(';'))
            .Select(p => Environment.ExpandEnvironmentVariables(p.Trim()))
            .Where(p => p.Length > 0)
            .Distinct(StringComparer.OrdinalIgnoreCase);
        CurrentPath = string.Join(';', parts);
    }

    public static string? Find(string name)
    {
        var extensions = Path.HasExtension(name) ? [""] : new[] { ".exe", ".cmd", ".bat", "" };
        foreach (var directory in CurrentPath.Split(';'))
        {
            foreach (var extension in extensions)
            {
                try
                {
                    var candidate = Path.Combine(directory, name + extension);
                    if (File.Exists(candidate))
                        return candidate;
                }
                catch { }
            }
        }
        return null;
    }

    [GeneratedRegex(@"^v?(\d+)\.")]
    private static partial Regex NodeVersionRegex();

    public static async Task<int> NodeMajorAsync(CancellationToken token)
    {
        var node = Find("node.exe");
        if (node is null)
            return 0;
        var version = await ProcessRunner.CaptureAsync(node, ["--version"], null, token);
        var match = NodeVersionRegex().Match(version);
        return match.Success ? int.Parse(match.Groups[1].Value) : 0;
    }

    static async Task WingetAsync(string verb, string packageId, CancellationToken token)
    {
        var winget = Find("winget.exe")
            ?? throw new CommandFailedException("Windows Package Manager (winget) is missing. Install \"App Installer\" from the Microsoft Store, then try again.");
        Log.Info($"winget {verb} {packageId}...");
        var code = await ProcessRunner.RunAsync(winget,
            [verb, "--id", packageId, "--exact", "--source", "winget", "--silent", "--accept-source-agreements", "--accept-package-agreements", "--disable-interactivity"],
            null, token);
        // -1978335189: no applicable upgrade; -1978335212: already installed
        if (code != 0 && code != -1978335189 && code != -1978335212)
            throw new CommandFailedException($"winget could not {verb} {packageId} (exit code {code}).");
        RefreshPath();
    }

    /// <summary>Node's bundled scripts are run through node.exe directly so no .cmd shim or shell is involved.</summary>
    static string? NodeScript(string shimName, string relativeScript)
    {
        var shim = Find(shimName + ".cmd");
        if (shim is null)
            return null;
        var script = Path.Combine(Path.GetDirectoryName(shim)!, "node_modules", relativeScript);
        return File.Exists(script) ? script : null;
    }

    public static string Node => Find("node.exe") ?? throw new CommandFailedException("Node.js was not found.");
    public static string Git => Find("git.exe") ?? throw new CommandFailedException("Git was not found.");
    public static string Corepack => NodeScript("corepack", Path.Combine("corepack", "dist", "corepack.js")) ?? throw new CommandFailedException("Corepack was not found.");

    public static async Task EnsureAsync(CancellationToken token)
    {
        RefreshPath();

        var nodeMajor = await NodeMajorAsync(token);
        if (nodeMajor < 22)
        {
            Log.Info(nodeMajor == 0 ? "Node.js is not installed." : $"Node.js {nodeMajor} is too old; Vencord needs 22 or newer.");
            await WingetAsync(nodeMajor == 0 ? "install" : "upgrade", "OpenJS.NodeJS.LTS", token);
            if (await NodeMajorAsync(token) < 22)
                await WingetAsync("install", "OpenJS.NodeJS.LTS", token);
            nodeMajor = await NodeMajorAsync(token);
            if (nodeMajor < 22)
                throw new CommandFailedException("Node.js 22 or newer is still not available. Restart Windows and try again.");
        }
        Log.Info($"Node.js {nodeMajor} found.");

        if (Find("git.exe") is null)
            await WingetAsync("install", "Git.Git", token);
        Log.Info("Git found.");

        if (NodeScript("corepack", Path.Combine("corepack", "dist", "corepack.js")) is null)
        {
            // Node 25+ no longer ships Corepack.
            var npm = NodeScript("npm", Path.Combine("npm", "bin", "npm-cli.js"))
                ?? throw new CommandFailedException("npm is missing from the Node.js install. Reinstall Node.js LTS.");
            Log.Info("Installing Corepack so Vencord can use its pinned pnpm version...");
            await ProcessRunner.RunCheckedAsync(Node, [npm, "install", "--global", "corepack"], null, token, "Could not install Corepack");
            RefreshPath();
        }
        _ = Corepack;
        Log.Info("Corepack found.");
    }
}
