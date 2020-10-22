import * as THREE from './lib/three.module.js';

const scratchCanvasId = 'scratch-canvas';
function scrathCanvas() {
  let canvas = document.getElementById(scratchCanvasId);
  if (canvas) {
    return canvas;
  }
  canvas = document.createElement('canvas');
  canvas.setAttribute('id', scratchCanvasId);
  return canvas;
}

function measureText(ctx, text) {
  const m = ctx.measureText(text);
  const left = -m.actualBoundingBoxLeft;
  const right = m.actualBoundingBoxRight;
  const ascent = m.actualBoundingBoxAscent;
  const descent = m.actualBoundingBoxDescent;
  const width = left + right;
  const height = ascent + descent;
  return [width, height];
}

function makeLabelCanvas(fontSize, text) {
  const canvas = scrathCanvas();
  const ctx = canvas.getContext('2d');
  const fontFamily = 'arial';
  const font = `${fontSize}px ${fontFamily}`;
  ctx.textBaseline = 'top';
  ctx.font = font;
  let [textWidth, textHeight] = measureText(ctx, text);
  // TODO: + 3 to account for the inset.
  let canvasSize = Math.max(textWidth, textHeight) + 3;
  canvas.width = canvas.height = canvasSize;
  // need to reset font after canvas resize.
  ctx.font = font;
  ctx.textBaseline = 'top';
  ctx.fillStyle = 'green';
  ctx.fillText(text, 0, 0);
  return canvas;
}

export default function makeLabel(text, fontSize = 20) {
  const canvas = makeLabelCanvas(fontSize, text);
  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  const labelMaterial = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      sizeAttenuation: false,
    });
  const sprite = new THREE.Sprite(labelMaterial);
  const s = 0.06;
  sprite.scale.set(s, s, 1);
  return sprite;
}
