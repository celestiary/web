import * as THREE from './lib/three.js/three.module.js';
import * as Utils from './utils.mjs';

// TODO: separate this into a SpriteSheet supercalss and LabelSheet subclass.
/**
 * From:
 *   https://observablehq.com/@vicapow/three-js-sprite-sheet-example
 *   https://observablehq.com/@vicapow/uv-mapping-textures-in-threejs
 */
export default class SpriteSheet {
  constructor(maxLabels, maxLabel, labelTextFont = '12px arial') {
    this.maxLabels = maxLabels;
    this.labelCount = 0;
    this.labelTextFont = labelTextFont;
    //this.textBaseline = 'bottom';
    this.textBaseline = 'top';
    this.canvas = Utils.createCanvas();
    document.canvas = this.canvas;
    this.ctx = this.canvas.getContext('2d');
    const maxBounds = Utils.measureText(this.ctx, maxLabel, labelTextFont);
    const itemSize = Math.max(maxBounds.width, maxBounds.height);
    this.size = Math.sqrt(this.maxLabels) * itemSize;
    this.width = this.size;
    this.height = this.size;
    this.canvas.width = this.width;
    this.canvas.height = this.height;
    console.log('canvas: ', {width: this.canvas.width, height: this.canvas.height},
                this.maxLabels, maxBounds, this.size, maxBounds.width);
    this.curX = 0;
    this.curY = 0;
    this.lineSizeMax = 0;
    const ctx = this.ctx;
    ctx.fillStyle = 'rgba(0, 0, 0, 0)'; // full black without alpha
    ctx.fillRect(0, 0, this.width, this.height);
    ctx.fill();
  }


  alloc(labelText, fillStyle = 'white') {
    if (this.labelCount >= this.maxLabels) {
      throw new Error(`Alloc called too many times, can only allocate maxLabels(${this.maxLabels})`);
    }
    this.labelCount++;
    const ctx = this.ctx;
    this.ctx.font = this.labelTextFont;
    let bounds = Utils.measureText(this.ctx, labelText);
    const size = Math.max(bounds.width, bounds.height);
    if (this.curX + size > this.width) {
      this.curX = 0;
      this.curY += this.lineSizeMax;
      console.log('yOff for new line: ', this.curY);
      this.lineSizeMax = 0;
    }
    if (size > this.lineSizeMax) {
      this.lineSizeMax = size;
      console.log(`for (${labelText})found new lineSizeMax(${this.lineSizeMax})`);
    }
    bounds = this.drawAt(labelText, this.curX, this.curY, fillStyle);
    const spriteCoords = [bounds.x / this.size,
                          1 - (bounds.y + bounds.height) / this.size,
                          bounds.width / this.size,
                          bounds.height / this.size];
    //console.log(`alloc: text: ${labelText}, curX: ${this.curX}, curY: ${this.curY}, this.width: ${this.width}, bounds, spriteCoords`, bounds, spriteCoords);
    const labelObject = this.makeLabelObject({width: bounds.width, height: bounds.height}, spriteCoords);
    this.curX += bounds.width;
    return labelObject;
  }


  drawAt(text, x, y, fillStyle) {
    const ctx = this.ctx;
    ctx.textBaseline = this.textBaseline;
    ctx.font = this.labelTextFont;
    const bounds = Utils.measureText(ctx, text);
    const size = Math.max(bounds.width, bounds.height);
    console.log(`drawAt, text(${text}), x(${x}), y(${y}), size(${size})`);
    ctx.save();
    ctx.translate(x, y);
    this.drawLabel(text, size, size, fillStyle);
    ctx.restore();
    return {x, y, width: size, height: size};
  }


  drawLabel(text, width, height, fillStyle) {
    const ctx = this.ctx;
    ctx.textBaseline = this.textBaseline;
    ctx.font = this.labelTextFont;
    ctx.fillStyle = fillStyle;
    ctx.fillText(text, 0, 0);
    /*
    ctx.beginPath();
    ctx.strokeStyle = 'white';
    ctx.rect(0, 0, width, height);
    ctx.stroke();
    */
  }


  makeLabelObject(pointSize, spriteCoords) {
    const vertices = [];
    vertices.push(0, 0, 0);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.computeBoundingBox();
    return new THREE.Points(geometry, this.createMaterial(pointSize, spriteCoords));
  }


  createMaterial(pointSize, spriteCoords) {
    const renderToPixelRatio = true;
    const pixelRatio = 1;
    const texture = new THREE.CanvasTexture(this.canvas);
    texture.minFilter = THREE.NearestFilter;
    texture.magFilter = THREE.NearestFilter;
    const me = this;
    const material = new THREE.ShaderMaterial( {
        uniforms: {
          pointWidth: { value: pointSize.width },
          //pointWidth: { value: pointSize.width * (renderToPixelRatio ? (pixelRatio * pixelRatio) : pixelRatio) },
          map: { value: texture },
          spriteCoords: { value: spriteCoords }
        },
        vertexShader: vertexShader,
        fragmentShader: fragmentShader,
        depthTest: true,
        depthWrite: false,
        transparent: true,
      });
    return material;
  }
}


const vertexShader = `
  uniform float pointWidth;
  void main() {
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
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
