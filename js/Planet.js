import {
  AdditiveBlending,
  AxesHelper,
  BackSide,
  BufferGeometry,
  EllipseCurve,
  FrontSide,
  Group,
  LOD,
  Line,
  LineBasicMaterial,
  MeshBasicMaterial,
  MeshLambertMaterial,
  MeshPhongMaterial,
  Object3D,
  ShaderMaterial,
  TextureLoader,
} from 'three'
import {
  assertFinite,
  assertInRange,
} from '@pablo-mayrgundter/testing.js/testing.js'
import Object from './object.js'
import SpriteSheet from './SpriteSheet.js'
import {
  ellipseSemiMinorAxisCurve,
  point,
  rings,
  sphere,
} from './shapes.js'
import * as Material from './material.js'
import {ASTRO_UNIT_METER, FAR_OBJ, labelTextColor, halfPi, toRad} from './shared.js'
import {capitalize, named} from './utils.js'


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
      depthWrite: false,
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
      // TODO: lod for names
      planet.add(this.loadLocations(this.props))
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

    const group = new Object3D
    group.add(named(planetLOD, 'planet LOD'))
    group.add(named(labelLOD, 'label LOD'))

    group.renderOrder = 1
    return group
  }


  /**
   * A surface with a shiny hydrosphere and bumpy terrain materials.
   * TODO(pablo): get shaders working again.
   *
   * @returns {Object3D}
   */
  nearShape() {
    const surfaceMaterial = Material.cacheMaterial(this.name)
    surfaceMaterial.metalness = 0.2
    surfaceMaterial.roughness = 0.8
    if (this.props.texture_terrain) {
      const terrainTex = Material.pathTexture(`${this.name}_terrain`)
      surfaceMaterial.bumpMap = terrainTex
      surfaceMaterial.bumpScale = 0.10
      surfaceMaterial.roughnessMap = terrainTex
      surfaceMaterial.roughness = 1.0
    }
    if (this.props.texture_hydrosphere) {
      const hydroTex = Material.pathTexture(`${this.name}_hydro`)
      surfaceMaterial.metalnessMap = hydroTex
      surfaceMaterial.reflectivity = 0.2
      surfaceMaterial.roughnessMap = hydroTex
      // https://franky-arkon-digital.medium.com/make-your-own-earth-in-three-js-8b875e281b1e
      // 5. Insert our custom roughness calculation
      // if the ocean map is white for the ocean, then we have to reverse the b&w values for roughness
      // We want the land to have 1.0 roughness, and the ocean to have a minimum of 0.5 roughness
      surfaceMaterial.onBeforeCompile = function( shader ) {
        shader.fragmentShader = shader.fragmentShader.replace('#include <roughnessmap_fragment>', `
        float roughnessFactor = roughness;

        #ifdef USE_ROUGHNESSMAP

          vec4 texelRoughness = texture2D( roughnessMap, vRoughnessMapUv );
          // reversing the black and white values because we provide the ocean map
          texelRoughness = vec4(1.0) - texelRoughness;

          // reads channel G, compatible with a combined OcclusionRoughnessMetallic (RGB) texture
          roughnessFactor *= clamp(texelRoughness.g, 0.5, 1.0);

        #endif
      `);
      }
    }
    const surface = named(sphere({radius: this.props.radius.scalar, matr: surfaceMaterial}), 'planet surface')
    // const surface = named(sphere({radius: this.props.radius.scalar, wireframe: true, color: 0x00ff00}), 'planet surface')
    surface.renderOrder = 1
    surface.add(this.newAtmosphere())
    if (this.props.texture_atmosphere) {
      surface.add(this.newClouds())
    }
    if (this.props.name === 'saturn') {
      // surface.add(rings('saturn', false))
      // surface.castShadow = true
      // surface.receiveShadow = true
      surface.add(rings('saturn', true, FrontSide))
      const underRings = rings('saturn', true, FrontSide)
      underRings.position.setY(-0.01)
      underRings.rotateX(Math.PI)
      surface.add(underRings)
    }
    const group = new Group
    group.add(surface)
    const internalGuidesRadius = this.props.radius.scalar * 0.9
    group.add(new AxesHelper(internalGuidesRadius))
    // group.add(sphere({radius: internalGuidesRadius, wireframe: true, color: 0x808080}))
    return named(group, 'planet surface and guides')
  }


  /** @returns {Object3D} */
  newAtmosphere() {
    // https://franky-arkon-digital.medium.com/make-your-own-earth-in-three-js-8b875e281b1e
    const shape = sphere({
      radius: this.props.radius.scalar * 1.02,
      // wireframe: true,
      // color: 0x0000ff,
      matr: new ShaderMaterial({
        vertexShader: `varying vec3 vNormal;
varying vec3 eyeVector;

void main() {
    // modelMatrix transforms the coordinates local to the model into world space
    vec4 mvPos = modelViewMatrix * vec4( position, 1.0 );

    // normalMatrix is a matrix that is used to transform normals from object space to view space.
    vNormal = normalize( normalMatrix * normal );

    // vector pointing from camera to vertex in view space
    eyeVector = normalize(mvPos.xyz);

    gl_Position = projectionMatrix * mvPos;
}`,
        fragmentShader: `// reference from https://youtu.be/vM8M4QloVL0?si=CKD5ELVrRm3GjDnN
varying vec3 vNormal;
varying vec3 eyeVector;
uniform float atmOpacity;
uniform float atmPowFactor;
uniform float atmMultiplier;

void main() {
    // Starting from the rim to the center at the back, dotP would increase from 0 to 1
    float dotP = dot( vNormal, eyeVector );
    // This factor is to create the effect of a realistic thickening of the atmosphere coloring
    float factor = pow(dotP, atmPowFactor) * atmMultiplier;
    // Adding in a bit of dotP to the color to make it whiter while the color intensifies
    float intensity = dotP;
    vec3 atmColor = vec3(intensity, intensity, intensity);
    // use atmOpacity to control the overall intensity of the atmospheric color
    gl_FragColor = vec4(atmColor, atmOpacity) * factor;
}`,
        uniforms: {
          atmOpacity: {value: 0.2},
          atmPowFactor: {value: 1.1},
          atmMultiplier: {value: 9.5},
        },
        // Such that it does not overlays on top of the earth; this points the
        // normal in opposite direction in vertex shader
        side: BackSide,
        // Notice that by default, Three.js uses NormalBlending, where if your
        // opacity of the output color gets lower, the displayed color might get
        // whiter.
        // This works better than setting transparent: true, because it avoids a
        // weird dark edge around the earth
        blending: AdditiveBlending,
        depthTest: true,
        // transparent: true,
        // toneMapped: false,
      }),
    })
    shape.name = `${this.name}.atmosphere`
    return shape
  }


  /** @returns {Object3D} */
  newClouds() {
    // TODO: https://threejs.org/examples/webgl_shaders_sky.html
    const atmosTex = Material.pathTexture(this.name, '_atmos.jpg')
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

