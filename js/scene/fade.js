import {alphaScaled} from './hdr.js'


/**
 * Fades for the scene's overlays (DESIGN.md, "Overlays & visibility
 * groups"): orbits, labels, asterisms, grids, the human expansion lines.
 * Each group has one Fade: an opacity eased toward on or off, in one shared
 * uniform every material of the group multiplies its alpha by
 * (fadeMaterial), and the group's `visible`, which is true from the moment
 * a fade in starts until a fade out ends, so a hidden group isn't drawn at
 * all.  A FadeDriver steps the fades that are moving, once a frame; with
 * none moving it returns at once, so a steady scene pays nothing but the
 * one multiply in each overlay's fragment shader.
 */


/** How long a fade takes, ms: a few hundred, so it reads as a fade, not a wait. */
export const FADE_MS = 400


/**
 * Smoothstep: starts and ends at rest, so neither end of a fade has a step.
 *
 * @param {number} t 0 to 1, held to that
 * @returns {number} 0 to 1
 */
export function ease(t) {
  const x = Math.min(Math.max(t, 0), 1)
  return x * x * (3 - (2 * x))
}


/** One overlay group's opacity, eased toward on or off. */
export class Fade {
  /**
   * @param {object} [opts]
   * @param {boolean} [opts.on] Start fully on (shown) or fully off (hidden)
   * @param {number} [opts.ms] The fade's length
   * @param {Function} [opts.onShow] Called with true when the group must be
   *   drawn (a fade in starts) and false when it needn't be (a fade out ends)
   * @param {Function} [opts.nodes] The group's nodes now, whose materials
   *   take the opacity (fadeObject): read while the fade moves, so nodes
   *   built since (a body loaded, a tier of places) join it
   */
  constructor({on = true, ms = FADE_MS, onShow = null, nodes = null} = {}) {
    this.on = on
    this.ms = ms
    this.onShow = onShow
    this.nodes = nodes
    // Linear progress, 0 off to 1 on; the opacity is its easing.
    this.t = on ? 1 : 0
    // The shared uniform the group's materials read (fadeMaterial).
    this.uniform = {value: this.t}
    // Whether the group is drawn: from a fade in's start to a fade out's end.
    this.shown = on
    // Ms left before a fade in starts (set's delay).
    this.wait = 0
    this.driver = null
  }


  /** @returns {number} The opacity, 0 to 1 */
  get opacity() {
    return this.uniform.value
  }


  /** @returns {boolean} Whether a step would change anything */
  get moving() {
    return this.wait > 0 || this.t !== (this.on ? 1 : 0)
  }


  /**
   * Fade toward on or off.  A fade in after `delay` ms (the load's
   * choreography); with `instant`, there at once.  Setting the state it is
   * already heading for changes nothing, so a waiting fade keeps its delay.
   *
   * @param {boolean} on
   * @param {object} [opts]
   * @param {number} [opts.delay] Ms before a fade in starts
   * @param {boolean} [opts.instant] No fade
   */
  set(on, {delay = 0, instant = false} = {}) {
    if (instant) {
      this.on = on
      this.wait = 0
      this.t = on ? 1 : 0
      this._show(on)
      this._wrap()
      this.uniform.value = this.t
      return
    }
    if (on === this.on) {
      return
    }
    this.on = on
    this.wait = on ? Math.max(delay, 0) : 0
    if (this.wait === 0) {
      this._start()
    }
    this.driver?.wake(this)
  }


  /** Jump to where it is heading. */
  finish() {
    this.set(this.on, {instant: true})
  }


  /**
   * @param {number} dtMs Since the last step
   * @returns {boolean} Whether it is still moving
   */
  step(dtMs) {
    if (this.wait > 0) {
      this.wait -= dtMs
      if (this.wait > 0) {
        return true
      }
      this.wait = 0
      this._start()
      return true
    }
    const dir = this.on ? 1 : -1
    this.t = Math.min(Math.max(this.t + (dir * dtMs / this.ms), 0), 1)
    // Nodes built since the fade started take it too.
    this._wrap()
    this.uniform.value = ease(this.t)
    if (this.t === 0 && !this.on) {
      this._show(false)
    }
    return this.moving
  }


  /** A fade starts: shown from now if fading in, and its materials take the opacity. */
  _start() {
    this._wrap()
    if (this.on) {
      this._show(true)
    }
  }


  /** @param {boolean} shown */
  _show(shown) {
    if (this.shown !== shown) {
      this.shown = shown
      this.onShow?.(shown)
    }
  }


  /** Give the group's materials the opacity (fadeObject). */
  _wrap() {
    for (const node of this.nodes?.() ?? []) {
      if (node) {
        fadeObject(node, this.uniform)
      }
    }
  }
}


/** Steps the fades that are moving, once a frame. */
export class FadeDriver {
  /** */
  constructor() {
    this.fades = new Set()
    this.active = new Set()
    this._lastMs = null
  }


  /**
   * @param {Fade} fade
   * @returns {Fade} The fade, driven from now
   */
  add(fade) {
    fade.driver = this
    this.fades.add(fade)
    if (fade.moving) {
      this.active.add(fade)
    }
    return fade
  }


  /** @param {Fade} fade Moving: step it from the next tick */
  wake(fade) {
    if (fade.moving) {
      this.active.add(fade)
    }
  }


  /**
   * Step every moving fade.  Nothing to do returns at once.
   *
   * @param {number} nowMs The frame's time
   * @returns {boolean} Whether any is still moving
   */
  tick(nowMs) {
    if (this.active.size === 0) {
      this._lastMs = null
      return false
    }
    // The first frame after a quiet spell starts the clock.
    const dt = this._lastMs === null ? 0 : Math.max(nowMs - this._lastMs, 0)
    this._lastMs = nowMs
    for (const fade of this.active) {
      if (!fade.step(dt)) {
        this.active.delete(fade)
      }
    }
    return this.active.size > 0
  }


  /** Every fade to where it is heading (tests, and a probe that wants the end state). */
  finish() {
    for (const fade of this.fades) {
      fade.finish()
    }
    this.active.clear()
    this._lastMs = null
  }


  /** @returns {boolean} */
  get moving() {
    return this.active.size > 0
  }
}


/**
 * Make a material multiply its output by a fade's opacity: its alpha, when
 * the blend scales by alpha (SrcAlpha: normal transparent and additive
 * blending, as every overlay's is), else its whole colour.  Wraps the
 * fragment shader's `main` at compile time, as hdr.js sceneReferred does,
 * after any wrapper it has (sceneReferred's conversion), so the material's
 * own shader is untouched.  A material takes one fade, its first.
 *
 * @param {object} material A three.js Material
 * @param {{value: number}} uniform The fade's (Fade.uniform)
 * @returns {boolean} Whether it was wrapped now (false: it already was)
 */
export function fadeMaterial(material, uniform) {
  if (material.userData.fade) {
    return false
  }
  material.userData.fade = uniform
  const before = material.onBeforeCompile
  const previousKey = material.customProgramCacheKey
  material.onBeforeCompile = (shader, renderer) => {
    before?.call(material, shader, renderer)
    shader.uniforms.uFade = material.userData.fade
    shader.fragmentShader = wrapFade(shader.fragmentShader, alphaScaled(material))
  }
  material.customProgramCacheKey = () => `fade:${alphaScaled(material)}:${previousKey.call(material)}`
  material.needsUpdate = true
  return true
}


/**
 * fadeMaterial for every material in a subtree.
 *
 * @param {object} object A three Object3D
 * @param {{value: number}} uniform
 * @returns {number} How many materials were wrapped now
 */
export function fadeObject(object, uniform) {
  let wrapped = 0
  object.traverse?.((node) => {
    const m = node.material
    for (const material of Array.isArray(m) ? m : (m ? [m] : [])) {
      if (fadeMaterial(material, uniform)) {
        wrapped++
      }
    }
  })
  return wrapped
}


/**
 * @param {string} fragmentShader
 * @param {boolean} alphaOnly Scale alpha only (the blend scales by it)
 * @returns {string} The shader with its main wrapped to scale gl_FragColor by uFade
 */
export function wrapFade(fragmentShader, alphaOnly) {
  const renamed = fragmentShader.replace(/void\s+main\s*\(\s*(void)?\s*\)/, 'void fadedMain()')
  if (renamed === fragmentShader) {
    return fragmentShader
  }
  return `uniform float uFade;
${renamed}
void main() {
  fadedMain();
  ${alphaOnly ? 'gl_FragColor.a *= uFade;' : 'gl_FragColor *= uFade;'}
}
`
}
