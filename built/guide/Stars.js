import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
import React from 'react';
import createTree from '@pablo-mayrgundter/yaot2';
import ThreeUi from '../ThreeUI';
import cStars from '../Stars';
import { getSunProps } from '../StarsCatalog';
import { marker as createMarker } from '../shapes';
import { queryPoints } from '../Picker';
export default function Stars() {
    React.useEffect(() => {
        setup();
    }, []);
    return (_jsxs(_Fragment, { children: [_jsx("div", { id: "ui" }), _jsx("h1", { children: "Stars" })] }));
}
function setup() {
    const ui = new ThreeUi('ui');
    ui.camera.position.z = 1e3;
    const stars = new cStars({
        radius: {
            scalar: getSunProps(0.1).radiusMeters,
        }
    }, () => {
        const tree = createTree();
        tree.init(stars.geom.coords);
        const marker = createMarker();
        ui.scene.add(marker);
        const markCb = (e) => {
            queryPoints(ui, e, tree, stars, (pick) => {
                marker.position.copy(pick);
            });
        };
        if (true) {
            document.body.addEventListener('dblclick', markCb);
        }
        else {
            document.body.addEventListener('mousemove', markCb);
        }
    }, true);
    ui.scene.add(stars);
}
