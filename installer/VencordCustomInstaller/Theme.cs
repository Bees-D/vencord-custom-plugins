using System.Numerics;
using ImGuiNET;

namespace VencordCustomInstaller;

static class Theme
{
    public static readonly Vector4 Accent = Rgb(0x5865F2);
    public static readonly Vector4 AccentHover = Rgb(0x6D78F5);
    public static readonly Vector4 Green = Rgb(0x23A55A);
    public static readonly Vector4 Yellow = Rgb(0xF0B232);
    public static readonly Vector4 Red = Rgb(0xF23F43);
    public static readonly Vector4 Muted = Rgb(0x949BA4);
    public static readonly Vector4 Text = Rgb(0xDBDEE1);
    public static readonly Vector4 Background = Rgb(0x1E1F22);
    public static readonly Vector4 Panel = Rgb(0x2B2D31);

    public static ImFontPtr TitleFont;
    public static bool HasTitleFont;

    static Vector4 Rgb(int hex, float alpha = 1) =>
        new(((hex >> 16) & 0xFF) / 255f, ((hex >> 8) & 0xFF) / 255f, (hex & 0xFF) / 255f, alpha);

    public const string FontPath = @"C:\Windows\Fonts\segoeui.ttf";
    public const string BoldFontPath = @"C:\Windows\Fonts\segoeuib.ttf";

    public static void Apply()
    {
        var io = ImGui.GetIO();
        io.ConfigFlags |= ImGuiConfigFlags.NavEnableKeyboard;
        unsafe
        {
            io.NativePtr->IniFilename = null;
        }

        if (File.Exists(BoldFontPath))
        {
            TitleFont = io.Fonts.AddFontFromFileTTF(BoldFontPath, 26);
            HasTitleFont = true;
        }

        var style = ImGui.GetStyle();
        style.WindowRounding = 0;
        style.ChildRounding = 10;
        style.FrameRounding = 6;
        style.PopupRounding = 8;
        style.GrabRounding = 6;
        style.ScrollbarRounding = 6;
        style.FramePadding = new Vector2(10, 7);
        style.ItemSpacing = new Vector2(10, 9);
        style.WindowPadding = new Vector2(18, 18);
        style.ChildBorderSize = 1;
        style.WindowBorderSize = 0;

        var colors = style.Colors;
        colors[(int)ImGuiCol.Text] = Text;
        colors[(int)ImGuiCol.TextDisabled] = Muted;
        colors[(int)ImGuiCol.WindowBg] = Background;
        colors[(int)ImGuiCol.ChildBg] = Panel;
        colors[(int)ImGuiCol.PopupBg] = Panel;
        colors[(int)ImGuiCol.Border] = Rgb(0x3F4147);
        colors[(int)ImGuiCol.FrameBg] = Rgb(0x1E1F22);
        colors[(int)ImGuiCol.FrameBgHovered] = Rgb(0x35373C);
        colors[(int)ImGuiCol.FrameBgActive] = Rgb(0x404249);
        colors[(int)ImGuiCol.Button] = Rgb(0x4E5058);
        colors[(int)ImGuiCol.ButtonHovered] = Rgb(0x6D6F78);
        colors[(int)ImGuiCol.ButtonActive] = Rgb(0x80848E);
        colors[(int)ImGuiCol.CheckMark] = Accent;
        colors[(int)ImGuiCol.SliderGrab] = Accent;
        colors[(int)ImGuiCol.Header] = Rgb(0x35373C);
        colors[(int)ImGuiCol.HeaderHovered] = Rgb(0x404249);
        colors[(int)ImGuiCol.HeaderActive] = Rgb(0x4E5058);
        colors[(int)ImGuiCol.PlotHistogram] = Accent;
        colors[(int)ImGuiCol.ModalWindowDimBg] = Rgb(0x000000, 0.6f);
        colors[(int)ImGuiCol.ScrollbarBg] = Rgb(0x000000, 0);
        colors[(int)ImGuiCol.Separator] = Rgb(0x3F4147);
    }
}
