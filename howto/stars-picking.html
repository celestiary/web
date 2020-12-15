<!DOCTYPE html>
<html>
<head><link rel="stylesheet" href="index.css"/></head>
<body>
<div id="ui"></div>
<h1>Stars Picking</h1>
Work in progres...
<script type="module">
  import {Raycaster} from './js/lib/three.js/three.module.js';
  import ThreeUi from './js/three_ui.js';
  import Stars from './js/Stars.mjs';
  import {faves} from './js/Stars.mjs';
  import StarsCatalog from './js/StarsCatalog.mjs';
  import Asterisms from './js/Asterisms.mjs';
  import AsterismsCatalog from './js/AsterismsCatalog.mjs';

  const cb = (scene, ui) => {
    if (window.target) {
      ui.camera.target = window.target;
      ui.camera.lookAt(window.target);
    }
  };
  const ui = new ThreeUi('ui', cb);
  window.u = ui;

let stars;
const raycaster = new Raycaster;
raycaster.params.Points.threshold = 1;
function onClickCb(mouse) {
  if (ui.clicked) {
    ui.clicked = false;
    console.log('raycasting...');
    raycaster.setFromCamera(mouse, ui.camera);
    const intersects = raycaster.intersectObjects(ui.scene.children, true);
    const intersection = ( intersects.length ) > 0 ? intersects[ 0 ] : null;
    if (intersection != null) {
      const obj = intersection.object;
      window.obj = obj;
      if (obj.type == 'Points') {
        const point = intersection.point;
        const index = intersection.index;
        window.index = index;
        console.log(`index(${index}): point(${point.x} ${point.y} ${point.z})`);
      }
    }
    console.log('after');
  }
}

  ui.addClickCb(onClickCb);
  let catalog = new StarsCatalog();
  catalog.load(() => {
    catalog = catalog.downsample(10, faves);
    stars = new Stars({
      radius: {
        // Sun's radius in meters.
        scalar: 6.9424895E8
      },
    }, catalog);
    ui.scene.add(stars);
    window.catalog = stars.catalog;
    const asterisms = new Asterisms(stars, () => {
      //const p = stars.labelsByName['EPS Vol'].parent.position;
      //window.target = p;
    });
    ui.scene.add(asterisms);
  });
  ui.camera.position.z = 1e1;
  window.u = ui;
</script>
</body>
</html>
