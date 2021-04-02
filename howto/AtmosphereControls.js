import {GUI} from 'dat.gui';


const PRESETS = {
  width: 400,
  load: {
    'preset': 'Earth',
    'remembered': {
      'Earth': {
        '0': {
          'SunY': 2,
          // Terrell's original, needs citation.
          'SunIntensity': 22,
          'GroundElevation': 6371000, // meters
          // 'AtmosphereHeight': 100000, // meters
          'AtmosphereHeight': 60000, // meters, Bruneton
          // TODO: these should be based on a constant λ for the frequency of light.
          // The Nvidia reference says Mie is usually λ/4, so maybe λ=84e-6 here?
          //'RayleighRed': 5.5e-6,
          //'RayleighGreen': 13.0e-6,
          //'RayleighBlue': 22.4e-6,
          //'RayleighScaleHeight': 8000,
          // Collienne et al. https://core.ac.uk/download/pdf/18591764.pdf
          // Eq 10: βR = (5.8, 13.5, 33.1)10^6 for wavelengths λ = (680, 550, 440)10−9m
          'RayleighRed': 5.8e-6,
          'RayleighGreen': 13.5e-6,
          'RayleighBlue': 33.1e-6,
          // Rayleigh scale height for Earth
          'RayleighScaleHeight': 8000, // Bruneton agrees
          // https://en.wikipedia.org/wiki/Scale_height#Planetary_examples
          //'RayleighScaleHeight': 7000,
          // https://www.scratchapixel.com/lessons/procedural-generation-virtual-worlds/simulating-sky/simulating-colors-of-the-sky
          //'MieScatteringCoeff': 0.000021,
          'MieScatteringCoeff': 0.000021,
          'MieScaleHeight': 1200, // meters, Bruneton agrees
          // TODO: why positive? Nvidia has it negative.
          // 'MiePolarity': 0.758
          'MiePolarity': 0.8 // Bruneton
        }
      },
      // Values default to Earth values.
      'Mars': {
        '0': {
          'SunY': 2,
          'SunIntensity': 11, // TODO
          //'GroundElevation': 3389500,
          'GroundElevation': 6371000,
          // https://en.wikipedia.org/wiki/Atmosphere_of_Mars#Vertical_structure
          'AtmosphereHeight': 60000,
          // Roughly swap r & b from Earth, then some hand tuning.
          'RayleighRed': 15e-6,
          'RayleighGreen': 13.5e-6,
          'RayleighBlue': 5.8e-6,
          //'RayleighRed': 5.75e-3,
          //'RayleighGreen': 13.57e-3,
          //'RayleighBlue': 19.918e-3,
          // Collienne et al.
          // Eq 11: βR = (19.918, 13.57, 5.75)10−3; λ = (680, 510, 440)10−9m
          // https://en.wikipedia.org/wiki/Scale_height#Planetary_examples
          'RayleighScaleHeight': 11100,
          'MieScatteringCoeff': 0.000042, // 2x earth
          'MieScaleHeight': 1200,
          'MiePolarity': 0.8
        }
      },
    },
    'closed': false,
    'folders': {
      'Rayleigh Scattering': {
        'preset': 'Default',
        'closed': false,
        'folders': {}
      },
      'Mie Scattering': {
        'preset': 'Default',
        'closed': false,
        'folders': {}
      }
    }
  },
};


export default class AtmosphereControls extends GUI {
  /** @param atmos An Atmosphere parameters object. */
  constructor(atmos) {
    super(PRESETS);
    this.onChangeCb = null;
    const onChange = () => {
      if (this.onChangeCb) {
        this.onChangeCb();
      }
    };
    this.onFinishChangeCb = null;
    const onFinishChange = () => {
      if (this.onFinishChangeCb) {
        this.onFinishChangeCb();
      }
    };
    this.add(atmos, 'SunY', -1, 5).name('Sun Y')
      .onChange(onChange).onFinishChange(onFinishChange);
    this.add(atmos, 'SunIntensity', 0, atmos.SunIntensity * 10).name('Sun intensity');
    this.add(atmos, 'GroundElevation', 1, atmos.GroundElevation).name('Ground Elevation (m)');
    this.add(atmos, 'AtmosphereHeight', 1, atmos.AtmosphereHeight * 2).name('Atmos. height (m)')
      .onChange(onChange).onFinishChange(onFinishChange);
    const rls = this.addFolder('Rayleigh Scattering');
    rls.add(atmos, 'RayleighRed', 1e-6, 1e-4).name('Red')
      .onChange(onChange).onFinishChange(onFinishChange);
    rls.add(atmos, 'RayleighGreen', 1e-6, 1e-4).name('Green')
      .onChange(onChange).onFinishChange(onFinishChange);
    rls.add(atmos, 'RayleighBlue', 1e-6, 1e-4).name('Blue')
      .onChange(onChange).onFinishChange(onFinishChange);
    rls.add(atmos, 'RayleighScaleHeight', 1, atmos.AtmosphereHeight).name('Scale height (m)')
      .onChange(onChange).onFinishChange(onFinishChange);
    rls.open();
    const mie = this.addFolder('Mie Scattering');
    mie.add(atmos, 'MieScatteringCoeff', 0.000001, 0.0001).name('Scattering')
      .onChange(onChange).onFinishChange(onFinishChange);
    mie.add(atmos, 'MieScaleHeight', 1, atmos.AtmosphereHeight).name('Scale height (m)');
    mie.add(atmos, 'MiePolarity', -0.999, 0.999).name('Polarity')
      .onChange(onChange).onFinishChange(onFinishChange);
    mie.open();
    this.remember(atmos);
  }
}
