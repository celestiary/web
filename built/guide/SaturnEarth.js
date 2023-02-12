import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import React from 'react';
import { AmbientLight, AxesHelper, Object3D, PointLight, } from 'three';
import ThreeUi from '../ThreeUI.js';
import Loader from '../Loader.js';
import Reify from '../reify.js';
import Stars from '../Stars.js';
import Planet from '../Planet.js';
import { LENGTH_SCALE } from '../shared.js';
export default function SaturnEarth() {
    React.useEffect(() => {
        setup();
    }, []);
    return (_jsxs(_Fragment, { children: [_jsx("div", { id: "ui" }), _jsx("h1", { children: "A Saturn-Earth Orbital System" }), _jsx("p", { children: "If the Earth orbited Saturn at the same distance that the Moon orbits Earth, i.e. Earth as a moon of Saturn, how fast would Earth orbit Saturn?" }), _jsxs("p", { children: ["This question was inspired by a friend commenting on the FB photo ", _jsx("a", Object.assign({ href: "https://www.facebook.com/fxsoyris/posts/4859941050713774" }, { children: "shared" })), " by Fran\u00E7ois Xavier Soyris, Jan 19 2021."] }), _jsx("img", { src: "/guide/saturn-earth-fb-photo.jpg", width: "400" })] }));
}
function setup() {
    // Bind the ThreeUi to the "ui" HTML page element.
    const ui = new ThreeUi('ui');
    // Pull the camera back from center 10 units along the z-axis
    // (towards the viewer).
    ui.camera.position.set(0, 0, 50);
    // Position closest to photo's perspective, but atmosphere doesn't look right.
    ui.camera.position.setLength(29.12);
    ui.camera.position.setY(0.63351);
    document.cam = ui.camera;
    // Create a light and move away 10 units from the center along
    // each axis to give // interesting lighting.
    ui.scene.add(new AmbientLight(0x111111));
    ui.scene.add(new AxesHelper());
    const stars = new Stars({
        radius: {
            // Sun's radius in meters.
            scalar: 6.9424895E8,
        },
    }, () => {
        document.stars = stars;
        ui.scene.add(stars);
    }, false, () => {
        // Move sun to proper distance from Saturn.
        const saturnSemiMajorAxis = 1.43353E12 * LENGTH_SCALE;
        const starPositions = stars.children[1].geometry.attributes.position;
        starPositions.array[0] = -saturnSemiMajorAxis;
        starPositions.array[2] = -saturnSemiMajorAxis;
        const sunlight = new PointLight();
        sunlight.position.set(-saturnSemiMajorAxis, 0, -saturnSemiMajorAxis);
        ui.scene.add(sunlight);
    });
    let saturn;
    let earth;
    let moon;
    const nO = (name) => {
        const o = new Object3D;
        o.name = name;
        return o;
    };
    const sceneGroups = {
        newObject: nO,
        newGroup: nO,
        orbitShapes: [],
    };
    let scaledSemiMajorAxis;
    const sceneLoadCb = (name, planet) => {
        if (name == 'moon') {
            const semiMajorAxis = planet.props.orbit.semiMajorAxis.scalar;
            scaledSemiMajorAxis = semiMajorAxis * LENGTH_SCALE;
            return;
        }
        if (name == 'earth') {
            const earthX = 0.5 * scaledSemiMajorAxis + 10;
            const earthRadius = planet.props.radius.scalar * LENGTH_SCALE;
            planet.position.x = earthX;
            ui.camera.position.set(earthX * 2, earthRadius * 2, 0);
        }
        else { // saturn
            planet.position.x = -0.5 * scaledSemiMajorAxis;
            planet.rotation.y = 0.75 * Math.PI;
        }
        ui.scene.add(planet);
    };
    const onLoadCb = (name, props) => { };
    const onDoneCb = (name, props) => {
        Reify(props);
        sceneLoadCb(name, new Planet(sceneGroups, props));
    };
    const loader = new Loader();
    loader.loadPath('moon', onLoadCb, onDoneCb);
    loader.loadPath('saturn', onLoadCb, onDoneCb);
    loader.loadPath('earth', onLoadCb, onDoneCb);
    ui.animationCb = () => { };
}
