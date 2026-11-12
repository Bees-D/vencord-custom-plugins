using System.IO.Compression;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace VencordCustomInstaller;

static partial class Tools
{
    public static string CurrentPath { get; private set; } = Environment.GetEnvironmentVariable("Path") ?? "";
    public static Dictionary<string, string> ExtraEnvironment { get; } = [];
    /// <summary>Test switch (--force-portable): ignore installed Node.js and Git so the download path runs.</summary>
    public static bool ForcePortable { get; set; }

    public static void RefreshPath()
    {
        var programFiles = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);
        var localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        var appData = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
        string[] extra =
        [
            // Portable copies downloaded by this installer come first, so they win over an older system install.
            PortableNodeDir,
            Path.Combine(PortableGitDir, "cmd"),
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

    static readonly string PortableNodeDir = Path.Combine(Paths.Tools, "node");
    static readonly string PortableGitDir = Path.Combine(Paths.Tools, "mingit");
    static bool IsArm64 => RuntimeInformation.OSArchitecture == Architecture.Arm64;

    static async Task<byte[]> DownloadAsync(string url, CancellationToken token)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, url);
        request.Headers.Accept.ParseAdd("*/*");
        using var response = await Http.Client.SendAsync(request, token);
        response.EnsureSuccessStatusCode();
        return await response.Content.ReadAsByteArrayAsync(token);
    }

    static void ExtractTo(byte[] zip, string destination, bool stripTopFolder)
    {
        var temp = destination + ".tmp";
        if (Directory.Exists(temp))
            Directory.Delete(temp, true);
        using (var stream = new MemoryStream(zip))
            ZipFile.ExtractToDirectory(stream, temp);

        var source = temp;
        if (stripTopFolder && Directory.GetDirectories(temp) is [var only] && Directory.GetFiles(temp).Length == 0)
            source = only;
        if (Directory.Exists(destination))
            Directory.Delete(destination, true);
        Directory.Move(source, destination);
        if (Directory.Exists(temp))
            Directory.Delete(temp, true);
    }

    /// <summary>Downloads the current Node.js LTS as a portable zip, checked against nodejs.org's published SHA-256.</summary>
    static async Task InstallPortableNodeAsync(CancellationToken token)
    {
        var platform = IsArm64 ? "win-arm64" : "win-x64";
        var index = JsonNode.Parse(System.Text.Encoding.UTF8.GetString(await DownloadAsync("https://nodejs.org/dist/index.json", token)))!.AsArray();
        var release = index.FirstOrDefault(r => r?["lts"] is JsonValue lts && lts.ToString() != "false"
                && r["files"]!.AsArray().Any(f => f?.GetValue<string>() == platform + "-zip"))
            ?? throw new CommandFailedException("Could not find a Node.js LTS download.");
        var version = release["version"]!.GetValue<string>();
        var file = $"node-{version}-{platform}.zip";

        Log.Info($"Downloading portable Node.js {version}...");
        var sums = System.Text.Encoding.UTF8.GetString(await DownloadAsync($"https://nodejs.org/dist/{version}/SHASUMS256.txt", token));
        var expected = sums.Split('\n').Select(line => line.Trim().Split("  ")).FirstOrDefault(parts => parts.Length == 2 && parts[1] == file)?[0]
            ?? throw new CommandFailedException("Node.js did not publish a checksum for " + file);
        var zip = await DownloadAsync($"https://nodejs.org/dist/{version}/{file}", token);
        if (!Convert.ToHexString(SHA256.HashData(zip)).Equals(expected, StringComparison.OrdinalIgnoreCase))
            throw new CommandFailedException("The Node.js download failed its checksum check.");

        Directory.CreateDirectory(Paths.Tools);
        ExtractTo(zip, PortableNodeDir, true);
        RefreshPath();
    }

    /// <summary>Downloads MinGit (portable Git for Windows) from its latest GitHub release, checked against GitHub's SHA-256 digest.</summary>
    static async Task InstallPortableGitAsync(CancellationToken token)
    {
        var release = await Http.GitHubAsync("repos/git-for-windows/git/releases/latest", token);
        var pattern = IsArm64 ? @"^MinGit-[\d.]+(\.windows\.\d+)?-arm64\.zip$" : @"^MinGit-[\d.]+(\.windows\.\d+)?-64-bit\.zip$";
        var asset = release["assets"]!.AsArray().FirstOrDefault(a => Regex.IsMatch(a?["name"]?.GetValue<string>() ?? "", pattern))
            ?? throw new CommandFailedException("Could not find a MinGit download.");
        var digest = asset["digest"]?.GetValue<string>();

        Log.Info($"Downloading portable Git ({asset["name"]})...");
        var zip = await DownloadAsync(asset["browser_download_url"]!.GetValue<string>(), token);
        if (digest is null || !digest.StartsWith("sha256:") || !Convert.ToHexString(SHA256.HashData(zip)).Equals(digest[7..], StringComparison.OrdinalIgnoreCase))
            throw new CommandFailedException("The Git download failed its checksum check.");

        Directory.CreateDirectory(Paths.Tools);
        ExtractTo(zip, PortableGitDir, false);
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

    /// <summary>Uses Node.js 22+ and Git if they are installed; otherwise downloads private portable copies (no admin rights or winget needed).</summary>
    public static async Task EnsureAsync(CancellationToken token)
    {
        RefreshPath();

        var nodeMajor = ForcePortable && !File.Exists(Path.Combine(PortableNodeDir, "node.exe")) ? 0 : await NodeMajorAsync(token);
        if (nodeMajor < 22)
        {
            Log.Info(nodeMajor == 0 ? "Node.js is not installed; using a private copy." : $"Node.js {nodeMajor} is too old for Vencord; using a private copy of the current LTS.");
            await InstallPortableNodeAsync(token);
            nodeMajor = await NodeMajorAsync(token);
            if (nodeMajor < 22)
                throw new CommandFailedException("Node.js 22 or newer could not be set up.");
        }
        Log.Info($"Node.js {nodeMajor} ready.");

        if (Find("git.exe") is null || (ForcePortable && !File.Exists(Path.Combine(PortableGitDir, "cmd", "git.exe"))))
        {
            Log.Info("Git is not installed; using a private copy.");
            await InstallPortableGitAsync(token);
            if (Find("git.exe") is null)
                throw new CommandFailedException("Git could not be set up.");
        }
        Log.Info("Git ready.");

        if (NodeScript("corepack", Path.Combine("corepack", "dist", "corepack.js")) is null)
        {
            // Node 25+ no longer ships Corepack, which Vencord uses to get its pinned pnpm version.
            var npm = NodeScript("npm", Path.Combine("npm", "bin", "npm-cli.js"))
                ?? throw new CommandFailedException("npm is missing from the Node.js install.");
            Log.Info("Installing Corepack...");
            await ProcessRunner.RunCheckedAsync(Node, [npm, "install", "--global", "corepack"], null, token, "Could not install Corepack");
            RefreshPath();
        }
        _ = Corepack;
        Log.Info("Corepack ready.");
    }
}
