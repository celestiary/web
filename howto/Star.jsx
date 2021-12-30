import React from 'react';
import { useLocation } from 'react-router-dom';
import cStar from './js/Star.js';
import Stars from './js/Stars.js';
import StarsCatalog from './js/StarsCatalog.js';
import ThreeUi from './js/ThreeUI.js';
import Time from './js/Time.js';
import * as Shared from './js/shared.js';
import { elt } from './js/utils.js';


export default function Star() {
  const [ui, setUi] = React.useState(null);
  const [star, setStar] = React.useState(null);
  const [catalog, setCatalog] = React.useState(null);
  const time = new Time();

  React.useEffect(() => { setUi(setup(setCatalog)) }, [])

  const location = useLocation()
  React.useEffect(() => {
    if (ui) {
      const path = (location.hash || '#Sol').substr(1);
      showStar(ui, path, star, setStar, catalog, time);
    }
  }, [catalog, location])

  return (
    <>
      <div id="ui"></div>
      <h1>Star</h1>
      See <a href="https://www.seedofandromeda.com/blogs/51-procedural-star-rendering">Seed
          of Andromeda</a> for a nice overall approach.

      <p>Borrowed heavily from
      code <a href="https://bpodgursky.com/2017/02/01/procedural-star-rendering-with-three-js-and-webgl-shaders/">here</a>.</p>

      <p>Added differential color range based on distance.  This makes the
        star appear white from far away and reveal surface structure as
        false-color on closer approach.</p>

      <table id="faves">
        <tbody>
          <tr><th>Star</th><th>Spectral Type</th><th>Hip ID</th></tr>
        </tbody>
      </table>
    </>)
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
  for (let hipId in Stars.faves) {
    const name = Stars.faves[hipId];
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
    } catch (e) {
      console.error(e);
      throw new Error(`preanim star: ${star}`);
    }
  };
}
