# Theme Studio

Theme Studio adds a dedicated **User Settings → Vencord Settings → Theme Studio** page. Its editor is also available as a draggable floating panel.

Each saved part can have its own text color, background color, opacity, font family, and font size. The editor highlights the part under the pointer and shows how many matching elements a style will affect. Styles are stored in Vencord settings and automatically applied on startup. Theme Studio's stylesheet is kept after Vencord themes and QuickCSS so saved rules take priority.

The editor panel always uses a black background with white text. Drag its header to move it around the screen. Theme Studio is enabled by default and can be favorited from the Vencord plugin details.

Font choices use common local/system fonts. To apply a style to a different group of elements, pick a representative item that shares the class with the other parts you want to style.

Theme Studio is a local user plugin and uses Vencord's src/userplugins workflow. Rebuild the custom Vencord bundle after changing the plugin source.
