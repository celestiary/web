import * as THREE from './lib/three.js/three.module.js';
import * as Utils from './utils.mjs';
import {labelTextColor as defaultTextColor, labelTextFont as defaultFont} from './shared.mjs';

// TODO: separate this into a SpriteSheet supercalss and LabelSheet subclass.
/**
 * From:
 *   https://observablehq.com/@vicapow/three-js-sprite-sheet-example
 *   https://observablehq.com/@vicapow/uv-mapping-textures-in-threejs
 */
export default class SpriteSheet {
  constructor(maxLabels, maxLabel, labelTextFont = defaultFont) {
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
    //console.log('canvas: ', {width: this.canvas.width, height: this.canvas.height},
    //            this.maxLabels, maxBounds, this.size, maxBounds.width);
    this.curX = 0;
    this.curY = 0;
    this.lineSizeMax = 0;
    const ctx = this.ctx;
    ctx.fillStyle = 'rgba(0, 0, 0, 0)'; // full black without alpha
    ctx.fillRect(0, 0, this.width, this.height);
    ctx.fill();

    this.positions = [];
    this.sizes = [];
    this.spriteCoords = [];
  }


  compile() {
    if (this.positions.length != this.labelCount * 3) {
      throw new Error('Positions array size wrong: ' + this.positions.length);
    }
    if (this.sizes.length != this.labelCount * 2) {
      throw new Error('Positions array size wrong: ' + this.sizes.length);
    }
    if (this.spriteCoords.length != this.labelCount * 4) {
      throw new Error('Positions array size wrong: ' + this.spriteCoords.length);
    }
    this.positionAttribute = new THREE.Float32BufferAttribute(this.positions, 3);
    this.sizeAttribute = new THREE.Float32BufferAttribute(this.sizes, 2);
    this.spriteCoordAttribute = new THREE.Float32BufferAttribute(this.spriteCoords, 4);
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', this.positionAttribute);
    this.geometry.setAttribute('size', this.sizeAttribute);
    this.geometry.setAttribute('spriteCoord', this.spriteCoordAttribute);
    this.geometry.computeBoundingBox();
    this.points = new THREE.Points(this.geometry, this.createMaterial());
    //console.log('compile done', this);
    return this.points;
  }


  add(x, y, z, labelText, fillStyle = defaultTextColor) {
    if (this.labelCount >= this.maxLabels) {
      throw new Error(`Add called too many times, can only allocate maxLabels(${this.maxLabels}), already have ${this.labelCount}`);
    }
    const ctx = this.ctx;
    this.ctx.font = this.labelTextFont;
    let bounds = Utils.measureText(this.ctx, labelText);
    const size = Math.max(bounds.width, bounds.height);
    if (this.curX + size > this.width) {
      this.curX = 0;
      this.curY += this.lineSizeMax;
      this.lineSizeMax = 0;
    }
    if (size > this.lineSizeMax) {
      this.lineSizeMax = size;
    }
    bounds = this.drawAt(labelText, this.curX, this.curY, fillStyle);

    //console.log(`positionAttribute.set(x: ${x}, y: ${y}, z: ${z}, offset: ${this.labelCount})`);
    this.positions.push(x, y, z);

    this.spriteCoords.push(bounds.x / this.size,
                           1 - (bounds.y + bounds.height) / this.size,
                           bounds.width / this.size,
                           bounds.height / this.size);

    this.sizes.push(bounds.width, bounds.height);
    this.curX += bounds.width;
    this.labelCount++;
    return this;
  }


  drawAt(text, x, y, fillStyle) {
    const ctx = this.ctx;
    ctx.textBaseline = this.textBaseline;
    ctx.font = this.labelTextFont;
    const bounds = Utils.measureText(ctx, text);
    const size = Math.max(bounds.width, bounds.height);
    //console.log(`drawAt, text(${text}), x(${x}), y(${y}), size(${size})`);
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

  createMaterial() {
    const texture = new THREE.CanvasTexture(this.canvas);
    texture.minFilter = THREE.NearestFilter;
    texture.magFilter = THREE.NearestFilter;
    const material = new THREE.ShaderMaterial( {
        uniforms: {
          map: { value: texture },
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
  attribute vec2 size;
  attribute vec4 spriteCoord;
  varying vec4 spriteCoordVarying;
  void main() {
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    spriteCoordVarying = spriteCoord;
    gl_PointSize = size[0];
    gl_Position = projectionMatrix * mvPosition;
  }
`;


const fragmentShader = `
  uniform sampler2D map;
  varying vec4 spriteCoordVarying;
  void main() {
    vec2 spriteUV = vec2(
      spriteCoordVarying.x + spriteCoordVarying.z * gl_PointCoord.x,
      spriteCoordVarying.y + spriteCoordVarying.w * (1.0 - gl_PointCoord.y));
    gl_FragColor = texture2D(map, spriteUV);
  }
`;
