# Everything Moves

Adds a slow shrink-and-fade exit and fade-and-grow entrance to Discord navigation and overlays.

## Controls

Each category has its own toggle in **User Settings → Vencord → Plugins → EverythingMoves**:

- Channel and DM navigation
- Server navigation
- Other page navigation
- Settings panels
- Menus, context menus, and popouts
- Dialogs and modals
- Shrink/enlarge scale and duration
- Separate fade-in and fade-out durations
- Shrink/fade blend, controlling when fade-out begins during shrinking
- Respect for the system reduced-motion preference

Scale, fade-in, and fade-out sliders each reach 10 seconds. The shrink/fade blend ranges from 0% (fade starts after shrinking) to 100% (fade starts as shrinking begins).

## Install

This is a Vencord **user plugin**. Copy the `everythingMoves` folder into your Vencord source checkout at `src/userplugins/everythingMoves`, then rebuild Vencord and restart Discord. See [Vencord's custom plugin instructions](https://docs.vencord.dev/installing/custom-plugins/) for the current source-build steps.

The plugin uses Discord's current page routes and overlay DOM to detect transitions. Discord UI updates can change those DOM hooks, so a future Discord redesign may require selector updates.

Navigation transitions animate the central message or page area. The message composer and persistent side panels are kept out of the outgoing snapshot so the composer updates to the newly selected DM immediately.

EverythingMoves is enabled by default and can be favorited with the star in its Vencord plugin details.
