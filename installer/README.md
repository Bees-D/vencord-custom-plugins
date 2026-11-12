# Windows installer

`CustomVencordInstaller.exe` is a single-file app (no .NET install needed). It asks for administrator rights when it starts.

## What it does

When you press **Download, build and install**:

1. Checks for Git, Node.js 22 or newer, and Corepack/pnpm. Missing tools are installed with WinGet.
2. Downloads the newest Vencord source and the plugins from this repository. Later runs only download what changed.
3. Adds every plugin in `plugins/` to Vencord and builds it on your PC.
4. Copies the build to `%LOCALAPPDATA%\VencordCustomPlugins\dist`.
5. Asks you to close Discord and Vesktop if they are open, or closes them for you.
6. Installs into each ticked client:
   - Discord Stable, PTB, and Canary use the official Vencord Installer CLI. The installer checks the CLI's SHA-256 against the official GitHub release. An existing Vencord install is replaced.
   - Vesktop is pointed at the custom build. Its `state.json` is backed up first.
   - Any other Discord-based client folder you add works too.

## Updates

The installer checks GitHub for new Vencord and plugin commits when it opens and every 30 minutes while it is open. When something changed, the status card lists what is new and the main button becomes **Update now**.

Discord sometimes removes Vencord when it updates itself. The client then shows **needs repair**. Press **Repair** to reinstall the existing build without rebuilding.

## Files

Everything lives in `%LOCALAPPDATA%\VencordCustomPlugins`: the source checkouts, the build, the log (`installer.log`), and the installer settings.

## Building the installer

```powershell
.\installer\Build-CustomVencordInstaller.ps1
```

This needs the .NET 8 SDK and writes `installer\release\CustomVencordInstaller.exe`. The old `Install-CustomVencord.cmd` script still works as a fallback.
