# Windows installer

Run `Install-CustomVencord.cmd`. It checks for Git and Node.js 22 or newer, and uses WinGet to install missing build prerequisites. It then clones the latest Vencord source and these plugins from GitHub, builds them together, and installs the custom build.

The installer:

- Updates official Discord Stable, PTB, and Canary installs that it finds. Existing Vencord installs are replaced by the custom build.
- Points Vesktop at the custom Vencord build, backing up its `state.json` before changing it.
- Lets you enter additional compatible client folders. The folder should contain `resources\app.asar` directly or inside an `app-*` folder.
- Verifies the downloaded official Vencord Installer CLI with the SHA-256 digest from its latest GitHub release.

Close Discord, Vesktop, and any additional clients before installation. Restart each client afterwards. Full Vencord source is downloaded and compiled during installation, so the process needs an internet connection and several gigabytes of temporary disk space.

Vencord's own client-mod terms and limitations still apply.
