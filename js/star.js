import * as THREE from './lib/three.js/three.module.js';
import Object from './object.js';
import * as Shaders from './star-shaders.js';
import * as Shapes from './shapes.js';
import * as Shared from './shared.js';


/**
 * The star uses a Perlin noise for a naturalistic rough noise
 * process.  However, solar surface dynamics are better described by
 * Benard convection cells:
 *   https://en.wikipedia.org/wiki/Granule_(solar_physics)
 *   https://en.wikipedia.org/wiki/Rayleigh%E2%80%93B%C3%A9nard_convection
 * Some example implementations:
 *   https://www.shadertoy.com/view/llScRy
 *   https://www.shadertoy.com/view/XlsfWM
 *
 * Current approach uses:
 *   https://bpodgursky.com/2017/02/01/procedural-star-rendering-with-three-js-and-webgl-shaders/
 * Which derives from:
 *   https://www.seedofandromeda.com/blogs/51-procedural-star-rendering
 *
 * A next level up is to include a magnetic field model for the entire
 * star and use it to mix in a representation of differential plasma
 * flows along the field lines.
 */
export default class Star extends Object {
  constructor(props, sceneObjects, ui) {
    super(props.name, props);
    const group = this;
    if (sceneObjects) {
      sceneObjects[this.name] = this;
      sceneObjects[this.name + '.orbitPosition'] = group;
    }
    const shaderMaterial = new THREE.ShaderMaterial({
      uniforms: {
        iTime: { value: 1.0 },
        iResolution: { value: new THREE.Vector2() },
        iScale: { value: 100.0 },
        iDist: { value: 1.0 }
      },
      vertexShader: Shaders.VERTEX_SHADER,
      fragmentShader: Shaders.FRAGMENT_SHADER
    });
    const star = Shapes.sphere({ matr: shaderMaterial });
    star.scale.setScalar(props.radius.scalar * Shared.LENGTH_SCALE);
    group.add(star);
    group.add(new THREE.PointLight(0xffffff));
    group.orbitPosition = group;
    group.preAnimCb = (time) => {
      // Sun looks bad changing too quickly.
      time = Math.log(1 + time.simTimeElapsed * 5E-6);
      if (Shared.targets.pos) {
        shaderMaterial.uniforms.iTime.value = time;
        const d = Shared.targets.pos.distanceTo(ui.camera.position);
        shaderMaterial.uniforms.iDist.value = d * 1E-2;
      }
    };
  }
}