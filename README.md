# Vencord Custom Plugins

This repository contains three Vencord plugins and a Windows installer that downloads the newest Vencord source, adds the plugins, builds everything on your PC, and installs it.

## Plugins

- **EverythingMoves**: animated transitions for channel, server, and page navigation, settings, menus, and dialogs. It has presets, a speed slider, and a live preview on its own **Everything Moves** settings page.
- **ThemeStudio**: click any part of Discord and change its colors, font, size, corners, or hide it. It has its own **Theme Studio** settings page and a floating editor. Saved styles win over Vencord themes and QuickCSS.
- **LongFriendNicknames**: right-click a user and pick **Set Nickname (Discord + Local)**. The Discord box saves to your account and uses Discord's character limit. The local box can be any length and is only shown in this client. It can also wrap long names instead of cutting them off.

All plugins are enabled by default.

## Install on Windows

Run `CustomVencordInstaller.exe` from the [releases](installer/README.md) and press **Download, build and install**. When Vencord or the plugins change, the installer shows **Update now**. See [installer/README.md](installer/README.md) for details.

Plugin source is under `plugins/` and licensed under GPL-3.0-or-later.
