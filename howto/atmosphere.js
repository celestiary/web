import * as THREE from './js/lib/three.js/three.module.js';
import Loader from './js/loader.js';

let theta = 0;
const eyeAltitudeOffset = 6372e3;
let sunY = 0.5, eyeY = eyeAltitudeOffset;

export default class Atmosphere extends THREE.Object3D {
  constructor(onLoadCb) {
    super();
    this.skyMaterial = new THREE.ShaderMaterial({
        uniforms: {
          uEyePos: { value: new THREE.Vector3(0, eyeY, 0) },
          uSunPos: { value: new THREE.Vector3(0, sunY, -1) }
        },
        vertexShader: 'atmosphere.vert',
        fragmentShader: 'atmosphere.frag',
        blending: THREE.AdditiveBlending,
      });

    new Loader().loadShaders(this.skyMaterial, () => {
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute([
          -1, -1, -1,
          1, -1, -1,
          1,  1, -1,
          -1, -1, -1,
          1,  1, -1,
          -1,  1, -1],
          3));
        const skySprite = new THREE.Mesh(geometry, this.skyMaterial);
        skySprite.position.z = 0;
        this.add(skySprite);
        onLoadCb();
      });
  }


  onRender(cameraPosition) {
    theta += 0.0125;
    sunY = Math.cos(theta) * 0.3 + 0.2;
    eyeY = eyeAltitudeOffset + cameraPosition.z;
    this.skyMaterial.uniforms.uSunPos.value.y = sunY;
    this.skyMaterial.uniforms.uEyePos.value.y = eyeY;
  }
}
