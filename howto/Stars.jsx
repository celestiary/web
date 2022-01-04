import React from 'react'
import * as THREE from 'three'
import createTree from '@pablo-mayrgundter/yaot2'
import ThreeUi from './js/ThreeUI'
import cStars from './js/Stars'
import StarsCatalog, { getSunProps } from './js/StarsCatalog'
import { marker as createMarker } from './js/shapes'
import { queryPoints } from './js/Picker'


export default function Stars() {
  React.useEffect(() => { setup() }, [])
  return (
    <>
      <div id="ui"></div>
      <h1>Stars</h1>
    </>)
}

function setup() {
  const ui = new ThreeUi('ui');
  ui.camera.position.z = 1e3;

  const stars = new cStars({
    radius: {
      scalar: getSunProps(0.1).radiusMeters
    }},
    () => {
      const coords = stars.geom.coords;
      const tree = createTree();
      tree.init(coords);
      const marker = createMarker();
      ui.scene.add(marker);
      const markCb = (e) => {
        queryPoints(ui, e, tree, coords, (pick) => {
          marker.position.copy(pick);
        })
      }
      if (true) {
        document.body.addEventListener('dblclick', markCb);
      } else {
        document.body.addEventListener('mousemove', markCb);
      }
    }, true);
  ui.scene.add(stars);
}
