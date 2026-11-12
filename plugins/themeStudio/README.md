# Theme Studio

Theme Studio adds a **User Settings → Vencord Settings → Theme Studio** page and a draggable floating editor. Open or close the floating editor anywhere with **Alt+F1**, from that page, or from the Vencord toolbox.

## Using it

1. Click **Pick a part**, hover Discord (the highlight shows what will be selected), and click. Press Esc to cancel.
2. Use **Select bigger area** if you picked something too small.
3. Change any option. Picking a color, typing a hex code, using a swatch or the eyedropper, or moving a slider turns that option on automatically.
4. With **Save automatically** on (default), changes are saved half a second after you stop editing and again when you close the editor.

Each saved part can have text color (optionally applied to everything inside it), background, opacity, font (any installed font), font weight, font size, rounded corners, or be hidden completely.

The **Saved parts** list lets you turn single styles on or off, see how many matches are on screen, select a style to edit it, or remove it. The **On** checkbox turns all styles off for a quick comparison.

**Export** copies your styles as JSON, **Import** merges an export back in, and **Copy as CSS** gives you CSS you can paste into QuickCSS or a theme file.

## Themes and Discord updates

Saved styles are wrapped in a CSS cascade layer. Important declarations inside a layer beat important declarations outside one, so Theme Studio styles win over QuickCSS and online/local themes regardless of how specific the theme's selectors are.

Discord class names end in a hash (for example `messageContent_c19a55`) that changes when Discord updates. When **Keep working after Discord updates** is checked, Theme Studio matches the class by name instead of by hash. It is checked automatically when both match the same elements. Older styles saved by hash show `–` in the list when nothing matches anymore; pick the part again to fix them.

Theme Studio is a local user plugin and uses Vencord's src/userplugins workflow. Rebuild the custom Vencord bundle after changing the plugin source.

## Images, avatars, and server icons

- Right-click a server and choose **Change Server Icon (Theme Studio)**, or right-click a user and choose **Change Avatar (Theme Studio)**. Pick an image file; it replaces that icon or avatar everywhere in Discord. **Reset Image** appears on the same menu afterwards.
- For any other image or icon, use **Pick a part**, then **Upload new image** in the Images section. Pictures are matched by their image address; SVG icons and other parts are matched by the picked selector.
- Images are kept on this device (Vencord's local database), not in synced settings. Photos are scaled down to 512 px (icons and avatars) or 1024 px; GIFs stay animated.
- Users with Discord's default avatar have no unique image address, so their avatar cannot be replaced yet.

## Floating editor

Drag the header to move it. Drag any edge or corner to resize it. Position and size are remembered.
