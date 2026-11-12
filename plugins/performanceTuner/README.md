# Performance Tuner

Discord tuning in one place. The plugin settings start with a live panel showing Discord's memory and CPU use per process, plus **Free memory now** and **Clear cache** buttons.

- **High performance mode:** one switch that turns on every option marked (HP), lowers Discord's priority to below normal, caps it at 25% of your CPU, and frees memory every 2 minutes. Turning it off brings back your own choices.
- **CPU (Windows):** hard CPU limit as a share of your whole CPU, limit to N cores, and Windows Efficiency mode.
- **Processes:** priority (normal, below normal, lowest), slow down in the background, spellcheck off, power-saving GPU (Windows graphics preference, restart needed), hardware acceleration (restart needed).
- **Memory (Windows):** free unused memory every N minutes, optionally only while Discord is in the background, and a soft memory limit that frees memory whenever Discord goes over it.
- **Visual:** no animations, no blur, no shadows, hide avatar decorations, hide profile effects and nameplates, instant scrolling, hide member list.
- **Media:** stop GIF autoplay, emoji and sticker animation, and images or videos in link previews and attachments. These change your Discord account settings, and the plugin restores your previous values when you turn them off.

Windows can't hard-cap how much GPU or memory a program uses. This plugin lowers Discord's priority, hands memory back to Windows, and removes the work that uses the GPU most.
