import {
  AdditiveBlending,
  AxesHelper,
  Group,
  ImageLoader,
  LOD,
  MeshPhongMaterial,
  Object3D,
  Texture,
  Vector3,
} from 'three'
import {
  assertFinite,
  assertInRange,
} from '@pablo-mayrgundter/testing.js/testing.js'
import Object from './object.js'
import Places, {fetchPlaces} from './Places.js'
import SpriteSheet from './SpriteSheet.js'
import {newFarPoint, pointSwitchDistance} from './farPoint.js'
import {
  point,
  sphere,
} from './shapes.js'
import Rings from './rings/Rings.js'
import * as Material from './material.js'
import {meanElements} from './meanElements.js'
import {ORBIT_LINE_POINTS, unitEllipse} from './orbitPath.js'
import {newWideLineStrip} from './wideLines.js'
import {dataUrl} from '../dataUrl.js'
import {monthOfJulianDay, monthlyPath} from './monthly.js'
import {FAR_OBJ, OVERLAY_LAYER, labelTextColor, toRad} from '../shared.js'
import {capitalize, named} from '../utils.js'


// Orbit lines: blue, added over the scene, as before as 1 px GL lines.
const ORBIT_COLOR = 0x0000ff
const ORBIT_WIDTH_PX = 1.5


// Earth's city lights, as rendered before tone mapping: what 5e15 came to
// under the old fixed exposure (3e-16).
const NIGHT_LIGHT = 1.5

// A label's depth, in radii toward the eye from the body's centre.
const LABEL_LIFT = 1.1


/** */
export default class Planet extends Object {
  /**
   * A new planet at its place in orbit.
   * https://en.wikipedia.org/wiki/Orbital_elements
   * https://en.wikipedia.org/wiki/Equinox#Celestial_coordinate_systems
   * https://en.wikipedia.org/wiki/Epoch_(astronomy)#Julian_years_and_J2000
   */
  constructor(scene, props, isMoon = false, isTest = false) {
    super(props.name, props)
    this.scene = scene
    this.initialCameraDistance = this.props.radius.scalar * 10
    this.isMoon = isMoon
    if (isTest) {
      this.loadNoOrbit()
    } else {
      this.load()
    }
  }


  /** */
  load() {
    const orbit = this.props.orbit
    const group = this.scene.newGroup(`${this.name}.group`)

    // Unrotated, as are group and the parent's orbitPosition: positions
    // Animation writes are in the scene's frame, relative to the primary.
    // The orbit line is laid by Animation: on the mean-element ellipse of
    // date (meanElements.js), or, for the planets and the Moon, as the
    // body's path sampled from its ephemeris (orbitPath.js).
    const orbitPlane = this.scene.newGroup(`${this.name}.orbitPlane`)
    group.add(orbitPlane)

    const orbitShape = this.newOrbit(this.scene, orbit, this.name)
    orbitPlane.add(orbitShape)

    const orbitPosition = this.scene.newGroup(`${this.name}.orbitPosition`)
    orbitPlane.add(orbitPosition)

    // Attaching this property triggers orbit of planet during animation.
    // See animation.js#animateSystem.
    orbitPosition.orbit = this.props.orbit
    // Published mean elements (Pluto, the moons), or null.
    orbitPosition.elements = meanElements(this.props.orbit)
    // For bodies whose orbit line Animation re-lays each frame.
    orbitPosition.orbitShape = orbitShape
    // Close up, the line is drawn through the body's centre to a small
    // fraction of this (bodyLine.js).
    orbitPosition.bodyRadius = this.props.radius.scalar

    const planetTilt = this.scene.newGroup(`${this.name}.planetTilt`)
    orbitPosition.add(planetTilt)
    // Tilt the planet's pole away from scene +Y (= NEP) toward the celestial
    // pole.  The scene frame is X = vernal equinox, Y = NEP, Z = -ecl-Y; the
    // EQ↔EC pivot axis is the VE direction (= scene +X), so axial obliquity
    // is rotation around scene +X.  After rotateX(-ε), local +Y maps to
    //   (0, cos ε, -sin ε)
    // which is the IAU North Celestial Pole in the scene frame — verified
    // by the celestialFrame test "earth axial tilt places NCP at expected
    // scene direction".  Using rotateZ instead would put the pole in the
    // X-Y plane, 90° away from NCP, and any subsequent spin then turns the
    // body around the wrong axis.
    planetTilt.rotateX(-assertInRange(this.props.axialInclination, 0, 360) * toRad)
    // Bodies with an IAU pole (the planets with moons, and Pluto) are tilted
    // to it by Animation instead: rotateX can only lean a pole toward
    // ecliptic longitude 90°, which is right for Earth alone.
    if (this.props.pole) {
      planetTilt.pole = this.props.pole
    }

    const planet = this.newPlanet(this.scene, orbitPosition, this.isMoon)
    planetTilt.add(named(planet, 'new planet'))

    this.add(group)
  }


  loadNoOrbit() {
    const planet = this.newPlanet(this.scene, {}, this.isMoon)
    this.add(named(planet, 'new planet'))
  }


  /**
   * The orbit line: a group holding a wide line strip (`group.line`, a
   * Line's position attribute and draw range; wideLines.js), which starts as
   * the orbit's unit ellipse, centred, in the XZ plane, scaled to the
   * semi-major axis.  Animation lays it on a mean-element orbit
   * (layOrbitShape), or, for the planets and the Moon, rewrites its
   * vertices in place with the body's sampled path (orbitPath.js).
   *
   * @param {object} scene
   * @param {object} orbit
   * @returns {Object3D}
   */
  newOrbit(scene, orbit) {
    const group = named(new Group(), 'orbit')
    const positions = unitEllipse(assertInRange(orbit.eccentricity, 0, 1), new Float32Array(ORBIT_LINE_POINTS * 3))
    // Wide lines (wideLines.js), as the asterisms: a strip with a Line's
    // position attribute and draw range, which orbitPath.js and bodyLine.js
    // rewrite in place.
    const pathShape = newWideLineStrip(positions, {
      name: 'orbit line',
      color: ORBIT_COLOR,
      width: ORBIT_WIDTH_PX,
      material: {blending: AdditiveBlending, depthTest: true, depthWrite: true, transparent: false},
    })
    group.add(pathShape)
    group.line = pathShape
    const orbitScaled = orbit.semiMajorAxis.scalar
    group.scale.setScalar(orbitScaled)
    // Initial visibility from the scene's current settings — handles the
    // case where this planet loads after applySettings has already toggled
    // orbits off (toggleOrbits' visitSetProperty only walks
    // already-attached children), so the new orbit doesn't sneak in
    // visible and contradict the user's saved permalink state.
    group.visible = scene.getSetting ? scene.getSetting('o') : true
    return group
  }


  /**
   * Creates a planet with waypoint, surface, atmosphere and locations and set
   * to rotate.
   *
   * @returns {Object3D}
   */
  newPlanet(scene, orbitPosition, isMoon) {
    const planet = new Object3D // scene.newObject(this.name, this.props, );
    const surfaceRadius = assertFinite(this.props.radius.scalar)
    // Attaching this property triggers rotation of planet during animation.
    planet.siderealRotationPeriod = this.props.siderealRotationPeriod
    // Attaching this is used by scene#goTo.
    planet.orbitPosition = orbitPosition
    planet.props = this.props
    if (scene.objects) { // hack
      scene.objects[this.name] = planet
    }

    if (this.props.has_locations) {
      const places = this.loadLocations(this.props)
      // Stash a reference on the rotating planet node so Scene.togglePlanetLabels
      // can toggle places visibility alongside the planet name labels (both
      // belong to the 'p' overlay group — see DESIGN.md "Overlays & visibility").
      planet.places = places
      // Initial visibility tracks the 'p' setting for the same reason — without
      // this, places would be visible after a permalink restore that had 'p' off.
      places.visible = scene.getSetting ? scene.getSetting('p') : true
      planet.add(places)
    }

    // An object must have a mesh to have onBeforeRender called, so
    // add a little invisible helper.
    const placeholder = point({
      opacity: 0, // invisible
      depthTest: false,
      depthWrite: false,
      transparent: true,
    })
    // Delay load and render for planet to only the first time camera is close
    // enough to see it, or it's targeted (preloadNear, Scene.setTarget):
    // then its textures load while the camera travels there.
    let near = null
    const buildNear = () => {
      if (!near) {
        near = this.nearShape()
        planet.add(near)
      }
    }
    // A request, served on the next animation frame (Animation calls
    // preAnimCb), so a target change doesn't build meshes and start
    // downloads synchronously.
    planet.preloadNear = () => {
      planet.preAnimCb = () => {
        buildNear()
        planet.preAnimCb = null
      }
    }
    // False while the near shape's colour map is loading.
    planet.surfaceReady = () => near !== null && near.userData.ready()
    placeholder.onBeforeRender = () => {
      buildNear()
      placeholder.onBeforeRender = null
      delete placeholder['onBeforeRender']
    }
    planet.add(placeholder)

    const farPoint = newFarPoint(isMoon)

    const farDist = surfaceRadius * 3e2
    const labelTooNearDist = surfaceRadius * 3e1
    const labelTooFarDist = isMoon ? farDist * 5e1 : farDist * 5e4
    const pointTooFarDist = farDist * 1e12

    const planetLOD = new LOD()
    planetLOD.addLevel(planet, 1)
    // A point once the mesh would be under ~1.6 px across (45° fov over
    // 640 px): a sub-pixel mesh, lit at its albedo, fades to nothing.  (It
    // was 10 AU, when a fixed, blown-out exposure kept sub-pixel meshes
    // bright.)  CesiumLayers.meshRange reads this too.
    planetLOD.addLevel(farPoint, pointSwitchDistance(surfaceRadius))
    planetLOD.addLevel(FAR_OBJ, pointTooFarDist)

    const labelLOD = new LOD()
    const name = capitalize(this.name)
    // TODO: single sheet for all planets/moons
    const labelSheet = named(new SpriteSheet(1, name), 'label')
    labelSheet.add(0, 0, 0, name, labelTextColor)
    const labelSprites = labelSheet.compile()
    // Drawn after the atmosphere pass, so it doesn't haze the label; still
    // depth-tested against the scene (ThreeUI.render).
    labelSprites.layers.set(OVERLAY_LAYER)
    // Depth in front of the body's near side, so the body itself doesn't
    // hide it: at exactly the near side it tied with the body's own depth
    // (and Cesium's ground sphere, CesiumLayers._writeGroundDepths) where
    // they overlap, and the two fought.
    labelSheet.setTowardEye(surfaceRadius * LABEL_LIFT)
    labelLOD.addLevel(FAR_OBJ, labelTooNearDist)
    labelLOD.addLevel(labelSprites, labelTooNearDist)
    labelLOD.addLevel(FAR_OBJ, labelTooFarDist)
    // Initial visibility from the scene's current settings (see newOrbit
    // above) — guards against the load-order race where a planet appears
    // after togglePlanetLabels has already run.
    labelLOD.visible = scene.getSetting ? scene.getSetting('p') : true

    const group = new Object3D
    group.add(named(planetLOD, 'planet LOD'))
    group.add(named(labelLOD, 'label LOD'))

    // group.renderOrder = 1
    return group
  }


  /**
   * Build a Places group for this planet's surface POIs.  Returned
   * synchronously (empty), populated async from /data/places/<name>.json.
   * Cached on the Planet so Scene.land can read entries without re-fetching.
   *
   * @param {object} props
   * @returns {Places}
   */
  loadLocations(props) {
    const places = new Places(this.name, props.radius.scalar)
    this.places = places
    fetchPlaces(this.name).then((entries) => places.setEntries(entries))
    return places
  }


  /**
   * A colour map that follows the simulation date's month (monthly.js).
   * One texture, whose image is replaced when the month changes, once the
   * new month's has loaded: no shader rebuild, and the old month shows
   * meanwhile rather than nothing.
   *
   * @param {string} pattern Under textures/, with `{MM}` for the month
   * @returns {Texture}
   */
  monthlyMap(pattern) {
    const map = new Texture()
    const loader = new ImageLoader()
    let wanted = 0
    this.preAnimCb = (time) => {
      const month = monthOfJulianDay(time.simTimeJulianDay())
      if (month === wanted) {
        return
      }
      wanted = month
      loader.load(dataUrl(`textures/${monthlyPath(pattern, month)}.jpg`), (image) => {
        if (month === wanted) {
          map.image = image
          map.needsUpdate = true
        }
      })
    }
    return map
  }


  /**
   * A surface with a shiny hydrosphere and bumpy terrain materials.
   * TODO(pablo): get shaders working again.
   *
   * @returns {Object3D}
   */
  nearShape() {
    // Optional per-body subdirectory under /textures/ — keeps a
    // body's many maps (terrain, hydro, atmos, night…) organized.
    const texDir = this.props.texture_dir || ''
    const monthly = this.props.texture_monthly
    const surfaceMaterial = Material.cacheMaterial(
        this.name, undefined, texDir, monthly ? this.monthlyMap(monthly) : undefined)
    // Rock and cloud aren't metallic, and metalness takes from the diffuse
    // light that exposure.js calibrates against.  Oceans' shine comes from
    // the hydrosphere metalness map, which scales this.
    surfaceMaterial.metalness = this.props.texture_hydrosphere ? 0.2 : 0
    surfaceMaterial.roughness = 0.8
    // A mosaic stretched darker than the body's albedo (Planet.md).
    surfaceMaterial.color.setScalar(this.props.texture_gain ?? 1)
    if (this.props.texture_terrain) {
      const terrainTex = Material.pathTexture(`${texDir}${this.name}_terrain`)
      surfaceMaterial.bumpMap = terrainTex
      surfaceMaterial.bumpScale = 0.10
      // Not a roughness map too: elevation isn't gloss, and low, dark
      // ground read as shiny, a glint at the subsolar point (Mars).
      surfaceMaterial.roughness = 1.0
    }
    // Build a chain of fragment-shader mods: hydrosphere ocean roughness +
    // night-side emissive city lights, both applied via a single
    // onBeforeCompile (Three.js calls onBeforeCompile exactly once when
    // the shader is first compiled).
    const shaderMods = []
    let nightSunDirUniform = null
    if (this.props.texture_hydrosphere) {
      const hydroTex = Material.pathTexture(`${texDir}${this.name}_hydro`)
      surfaceMaterial.metalnessMap = hydroTex
      surfaceMaterial.reflectivity = 0.2
      surfaceMaterial.roughnessMap = hydroTex
      // https://franky-arkon-digital.medium.com/make-your-own-earth-in-three-js-8b875e281b1e
      // 5. Insert our custom roughness calculation
      // if the ocean map is white for the ocean, then we have to reverse the b&w values for roughness
      // We want the land to have 1.0 roughness, and the ocean to have a minimum of 0.5 roughness
      shaderMods.push((shader) => {
        shader.fragmentShader = shader.fragmentShader.replace('#include <roughnessmap_fragment>', `
        float roughnessFactor = roughness;

        #ifdef USE_ROUGHNESSMAP

          vec4 texelRoughness = texture2D( roughnessMap, vRoughnessMapUv );
          // reversing the black and white values because we provide the ocean map
          texelRoughness = vec4(1.0) - texelRoughness;

          // reads channel G, compatible with a combined OcclusionRoughnessMetallic (RGB) texture
          roughnessFactor *= clamp(texelRoughness.g, 0.5, 1.0);

        #endif
      `)
      })
    }
    if (this.props.texture_night) {
      // City lights / night-side emissive map.  Drop a NASA "Black Marble"
      // (or equivalent equirectangular night-lights JPG) at
      // public/textures/<name>_night.jpg — public domain at
      // https://earthobservatory.nasa.gov/features/NightLights.  Without
      // the file the load fails silently and the night-side stays dark.
      const nightTex = Material.pathTexture(`${texDir}${this.name}_night`)
      // Shared uniform: written by the surface mesh's onBeforeRender each
      // frame, read by the patched fragment shader.  Same Vector3 ref so
      // the GLSL sees live values without re-binding.
      nightSunDirUniform = {value: new Vector3(0, 0, -1)}
      const nightMapUniform = {value: nightTex}
      // Stash on the material so the surface mesh's onBeforeRender can
      // find it without a closure (multiple Earth instances would all
      // share material via cacheMaterial — though that doesn't happen
      // today).
      surfaceMaterial.userData.uSunDirection = nightSunDirUniform
      shaderMods.push((shader) => {
        shader.uniforms.uNightMap = nightMapUniform
        shader.uniforms.uSunDirection = nightSunDirUniform
        // Inject uniforms after <common> (always present) and the
        // night-side emissive add BEFORE <tonemapping_fragment> so the
        // city lights pass through the same tonemap+gamma chain as the
        // rest of the surface.  Earlier rev tried `<output_fragment>` —
        // that chunk was renamed `<opaque_fragment>` in r155+, so the
        // string-replace silently failed and night lights didn't show.
        // vNormal is in VIEW space; uSunDirection is updated per-frame
        // (in onBeforeRender below) into the same view space.
        // The lights are divided by the renderer's toneMappingExposure, so
        // they show at NIGHT_LIGHT after it whatever the exposure (which
        // follows the target; exposure.js).  Tweak per texture: composite
        // "Earth at night" textures (with land visible as faint grey) need
        // a lower level than pure NASA Black Marble (mostly black with
        // bright cities).
        shader.fragmentShader = shader.fragmentShader.replace(
            '#include <common>',
            `#include <common>
             uniform sampler2D uNightMap;
             uniform vec3 uSunDirection;`,
        )
        shader.fragmentShader = shader.fragmentShader.replace(
            '#include <tonemapping_fragment>',
            `vec3 nightLight = texture2D(uNightMap, vMapUv).rgb;
             // smoothstep around terminator: 0 fully day, 1 fully night
             float nightFactor = smoothstep(-0.05, 0.05, -dot(normalize(vNormal), uSunDirection));
             #ifdef TONE_MAPPING
               gl_FragColor.rgb += nightLight * nightFactor * (${NIGHT_LIGHT.toFixed(2)} / toneMappingExposure);
             #else
               gl_FragColor.rgb += nightLight * nightFactor * ${NIGHT_LIGHT.toFixed(2)};
             #endif
             #include <tonemapping_fragment>`,
        )
      })
    }
    if (shaderMods.length > 0) {
      surfaceMaterial.onBeforeCompile = (shader) => {
        for (const fn of shaderMods) {
          fn(shader)
        }
      }
    }

    // Bump surface resolution from sphere()'s default (128 segs ≈ 16k tris,
    // ~310 km triangle edge at Earth scale) to 512 (~262k tris, ~78 km
    // edge).  At close range — landing, low-altitude flight — the smaller
    // triangles plus tighter chord-to-arc fit reduce sub-pixel rasterization
    // gaps that previously let the sun show through Earth.  Cost per body
    // is trivial on a modern GPU; one planet's worth of triangles dwarfed
    // by the star catalog.
    const surface = named(sphere({radius: this.props.radius.scalar, resolution: 512, matr: surfaceMaterial}), 'planet surface')

    // Per-frame: refresh sun direction (view space) for the night-lights
    // shader.  Sun lives at world origin; transform direction-from-planet-
    // to-sun into the camera's view frame.
    if (nightSunDirUniform) {
      const _planetWorld = new Vector3()
      surface.onBeforeRender = (renderer, scene, camera) => {
        surface.getWorldPosition(_planetWorld)
        nightSunDirUniform.value.copy(_planetWorld).negate().normalize()
        nightSunDirUniform.value.transformDirection(camera.matrixWorldInverse)
      }
    }
    // const surface = named(sphere({radius: this.props.radius.scalar, wireframe: true, color: 0x00ff00}), 'planet surface')
    surface.renderOrder = 1
    if (this.props.texture_atmosphere && !this.props.atmosphere) {
      surface.add(this.newClouds())
    }
    if (this.props.rings && this.props.rings.texture) {
      const ringsObj = new Rings(this.props)
      ringsObj.injectPlanetShadow(surfaceMaterial)
      surface.add(ringsObj)
    }
    // No glow for a body without atmosphere data: those are airless (or,
    // like Europa, have an exosphere far too thin to see), so their limb is
    // sharp.  A decorative rim shell here used to glow all the way round,
    // shadow side included; bodies with an atmosphere get a physically lit
    // limb from the atmosphere pass.
    const group = new Group
    group.add(surface)
    const internalGuidesRadius = this.props.radius.scalar * 0.9
    group.add(new AxesHelper(internalGuidesRadius))
    // group.add(sphere({radius: internalGuidesRadius, wireframe: true, color: 0x808080}))
    // Not drawn until its colour map is in: a map without its image draws
    // black, and the atmosphere pass hazed that into a blue disc before the
    // surface appeared (ThreeUI gates the pass on this too).
    group.userData.ready = () => Boolean(surfaceMaterial.map?.image)
    surface.visible = group.userData.ready()
    if (!surface.visible) {
      group.preAnimCb = () => {
        if (group.userData.ready()) {
          surface.visible = true
          group.preAnimCb = null
        }
      }
    }
    return named(group, 'planet surface and guides')
  }


  /** @returns {Object3D} */
  newClouds() {
    // TODO: https://threejs.org/examples/webgl_shaders_sky.html
    const texDir = this.props.texture_dir || ''
    const atmosTex = Material.pathTexture(`${texDir}${this.name}`, '_atmos.jpg')
    const atmosphereScaleHeight = 8.5e3 // earth
    const shape = sphere({
      radius: this.props.radius.scalar + atmosphereScaleHeight,
      matr: new MeshPhongMaterial({
        color: 0xffffff,
        alphaMap: atmosTex,
        transparent: true,
        specularMap: atmosTex,
        shininess: 100,
        depthWrite: false,
        depthTest: false,
      }),
    })
    shape.name = `${this.name}.clouds`
    return shape
  }
}

