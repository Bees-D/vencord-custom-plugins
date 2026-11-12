/*
 * Vencord, a Discord client mod
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import { definePluginSettings } from "@api/Settings";
import { Button } from "@components/Button";
import { Heading } from "@components/Heading";
import { PencilIcon } from "@components/Icons";
import { Paragraph } from "@components/Paragraph";
import definePlugin, { OptionType } from "@utils/types";
import type { RenderModalProps, User } from "@vencord/discord-types";
import { Menu, Modal, openModal, React, RelationshipStore, RestAPI, TextInput, UserStore, useState } from "@webpack/common";

const settings = definePluginSettings({
    nicknames: {
        type: OptionType.CUSTOM,
        default: {} as Record<string, string>
    },
    wrapNames: {
        type: OptionType.BOOLEAN,
        description: "Wrap long names onto more lines instead of cutting them off with ...",
        default: true,
        onChange: () => updateWrapStyle()
    },
    list: {
        type: OptionType.COMPONENT,
        component: NicknameList
    }
});

const nameSelectors = [
    '[class*="nameAndDecorators_"]',
    '[class*="nameAndDecorators_"] *',
    '[class^="username_"]',
    '[class*=" username_"]',
    '[class^="overflow_"]',
    '[class*=" overflow_"]',
    '[class*="userText_"] *',
    '[class*="discriminator_"]',
    '[class*="headerText_"] [class*="username"]'
].join(",\n");

// Rows such as DM list and member list entries have a fixed height, so let them grow with the wrapped name.
const wrapCss = `
${nameSelectors} {
    white-space: normal !important;
    overflow: visible !important;
    text-overflow: clip !important;
    overflow-wrap: anywhere !important;
    height: auto !important;
    max-height: none !important;
}
[class*="layout_"]:has([class*="nameAndDecorators_"]) {
    height: auto !important;
    min-height: 42px;
    padding-top: 4px;
    padding-bottom: 4px;
}
`;

let wrapStyle: HTMLStyleElement | undefined;

function updateWrapStyle() {
    if (settings.store.wrapNames && wrapStyle === undefined) {
        wrapStyle = document.createElement("style");
        wrapStyle.id = "vc-long-friend-nicknames-wrap";
        wrapStyle.textContent = wrapCss;
        (document.head ?? document.documentElement).append(wrapStyle);
    } else if (!settings.store.wrapNames) {
        wrapStyle?.remove();
        wrapStyle = undefined;
    }
}

let originalGetNickname: ((userId: string) => string | undefined) | undefined;
let retryTimer: ReturnType<typeof setTimeout> | undefined;

function getLocal(userId: string): string | undefined {
    const value = settings.store.nicknames?.[userId];
    return typeof value === "string" && value.trim() ? value : undefined;
}

function refresh() {
    (RelationshipStore as any)?.emitChange?.();
}

function setLocal(userId: string, nickname: string | undefined) {
    const next = { ...settings.store.nicknames };
    if (nickname?.trim())
        next[userId] = nickname.trim();
    else
        delete next[userId];
    settings.store.nicknames = next;
    refresh();
}

// Discord's own components read friend nicknames through this store method, so overriding it shows long names everywhere.
function patchStore() {
    if (!RelationshipStore?.getNickname) {
        retryTimer = setTimeout(patchStore, 500);
        return;
    }

    const store = RelationshipStore as any;
    originalGetNickname = store.getNickname;
    store.getNickname = function (this: unknown, userId: string) {
        return getLocal(userId) ?? originalGetNickname!.call(this, userId);
    };
    refresh();
}

function unpatchStore() {
    clearTimeout(retryTimer);
    retryTimer = undefined;
    if (originalGetNickname && RelationshipStore) {
        (RelationshipStore as any).getNickname = originalGetNickname;
        originalGetNickname = undefined;
        refresh();
    }
}

const DISCORD_NICKNAME_LIMIT = 32;

function NicknameModal({ user, modalProps }: { user: User; modalProps: RenderModalProps; }) {
    const isFriend = RelationshipStore.isFriend(user.id);
    const initialCloud = originalGetNickname?.call(RelationshipStore, user.id) ?? "";
    const [cloud, setCloud] = useState(initialCloud);
    const [local, setLocalValue] = useState(getLocal(user.id) ?? "");
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string>();

    async function save() {
        if (saving)
            return;
        setSaving(true);
        setError(undefined);
        try {
            if (isFriend && cloud.trim() !== initialCloud.trim()) {
                // Same request Discord's own "Edit Friend Nickname" dialog sends.
                await RestAPI.patch({
                    url: `/users/@me/relationships/${user.id}`,
                    body: { nickname: cloud.trim() || null }
                });
            }
            setLocal(user.id, local);
            modalProps.onClose();
        } catch (e: any) {
            setError(e?.body?.message ?? e?.message ?? "Discord rejected the nickname.");
        } finally {
            setSaving(false);
        }
    }

    const onEnter = (event: React.KeyboardEvent<HTMLInputElement>) => {
        if (event.key === "Enter")
            save();
    };

    return (
        <Modal
            {...modalProps}
            title={"Nickname for " + (user.globalName ?? user.username)}
            actions={[
                { text: "Cancel", variant: "secondary" as const, onClick: () => modalProps.onClose() },
                { text: saving ? "Saving..." : "Save", variant: "primary" as const, onClick: save, disabled: saving || cloud.length > DISCORD_NICKNAME_LIMIT }
            ]}
        >
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                <section style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    <Heading>Discord nickname (saved to your account)</Heading>
                    <TextInput
                        value={cloud}
                        onChange={setCloud}
                        maxLength={DISCORD_NICKNAME_LIMIT}
                        disabled={!isFriend}
                        placeholder={isFriend ? "Shown on all your devices" : "Only friends can have a Discord nickname"}
                        onKeyDown={onEnter}
                    />
                    <Paragraph>{cloud.length}/{DISCORD_NICKNAME_LIMIT} characters. Synced by Discord to every device you use.</Paragraph>
                </section>
                <section style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    <Heading>Local nickname (any length)</Heading>
                    <TextInput value={local} onChange={setLocalValue} placeholder="Overrides the Discord nickname in this client" autoFocus onKeyDown={onEnter} />
                    <Paragraph>{local.length} characters. Saved in your Vencord settings; leave empty to use the Discord nickname.</Paragraph>
                </section>
                {error && <Paragraph style={{ color: "var(--text-feedback-critical, #f23f43)" }}>{error}</Paragraph>}
            </div>
        </Modal>
    );
}

function openNicknameModal(user: User) {
    openModal(modalProps => <NicknameModal user={user} modalProps={modalProps} />);
}

function NicknameList() {
    const { nicknames } = settings.use(["nicknames"]);
    const entries = Object.entries(nicknames ?? {});

    if (!entries.length)
        return <Paragraph>No long nicknames yet. Right-click someone and choose "Long Friend Nickname".</Paragraph>;

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {entries.map(([userId, nickname]) => {
                const user = UserStore.getUser(userId);
                return (
                    <div key={userId} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <Paragraph style={{ flex: 1, minWidth: 0, overflowWrap: "anywhere" }}>
                            <b>{user?.username ?? userId}</b>: {nickname}
                        </Paragraph>
                        <Button size="small" variant="dangerSecondary" onClick={() => setLocal(userId, undefined)}>Remove</Button>
                    </div>
                );
            })}
        </div>
    );
}

const UserContextMenuPatch: NavContextMenuPatchCallback = (children, { user }: { user?: User; }) => {
    if (!user || user.id === UserStore.getCurrentUser()?.id)
        return;

    children.push(
        <Menu.MenuItem
            id="vc-long-friend-nickname"
            label="Set Nickname (Discord + Local)"
            action={() => openNicknameModal(user)}
            icon={PencilIcon}
        />
    );
};

export default definePlugin({
    name: "LongFriendNicknames",
    description: "Give friends nicknames of any length. Right-click a user and choose Long Friend Nickname.",
    authors: [],
    tags: ["Friends", "Customisation"],
    enabledByDefault: true,
    settings,

    contextMenus: {
        "user-context": UserContextMenuPatch
    },

    start() {
        patchStore();
        updateWrapStyle();
    },

    stop() {
        unpatchStore();
        wrapStyle?.remove();
        wrapStyle = undefined;
    }
});
