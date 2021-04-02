import * as THREE from 'three';

import * as Utils from './utils.js';

// https://observablehq.com/@vicapow/three-js-sprite-sheet-example
// https://observablehq.com/@vicapow/uv-mapping-textures-in-threejs

export default function makeLabel(text, fontSize = 20, fontFamily = 'arial') {
  const vertices = [];
  vertices.push(0, 0, 0);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.computeBoundingBox();
  return new THREE.Points(geometry, createMaterial());
}

const renderToPixelRatio = true;
const pixelRatio = 1;
function createMaterial() {
  const texture = new THREE.CanvasTexture(spriteSheet.canvas);
  texture.minFilter = THREE.NearestFilter;
  texture.magFilter = THREE.NearestFilter;
  const material = new THREE.ShaderMaterial( {
      uniforms: {
        pointWidth: { value: 50 * (renderToPixelRatio ? (pixelRatio * pixelRatio) : pixelRatio) },
        map: { value: texture },
        spriteCoords: { value: spriteSheet.spriteMap.item_0 }
      },
      vertexShader: this.vertexShader,
      fragmentShader: this.fragmentShader,
      transparent: true,
    });
  return material;
}

const vertexShader = `
  uniform float pointWidth;
  void main() {
    vec4 mvPosition = modelViewMatrix * vec4( position, 1.0 );
    gl_PointSize = pointWidth;
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const fragmentShader = `
  uniform float pointWidth;
  uniform sampler2D map;
  uniform vec4 spriteCoords;
  void main() {
    vec2 spriteUV = vec2(
      spriteCoords.x + spriteCoords.z * gl_PointCoord.x,
      spriteCoords.y + spriteCoords.w * (1.0 - gl_PointCoord.y));
    gl_FragColor = texture2D(map, spriteUV);
  }
`;

function createSpriteSheet() {
  const size = Math.pow(2, 8);
  const [width, height] = [size, size];
  const canvas = Utils.createCanvas();
  [canvas.width, canvas.height] = [width, height];
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = 'rgba(0, 0, 0, 0)'; // full black without alpha
  ctx.fillRect(0, 0, width, height);
  ctx.fill();

  const spriteMap = {};
  const drawAt = (name, {x, y, width, height}, fill) => {
    ctx.save();
    ctx.translate(x, y);
    drawLabel(ctx, fill, width, name);
    ctx.restore();
    spriteMap[name] = [x / size, 1 - (y + height) / size, width / size, height / size];
  };

  const spriteSize = 128;
  drawAt('item_0', {x: 0, y: 0, width: spriteSize, height: spriteSize }, 'green');
  drawAt('item_1', {x: spriteSize, y: 0, width: spriteSize, height: spriteSize}, 'blue');
  drawAt('item_2', {x: 0, y: spriteSize, width: spriteSize, height: spriteSize}, 'brown');
  drawAt('item_3', {x: spriteSize, y: spriteSize, width: spriteSize, height: spriteSize}, 'red');
  return {canvas, spriteMap};
}

function drawLabel(ctx, fillStyle, size, name) {
  const [width, height] = [size, size];
  ctx.fillStyle = fillStyle;
  ctx.fillRect(0, 0, size, size);
  ctx.textBaseline = 'top';
  ctx.font = '40px arial';
  ctx.fillStyle = 'white';
  ctx.fillText(name, 0, 0);
}
