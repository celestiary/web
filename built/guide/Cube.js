import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
import React from 'react';
import { AxesHelper, PointLight } from 'three';
import ThreeUi from '../ThreeUI.js';
import { cube } from '../shapes.js';
export default function Cube() {
    React.useEffect(() => {
        setup();
    }, []);
    return (_jsxs(_Fragment, { children: [_jsx("div", { id: "ui" }), _jsx("h1", { children: "A Simple Cube" }), "To start with, a simple scene is defined with an object and controls.  Try rotating the cube with your mouse.  A scroll up or down gesture or mouse-wheel will zoom.  Double-button drag will pan."] }));
}
function setup() {
    // Bind the ThreeUi to the "ui" HTML page element.
    const ui = new ThreeUi('ui');
    // Pull the camera back from center 10 units along the z-axis
    // (towards the viewer).
    ui.camera.position.set(1, 2, 3);
    // Create a light and move away 10 units from the center along
    // each axis to give // interesting lighting.
    const light = new PointLight();
    light.position.set(3, 4, 5);
    ui.scene.add(light);
    // Add a unit cube at the center; (0,0,0) is implicit.
    ui.scene.add(new AxesHelper());
    ui.scene.add(cube());
}
