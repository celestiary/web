import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
import React from 'react';
import { Mesh, MeshBasicMaterial, PointLight, SphereGeometry } from 'three';
import ThreeUi from '../ThreeUI.js';
export default function Cube() {
    React.useEffect(() => {
        setup();
    }, []);
    return (_jsxs(_Fragment, { children: [_jsx("div", { id: "ui" }), _jsx("h1", { children: "A Sphere" }), "Or is it a fully operational battlestation?!"] }));
}
function setup() {
    const ui = new ThreeUi('ui');
    ui.camera.position.z = 10;
    const light = new PointLight();
    light.position.set(10, 10, 10);
    ui.scene.add(light);
    const radius = 1;
    const segmentSize = 20;
    const geometry = new SphereGeometry(radius, segmentSize, segmentSize / 2);
    const material = new MeshBasicMaterial({
        color: 0xff0000,
        wireframe: true,
    });
    ui.scene.add(new Mesh(geometry, material));
}
