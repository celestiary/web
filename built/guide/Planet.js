import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
import React from 'react';
import { useLocation } from 'react-router-dom';
import { PointLight } from 'three';
import ThreeUi from '../ThreeUI.js';
import { planetHelper } from '../scene_utils.js';
export default function Planet() {
    const [ui, setUi] = React.useState(null);
    const [planet, setPlanet] = React.useState(null);
    React.useEffect(() => {
        setUi(setup());
    }, []);
    const location = useLocation();
    React.useEffect(() => {
        if (ui) {
            const path = (location.hash || '#earth').substr(1);
            showPlanet(ui, path, planet, setPlanet);
        }
    }, [ui, location]);
    return (_jsxs(_Fragment, { children: [_jsx("div", { id: "ui" }), _jsx("h1", { children: "Planet" }), _jsx("p", { children: "Use LOD to lazy-load texture.  Open your browser network trace and watch it as you zoom in." }), _jsx("table", Object.assign({ id: "faves" }, { children: _jsx("tbody", { children: _jsx("tr", { children: _jsx("th", { children: "Name" }) }) }) }))] }));
}
function setup() {
    const ui = new ThreeUi('ui');
    ui.camera.position.z = 1e1;
    const light = new PointLight();
    const dist = 1e3;
    light.position.set(-dist, 0, dist);
    ui.camera.add(light);
    return ui;
}
function showPlanet(ui, path, curPlanet, setPlanet) {
    planetHelper(path, (p) => {
        if (curPlanet) {
            ui.scene.remove(curPlanet);
        }
        ui.scene.add(p);
        setPlanet(p);
        ui.animationCb = () => {
            p.rotation.y += 0.001;
        };
    });
}
