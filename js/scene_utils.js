import {Euler, Object3D} from './lib/three.js/three.module.js';

import Loader from './loader.js';
import Planet from './Planet.js';
import Reify from './reify.js';
import {LENGTH_SCALE} from './shared.js';


function planetHelper(cb) {
  const nO = (name) => {
    const o = new Object3D;
    o.name = name;
    return o;
  }

  const sceneGroups = {
    newObject: nO,
    newGroup: nO,
    orbitShapes: []
  };

  const planetNames = ['Mercury','Venus','Earth','Mars','Jupiter','Saturn','Uranus','Neptune','Pluto'];
  const favesTable = document.getElementById('faves');
  favesTable.innerHTML = '<tr><th>Planet</th></tr>';
  planetNames.map(planetName => {
      favesTable.innerHTML +=
          `<tr>
            <td><a href="#${planetName.toLowerCase()}">${planetName}</a></td>
          </tr>`;
    });

  const onLoadCb = (name, props) => {};
  const onDoneCb = (name, props) => {
    Reify(props);
    cb(new Planet(sceneGroups, props));
  };

  const loader = new Loader();
  const handleHash = () => {
    let hash = location.hash.substr(1) || 'earth';
    loader.loadPath(hash, onLoadCb, onDoneCb);
  }
  window.addEventListener('hashchange', handleHash);
  handleHash();
}


function rotateEuler(obj, opts) {
  opts = opts || { x: 0, rotY: 0, rotZ: 0 };
  obj.applyEuler(new Euler(opts.x || 0, opts.y || 0))
}


function rotate(obj, opts) {
  opts = opts || { x: 0, y: 0, z: 0 };
  if (opts.x) { obj.rotateX(opts.x); }
  if (opts.y) { obj.rotateY(opts.y); }
  if (opts.z) { obj.rotateZ(opts.z); }
}


function addAndOrient(parent, child, opts) {
  parent.add(child);
  rotate(child, {x: opts.rotX || 0, y: opts.rotY || 0, z: opts.rotZ || 0});
  return child;
}


export {
  addAndOrient,
  planetHelper,
  rotate,
  rotateEuler,
}
