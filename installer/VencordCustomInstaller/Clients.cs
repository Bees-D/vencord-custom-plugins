using System.Diagnostics;
using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace VencordCustomInstaller;

enum ClientKind { Discord, Vesktop, Custom }

sealed record ClientTarget(string Id, string Name, ClientKind Kind, string Path, string? Branch, bool Detected, bool Patched);

static class Http
{
    public static readonly HttpClient Client = Create();

    static HttpClient Create()
    {
        var client = new HttpClient { Timeout = TimeSpan.FromSeconds(60) };
        client.DefaultRequestHeaders.UserAgent.Add(new ProductInfoHeaderValue("CustomVencordInstaller", "1.0"));
        client.DefaultRequestHeaders.Accept.Add(new MediaTypeWithQualityHeaderValue("application/vnd.github+json"));
        return client;
    }

    public static async Task<JsonNode> GitHubAsync(string path, CancellationToken token)
    {
        using var response = await Client.GetAsync("https://api.github.com/" + path, token);
        if ((int)response.StatusCode == 403 || (int)response.StatusCode == 429)
            throw new CommandFailedException("GitHub rate limit reached. Try again in a few minutes.");
        response.EnsureSuccessStatusCode();
        return JsonNode.Parse(await response.Content.ReadAsStringAsync(token))!;
    }
}

static class Clients
{
    static readonly string LocalAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
    static readonly string AppData = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
    static readonly string[] ProcessNames = ["Discord", "DiscordPTB", "DiscordCanary", "Vesktop", "vesktop"];

    static readonly (string Id, string Name, string Branch, string Folder)[] Branches =
    [
        ("discord-stable", "Discord", "stable", "Discord"),
        ("discord-ptb", "Discord PTB", "ptb", "DiscordPTB"),
        ("discord-canary", "Discord Canary", "canary", "DiscordCanary")
    ];

    static IEnumerable<string> ResourceFolders(string root)
    {
        var direct = Path.Combine(root, "resources");
        if (File.Exists(Path.Combine(direct, "app.asar")) || File.Exists(Path.Combine(direct, "_app.asar")))
            yield return direct;

        if (!Directory.Exists(root))
            yield break;

        var newest = Directory.GetDirectories(root, "app-*")
            .Select(dir => (dir, version: Version.TryParse(Path.GetFileName(dir)[4..], out var v) ? v : new Version(0, 0)))
            .OrderByDescending(item => item.version)
            .Select(item => Path.Combine(item.dir, "resources"))
            .FirstOrDefault(dir => File.Exists(Path.Combine(dir, "app.asar")) || File.Exists(Path.Combine(dir, "_app.asar")) || Directory.Exists(Path.Combine(dir, "app.asar")));
        if (newest is not null)
            yield return newest;
    }

    public static bool IsInstallFolder(string root) => ResourceFolders(root).Any();

    // Vencord moves Discord's original app.asar to _app.asar; a Discord update brings back a fresh, unpatched app folder.
    static bool IsPatched(string root) => ResourceFolders(root).LastOrDefault() is { } resources && File.Exists(Path.Combine(resources, "_app.asar"));

    static string VesktopDataPath() => new[] { Path.Combine(AppData, "vesktop"), Path.Combine(AppData, "Vesktop") }.FirstOrDefault(Directory.Exists) ?? Path.Combine(AppData, "vesktop");

    static bool VesktopDetected()
    {
        string[] exes =
        [
            Path.Combine(LocalAppData, "Programs", "vesktop", "Vesktop.exe"),
            Path.Combine(LocalAppData, "Programs", "Vesktop", "Vesktop.exe"),
            Path.Combine(LocalAppData, "Vesktop", "Vesktop.exe")
        ];
        return Directory.Exists(Path.Combine(AppData, "vesktop")) || Directory.Exists(Path.Combine(AppData, "Vesktop")) || exes.Any(File.Exists);
    }

    static bool VesktopPatched()
    {
        try
        {
            var statePath = Path.Combine(VesktopDataPath(), "state.json");
            if (!File.Exists(statePath))
                return false;
            var dir = JsonNode.Parse(File.ReadAllText(statePath))?["vencordDir"]?.GetValue<string>();
            return dir is not null && string.Equals(Path.GetFullPath(dir).TrimEnd('\\'), Path.GetFullPath(Paths.Dist).TrimEnd('\\'), StringComparison.OrdinalIgnoreCase);
        }
        catch
        {
            return false;
        }
    }

    public static List<ClientTarget> Detect(InstallState state)
    {
        var list = new List<ClientTarget>();
        foreach (var (id, name, branch, folder) in Branches)
        {
            var root = Path.Combine(LocalAppData, folder);
            if (IsInstallFolder(root))
                list.Add(new ClientTarget(id, name, ClientKind.Discord, root, branch, true, IsPatched(root)));
        }

        if (VesktopDetected())
            list.Add(new ClientTarget("vesktop", "Vesktop", ClientKind.Vesktop, VesktopDataPath(), null, true, VesktopPatched()));

        foreach (var folder in state.CustomFolders)
            list.Add(new ClientTarget("custom:" + folder, Path.GetFileName(folder.TrimEnd('\\')), ClientKind.Custom, folder, null, IsInstallFolder(folder), IsPatched(folder)));

        return list;
    }

    public static string[] Running() =>
        ProcessNames.SelectMany(name => Process.GetProcessesByName(name).Select(p => p.ProcessName)).Distinct(StringComparer.OrdinalIgnoreCase).ToArray();

    public static void CloseAll()
    {
        foreach (var name in ProcessNames)
        {
            foreach (var process in Process.GetProcessesByName(name))
            {
                try { process.Kill(entireProcessTree: true); } catch { }
            }
        }
    }

    public static async Task<string> DownloadInstallerCliAsync(CancellationToken token)
    {
        var release = await Http.GitHubAsync("repos/Vencord/Installer/releases/latest", token);
        var asset = release["assets"]?.AsArray().FirstOrDefault(a => a?["name"]?.GetValue<string>() == "VencordInstallerCli.exe")
            ?? throw new CommandFailedException("The latest official Vencord Installer release has no Windows CLI.");
        var digest = asset["digest"]?.GetValue<string>();
        if (digest is null || !digest.StartsWith("sha256:"))
            throw new CommandFailedException("The official Vencord Installer CLI has no published checksum, so it was not used.");

        Directory.CreateDirectory(Paths.Tools);
        var destination = Path.Combine(Paths.Tools, "VencordInstallerCli.exe");
        var temp = destination + ".download";
        await using (var source = await Http.Client.GetStreamAsync(asset["browser_download_url"]!.GetValue<string>(), token))
        await using (var file = File.Create(temp))
            await source.CopyToAsync(file, token);

        string actual;
        await using (var file = File.OpenRead(temp))
            actual = Convert.ToHexString(await SHA256.HashDataAsync(file, token)).ToLowerInvariant();
        if (actual != digest["sha256:".Length..].ToLowerInvariant())
        {
            File.Delete(temp);
            throw new CommandFailedException("The downloaded Vencord Installer CLI failed its SHA-256 check.");
        }

        File.Move(temp, destination, true);
        Log.Info("Downloaded and verified the official Vencord Installer CLI.");
        return destination;
    }

    public static async Task InstallAsync(string cli, ClientTarget target, CancellationToken token)
    {
        switch (target.Kind)
        {
            case ClientKind.Vesktop:
                ConfigureVesktop();
                return;
            case ClientKind.Discord:
                await ProcessRunner.RunCheckedAsync(cli, ["--install", "--branch", target.Branch!], null, token, $"Could not install into {target.Name}");
                break;
            case ClientKind.Custom:
                await ProcessRunner.RunCheckedAsync(cli, ["--install", "--location", target.Path], null, token, $"Could not install into {target.Path}");
                break;
        }
        Log.Success($"Installed into {target.Name}.");
    }

    static void ConfigureVesktop()
    {
        var dataPath = VesktopDataPath();
        Directory.CreateDirectory(dataPath);
        var statePath = Path.Combine(dataPath, "state.json");

        JsonObject state;
        try
        {
            state = File.Exists(statePath) ? JsonNode.Parse(File.ReadAllText(statePath)) as JsonObject ?? [] : [];
        }
        catch (JsonException)
        {
            state = [];
        }

        var target = Path.GetFullPath(Paths.Dist);
        if (state["vencordDir"]?.GetValue<string>() != target)
        {
            if (File.Exists(statePath))
                File.Copy(statePath, $"{statePath}.backup.{DateTime.Now:yyyyMMdd-HHmmss}");
            state["vencordDir"] = target;
            var temp = statePath + ".tmp";
            File.WriteAllText(temp, state.ToJsonString(new JsonSerializerOptions { WriteIndented = true }));
            File.Move(temp, statePath, true);
        }
        Log.Success("Vesktop now loads the custom Vencord build.");
    }
}
