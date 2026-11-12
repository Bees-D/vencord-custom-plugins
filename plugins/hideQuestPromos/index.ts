/*
 * Vencord, a Discord client mod
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import definePlugin, { OptionType } from "@utils/types";

// Discord class names are "readableName_hash"; matching the readable prefix survives Discord updates.
const cls = (name: string) => `[class*="${name}_"]`;

const sections = {
    questBar: {
        description: "Quest bar above your account panel",
        css: `${cls("questPromoContent")}, [class*="panels_"] > :has(${cls("questPromoContent")}) { display: none !important; }`
    },
    callHeader: {
        description: "Quest banner in voice and video call headers",
        css: `${cls("questChannelCallHeaderWrapper")}, ${cls("questChannelCallHeaderPreview")} { display: none !important; }`
    },
    activityShelf: {
        description: "Quest cards in the activity shelf and Activities panel",
        css: `${cls("shelfCardQuest")}, ${cls("shelfCardQuestDetails")} { display: none !important; }`
    },
    embeds: {
        description: "Quest embeds posted in chat",
        css: `${cls("questEmbedCard")}, ${cls("questsEmbed")}, [class*="messageAccessories_"] > :has(> ${cls("questEmbedCard")}) { display: none !important; }`
    },
    popups: {
        description: "Quest popouts, tooltips, and promo previews that open over Discord",
        // Only popout layers; the whole app also lives in a "layer_ baseLayer_" element.
        css: `[class*="layerContainer_"] > :has(${cls("questPromoContent")}, ${cls("questTile")}, ${cls("questRewardTile")}, ${cls("videoQuestPreviewCont")}) { display: none !important; }`
    },
    questsTab: {
        description: "Quests entry in the direct messages list",
        css: `li:has([data-list-item-id$="___quests"]), [data-list-item-id$="___quests"] { display: none !important; }`
    },
    badges: {
        description: "\"Completed a Quest\" profile badges",
        css: `a[href*="/discovery/quests"][aria-label] { display: none !important; }`
    }
} as const;

type Section = keyof typeof sections;

const defaults: Record<Section, boolean> = {
    questBar: true,
    callHeader: true,
    activityShelf: true,
    embeds: true,
    popups: true,
    questsTab: false,
    badges: false
};

const settings = definePluginSettings(Object.fromEntries(
    (Object.keys(sections) as Section[]).map(key => [key, {
        type: OptionType.BOOLEAN as const,
        description: "Hide: " + sections[key].description,
        default: defaults[key],
        onChange: () => update()
    }])
) as Record<Section, { type: OptionType.BOOLEAN; description: string; default: boolean; onChange(): void; }>);

let style: HTMLStyleElement | undefined;

function update() {
    if (!style)
        return;
    style.textContent = (Object.keys(sections) as Section[])
        .filter(key => settings.store[key])
        .map(key => sections[key].css)
        .join("\n");
}

export default definePlugin({
    name: "HideQuestPromos",
    description: "Automatically hides Discord Quest promotions: the quest bar, call banners, activity cards, embeds, and popups",
    authors: [],
    tags: ["Appearance", "Utility"],
    enabledByDefault: true,
    settings,

    start() {
        style = document.createElement("style");
        style.id = "vc-hide-quest-promos";
        document.head.append(style);
        update();
    },

    stop() {
        style?.remove();
        style = undefined;
    }
});
