/**
 */
export default class Atmosphere {
  /**
   */
  constructor(
      SunY, SunIntensity, GroundElevation, AtmosphereHeight,
      RayleighRed, RayleighGreen, RayleighBlue, RayleighScaleHeight,
      MieScatteringCoeff, MieScaleHeight, MiePolarity) {
    this.EyeHeight = 2 // meters
    this.SunY = SunY
    this.SunIntensity = SunIntensity
    this.GroundElevation = GroundElevation
    this.AtmosphereHeight = AtmosphereHeight
    // TODO: these should be based on a constant λ for the frequency of light.
    // The Nvidia reference says Mie is usually λ/4, so maybe λ=84e-6 here.
    this.RayleighRed = RayleighRed
    this.RayleighGreen = RayleighGreen
    this.RayleighBlue = RayleighBlue
    this.MieScatteringCoeff = MieScatteringCoeff
    // Rayleigh scale height for Earth
    // https://en.wikipedia.org/wiki/Scale_height#Planetary_examples
    this.RayleighScaleHeight = RayleighScaleHeight
    this.MieScaleHeight = MieScaleHeight
    // Mie preferred scattering direction
    // TODO: why positive? Nvidia has it negative.
    this.MiePolarity = MiePolarity
    this.Presets = ''
  }
}
