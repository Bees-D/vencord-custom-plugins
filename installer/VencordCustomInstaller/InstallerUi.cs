using System.Diagnostics;
using System.Numerics;
using System.Security.Principal;
using ImGuiNET;

namespace VencordCustomInstaller;

sealed class InstallerUi
{
    readonly InstallState state = InstallState.Load();
    readonly Engine engine = new();
    readonly UpdateChecker updates = new();
    readonly bool isAdmin = new WindowsPrincipal(WindowsIdentity.GetCurrent()).IsInRole(WindowsBuiltInRole.Administrator);

    List<ClientTarget> clients = [];
    string newFolder = "";
    string? folderError;
    int lastLogCount;
    volatile bool refreshRequested;
    DateTime nextAutoCheck = DateTime.MinValue;

    public InstallerUi()
    {
        Log.Info("Custom Vencord Installer ready.");
        if (!isAdmin)
            Log.Warn("Not running as administrator. Installing build tools may ask for permission.");
        RefreshClients();
    }

    public void Shutdown() => engine.Cancel();

    void RefreshClients()
    {
        clients = Clients.Detect(state);
        foreach (var client in clients)
            state.Targets.TryAdd(client.Id, client.Detected);
    }

    bool IsSelected(ClientTarget client) => state.Targets.TryGetValue(client.Id, out var selected) && selected;

    void CheckUpdates()
    {
        nextAutoCheck = DateTime.Now.AddMinutes(30);
        _ = updates.CheckAsync(state);
    }

    void Run(bool rebuild)
    {
        state.Save();
        var targets = clients.Where(c => IsSelected(c) && c.Detected).ToList();
        engine.Start(state, targets, rebuild, () => refreshRequested = true);
    }

    public void Draw(Vector2 size)
    {
        if (refreshRequested)
        {
            refreshRequested = false;
            RefreshClients();
            CheckUpdates();
        }
        if (state.AutoCheckUpdates && DateTime.Now >= nextAutoCheck && !engine.IsRunning)
            CheckUpdates();

        ImGui.SetNextWindowPos(Vector2.Zero);
        ImGui.SetNextWindowSize(size);
        ImGui.Begin("##main", ImGuiWindowFlags.NoDecoration | ImGuiWindowFlags.NoMove | ImGuiWindowFlags.NoResize | ImGuiWindowFlags.NoSavedSettings | ImGuiWindowFlags.NoBringToFrontOnFocus);

        DrawHeader();

        var available = ImGui.GetContentRegionAvail();
        var leftWidth = MathF.Min(460, available.X * 0.45f);

        ImGui.PushStyleColor(ImGuiCol.ChildBg, Vector4.Zero);
        ImGui.BeginChild("##left", new Vector2(leftWidth, available.Y), ImGuiChildFlags.None);
        ImGui.PopStyleColor();
        DrawStatusCard();
        DrawClientsCard();
        DrawActions();
        ImGui.EndChild();

        ImGui.SameLine();
        ImGui.PushStyleColor(ImGuiCol.ChildBg, Vector4.Zero);
        ImGui.BeginChild("##right", new Vector2(0, available.Y), ImGuiChildFlags.None);
        ImGui.PopStyleColor();
        DrawProgress();
        DrawLog();
        ImGui.EndChild();

        DrawClosePrompt();
        ImGui.End();
    }

    static void Colored(Vector4 color, string text)
    {
        ImGui.PushStyleColor(ImGuiCol.Text, color);
        ImGui.TextUnformatted(text);
        ImGui.PopStyleColor();
    }

    static void Wrapped(string text, Vector4? color = null)
    {
        if (color is { } c)
            ImGui.PushStyleColor(ImGuiCol.Text, c);
        ImGui.PushTextWrapPos(0);
        ImGui.TextUnformatted(text);
        ImGui.PopTextWrapPos();
        if (color is not null)
            ImGui.PopStyleColor();
    }

    static void Tooltip(string text)
    {
        if (!ImGui.IsItemHovered())
            return;
        ImGui.BeginTooltip();
        ImGui.PushTextWrapPos(420);
        ImGui.TextUnformatted(text);
        ImGui.PopTextWrapPos();
        ImGui.EndTooltip();
    }

    static bool BeginCard(string id, string title)
    {
        ImGui.BeginChild(id, new Vector2(0, 0), ImGuiChildFlags.Border | ImGuiChildFlags.AutoResizeY | ImGuiChildFlags.AlwaysUseWindowPadding);
        Colored(Theme.Muted, title.ToUpperInvariant());
        ImGui.Separator();
        return true;
    }

    static bool AccentButton(string label, Vector2 size)
    {
        ImGui.PushStyleColor(ImGuiCol.Button, Theme.Accent);
        ImGui.PushStyleColor(ImGuiCol.ButtonHovered, Theme.AccentHover);
        ImGui.PushStyleColor(ImGuiCol.ButtonActive, Theme.Accent);
        ImGui.PushStyleColor(ImGuiCol.Text, new Vector4(1, 1, 1, 1));
        var pressed = ImGui.Button(label, size);
        ImGui.PopStyleColor(4);
        return pressed;
    }

    static string Short(string? sha) => sha is { Length: > 7 } ? sha[..7] : sha ?? "unknown";

    void DrawHeader()
    {
        if (Theme.HasTitleFont)
            ImGui.PushFont(Theme.TitleFont);
        ImGui.TextUnformatted("Custom Vencord Installer");
        if (Theme.HasTitleFont)
            ImGui.PopFont();

        ImGui.SameLine();
        ImGui.SetCursorPosX(ImGui.GetWindowContentRegionMax().X - 190);
        Colored(isAdmin ? Theme.Green : Theme.Yellow, isAdmin ? "Running as administrator" : "Not running as administrator");
        Colored(Theme.Muted, "Builds the newest Vencord from source with your custom plugins and installs it.");
        ImGui.Spacing();
    }

    void DrawRepoStatus(RepoStatus repo, string? installed)
    {
        if (updates.Checking && repo.LatestSha is null)
        {
            Colored(Theme.Muted, $"{repo.Name}: checking...");
            return;
        }
        if (repo.Error is not null)
        {
            Colored(Theme.Yellow, $"{repo.Name}: {repo.Error}");
            return;
        }
        if (repo.LatestSha is null)
            return;

        if (installed is null)
        {
            Colored(Theme.Text, $"{repo.Name}: newest is {Short(repo.LatestSha)}");
            Tooltip(repo.LatestMessage ?? "");
        }
        else if (repo.HasUpdate(installed))
        {
            var count = repo.Behind is { } behind ? $"{behind} new update{(behind == 1 ? "" : "s")}" : "update available";
            Colored(Theme.Yellow, $"{repo.Name}: {count}");
            if (repo.NewCommits.Count > 0 && ImGui.TreeNode($"What's new in {repo.Name}##{repo.Name}"))
            {
                foreach (var commit in repo.NewCommits)
                    Wrapped("- " + commit, Theme.Muted);
                if (repo.Behind > repo.NewCommits.Count)
                    Colored(Theme.Muted, $"...and {repo.Behind - repo.NewCommits.Count} more");
                ImGui.TreePop();
            }
        }
        else
        {
            Colored(Theme.Green, $"{repo.Name}: up to date ({Short(installed)})");
        }
    }

    bool UpdateAvailable => updates.Vencord.HasUpdate(state.VencordCommit) || updates.Plugins.HasUpdate(state.PluginsCommit);

    void DrawStatusCard()
    {
        BeginCard("##status", "Status");
        if (state.BuiltAt is null)
            Colored(Theme.Text, "Not installed yet.");
        else
            Colored(Theme.Text, $"Installed build from {state.BuiltAt:MMM d, yyyy h:mm tt}");

        DrawRepoStatus(updates.Vencord, state.VencordCommit);
        DrawRepoStatus(updates.Plugins, state.PluginsCommit);

        ImGui.BeginDisabled(updates.Checking);
        if (ImGui.Button(updates.Checking ? "Checking..." : "Check for updates"))
            CheckUpdates();
        ImGui.EndDisabled();
        ImGui.SameLine();
        var auto = state.AutoCheckUpdates;
        if (ImGui.Checkbox("Check every 30 min", ref auto))
        {
            state.AutoCheckUpdates = auto;
            state.Save();
        }
        if (updates.LastChecked is { } checkedAt)
            Colored(Theme.Muted, $"Last checked {checkedAt:h:mm tt}");
        ImGui.EndChild();
    }

    void DrawClientsCard()
    {
        BeginCard("##clients", "Install into");
        ImGui.BeginDisabled(engine.IsRunning);

        if (!clients.Any(c => c.Kind != ClientKind.Custom))
            Wrapped("No Discord or Vesktop install was found. You can add another client's folder below.", Theme.Muted);

        ClientTarget? remove = null;
        foreach (var client in clients)
        {
            var selected = IsSelected(client);
            if (ImGui.Checkbox($"{client.Name}##{client.Id}", ref selected))
            {
                state.Targets[client.Id] = selected;
                state.Save();
            }
            Tooltip(client.Path);

            ImGui.SameLine();
            if (!client.Detected)
                Colored(Theme.Red, "folder not found");
            else if (client.Patched)
                Colored(Theme.Green, "installed");
            else if (state.BuiltAt is not null && client.Kind == ClientKind.Discord)
                Colored(Theme.Yellow, "needs repair (Discord updated)");
            else
                Colored(Theme.Muted, "not installed");

            if (client.Kind == ClientKind.Custom)
            {
                ImGui.SameLine();
                if (ImGui.SmallButton($"Remove##{client.Id}"))
                    remove = client;
            }
        }
        if (remove is not null)
        {
            state.CustomFolders.Remove(remove.Path);
            state.Targets.Remove(remove.Id);
            state.Save();
            RefreshClients();
        }

        ImGui.Spacing();
        ImGui.SetNextItemWidth(ImGui.GetContentRegionAvail().X - 70);
        ImGui.InputTextWithHint("##folder", "Other client folder (has resources\\app.asar)", ref newFolder, 1024);
        ImGui.SameLine();
        if (ImGui.Button("Add", new Vector2(60, 0)))
            AddFolder();
        if (folderError is not null)
            Wrapped(folderError, Theme.Red);

        ImGui.EndDisabled();
        ImGui.EndChild();
    }

    void AddFolder()
    {
        folderError = null;
        string path;
        try
        {
            path = Path.GetFullPath(newFolder.Trim().Trim('"'));
        }
        catch
        {
            folderError = "That is not a valid folder path.";
            return;
        }

        if (!Clients.IsInstallFolder(path))
        {
            folderError = "No resources\\app.asar was found there or in an app-* folder inside it.";
            return;
        }
        if (!state.CustomFolders.Contains(path, StringComparer.OrdinalIgnoreCase))
            state.CustomFolders.Add(path);
        state.Targets["custom:" + path] = true;
        state.Save();
        newFolder = "";
        RefreshClients();
    }

    void DrawActions()
    {
        var width = ImGui.GetContentRegionAvail().X;
        ImGui.Spacing();

        if (engine.IsRunning)
        {
            if (ImGui.Button("Cancel", new Vector2(width, 44)))
                engine.Cancel();
        }
        else
        {
            var label = state.BuiltAt is null ? "Download, build and install"
                : UpdateAvailable ? "Update now"
                : "Rebuild and reinstall";
            if (AccentButton(label, new Vector2(width, 48)))
                Run(rebuild: true);
            Tooltip("Downloads the newest Vencord and plugins, builds them on this PC, and installs into the ticked clients.");

            var hasBuild = File.Exists(Path.Combine(Paths.Dist, "patcher.js"));
            ImGui.BeginDisabled(!hasBuild);
            if (ImGui.Button("Repair (reinstall without rebuilding)", new Vector2(width, 36)))
                Run(rebuild: false);
            ImGui.EndDisabled();
            Tooltip("Use this after Discord updates itself and Vencord disappears.");
        }

        if (ImGui.Button("Open install folder", new Vector2(width / 2 - 5, 0)))
        {
            Directory.CreateDirectory(Paths.Root);
            Process.Start(new ProcessStartInfo("explorer.exe", $"\"{Paths.Root}\"") { UseShellExecute = true });
        }
        ImGui.SameLine();
        if (ImGui.Button("Copy log", new Vector2(-1, 0)))
            ImGui.SetClipboardText(Log.AllText());
    }

    void DrawProgress()
    {
        BeginCard("##progress", "Progress");
        switch (engine.Status)
        {
            case EngineStatus.Idle:
                Colored(Theme.Muted, "Press the blue button to start.");
                break;
            case EngineStatus.Running:
                var elapsed = DateTime.Now - engine.StartedAt;
                Colored(Theme.Text, engine.CurrentStep);
                var fraction = engine.StepCount == 0 ? 0 : (engine.StepIndex - 1 + 0.5f) / engine.StepCount;
                ImGui.ProgressBar(Math.Clamp(fraction, 0, 1), new Vector2(-1, 22), $"Step {engine.StepIndex} of {engine.StepCount}");
                Colored(Theme.Muted, $"Elapsed {elapsed:mm\\:ss}. The first build downloads a lot and can take several minutes.");
                break;
            case EngineStatus.Succeeded:
                Colored(Theme.Green, "Finished. Restart Discord or Vesktop to load the new build.");
                break;
            case EngineStatus.Failed:
                Wrapped("Failed: " + engine.LastError, Theme.Red);
                break;
            case EngineStatus.Cancelled:
                Colored(Theme.Yellow, "Cancelled.");
                break;
        }
        ImGui.EndChild();
    }

    unsafe void DrawLog()
    {
        ImGui.BeginChild("##log", new Vector2(0, 0), ImGuiChildFlags.Border, ImGuiWindowFlags.HorizontalScrollbar);
        var lines = Log.Snapshot();
        var stickToBottom = ImGui.GetScrollY() >= ImGui.GetScrollMaxY() - 4;

        var clipper = new ImGuiListClipperPtr(ImGuiNative.ImGuiListClipper_ImGuiListClipper());
        clipper.Begin(lines.Length);
        while (clipper.Step())
        {
            for (var i = clipper.DisplayStart; i < clipper.DisplayEnd; i++)
            {
                var line = lines[i];
                var color = line.Kind switch
                {
                    LogKind.Step => Theme.Accent,
                    LogKind.Warning => Theme.Yellow,
                    LogKind.Error => Theme.Red,
                    LogKind.Success => Theme.Green,
                    LogKind.Output => Theme.Muted,
                    _ => Theme.Text
                };
                Colored(color, line.Text);
            }
        }
        clipper.End();
        clipper.Destroy();

        if (lines.Length != lastLogCount && stickToBottom)
            ImGui.SetScrollHereY(1);
        lastLogCount = lines.Length;
        ImGui.EndChild();
    }

    void DrawClosePrompt()
    {
        var running = engine.ClientsToClose;
        if (running is not null && !ImGui.IsPopupOpen("Close Discord"))
            ImGui.OpenPopup("Close Discord");

        var open = true;
        ImGui.SetNextWindowSize(new Vector2(440, 0));
        if (!ImGui.BeginPopupModal("Close Discord", ref open, ImGuiWindowFlags.AlwaysAutoResize | ImGuiWindowFlags.NoSavedSettings))
            return;

        Wrapped($"{string.Join(", ", running ?? [])} must be closed before installing. Unsaved message drafts are kept by Discord.");
        ImGui.Spacing();
        if (AccentButton("Close them for me", new Vector2(200, 36)))
        {
            engine.AnswerClosePrompt(true);
            ImGui.CloseCurrentPopup();
        }
        ImGui.SameLine();
        if (ImGui.Button("Cancel install", new Vector2(-1, 36)) || !open)
        {
            engine.AnswerClosePrompt(false);
            ImGui.CloseCurrentPopup();
        }
        if (running is null)
            ImGui.CloseCurrentPopup();
        ImGui.EndPopup();
    }
}
