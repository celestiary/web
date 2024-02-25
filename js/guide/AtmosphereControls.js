import {Pane} from 'tweakpane'


const PRESETS = {
  Earth: {
    SunY: 2,
    // Terrells original, needs citation.
    SunIntensity: 22,
    GroundElevation: 6371000, // meters
    // AtmosphereHeight: 100000, // meters
    AtmosphereHeight: 60000, // meters, Bruneton
    // TODO: these should be based on a constant λ for the frequency of light.
    // The Nvidia reference says Mie is usually λ/4, so maybe λ=84e-6 here?
    // RayleighRed: 5.5e-6,
    // RayleighGreen: 13.0e-6,
    // RayleighBlue: 22.4e-6,
    // RayleighScaleHeight: 8000,
    // Collienne et al. https://core.ac.uk/download/pdf/18591764.pdf
    // Eq 10: βR = (5.8, 13.5, 33.1)10^6 for wavelengths λ = (680, 550, 440)10−9m
    RayleighRed: 5.8e-6,
    RayleighGreen: 13.5e-6,
    RayleighBlue: 33.1e-6,
    // Rayleigh scale height for Earth
    RayleighScaleHeight: 8000, // Bruneton agrees
    // https://en.wikipedia.org/wiki/Scale_height#Planetary_examples
    // RayleighScaleHeight: 7000,
    // https://www.scratchapixel.com/lessons/procedural-generation-virtual-worlds/simulating-sky/simulating-colors-of-the-sky
    // MieScatteringCoeff: 0.000021,
    MieScatteringCoeff: 0.000021,
    MieScaleHeight: 1200, // meters, Bruneton agrees
    // TODO: why positive? Nvidia has it negative.
    // MiePolarity: 0.758
    MiePolarity: 0.8, // Bruneton
  },
  // Values default to Earth values.
  Mars: {
    SunY: 2,
    SunIntensity: 11, // TODO
    // GroundElevation: 3389500,
    GroundElevation: 6371000,
    // https://en.wikipedia.org/wiki/Atmosphere_of_Mars#Vertical_structure
    AtmosphereHeight: 60000,
    // Roughly swap r & b from Earth, then some hand tuning.
    RayleighRed: 15e-6,
    RayleighGreen: 13.5e-6,
    RayleighBlue: 5.8e-6,
    // RayleighRed: 5.75e-3,
    // RayleighGreen: 13.57e-3,
    // RayleighBlue: 19.918e-3,
    // Collienne et al.
    // Eq 11: βR = (19.918, 13.57, 5.75)10−3; λ = (680, 510, 440)10−9m
    // https://en.wikipedia.org/wiki/Scale_height#Planetary_examples
    RayleighScaleHeight: 11100,
    MieScatteringCoeff: 0.000042, // 2x earth
    MieScaleHeight: 1200,
    MiePolarity: 0.8,
  },
}


/**
 */
export default class AtmosphereControls extends Pane {
  /** @param atmos An Atmosphere parameters object. */
  constructor(container, atmos) {
    super({container: container, expanded: true, title: 'Controls'})
    this.addBinding(atmos, 'SunY', {label: 'Sun Y', min: -1, max: 5})
    this.addBinding(atmos, 'SunIntensity', {label: 'Sun Intensity', min: 0, max: atmos.SunIntensity * 10})
    this.addBinding(atmos, 'GroundElevation', {label: 'Ground elevation (meters)', min: 1, max: atmos.GroundElevation})
    this.addBinding(atmos, 'AtmosphereHeight', {label: 'Atmos. height (m)', min: 1, max: atmos.AtmosphereHeight * 2})
    const rls = this.addFolder({title: 'Rayleigh Scattering'})
    rls.addBinding(atmos, 'RayleighRed', {label: 'Red', min: 1e-6, max: 1e-4})
    rls.addBinding(atmos, 'RayleighGreen', {label: 'Green', min: 1e-6, max: 1e-4})
    rls.addBinding(atmos, 'RayleighBlue', {label: 'Blue', min: 1e-6, max: 1e-4})
    rls.addBinding(atmos, 'RayleighScaleHeight', {label: 'Scale height (m)', min: 1, max: atmos.AtmosphereHeight})
    const mie = this.addFolder({title: 'Mie Scattering'})
    mie.addBinding(atmos, 'MieScatteringCoeff', {label: 'Scattering', min: 0.000001, max: 0.0001})
    mie.addBinding(atmos, 'MieScaleHeight', {label: 'Scale height (m)', min: 1, max: atmos.AtmosphereHeight})
    mie.addBinding(atmos, 'MiePolarity', {label: 'Polarity', min: -0.999, max: 0.999})
    /*
    this.addBinding(atmos, 'Presets', {
      options: {
        Earth: 'Earth',
        Mars: 'Mars',
      },
    }).on('change', (e) => {
      let preset = null
      switch (e.value) {
        case 'Mars': preset = PRESETS.Mars; break
        case 'Earth': // fallthrough
        default: preset = PRESETS.Earth
      }
      this.importPreset(preset)
    })*/
  }
}
