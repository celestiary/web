import {
  AdditiveBlending,
  AxesHelper,
  BufferGeometry,
  EllipseCurve,
  Group,
  LOD,
  Line,
  LineBasicMaterial,
  MeshPhongMaterial,
  Object3D,
  Vector3,
} from 'three'
import {
  assertFinite,
  assertInRange,
} from '@pablo-mayrgundter/testing.js/testing.js'
import Object from './object.js'
import Places, {fetchPlaces} from './Places.js'
import SpriteSheet from './SpriteSheet.js'
import {
  ellipseSemiMinorAxisCurve,
  point,
  sphere,
} from './shapes.js'
import Rings from './rings/Rings.js'
import {newAtmosphere} from './atmos/Atmosphere'
import * as Material from './material.js'
import {ASTRO_UNIT_METER, FAR_OBJ, labelTextColor, halfPi, toRad} from '../shared.js'
import {capitalize, named} from '../utils.js'


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

    const orbitPlane = this.scene.newGroup(`${this.name}.orbitPlane`)
    group.add(orbitPlane)

    // TODO(pablo): these break vsop for the planets.
    // orbitPlane.rotation.x = assertInRange(orbit.inclination, 0, 360) * toRad
    // orbitPlane.rotation.y = assertInRange(orbit.longitudeOfPericenter, 0, 360) * toRad

    const orbitShape = this.newOrbit(this.scene, orbit, this.name)
    orbitPlane.add(orbitShape)

    const orbitPosition = this.scene.newGroup(`${this.name}.orbitPosition`)
    orbitPlane.add(orbitPosition)

    // Attaching this property triggers orbit of planet during animation.
    // See animation.js#animateSystem.
    orbitPosition.orbit = this.props.orbit

    const planetTilt = this.scene.newGroup(`${this.name}.planetTilt`)
    orbitPosition.add(planetTilt)
    planetTilt.rotateZ(assertInRange(this.props.axialInclination, 0, 360) * toRad)

    const planet = this.newPlanet(this.scene, orbitPosition, this.isMoon)
    planetTilt.add(named(planet, 'new planet'))

    // group.rotation.y = orbit.longitudeOfAscendingNode * toRad;
    // Children centered at this planet's orbit position.

    this.add(group)
  }


  loadNoOrbit() {
    const planet = this.newPlanet(this.scene, {}, this.isMoon)
    this.add(named(planet, 'new planet'))
  }


  /**
   * @param {object} scene
   * @param {object} orbit
   * @returns {Object3D}
   */
  newOrbit(scene, orbit) {
    const group = named(new Group(), 'orbit')
    const ellipseCurve = new EllipseCurve(
        0, 0,
        1, ellipseSemiMinorAxisCurve(assertInRange(orbit.eccentricity, 0, 1)),
        0, Math.PI * 2)
    const ellipsePoints = ellipseCurve.getPoints(1000)
    const ellipseGeometry = new BufferGeometry().setFromPoints(ellipsePoints)
    const orbitMaterial = new LineBasicMaterial({
      color: 0x0000ff,
      blending: AdditiveBlending,
      depthTest: true,
      depthWrite: true,
      transparent: false,
      toneMapped: false,
    })
    const pathShape = new Line(ellipseGeometry, orbitMaterial)
    // Orbit is in the x/y plane, so rotate it around x by 90 deg to put
    // it in the x/z plane (top comes towards camera until it's flat
    // edge on).
    pathShape.rotation.x = halfPi
    group.add(pathShape)
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
    // enough to see it
    placeholder.onBeforeRender = () => {
      planet.add(this.nearShape())
      placeholder.onBeforeRender = null
      delete placeholder['onBeforeRender']
    }
    planet.add(placeholder)

    const farPoint = point({
      color: 0xffffff,
      size: isMoon ? 1 : 2,
      sizeAttenuation: false,
      blending: AdditiveBlending,
      depthTest: false,
      depthWrite: false,
      transparent: true,
    })

    const farDist = surfaceRadius * 3e2
    const labelTooNearDist = surfaceRadius * 3e1
    const labelTooFarDist = isMoon ? farDist * 5e1 : farDist * 5e4
    const pointTooFarDist = farDist * 1e12

    const planetLOD = new LOD()
    planetLOD.addLevel(planet, 1)
    planetLOD.addLevel(farPoint, 10 * ASTRO_UNIT_METER) // tuned on jupiter
    planetLOD.addLevel(FAR_OBJ, pointTooFarDist)

    const labelLOD = new LOD()
    const name = capitalize(this.name)
    // TODO: single sheet for all planets/moons
    const labelSheet = named(new SpriteSheet(1, name), 'label')
    labelSheet.add(0, 0, 0, name, labelTextColor)
    labelLOD.addLevel(FAR_OBJ, labelTooNearDist)
    labelLOD.addLevel(labelSheet.compile(), labelTooNearDist)
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
   * A surface with a shiny hydrosphere and bumpy terrain materials.
   * TODO(pablo): get shaders working again.
   *
   * @returns {Object3D}
   */
  nearShape() {
    // Optional per-body subdirectory under /textures/ — keeps a
    // body's many maps (terrain, hydro, atmos, night…) organized.
    const texDir = this.props.texture_dir || ''
    const surfaceMaterial = Material.cacheMaterial(this.name, undefined, texDir)
    surfaceMaterial.metalness = 0.2
    surfaceMaterial.roughness = 0.8
    if (this.props.texture_terrain) {
      const terrainTex = Material.pathTexture(`${texDir}${this.name}_terrain`)
      surfaceMaterial.bumpMap = terrainTex
      surfaceMaterial.bumpScale = 0.10
      surfaceMaterial.roughnessMap = terrainTex
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
        // The intensity scalar compensates for the renderer's very small
        // toneMappingExposure (3e-16, calibrated for sun lumens ~1e28).
        // Day-side surface peaks at ~2e16 linear (sun illuminance × Earth
        // albedo / π) → ~1.0 after tonemap.  For city peaks around 30%
        // display brightness we want input·exposure ≈ 0.3, i.e. multiplier
        // ≈ 1e15.  Tweak per texture: composite "Earth at night" textures
        // (with land visible as faint grey) need a lower scalar than pure
        // NASA Black Marble (mostly black with bright cities).
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
             gl_FragColor.rgb += nightLight * nightFactor * 5e15;
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
    const group = new Group
    group.add(surface)
    if (!this.props.atmosphere) {
      group.add(named(newAtmosphere(this.props.radius.scalar * 1.02), 'atmosphere'))
    }
    const internalGuidesRadius = this.props.radius.scalar * 0.9
    group.add(new AxesHelper(internalGuidesRadius))
    // group.add(sphere({radius: internalGuidesRadius, wireframe: true, color: 0x808080}))
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

