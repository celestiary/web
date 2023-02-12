import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import React from 'react';
import { useLocation } from 'react-router-dom';
import cStar from '../Star.js';
import StarsCatalog, { FAVES } from '../StarsCatalog.js';
import ThreeUi from '../ThreeUI.js';
import Time from '../Time.js';
import * as Shared from '../shared.js';
import { elt } from '../utils.js';
export default function Star() {
    const [ui, setUi] = React.useState(null);
    const [star, setStar] = React.useState(null);
    const [catalog, setCatalog] = React.useState(null);
    const time = new Time();
    React.useEffect(() => {
        setUi(setup(setCatalog));
    }, []);
    const location = useLocation();
    React.useEffect(() => {
        if (ui) {
            const path = (location.hash || '#Sol').substr(1);
            showStar(ui, path, star, setStar, catalog, time);
        }
    }, [catalog, location]);
    return (_jsxs(_Fragment, { children: [_jsx("div", { id: "ui" }), _jsx("h1", { children: "Star" }), "See ", _jsx("a", Object.assign({ href: "https://www.seedofandromeda.com/blogs/51-procedural-star-rendering" }, { children: "Seed of Andromeda" })), " for a nice overall approach.", _jsxs("p", { children: ["Borrowed heavily from code ", _jsx("a", Object.assign({ href: "https://bpodgursky.com/2017/02/01/procedural-star-rendering-with-three-js-and-webgl-shaders/" }, { children: "here" })), "."] }), _jsx("p", { children: "Added differential color range based on distance.  This makes the star appear white from far away and reveal surface structure as false-color on closer approach." }), _jsx("table", Object.assign({ id: "faves" }, { children: _jsx("tbody", { children: _jsxs("tr", { children: [_jsx("th", { children: "Star" }), _jsx("th", { children: "Spectral Type" }), _jsx("th", { children: "Hip ID" })] }) }) }))] }));
}
function addStarToScene(ui, catalog, hipId, curStar, setStar) {
    if (curStar) {
        ui.scene.remove(curStar);
    }
    const starProps = catalog.starsByHip[hipId];
    starProps.x = starProps.y = starProps.z = 0;
    starProps.radius = {
        // Sun's radius in meters.
        scalar: 1 / Shared.LENGTH_SCALE,
    };
    const star = new cStar(starProps, {}, ui);
    ui.scene.add(star);
    setStar(star);
    return star;
}
function setupFavesTable(catalog) {
    const favesTable = elt('faves');
    for (const hipId in FAVES) {
        const name = FAVES[hipId];
        const star = catalog.starsByHip[hipId];
        const spectralType = StarsCatalog.StarSpectra[star.spectralType][3];
        favesTable.innerHTML +=
            `<tr>
        <td><a href="#${name}">${name}</a></td>
        <td>${spectralType}</td>
        <td>${hipId}</td>
      </tr>`;
    }
}
function setup(setCatalog) {
    const ui = new ThreeUi('ui');
    ui.camera.position.z = 3;
    const catalog = new StarsCatalog();
    catalog.load(() => {
        setupFavesTable(catalog);
        setCatalog(catalog);
    });
    return ui;
}
function showStar(ui, path, curStar, setStar, catalog, time) {
    path = path.replaceAll(/%20/g, ' ');
    const hipId = catalog.hipByName[path];
    if (hipId === undefined) {
        console.error(`Cannot find star(${path}) in `, catalog);
        return;
    }
    const star = addStarToScene(ui, catalog, parseInt(hipId), curStar, setStar);
    ui.animationCb = () => {
        time.updateTime();
        try {
            star.preAnimCb(time);
        }
        catch (e) {
            console.error(e);
            throw new Error(`preanim star: ${star}`);
        }
    };
}
