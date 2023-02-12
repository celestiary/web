import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
import React from 'react';
import ThreeUi from '../ThreeUI.js';
import { grid } from '../shapes.js';
export default function Grid() {
    React.useEffect(() => {
        setup();
    }, []);
    return (_jsxs(_Fragment, { children: [_jsx("div", { id: "ui" }), _jsx("h1", { children: "A Grid" }), "Try zooming out and rotating."] }));
}
function setup() {
    const ui = new ThreeUi('ui');
    ui.camera.position.z = 10;
    const g = grid();
    g.material.color.setRGB(0, 0, 1);
    g.material.transparent = true;
    // grid.material.opacity = 0.1;
    ui.scene.add(g);
}
