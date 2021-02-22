import * as THREE from './js/lib/three.js/three.module.js';
import Loader from './js/loader.js';

const eyeAltitudeOffset = 6372e3;
let sunY = 0.5;

export default class Atmosphere extends THREE.Object3D {
  constructor(
      SunY, SunIntensity, GroundElevation, AtmosphereHeight,
      RayleighRed, RayleighGreen, RayleighBlue, RayleighScaleHeight,
      MieScatteringCoeff, MieScaleHeight, MiePolarity) {
    super();
    this.SunY = SunY;
    this.GroundElevation = GroundElevation;
    this.AtmosphereHeight = AtmosphereHeight;
    this.SunIntensity = SunIntensity;
    // TODO: these should be based on a constant λ for the frequency of light.
    // The Nvidia reference says Mie is usually λ/4, so maybe λ=84e-6 here.
    this.RayleighRed = RayleighRed;
    this.RayleighGreen = RayleighGreen;
    this.RayleighBlue = RayleighBlue;
    this.MieScatteringCoeff = MieScatteringCoeff;
    // Rayleigh scale height for Earth
    // https://en.wikipedia.org/wiki/Scale_height#Planetary_examples
    this.RayleighScaleHeight = RayleighScaleHeight;
    this.MieScaleHeight = MieScaleHeight;
    // Mie preferred scattering direction
    // TODO: why positive? Nvidia has it negative.
    this.MiePolarity = MiePolarity;

    this.skyMaterial = new THREE.ShaderMaterial({
        uniforms: {
          uEyePos: { value: new THREE.Vector3(0, this.EyeHeight, 0) },
          uSunPos: { value: new THREE.Vector3(0, this.SunY, -1) },
          uSunIntensity: { value: this.SunIntensity },
          uGroundElevation: { value: this.GroundElevation },
          uAtmosphereHeight: { value: this.AtmosphereHeight },
          uRayleighScatteringCoeff: {
            value: new THREE.Vector3(
                this.RayleighRed,
                this.RayleighGreen,
                this.RayleighBlue,
              )},
          uRayleighScaleHeight: { value: this.RayleighScaleHeight },
          uMieScatteringCoeff: { value: this.MieScatteringCoeff },
          uMieScaleHeight: { value: this.MieScaleHeight },
          uMiePolarity: { value: this.MiePolarity },
        },
        vertexShader: 'atmosphere.vert',
        fragmentShader: 'atmosphere.frag',
        blending: THREE.AdditiveBlending,
      });
  }


  loadShaders(onLoadCb) {
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
        if (onLoadCb) {
          onLoadCb();
        }
      });
  }


  onRender() {
    const u = this.skyMaterial.uniforms;
    u.uEyePos.value.y = this.EyeHeight;
    u.uSunPos.value.y = this.SunY;
    u.uSunIntensity.value = this.SunIntensity;
    u.uGroundElevation.value = this.GroundElevation;
    u.uAtmosphereHeight.value = this.AtmosphereHeight;
    u.uRayleighScatteringCoeff.value.set(
        this.RayleighRed,
        this.RayleighGreen,
        this.RayleighBlue);
    u.uRayleighScaleHeight.value = this.RayleighScaleHeight;
    u.uMieScatteringCoeff.value = this.MieScatteringCoeff;
    u.uMieScaleHeight.value = this.MieScaleHeight;
    u.uMiePolarity.value = this.MiePolarity;
  }
}
