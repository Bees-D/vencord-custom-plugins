# Everything Moves

Adds transitions to Discord navigation, menus, settings, and dialogs.

## Controls

Open **User Settings → Everything Moves** (in the Vencord section of the settings sidebar). The plugin's settings button in the Plugins list links there too.

- **Preset**: Subtle, Smooth (default), Snappy, Bouncy, Slide, Fade, or Dramatic. Choose **Custom** to show the detailed controls.
- **Speed**: one slider that speeds up or slows down every preset (0.25× to 3×).
- **Play preview**: try the current settings without leaving the settings page.
- Toggles for channel/DM navigation, server navigation, other pages, settings panels, menus and popouts, and dialogs.
- **Grow from cursor**: menus and popouts grow out of the spot you clicked.
- Custom only: movement style (shrink, zoom, slide up, slide sideways, fade), speed curve, movement amount, movement duration, fade-in and fade-out durations, and when the fade-out starts.
- Respect for the system reduced-motion preference.

## Install

This is a Vencord **user plugin**. Copy the `everythingMoves` folder into your Vencord source checkout at `src/userplugins/everythingMoves`, then rebuild Vencord and restart Discord. See [Vencord's custom plugin instructions](https://docs.vencord.dev/installing/custom-plugins/) for the current source-build steps.

The plugin uses Discord's current page routes and overlay DOM to detect transitions. Discord UI updates can change those DOM hooks, so a future Discord redesign may require selector updates.

Navigation transitions animate the central message or page area. The outgoing snapshot keeps its scroll position, leaves out the message composer and side panels, and drops embedded players so nothing reloads or plays sound. Jumping to a message in the same channel does not trigger a transition.
