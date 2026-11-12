using System.Text.Json;

namespace VencordCustomInstaller;

static class Paths
{
    public static readonly string Root = Environment.GetEnvironmentVariable("VCI_ROOT")
        ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "VencordCustomPlugins");
    public static readonly string VencordSource = Path.Combine(Root, "vencord-src");
    public static readonly string PluginSource = Path.Combine(Root, "plugins-src");
    public static readonly string Dist = Path.Combine(Root, "dist");
    public static readonly string Tools = Path.Combine(Root, "tools");
    public static readonly string StateFile = Path.Combine(Root, "installer-state.json");
    public static readonly string LogFile = Path.Combine(Root, "installer.log");

    public const string VencordRepo = "https://github.com/Vendicated/Vencord.git";
    public const string VencordApi = "repos/Vendicated/Vencord";
    public const string PluginRepo = "https://github.com/Bees-D/vencord-custom-plugins.git";
    public const string PluginApi = "repos/Bees-D/vencord-custom-plugins";
}

sealed class InstallState
{
    public string? VencordCommit { get; set; }
    public string? PluginsCommit { get; set; }
    public DateTime? BuiltAt { get; set; }
    public List<string> InstalledPlugins { get; set; } = [];
    public List<string> CustomFolders { get; set; } = [];
    public Dictionary<string, bool> Targets { get; set; } = [];
    public bool AutoCheckUpdates { get; set; } = true;

    static readonly JsonSerializerOptions Json = new() { WriteIndented = true };

    public static InstallState Load()
    {
        try
        {
            if (File.Exists(Paths.StateFile))
                return JsonSerializer.Deserialize<InstallState>(File.ReadAllText(Paths.StateFile)) ?? new();
        }
        catch { }
        return new();
    }

    public void Save()
    {
        Directory.CreateDirectory(Paths.Root);
        var temp = Paths.StateFile + ".tmp";
        File.WriteAllText(temp, JsonSerializer.Serialize(this, Json));
        File.Move(temp, Paths.StateFile, true);
    }
}
