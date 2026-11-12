using System.IO.Compression;
using System.Numerics;
using System.Runtime.InteropServices;
using Silk.NET.Input;
using Silk.NET.Input.Glfw;
using Silk.NET.Maths;
using Silk.NET.OpenGL;
using Silk.NET.OpenGL.Extensions.ImGui;
using Silk.NET.Windowing;
using Silk.NET.Windowing.Glfw;

namespace VencordCustomInstaller;

static class Program
{
    [DllImport("kernel32.dll")] static extern bool SetDefaultDllDirectories(uint flags);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern IntPtr AddDllDirectory(string path);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int MessageBoxW(IntPtr owner, string text, string caption, uint type);

    [STAThread]
    static void Main(string[] args)
    {
        // Only load DLLs from System32 and folders we add. Without this, a stray DLL next to the exe
        // (for example a winhttp.dll in Downloads) gets loaded into the installer and can crash it.
        SetDefaultDllDirectories(0x00000800 | 0x00000400); // LOAD_LIBRARY_SEARCH_SYSTEM32 | LOAD_LIBRARY_SEARCH_USER_DIRS
        foreach (var dir in (AppContext.GetData("NATIVE_DLL_SEARCH_DIRECTORIES") as string ?? "").Split(';', StringSplitOptions.RemoveEmptyEntries))
            if (Directory.Exists(dir))
                AddDllDirectory(dir);

        AppDomain.CurrentDomain.UnhandledException += (_, e) => Log.Error("Crash: " + e.ExceptionObject);
        try
        {
            Run(args);
        }
        catch (Exception error)
        {
            Log.Error("Could not start: " + error);
            var graphics = error.ToString().Contains("GLFW", StringComparison.OrdinalIgnoreCase) || error.ToString().Contains("OpenGL", StringComparison.OrdinalIgnoreCase);
            MessageBoxW(IntPtr.Zero,
                (graphics
                    ? "The installer window needs OpenGL 3.3. Update your graphics driver (or install one, if Windows is using \"Microsoft Basic Display Adapter\") and try again.\n\n"
                    : "The installer could not start.\n\n")
                + error.Message + "\n\nDetails were saved to:\n" + Paths.LogFile,
                "Custom Vencord Installer", 0x10);
        }
    }

    static void Run(string[] args)
    {
        // --screenshot <file.png> renders a few frames, saves them, and exits (used to check the layout without clicking).
        Tools.ForcePortable = args.Contains("--force-portable");
        if (args.Contains("--build-only"))
        {
            // Headless build with no client install; used to test the pipeline (set VCI_ROOT to keep it away from the real install).
            var engine = new Engine();
            using var done = new ManualResetEventSlim();
            engine.Start(InstallState.Load(), [], true, done.Set);
            done.Wait();
            Environment.Exit(engine.Status == EngineStatus.Succeeded ? 0 : 1);
        }

        var screenshotIndex = Array.IndexOf(args, "--screenshot");
        var screenshotPath = screenshotIndex >= 0 && screenshotIndex + 1 < args.Length ? args[screenshotIndex + 1] : null;

        // Single-file builds extract glfw3.dll to a temp folder that Silk.NET's own loader does not search.
        var nativeDirs = (AppContext.GetData("NATIVE_DLL_SEARCH_DIRECTORIES") as string ?? "").Split(';', StringSplitOptions.RemoveEmptyEntries);
        if (Silk.NET.Core.Loader.PathResolver.Default is Silk.NET.Core.Loader.DefaultPathResolver resolver)
            resolver.Resolvers.Insert(0, name => nativeDirs.Select(dir => Path.Combine(dir, name)));

        GlfwWindowing.RegisterPlatform();
        GlfwInput.RegisterPlatform();

        var options = WindowOptions.Default with
        {
            Size = new Vector2D<int>(1120, 740),
            Title = "Custom Vencord Installer",
            VSync = true
        };

        using var window = Window.Create(options);
        GL? gl = null;
        IInputContext? input = null;
        ImGuiController? controller = null;
        InstallerUi? ui = null;

        window.Load += () =>
        {
            gl = window.CreateOpenGL();
            input = window.CreateInput();
            ImGuiFontConfig? font = File.Exists(Theme.FontPath) ? new ImGuiFontConfig(Theme.FontPath, 18) : null;
            controller = new ImGuiController(gl, window, input, font, Theme.Apply);
            ui = new InstallerUi();
        };

        window.FramebufferResize += size => gl?.Viewport(size);

        window.Render += delta =>
        {
            if (gl is null || controller is null || ui is null)
                return;

            controller.Update((float)delta);
            var bg = Theme.Background;
            gl.ClearColor(bg.X, bg.Y, bg.Z, 1);
            gl.Clear(ClearBufferMask.ColorBufferBit);
            ui.Draw(new Vector2(window.Size.X, window.Size.Y));
            controller.Render();

            if (screenshotPath is not null && window.Time > 5)
            {
                SavePng(gl, window.FramebufferSize, screenshotPath);
                window.Close();
            }
        };

        window.Closing += () =>
        {
            ui?.Shutdown();
            controller?.Dispose();
            input?.Dispose();
            gl?.Dispose();
        };

        window.Run();
    }

    static void SavePng(GL gl, Vector2D<int> size, string path)
    {
        int width = size.X, height = size.Y;
        var pixels = new byte[width * height * 4];
        unsafe
        {
            fixed (byte* p = pixels)
                gl.ReadPixels(0, 0, (uint)width, (uint)height, PixelFormat.Rgba, PixelType.UnsignedByte, p);
        }

        var raw = new byte[(width * 4 + 1) * height];
        for (var y = 0; y < height; y++)
        {
            var row = (height - 1 - y) * width * 4;
            raw[y * (width * 4 + 1)] = 0;
            System.Buffer.BlockCopy(pixels, row, raw, y * (width * 4 + 1) + 1, width * 4);
        }

        using var file = File.Create(path);
        file.Write([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
        var header = new byte[13];
        WriteBigEndian(header, 0, width);
        WriteBigEndian(header, 4, height);
        header[8] = 8;
        header[9] = 6;
        WriteChunk(file, "IHDR", header);
        using (var compressed = new MemoryStream())
        {
            using (var zlib = new ZLibStream(compressed, CompressionLevel.Fastest, true))
                zlib.Write(raw);
            WriteChunk(file, "IDAT", compressed.ToArray());
        }
        WriteChunk(file, "IEND", []);
    }

    static void WriteBigEndian(byte[] buffer, int offset, int value)
    {
        buffer[offset] = (byte)(value >> 24);
        buffer[offset + 1] = (byte)(value >> 16);
        buffer[offset + 2] = (byte)(value >> 8);
        buffer[offset + 3] = (byte)value;
    }

    static void WriteChunk(Stream stream, string type, byte[] data)
    {
        var length = new byte[4];
        WriteBigEndian(length, 0, data.Length);
        stream.Write(length);
        var typeBytes = System.Text.Encoding.ASCII.GetBytes(type);
        stream.Write(typeBytes);
        stream.Write(data);
        var crc = new byte[4];
        WriteBigEndian(crc, 0, (int)Crc32(typeBytes, data));
        stream.Write(crc);
    }

    static uint Crc32(byte[] type, byte[] data)
    {
        var crc = 0xFFFFFFFFu;
        foreach (var b in type.Concat(data))
        {
            crc ^= b;
            for (var k = 0; k < 8; k++)
                crc = (crc & 1) != 0 ? 0xEDB88320u ^ (crc >> 1) : crc >> 1;
        }
        return ~crc;
    }
}
