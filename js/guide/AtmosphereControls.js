import {Pane} from 'tweakpane'


/** */
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

