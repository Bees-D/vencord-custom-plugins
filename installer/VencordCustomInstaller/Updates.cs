namespace VencordCustomInstaller;

sealed class RepoStatus
{
    public required string Name { get; init; }
    public string? LatestSha { get; set; }
    public string? LatestMessage { get; set; }
    public DateTime? LatestDate { get; set; }
    public int? Behind { get; set; }
    public List<string> NewCommits { get; } = [];
    public string? Error { get; set; }
    public bool HasUpdate(string? installed) => LatestSha is not null && installed is not null && !LatestSha.Equals(installed, StringComparison.OrdinalIgnoreCase);
}

sealed class UpdateChecker
{
    public RepoStatus Vencord { get; private set; } = new() { Name = "Vencord" };
    public RepoStatus Plugins { get; private set; } = new() { Name = "Plugins" };
    public DateTime? LastChecked { get; private set; }
    public bool Checking { get; private set; }

    public async Task CheckAsync(InstallState state)
    {
        if (Checking)
            return;
        Checking = true;
        try
        {
            var vencord = CheckRepoAsync("Vencord", Paths.VencordApi, state.VencordCommit);
            var plugins = CheckRepoAsync("Plugins", Paths.PluginApi, state.PluginsCommit);
            Vencord = await vencord;
            Plugins = await plugins;
            LastChecked = DateTime.Now;
        }
        finally
        {
            Checking = false;
        }
    }

    static string FirstLine(string? message) => (message ?? "").Split('\n')[0].Trim();

    static async Task<RepoStatus> CheckRepoAsync(string name, string api, string? installed)
    {
        var status = new RepoStatus { Name = name };
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(30));
        try
        {
            var latest = await Http.GitHubAsync(api + "/commits/HEAD", timeout.Token);
            status.LatestSha = latest["sha"]?.GetValue<string>();
            status.LatestMessage = FirstLine(latest["commit"]?["message"]?.GetValue<string>());
            if (DateTime.TryParse(latest["commit"]?["committer"]?["date"]?.GetValue<string>(), out var date))
                status.LatestDate = date;

            if (installed is not null && status.LatestSha is not null && status.HasUpdate(installed))
            {
                var compare = await Http.GitHubAsync($"{api}/compare/{installed}...{status.LatestSha}", timeout.Token);
                status.Behind = compare["ahead_by"]?.GetValue<int>();
                var commits = compare["commits"]?.AsArray() ?? [];
                foreach (var commit in commits.Reverse().Take(15))
                    status.NewCommits.Add(FirstLine(commit?["commit"]?["message"]?.GetValue<string>()));
            }
        }
        catch (Exception error)
        {
            status.Error = error is CommandFailedException ? error.Message : "Could not reach GitHub.";
        }
        return status;
    }
}
