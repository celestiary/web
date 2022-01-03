import { Raycaster, Vector3 } from 'three'
import { assertFinite } from './utils'


export function queryPoints(ui, e, tree, coords, pickCb) {
  const mouse = {
    x: (e.clientX / ui.renderer.domElement.clientWidth) * 2 - 1,
    y: (e.clientY / ui.renderer.domElement.clientHeight) * -2 + 1
  }
  const raycaster = new Raycaster;
  raycaster.setFromCamera(mouse, ui.camera);

  // Usual timing here is < 1ms.
  //console.time('ray');
  const ray = raycaster.ray;
  const items = tree.intersectRay(ray.origin, ray.direction);
  if (items.length > 0) {
    mark(ui, items, mouse, coords, pickCb);
  }
  //console.timeEnd('ray');
}


function mark(ui, items, mouse, coords, pickCb) {
  const itemVec = new Vector3, mouseVec = new Vector3;
  const arr = new Float32Array(items.length);
  let minX = 0, minY = 0, minZ = 0, minDist = Infinity, closestNdx = 0;
  for (let i = 0; i < items.length; i += 3) {
    const ndx = items[i];
    const x = coords[ndx], y = coords[ndx + 1], z = coords[ndx + 2];
    arr[i] = assertFinite(x);
    arr[i + 1] = assertFinite(y);
    arr[i + 2] = assertFinite(z);
    itemVec.set(x, y, z);
    const v1 = itemVec.clone();
    itemVec.project(ui.camera);
    const v2 = itemVec.clone();
    mouseVec.x = mouse.x;
    mouseVec.y = mouse.y;
    mouseVec.z = 0;
    const mouseDist = itemVec.distanceTo(mouseVec) / ui.height;
    //const screenDist = itemVec.distanceTo(ui.camera.position) / catalog.sceneScale / 2;
    // A low mouse dist (~0.01) and low screen dist (~<half scene radius/STARS_SCALE)
    // Currently works better without screen distance, not sure why.
    //const dist = mouseDist + screenDist;
    const dist = mouseDist;
    if (dist < minDist) {
      minDist = dist;
      closestNdx = ndx;
      minX = x, minY = y, minZ = z;
    }
  }
  //console.log('minM, minS, maxM, maxS: ', minMDist, minSDist, maxMDist, maxSDist);
  pickCb({x: minX, y: minY, z: minZ});
}
