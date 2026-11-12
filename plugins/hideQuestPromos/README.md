# Hide Quest Promos

Automatically hides Discord Quest promotions. Each area has its own toggle:

- Quest bar above your account panel (on)
- Quest banner in voice and video call headers (on)
- Quest cards in the activity shelf (on)
- Quest embeds posted in chat (on)
- Quest popouts and promo previews (on)
- Quests entry in the direct messages list (off)
- "Completed a Quest" profile badges (off)

It only hides things in your client. Nothing is sent to Discord, so quests you already accepted keep working and stay reachable from Quest Home.

Selectors match Discord's readable class-name prefixes (for example `questPromoContent_`), so they keep working when Discord changes the hash part of its class names.
