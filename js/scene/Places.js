import {Group, Vector3} from 'three'
import {assertFinite} from '@pablo-mayrgundter/testing.js/testing.js'
import SpriteSheet from './SpriteSheet.js'
import {point} from './shapes.js'
import {latLngAltToBodyFixed} from '../coords.js'
import {labelTextColor} from '../shared.js'


// Tier reveal thresholds: planet apparent RADIUS in viewport pixels.
// T0 marquee names appear when the body is a small recognizable disc;
// finer tiers reveal as the camera closes in.  Indexed by entry's `t` field.
const DEFAULT_TIER_PX = [30, 200, 1500, 8000]

// Lift label anchors above the surface as a fraction of the body radius.
// SpriteSheet billboards in screen space at the anchor's 3D depth — without
// a lift, sprite pixels extending toward the disc center get depth-clipped
// by the curving sphere (the surface curves CLOSER to the camera between
// the anchor and the disc center).  ~0.5% of body radius (~32 km Earth,
// 9 km Moon) keeps the lift invisible from typical viewing distances while
// still floating clear of the curvature.  Per-entry `a` (alt) adds on top.
const SURFACE_OFFSET_FRAC = 0.005


/**
 * Surface places (cities, craters, landing sites…) on a celestial body.
 *
 * Lives in the rotating Planet Object3D's local frame so labels inherit
 * axial tilt + sidereal rotation via the scene graph — entry positions are
 * raw body-fixed XYZ from latLngAltToBodyFixed, no per-frame transform work.
 *
 * LOD: per-tier SpriteSheets are lazy-instantiated the first time their
 * reveal threshold (planet apparent radius in pixels) is crossed.  Per-frame
 * visibility toggling is driven by an invisible placeholder Points whose
 * onBeforeRender computes screenPx for the parent body.
 */
export default class Places extends Group {
  /**
   * @param {string} bodyName For node naming + debugging
   * @param {number} planetRadius Body radius in meters
   * @param {number[]} [tierThresholds] Override DEFAULT_TIER_PX
   */
  constructor(bodyName, planetRadius, tierThresholds = DEFAULT_TIER_PX) {
    super()
    this.name = `${bodyName}.places`
    this.bodyName = bodyName
    this.planetRadius = assertFinite(planetRadius)
    this.tierThresholds = tierThresholds
    this.entries = []
    this.byTier = []
    this.tierGroups = []
    this._planetWorldPos = new Vector3()
    this._camWorldPos = new Vector3()
    this._installLODHook()
  }


  /**
   * Replace the catalog and bucket by tier.  Higher-tier sheets are not
   * built until their pixel threshold is first crossed (see _updateLOD).
   *
   * @param {Array<{n:string,t?:number,lat:number,lng:number,a?:number,k?:string}>} entries
   */
  setEntries(entries) {
    this._disposeTiers()
    this.entries = entries
    this.byTier = []
    for (const e of entries) {
      const t = e.t ?? 0
      if (!this.byTier[t]) {
        this.byTier[t] = []
      }
      this.byTier[t].push(e)
    }
  }


  /**
   * Compute the body's apparent radius in viewport pixels at the camera.
   *
   * @param {object} camera Three.js PerspectiveCamera (uses .fov)
   * @param {number} viewportH Viewport height in pixels
   * @returns {number}
   */
  screenPx(camera, viewportH) {
    const parent = this.parent
    if (!parent) {
      return 0
    }
    parent.getWorldPosition(this._planetWorldPos)
    camera.getWorldPosition(this._camWorldPos)
    const camDist = this._camWorldPos.distanceTo(this._planetWorldPos)
    const r = this.planetRadius
    // Half-angle subtended by the body, valid even when camera is inside.
    const angRad = Math.atan2(r, Math.max(camDist, r))
    const halfFovRad = (camera.fov * Math.PI) / 360
    return (angRad / halfFovRad) * (viewportH / 2)
  }


  /**
   * Visibility test for tier `t` at a given screenPx.  Exposed for tests so
   * we don't need a real renderer/camera to verify the LOD logic.
   *
   * @param {number} t
   * @param {number} screenPx
   * @returns {boolean}
   */
  shouldShowTier(t, screenPx) {
    const threshold = this.tierThresholds[t]
    if (threshold === undefined) {
      return false
    }
    return screenPx >= threshold
  }


  /** Build the SpriteSheet for tier `t` from this.byTier[t]. */
  _buildTier(t) {
    const entries = this.byTier[t]
    if (!entries || entries.length === 0) {
      return
    }
    const longest = entries.reduce((a, e) => (e.n.length > a.length ? e.n : a), '')
    // Non-RTE: positions are body-local (small magnitude), three.js handles
    // body-local → world via modelMatrix.  RTE shaders skip modelMatrix.
    const sheet = new SpriteSheet(entries.length, longest)
    const lift = this.planetRadius * SURFACE_OFFSET_FRAC
    for (const e of entries) {
      const xyz = latLngAltToBodyFixed(e.lat, e.lng, (e.a ?? 0) + lift, this.planetRadius)
      sheet.add(xyz.x, xyz.y, xyz.z, e.n, labelTextColor)
    }
    const points = sheet.compile()
    const g = new Group()
    g.name = `${this.bodyName}.places.t${t}`
    g.userData.tier = t
    g.userData.sheet = sheet
    g.add(points)
    g.visible = false // _updateLOD will turn on this same frame
    this.tierGroups[t] = g
    this.add(g)
  }


  /** Install an invisible Points whose onBeforeRender drives per-frame LOD. */
  _installLODHook() {
    const placeholder = point({
      opacity: 0,
      depthTest: false,
      depthWrite: false,
      transparent: true,
    })
    placeholder.name = `${this.bodyName}.places.lodHook`
    // Hook runs only when the placeholder itself isn't culled.  It sits at
    // the parent's origin, so it's visible whenever the planet is in frame.
    placeholder.onBeforeRender = (renderer, _scene, camera) => {
      const px = this.screenPx(camera, renderer.domElement.clientHeight)
      for (let t = 0; t < this.tierThresholds.length; t++) {
        if (!this.byTier[t]) {
          continue
        }
        const want = this.shouldShowTier(t, px)
        if (want && !this.tierGroups[t]) {
          this._buildTier(t)
        }
        if (this.tierGroups[t]) {
          this.tierGroups[t].visible = want
        }
      }
    }
    this._lodHook = placeholder
    this.add(placeholder)
  }


  /** Free GPU resources for every built tier. */
  _disposeTiers() {
    for (let t = 0; t < this.tierGroups.length; t++) {
      const g = this.tierGroups[t]
      if (!g) {
        continue
      }
      this.remove(g)
      const points = g.children[0]
      if (points) {
        points.geometry.dispose()
        const mat = points.material
        if (mat.uniforms?.map?.value) {
          mat.uniforms.map.value.dispose()
        }
        mat.dispose()
      }
    }
    this.tierGroups = []
  }
}


/**
 * Fetch and parse a body's place catalog.  Returns a Promise that resolves
 * to the entries array, or [] on 404 / parse error so a missing catalog
 * degrades silently rather than blowing up the planet.
 *
 * @param {string} bodyName
 * @returns {Promise<Array>}
 */
export async function fetchPlaces(bodyName) {
  try {
    const rsp = await fetch(`/data/places/${bodyName}.json`)
    if (!rsp.ok) {
      return []
    }
    const json = await rsp.json()
    return Array.isArray(json.places) ? json.places : []
  } catch (e) {
    console.warn(`Places: failed to load ${bodyName}.json`, e)
    return []
  }
}
