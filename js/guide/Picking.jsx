import React from 'react';
import { AmbientLight, PointLight, Object3D, Raycaster, Vector3 } from 'three';
import ThreeUi from '../ThreeUI.js';
import { sphere } from '../shapes.js';


export default function Picking() {
  React.useEffect(() => { setup() }, [])
  return (
    <>
      <div id="ui"></div>
      <h1>Picking</h1>
      Click on the sphere to change its colors.
    </>)
}

function setup() {
  const ui = new ThreeUi('ui');
  const light = new PointLight;
  light.position.set(10, 10, 10);
  ui.scene.add(light);
  ui.scene.add(new AmbientLight(0x888888));

  // Test a complex scene graph to show that picking is compatible with
  // object and camera offsets.
  const a = sphere(), b = sphere(), c = sphere();
  a.position.set(5, 3, 2);
  b.position.set(2, 5, 3);
  c.position.set(2, 3, 5);
  ui.scene.add(a);
  ui.scene.add(b);
  ui.scene.add(c);

  ui.camera.platform.position.z = 4;
  ui.camera.position.z = 1;

  // I think lookAt just works, unless camera is controlled, in which
  // case controls.target needs to be set to worldMatrix position of target
  // obj.
  ui.scene.updateMatrixWorld();
  const sPos = new Vector3;
  sPos.setFromMatrixPosition(a.matrixWorld);
  ui.camera.lookAt(sPos);
  ui.controls.update();
  ui.controls.target = sPos;

  const raycaster = new Raycaster;
  const colorAlts = [0xff0000, 0x00ff00];
  let colorNdx = 0;
  ui.addClickCb((mouse) => {
    if (ui.clicked) {
      ui.clicked = false;
      raycaster.setFromCamera(mouse, ui.camera);
      const intersects = raycaster.intersectObjects(ui.scene.children, true);
      for (let i = 0; i < intersects.length; i++) {
        const obj = intersects[i].object;
        obj.material.color.set(colorAlts[colorNdx]);
        colorNdx = (colorNdx + 1) % 2;
      }
    }
  });
}
