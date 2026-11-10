# Vencord Custom Plugins

This repository contains two Vencord plugins and a Windows installer that fetches the current Vencord source, installs the plugins, and builds them together.

## Plugins

- **EverythingMoves** — per-category shrink and fade transitions for channel/server/page navigation, settings, menus, and modals.
- **ThemeStudio** — a dedicated User Settings page and draggable editor for element colors, opacity, fonts, and font sizes. Saved rules apply at startup after Vencord themes and QuickCSS.

The plugins are enabled by default. Vencord's plugin details include a favorite star for both local plugins through the installer patch.

## Install on Windows

Extract the installer ZIP and run `Install-CustomVencord.cmd`. It checks for the Vencord build prerequisites, installs missing prerequisites with WinGet, downloads both plugins from this repository, builds the newest Vencord source, and installs it into detected Discord Stable/PTB/Canary and Vesktop clients. It also supports additional compatible client folders.

See [installer/README.md](installer/README.md) for details. Plugin source is under `plugins/` and licensed under GPL-3.0-or-later.
