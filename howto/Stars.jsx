import React from 'react';
import cStars from './js/Stars.js';
import StarsCatalog from './js/StarsCatalog.js';
import ThreeUi from './js/ThreeUI.js';


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
  const stars = new cStars({
    radius: {
      // Sun's radius in meters.
      scalar: 6.9424895E8
    },
  }, () => {
    ui.scene.add(stars);
    window.catalog = stars.catalog;
    stars.showLabels(2);
  });

  ui.camera.position.z = 1e10;
}
