using System.Text.RegularExpressions;

namespace VencordCustomInstaller;

enum EngineStatus { Idle, Running, Succeeded, Failed, Cancelled }

sealed partial class Engine
{
    public EngineStatus Status { get; private set; } = EngineStatus.Idle;
    public string CurrentStep { get; private set; } = "";
    public int StepIndex { get; private set; }
    public int StepCount { get; private set; }
    public DateTime StartedAt { get; private set; }
    public string? LastError { get; private set; }
    public string[]? ClientsToClose { get; private set; }
    public bool IsRunning => Status == EngineStatus.Running;

    CancellationTokenSource? cancellation;
    TaskCompletionSource<bool>? closePrompt;
    bool rebuilding;

    public void AnswerClosePrompt(bool closeThem) => closePrompt?.TrySetResult(closeThem);
    public void Cancel() => cancellation?.Cancel();

    /// <param name="rebuild">false re-applies an existing build to the clients (for example after Discord updated itself).</param>
    public void Start(InstallState state, IReadOnlyList<ClientTarget> targets, bool rebuild, Action onFinished)
    {
        if (IsRunning)
            return;

        cancellation = new CancellationTokenSource();
        var token = cancellation.Token;
        Status = EngineStatus.Running;
        LastError = null;
        StartedAt = DateTime.Now;
        StepIndex = 0;
        rebuilding = rebuild;
        StepCount = rebuild ? 10 : 2;

        Task.Run(async () =>
        {
            try
            {
                if (rebuild)
                    await BuildAsync(state, token);
                else if (!File.Exists(Path.Combine(Paths.Dist, "patcher.js")))
                    throw new CommandFailedException("There is no build to install yet. Use \"Download, build and install\" first.");

                await InstallAsync(targets, token);
                state.Save();
                Status = EngineStatus.Succeeded;
                Log.Success("All done. Restart Discord or Vesktop to load the new build.");
            }
            catch (OperationCanceledException)
            {
                Status = EngineStatus.Cancelled;
                Log.Warn("Cancelled.");
            }
            catch (Exception error)
            {
                LastError = error is CommandFailedException ? error.Message : error.ToString();
                Status = EngineStatus.Failed;
                Log.Error(LastError);
            }
            finally
            {
                ClientsToClose = null;
                Tools.ExtraEnvironment.Clear();
                onFinished();
            }
        });
    }

    void Begin(string step)
    {
        StepIndex++;
        CurrentStep = step;
        Log.Step($"[{StepIndex}/{StepCount}] {step}");
    }

    async Task BuildAsync(InstallState state, CancellationToken token)
    {
        Directory.CreateDirectory(Paths.Root);

        Begin("Checking build tools (Git, Node.js, pnpm)");
        await Tools.EnsureAsync(token);

        Begin("Downloading the newest Vencord source");
        var vencordCommit = await SyncRepoAsync(Paths.VencordRepo, Paths.VencordSource, token);

        Begin("Downloading the plugins");
        var pluginsCommit = await SyncRepoAsync(Paths.PluginRepo, Paths.PluginSource, token);

        Begin("Adding the plugins to Vencord");
        var plugins = CopyPlugins(state);
        PatchPluginModal();
        PatchThemesTab();

        Begin("Installing Vencord's dependencies");
        await ProcessRunner.RunCheckedAsync(Tools.Node, [Tools.Corepack, "pnpm", "install", "--frozen-lockfile"], Paths.VencordSource, token, "Installing dependencies failed");

        Begin("Building Vencord with the plugins");
        await ProcessRunner.RunCheckedAsync(Tools.Node, [Tools.Corepack, "pnpm", "build", "--dev"], Paths.VencordSource, token, "The Vencord build failed");

        Begin("Checking the build");
        var renderer = Path.Combine(Paths.VencordSource, "dist", "vencordDesktopRenderer.js");
        if (!File.Exists(renderer))
            throw new CommandFailedException("The build did not produce vencordDesktopRenderer.js.");
        var rendererText = await File.ReadAllTextAsync(renderer, token);
        foreach (var (folder, name) in plugins)
        {
            if (name is null)
                Log.Warn($"Could not read the plugin name of {folder}; skipped checking it.");
            else if (!rendererText.Contains(name))
                throw new CommandFailedException($"The build does not contain the {name} plugin.");
        }

        state.VencordCommit = vencordCommit;
        state.PluginsCommit = pluginsCommit;
        state.BuiltAt = DateTime.Now;
        state.InstalledPlugins = plugins.Select(p => p.Folder).ToList();
        Log.Success($"Built Vencord {Short(vencordCommit)} with {plugins.Count} plugins ({string.Join(", ", plugins.Select(p => p.Name ?? p.Folder))}).");
    }

    async Task InstallAsync(IReadOnlyList<ClientTarget> targets, CancellationToken token)
    {
        Begin("Closing Discord and Vesktop");
        var running = targets.Count > 0 ? Clients.Running() : [];
        if (running.Length > 0)
        {
            closePrompt = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
            ClientsToClose = running;
            Log.Info("Waiting for you to close: " + string.Join(", ", running));
            var close = await closePrompt.Task.WaitAsync(token);
            ClientsToClose = null;
            if (!close)
                throw new OperationCanceledException();

            Clients.CloseAll();
            for (var i = 0; i < 20 && Clients.Running().Length > 0; i++)
                await Task.Delay(250, token);
            if (Clients.Running().Length > 0)
                throw new CommandFailedException("Discord or Vesktop is still running. Close it from the tray and try again.");
            await Task.Delay(1000, token);
        }

        if (rebuilding)
        {
            Begin("Copying the build into place");
            CopyDist();
        }

        Begin("Installing into your clients");
        if (targets.Count == 0)
        {
            Log.Warn("No client was selected, so the build was not installed anywhere. Tick a client and press Repair.");
            return;
        }

        string? cli = null;
        Tools.ExtraEnvironment["VENCORD_USER_DATA_DIR"] = Paths.Root;
        Tools.ExtraEnvironment["VENCORD_DEV_INSTALL"] = "1";
        foreach (var target in targets)
        {
            token.ThrowIfCancellationRequested();
            if (target.Kind != ClientKind.Vesktop)
                cli ??= await Clients.DownloadInstallerCliAsync(token);
            await Clients.InstallAsync(cli ?? "", target, token);
        }
    }

    static string Short(string? sha) => sha is { Length: > 7 } ? sha[..7] : sha ?? "?";

    static async Task<string> SyncRepoAsync(string url, string directory, CancellationToken token)
    {
        var git = Tools.Git;
        string[] safe = ["-c", "safe.directory=*"];
        var head = Directory.Exists(Path.Combine(directory, ".git"))
            ? await ProcessRunner.CaptureAsync(git, [.. safe, "-C", directory, "rev-parse", "HEAD"], null, token)
            : "";

        if (head.Length == 0)
        {
            DeleteDirectory(directory);
            Log.Info($"Cloning {url}...");
            await ProcessRunner.RunCheckedAsync(git, [.. safe, "clone", "--depth", "1", url, directory], null, token, $"Could not download {url}");
        }
        else
        {
            Log.Info($"Updating {url}...");
            await ProcessRunner.RunCheckedAsync(git, [.. safe, "-C", directory, "fetch", "--depth", "1", "origin", "HEAD"], null, token, $"Could not download updates from {url}");
            await ProcessRunner.RunCheckedAsync(git, [.. safe, "-C", directory, "reset", "--hard", "FETCH_HEAD"], null, token, "Could not apply the update");
            await ProcessRunner.RunCheckedAsync(git, [.. safe, "-C", directory, "clean", "-fd"], null, token, "Could not clean the source folder");
        }

        var commit = await ProcessRunner.CaptureAsync(git, [.. safe, "-C", directory, "rev-parse", "HEAD"], null, token);
        Log.Info($"Now at {Short(commit)}.");
        return commit;
    }

    [GeneratedRegex(@"definePlugin\(\{\s*name:\s*""([^""]+)""")]
    private static partial Regex InlineNameRegex();

    [GeneratedRegex(@"PLUGIN_NAME\s*=\s*""([^""]+)""")]
    private static partial Regex ConstantNameRegex();

    static List<(string Folder, string? Name)> CopyPlugins(InstallState state)
    {
        var sourceRoot = Path.Combine(Paths.PluginSource, "plugins");
        if (!Directory.Exists(sourceRoot))
            throw new CommandFailedException("The plugin repository has no plugins folder.");

        var userPlugins = Path.Combine(Paths.VencordSource, "src", "userplugins");
        Directory.CreateDirectory(userPlugins);

        var folders = Directory.GetDirectories(sourceRoot)
            .Where(dir => File.Exists(Path.Combine(dir, "index.ts")) || File.Exists(Path.Combine(dir, "index.tsx")))
            .ToList();
        if (folders.Count == 0)
            throw new CommandFailedException("No plugins were found in the plugin repository.");

        foreach (var old in state.InstalledPlugins.Concat(folders.Select(Path.GetFileName)))
        {
            if (!string.IsNullOrWhiteSpace(old) && old.IndexOfAny(Path.GetInvalidFileNameChars()) < 0)
                DeleteDirectory(Path.Combine(userPlugins, old));
        }

        var result = new List<(string, string?)>();
        foreach (var folder in folders)
        {
            var name = Path.GetFileName(folder);
            CopyDirectory(folder, Path.Combine(userPlugins, name));

            var index = Path.Combine(folder, File.Exists(Path.Combine(folder, "index.tsx")) ? "index.tsx" : "index.ts");
            var text = File.ReadAllText(index);
            var match = InlineNameRegex().Match(text);
            if (!match.Success)
                match = ConstantNameRegex().Match(text);
            result.Add((name, match.Success ? match.Groups[1].Value : null));
            Log.Info($"Added plugin {name}.");
        }
        return result;
    }

    // Lets the custom user plugins be favorited from their Vencord plugin details, like built-in plugins.
    // Lets plugins add their own tabs (for example "Background") next to Local Themes / Online Themes.
    static void PatchThemesTab()
    {
        var path = Path.Combine(Paths.VencordSource, "src", "components", "settings", "tabs", "themes", "index.tsx");
        if (!File.Exists(path))
        {
            Log.Warn("Vencord's Themes tab file moved; plugins will use their own settings pages instead.");
            return;
        }

        var source = File.ReadAllText(path);
        if (source.Contains("VcExtraThemeTabs"))
            return;

        const string tabs = "(window as any).VcExtraThemeTabs";
        var updated = Regex.Replace(source, @"(Online Themes\s*</TabBar\.Item>)",
            "$1\n                {" + tabs + "?.map((tab: any) => <TabBar.Item className=\"vc-settings-tab-bar-item\" id={tab.id} key={tab.id}>{tab.title}</TabBar.Item>)}");
        updated = Regex.Replace(updated, @"(\{currentTab === ThemeTab\.ONLINE && <OnlineThemesTab />\})",
            "$1\n                {" + tabs + "?.filter((tab: any) => tab.id === currentTab).map((tab: any) => <tab.Component key={tab.id} />)}");
        updated = Regex.Replace(updated, @"(\nconst enum ThemeTab)", "\n(window as any).VcExtraThemeTabsReady = true;\n$1");

        if (Regex.Matches(updated, "VcExtraThemeTabs").Count != 3)
        {
            Log.Warn("Vencord changed its Themes tab layout; plugins will use their own settings pages instead.");
            return;
        }

        File.WriteAllText(path, updated);
        Log.Info("Added plugin tabs to Vencord's Themes page.");
    }

    static void PatchPluginModal()
    {
        var modalPath = Path.Combine(Paths.VencordSource, "src", "components", "settings", "tabs", "plugins", "PluginModal.tsx");
        if (!File.Exists(modalPath))
        {
            Log.Warn("Vencord's plugin details file moved; plugin favorites for custom plugins are skipped.");
            return;
        }

        var source = File.ReadAllText(modalPath);
        var match = Regex.Match(source, @"\{!pluginMeta\.userPlugin\s*&&\s*\(\s*(?<container><div className=""vc-settings-modal-links"">.*?</div>)\s*\)\}", RegexOptions.Singleline);
        if (!match.Success)
        {
            Log.Warn("Vencord changed its plugin details layout; plugin favorites for custom plugins are skipped.");
            return;
        }

        var container = match.Groups["container"].Value;
        var updated = Regex.Replace(container, @"(<FavoriteButton\b.*?/>)\s*(?=<WebsiteButton\b)", "${1}{!pluginMeta.userPlugin && <>", RegexOptions.Singleline);
        updated = Regex.Replace(updated, @"(<GithubButton\b.*?/>)", "${1}</>}", RegexOptions.Singleline);
        if (updated == container || !updated.Contains("{!pluginMeta.userPlugin && <>"))
        {
            Log.Warn("Could not safely enable favorites for custom plugins; skipped.");
            return;
        }

        File.WriteAllText(modalPath, source.Remove(match.Index, match.Length).Insert(match.Index, updated));
    }

    static void CopyDist()
    {
        var built = Path.Combine(Paths.VencordSource, "dist");
        if (!Directory.Exists(built))
            throw new CommandFailedException("The build output folder is missing.");

        Directory.CreateDirectory(Paths.Dist);
        foreach (var file in Directory.GetFiles(Paths.Dist))
            File.Delete(file);
        foreach (var directory in Directory.GetDirectories(Paths.Dist))
            DeleteDirectory(directory);
        CopyDirectory(built, Paths.Dist);
        Log.Info($"Build copied to {Paths.Dist}.");
    }

    static void CopyDirectory(string source, string destination)
    {
        Directory.CreateDirectory(destination);
        foreach (var file in Directory.GetFiles(source))
            File.Copy(file, Path.Combine(destination, Path.GetFileName(file)), true);
        foreach (var directory in Directory.GetDirectories(source))
            CopyDirectory(directory, Path.Combine(destination, Path.GetFileName(directory)));
    }

    static void DeleteDirectory(string directory)
    {
        if (!Directory.Exists(directory))
            return;

        var full = Path.GetFullPath(directory);
        var root = Path.GetFullPath(Paths.Root).TrimEnd('\\') + "\\";
        if (!full.StartsWith(root, StringComparison.OrdinalIgnoreCase))
            throw new CommandFailedException($"Refusing to delete {full} because it is outside {root}.");

        // Git marks its object files read-only, which blocks Directory.Delete.
        foreach (var file in Directory.EnumerateFiles(full, "*", SearchOption.AllDirectories))
            File.SetAttributes(file, FileAttributes.Normal);
        Directory.Delete(full, true);
    }
}
