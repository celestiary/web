import React from 'react';
import ThreeUi from '../ThreeUI.js';
import { grid } from '../shapes.js';
export default function Grid() {
    React.useEffect(() => {
        setup();
    }, []);
    return (<>
      <div id="ui"></div>
      <h1>A Grid</h1>
      Try zooming out and rotating.
    </>);
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
