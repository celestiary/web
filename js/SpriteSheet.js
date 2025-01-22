import {
  AdditiveBlending,
  BufferGeometry,
  CanvasTexture,
  Float32BufferAttribute,
  NearestFilter,
  Points,
  ShaderMaterial,
  Vector2,
} from 'three'
import * as Utils from './utils.js'
import {
  labelTextColor as defaultTextColor,
  labelTextFont as sharedDefaultFont,
} from './shared.js'


// TODO: separate this into a SpriteSheet supercalss and LabelSheet subclass.
/**
 * From:
 *   https://observablehq.com/@vicapow/three-js-sprite-sheet-example
 *   https://observablehq.com/@vicapow/uv-mapping-textures-in-threejs
 */
export default class SpriteSheet {
  /** */
  constructor(maxLabels, maxLabel, labelTextFont = sharedDefaultFont, padding = [0, 0]) {
    if (!Number.isInteger(maxLabels)) {
      throw new Error(`maxLabels is invalid: ${ maxLabels}`)
    }
    this.maxLabels = maxLabels
    this.labelCount = 0
    this.labelTextFont = labelTextFont
    this.textBaseline = 'top'
    this.padding = padding
    this.canvas = Utils.createCanvas()
    this.ctx = this.canvas.getContext('2d')
    const maxBounds = Utils.measureText(this.ctx, maxLabel, labelTextFont)
    const itemSize = Math.max(maxBounds.width, maxBounds.height)
    this.size = Math.sqrt(this.maxLabels) * itemSize
    this.canvas.width = this.size
    this.canvas.height = this.size
    this.curX = 0
    this.curY = 0
    this.lineSizeMax = 0
    const ctx = this.ctx
    ctx.fillStyle = 'rgba(0, 0, 0, 0)'
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height)
    ctx.fill()
    this.positions = []
    this.sizes = []
    this.spriteCoords = []
    this.positionAttribute = null
    this.sprites = null
    // document.canvas = this.canvas;
    // console.log('canvas: ', {width: this.canvas.width, height: this.canvas.height},
    //            this.maxLabels, maxBounds, this.size, maxBounds.width);
  }


  /**
   * @param {string} Parsed as a CSS <color> value, e.g. 'red' or 'rgb(1, 0, 0, 0)'.
   * @returns {number} id of label.
   */
  add(x, y, z, labelText, fillStyle = defaultTextColor) {
    if (this.labelCount >= this.maxLabels) {
      throw new Error(`Add called too many times, can only allocate
                       maxLabels(${this.maxLabels}), already have ${this.labelCount}`)
    }
    this.ctx.font = this.labelTextFont
    let bounds = Utils.measureText(this.ctx, labelText)
    const size = Math.max(bounds.width, bounds.height)
    if (this.curX + size > this.canvas.width) {
      this.curX = 0
      // TODO: getting a little bleed through from cur to next line,
      // so moving down next line a bit.  This is probably from
      // measureText not being quite tall enough.
      this.curY += this.lineSizeMax + 1
      this.lineSizeMax = 0
    }
    if (size > this.lineSizeMax) {
      this.lineSizeMax = size
    }
    bounds = this.drawAt(labelText, this.curX, this.curY, fillStyle)

    // console.log(`positionAttribute.set(x: ${x}, y: ${y}, z: ${z}, offset: ${this.labelCount})`);
    this.positions.push(x, y, z)

    this.spriteCoords.push(bounds.x / this.size,
        1 - ((bounds.y + bounds.height) / this.size),
        bounds.width / this.size,
        bounds.height / this.size)

    this.sizes.push(bounds.width, bounds.height)
    this.curX += bounds.width
    const id = this.labelCount++
    return id
  }


  /** @returns {object} */
  drawAt(text, x, y, fillStyle) {
    const ctx = this.ctx
    ctx.textBaseline = this.textBaseline
    ctx.font = this.labelTextFont
    const bounds = Utils.measureText(ctx, text)
    const size = Math.max(bounds.width, bounds.height)
    // console.log(`drawAt, text(${text}), x(${x}), y(${y}), size(${size}), fillStyle(${fillStyle})`);
    ctx.save()
    ctx.translate(x, y)
    this.drawLabel(text, size, size, fillStyle)
    ctx.restore()
    return {x, y, width: size, height: size}
  }


  /** */
  drawLabel(text, width, height, fillStyle) {
    const ctx = this.ctx
    ctx.textBaseline = this.textBaseline
    ctx.font = this.labelTextFont
    ctx.fillStyle = fillStyle
    ctx.fillText(text, 0, 0)
    // console.log(`fillStyle(${fillStyle}), ctx.fillStyle(${ctx.fillStyle}):`, ctx);
    /*
    ctx.beginPath();
    ctx.strokeStyle = 'white';
    ctx.rect(0, 0, width, height);
    ctx.stroke();
    */
  }


  /**
   * @param {Float32BufferAttribute} sharedPositionAttribute
   * @returns {Points}
   */
  compile(sharedPositionAttribute = null) {
    if (sharedPositionAttribute && sharedPositionAttribute.count * 3 !== this.positions.length) {
      console.log(sharedPositionAttribute.count)
      throw new Error(
          `Shared positionAttribute.length(${sharedPositionAttribute.count * 3}) \
           != this.positions.length(${this.positions.length})`)
    }
    if (this.positions.length !== this.labelCount * 3) {
      throw new Error(`Positions array size wrong: ${ this.positions.length}`)
    }
    if (this.sizes.length !== this.labelCount * 2) {
      throw new Error(`Positions array size wrong: ${ this.sizes.length}`)
    }
    if (this.spriteCoords.length !== this.labelCount * 4) {
      throw new Error(`Positions array size wrong: ${ this.spriteCoords.length}`)
    }
    this.positionAttribute = sharedPositionAttribute || new Float32BufferAttribute(this.positions, 3)
    const sizeAttribute = new Float32BufferAttribute(this.sizes, 2)
    const spriteCoordAttribute = new Float32BufferAttribute(this.spriteCoords, 4)
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', this.positionAttribute)
    geometry.setAttribute('size', sizeAttribute)
    geometry.setAttribute('spriteCoord', spriteCoordAttribute)
    geometry.computeBoundingBox()
    this.sprites = new Points(geometry, this.createMaterial())
    this.sprites.renderOrder = 0
    return this.sprites
  }


  /** @returns {ShaderMaterial} */
  createMaterial() {
    const texture = new CanvasTexture(this.canvas)
    texture.minFilter = NearestFilter
    texture.magFilter = NearestFilter
    const material = new ShaderMaterial({
      uniforms: {
        map: {value: texture},
        padding: {value: new Vector2(this.padding[0], this.padding[1])},
      },
      vertexShader: vertexShader,
      fragmentShader: fragmentShader,
      blending: AdditiveBlending,
      depthTest: true,
      depthWrite: false,
      transparent: true,
      toneMapped: false,
    })
    return material
  }
}


const vertexShader = `
  uniform vec2 padding;
  attribute vec2 size;
  attribute vec4 spriteCoord;
  varying vec4 spriteCoordVarying;
  void main() {
    vec3 offsetPos = vec3(position.x + padding.x, position.y + padding.y, position.z);
    vec4 mvPosition = modelViewMatrix * vec4(offsetPos, 1.0);
    spriteCoordVarying = spriteCoord;
    gl_PointSize = size[0];
    gl_Position = projectionMatrix * mvPosition;
  }
`


const fragmentShader = `
  uniform sampler2D map;
  varying vec4 spriteCoordVarying;
  void main() {
    vec2 spriteUV = vec2(
      spriteCoordVarying.x + spriteCoordVarying.z * gl_PointCoord.x,
      spriteCoordVarying.y + spriteCoordVarying.w * (1.0 - gl_PointCoord.y));
    gl_FragColor = texture2D(map, spriteUV);
  }
`
