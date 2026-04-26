import {
  AdditiveBlending,
  BufferGeometry,
  CanvasTexture,
  Float32BufferAttribute,
  NearestFilter,
  Points,
  ShaderMaterial,
  Vector2,
  Vector3,
} from 'three'
import * as Utils from '../utils.js'
import {
  labelTextColor as defaultTextColor,
  labelTextFont as sharedDefaultFont,
} from '../shared.js'


// TODO: separate this into a SpriteSheet supercalss and LabelSheet subclass.
/**
 * From:
 *   https://observablehq.com/@vicapow/three-js-sprite-sheet-example
 *   https://observablehq.com/@vicapow/uv-mapping-textures-in-threejs
 */
export default class SpriteSheet {
  /**
   * @param {number} numLabels
   * @param {string} maxLabel
   * @param {string} [labelTextFont]
   * @param {[number, number]} [padding]
   * @param {boolean} [useRTE] Use Relative-To-Eye emulated double precision for catalog-space positions
   * @param {boolean} [surfaceVisibility] Discard back-hemisphere labels in
   *   shader (treat the sprite's body-local position vector as the surface
   *   normal at that label, dot vs view direction).  Disables depth testing
   *   so front-hemisphere labels never get clipped by the curving sphere
   *   when the sprite extends in screen space.  Use for body-anchored
   *   surface labels (Places); leave off for free-floating labels.
   */
  constructor(numLabels, maxLabel, labelTextFont = sharedDefaultFont, padding = [0, 0],
      useRTE = false, surfaceVisibility = false) {
    if (!Number.isInteger(numLabels)) {
      throw new Error(`numLabels is invalid: ${ numLabels}`)
    }
    this.numLabels = numLabels
    this.labelCount = 0
    this.labelTextFont = labelTextFont
    this.textBaseline = 'top'
    this.padding = padding
    this.canvas = Utils.createCanvas()
    this.ctx = this.canvas.getContext('2d')
    const maxBounds = Utils.measureText(this.ctx, maxLabel, labelTextFont)
    const itemSize = Math.max(maxBounds.width, maxBounds.height)
    this.size = Math.sqrt(this.numLabels) * itemSize
    this.canvas.width = this.size
    this.canvas.height = this.size
    this.curX = 0
    this.curY = 0
    this.lineSizeMax = 0
    const ctx = this.ctx
    ctx.fillStyle = 'rgba(0, 0, 0, 0)'
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height)
    ctx.fill()
    this.useRTE = useRTE
    this.surfaceVisibility = surfaceVisibility
    this.positions = []
    this._posLow = useRTE ? [] : null
    this.sizes = []
    this.spriteCoords = []
    this.positionAttribute = null
    this.sprites = null
    // document.canvas = this.canvas;
    // console.log('canvas: ', {width: this.canvas.width, height: this.canvas.height},
    //            this.numLabels, maxBounds, this.size, maxBounds.width);
  }


  /**
   * @param {string} Parsed as a CSS <color> value, e.g. 'red' or 'rgb(1, 0, 0, 0)'.
   * @returns {number} id of label.
   */
  add(x, y, z, labelText, fillStyle = defaultTextColor) {
    if (this.labelCount >= this.numLabels) {
      throw new Error(`Add called too many times, can only allocate
                       numLabels(${this.numLabels}), already have ${this.labelCount}`)
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
    if (this.useRTE) {
      const hx = Math.fround(x); const hy = Math.fround(y); const hz = Math.fround(z)
      this.positions.push(hx, hy, hz)
      this._posLow.push(x - hx, y - hy, z - hz)
    } else {
      this.positions.push(x, y, z)
    }

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
    if (this.useRTE) {
      geometry.setAttribute('positionLow', new Float32BufferAttribute(this._posLow, 3))
    }
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
    const uniforms = {
      map: {value: texture},
      padding: {value: new Vector2(this.padding[0], this.padding[1])},
    }
    if (this.useRTE) {
      uniforms.uCamPosWorldHigh = {value: new Vector3()}
      uniforms.uCamPosWorldLow = {value: new Vector3()}
    }
    let vertSrc = vertexShader
    let fragSrc = fragmentShader
    if (this.surfaceVisibility) {
      vertSrc = surfaceVertexShader
      fragSrc = surfaceFragmentShader
    } else if (this.useRTE) {
      vertSrc = rteVertexShader
    }
    const material = new ShaderMaterial({
      uniforms,
      vertexShader: vertSrc,
      fragmentShader: fragSrc,
      blending: AdditiveBlending,
      // Surface-visibility mode does its own back-hemisphere discard, so
      // depth testing isn't needed (and would re-introduce limb clipping
      // by the curving sphere when sprite billboards extend in screen
      // space).  Other modes keep depth testing for correct occlusion.
      depthTest: !this.surfaceVisibility,
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


// RTE variant — same Relative-To-Eye technique as stars.vert/Asterisms.js.
const rteVertexShader = `
  uniform vec2 padding;
  uniform vec3 uCamPosWorldHigh;
  uniform vec3 uCamPosWorldLow;
  attribute vec2 size;
  attribute vec4 spriteCoord;
  attribute vec3 positionLow;
  varying vec4 spriteCoordVarying;
  void main() {
    spriteCoordVarying = spriteCoord;
    gl_PointSize = size[0];
    vec3 highDiff = position - uCamPosWorldHigh;
    vec3 lowDiff  = positionLow - uCamPosWorldLow;
    vec3 eyePos = highDiff + lowDiff;
    eyePos.x += padding.x;
    eyePos.y += padding.y;
    gl_Position = projectionMatrix * vec4(mat3(viewMatrix) * eyePos, 1.0);
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


// Surface-anchored variant: the sprite's body-local position is also its
// surface normal at that point (since labels sit on/just above the sphere
// surface, body-local pos / radius ≈ outward normal).  Compute view-space
// normal vs view-space camera direction to get a per-vertex front/back
// hemisphere flag, then discard back-facing labels in the fragment shader.
// Pair this with depthTest=false to avoid sphere-curvature clipping at
// the limb (front-facing sprite pixels extending toward disc centre share
// the anchor's depth, but the sphere there is closer to the camera than
// the anchor).
const surfaceVertexShader = `
  uniform vec2 padding;
  attribute vec2 size;
  attribute vec4 spriteCoord;
  varying vec4 spriteCoordVarying;
  varying float vVisible;
  void main() {
    vec3 offsetPos = vec3(position.x + padding.x, position.y + padding.y, position.z);
    vec4 mvPosition = modelViewMatrix * vec4(offsetPos, 1.0);
    // Body centre in view space (transform local origin).
    vec3 bodyCentreView = (modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
    vec3 normalView = normalize(mvPosition.xyz - bodyCentreView);
    // Camera at origin in view space; direction from sprite to camera = -mvPosition.
    vec3 viewDir = normalize(-mvPosition.xyz);
    vVisible = dot(normalView, viewDir) > 0.0 ? 1.0 : 0.0;
    spriteCoordVarying = spriteCoord;
    gl_PointSize = size[0];
    gl_Position = projectionMatrix * mvPosition;
  }
`


const surfaceFragmentShader = `
  uniform sampler2D map;
  varying vec4 spriteCoordVarying;
  varying float vVisible;
  void main() {
    if (vVisible < 0.5) discard;
    vec2 spriteUV = vec2(
      spriteCoordVarying.x + spriteCoordVarying.z * gl_PointCoord.x,
      spriteCoordVarying.y + spriteCoordVarying.w * (1.0 - gl_PointCoord.y));
    gl_FragColor = texture2D(map, spriteUV);
  }
`
