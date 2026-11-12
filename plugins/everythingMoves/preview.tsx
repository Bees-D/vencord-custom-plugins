/*
 * Vencord, a Discord client mod
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Button } from "@components/Button";
import { Paragraph } from "@components/Paragraph";
import { React, useState } from "@webpack/common";

import { animateIn, animateOutClone, animationsAllowed, makeSafeClone } from ".";

const boxStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    height: 90,
    marginTop: 8,
    borderRadius: 8,
    color: "white",
    fontWeight: 600,
    background: "linear-gradient(135deg, #5865f2, #eb459e)"
};

export function PreviewSetting() {
    const box = React.useRef<HTMLDivElement>(null);
    const [page, setPage] = useState(1);

    function play() {
        const element = box.current;
        if (!element)
            return;

        animateOutClone(makeSafeClone(element), element.getBoundingClientRect());
        setPage(current => current % 3 + 1);
        requestAnimationFrame(() => animateIn(element));
    }

    return (
        <div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                <Paragraph>Preview the current preset, speed, and custom values.</Paragraph>
                <Button size="small" onClick={play}>Play preview</Button>
            </div>
            {!animationsAllowed() && (
                <Paragraph>Animations are off because your system requests reduced motion. Turn off the last setting to override.</Paragraph>
            )}
            <div ref={box} style={boxStyle}>Page {page}</div>
        </div>
    );
}
