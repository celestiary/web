/**
 * The activity view: a star as a space observatory's instruments show it,
 * not as the eye does (js/scene/Sun.md, "The activity view").  In white
 * light at the disc's exposure a flare is a few percent on a few granules,
 * a prominence 1e-5 of the disc and a CME 1e-9: all there, none to be
 * seen.  SOHO's and SDO's pictures show them because of what the
 * instruments are:
 *
 * - an **EUV imager** in He II 304 Å (EIT, AIA): the photosphere is dark
 *   there, and the picture is the chromosphere and transition region at
 *   ~50,000 K: the supergranules' network, plage over the active regions,
 *   flares that saturate the detector, and prominences in emission off
 *   the limb, as bright as the disc;
 * - a **white-light coronagraph** round it (LASCO): the K-corona and the
 *   CMEs, with the corona's steep fall taken out by a radial filter (each
 *   radius over the mean corona's brightness there, as the normalising
 *   radial graded filter does: Morgan, Habbal & Woo 2006), so streamers
 *   and CME fronts show at every radius at once;
 * - both through the instrument's **colour table**, a ramp from dark red
 *   through orange to white: false colour, of a brightness, not a hue.
 *
 * The structures are the white-light model's own (the regions, flares,
 * prominences, CMEs and the corona's electrons); the view gives each its
 * level in the passband.  Those levels are the view's parameters, below:
 * a model of the published pictures' look, not a radiative transfer of
 * the 304 Å line.
 */


/** The views a star's layers can be drawn in (SunLayers.setView). */
export const VIEW_EYE = 'eye'
export const VIEW_EUV = 'euv'
export const VIEWS = Object.freeze([VIEW_EYE, VIEW_EUV])


/**
 * The EUV view's levels, each over the quiet disc's mean in the passband.
 *
 * - `white`: the colour table's white over the white-light disc's
 *   radiance, which the meter shows as a sunlit surface, 0.6 of the
 *   display's white (exposure.js METER_HIGHLIGHT): 1.7, so the table's
 *   white is the display's.
 * - `plage`: an active region's plage (EIT 304 Å active regions are 5-10
 *   times the quiet Sun's count rate); the quiet disc itself is drawn at
 *   1.5, its cells at 1.1 and its network to 2.7 (star-shaders.js).
 * - `filament`: how much of the disc's light a filament takes: the same
 *   prominences seen against the disc, dark ribbons at a third of the
 *   quiet disc (He II absorbs in the cool plasma).
 * - `limb`: the limb's brightening, × (1 − μ)² (the line is optically
 *   thick but forms higher toward the limb: a brighter rim).
 * - `corona`: the coronagraph field's level where the corona is the mean
 *   streamer belt's (the radial filter's 1).
 * - `coolPerNm`: the cool plasma's level per nm of the Balmer model's Hα
 *   equivalent width: a typical prominence (0.01 nm) is 2.5 times the
 *   quiet disc, as bright as the network, as prominences are in 304 Å.
 * - `flareAtC1`, `flareIndex`: a flare's level at its peak, by its GOES
 *   class: 30 at C1, as (F/F_C1)^0.6: 120 at M1, 480 at X1.
 * - `flareMmAtC1`, `flareSizeIndex`: the radius of what it lights, 4 Mm at
 *   C1 as (F/F_C1)^0.3: 16 Mm at X1 (ribbon areas of 10¹⁸ to 10¹⁹·⁵ cm²).
 */
export const EUV_VIEW = Object.freeze({
  white: 1.7,
  plage: 8,
  filament: 0.65,
  limb: 0.8,
  corona: 5,
  coolPerNm: 250,
  flareAtC1: 30,
  flareIndex: 0.6,
  flareMmAtC1: 4,
  flareSizeIndex: 0.3,
})


const C1_FLUX = 1e-6


/**
 * A flare's level in the EUV view at its peak, over the quiet disc.
 *
 * @param {number} flux GOES 1-8 Å peak flux, W m⁻²
 * @returns {number}
 */
export function euvFlareLevel(flux) {
  return EUV_VIEW.flareAtC1 * ((Math.max(flux, 0) / C1_FLUX) ** EUV_VIEW.flareIndex)
}


/**
 * The radius of what a flare lights in the EUV view.
 *
 * @param {number} flux GOES 1-8 Å peak flux, W m⁻²
 * @returns {number} Mm
 */
export function euvFlareRadiusMm(flux) {
  return EUV_VIEW.flareMmAtC1 * ((Math.max(flux, 0) / C1_FLUX) ** EUV_VIEW.flareSizeIndex)
}


// The colour table: each channel's ceiling, the level at which it has
// risen by 1 − 1/e, and its curve's power.  Red comes up first, green
// through the levels of the network and plage, blue only for what
// saturates: dark red, orange, yellow, white, as the 304 Å tables of EIT
// and AIA run.  Fitted by eye to their pictures: the quiet disc
// (0.58, 0.07, 0.004) in linear sRGB, the network at 2.5 (0.95, 0.27,
// 0.02), plage at 8 (1.15, 0.92, 0.16), white past 30.
export const TABLE = Object.freeze([
  Object.freeze({ceiling: 1.15, level: 1 / 0.7, power: 1}),
  Object.freeze({ceiling: 1.1, level: 5.5, power: 1.6}),
  Object.freeze({ceiling: 1.05, level: 22, power: 1.8}),
])


/**
 * The colour table: a level's colour.  Each channel saturates, so the
 * tone map is handed a picture already within the display's range (a
 * level of 500 as red 500 would come out of it pink, not white).
 *
 * @param {number} level over the quiet disc's mean
 * @returns {Array<number>} linear sRGB over the table's white
 */
export function viewColor(level) {
  const l = Math.max(level, 0)
  return TABLE.map(({ceiling, level: at, power}) => ceiling * (1 - Math.exp(-((l / at) ** power))))
}


/** GLSL: vec3 viewColor(float level), as viewColor(). */
export const VIEW_GLSL = `
vec3 viewColor(float level) {
  vec3 x = max(level, 0.0) / vec3(${TABLE.map((c) => c.level.toFixed(4)).join(', ')});
  return vec3(${TABLE.map((c) => c.ceiling.toFixed(3)).join(', ')}) *
      (1.0 - exp(-pow(x, vec3(${TABLE.map((c) => c.power.toFixed(2)).join(', ')}))));
}
`


// The radial filter's table: the mean corona's brightness at this many
// radii, log-spaced from the first to the shell's edge.
export const RADIAL_SAMPLES = 16
export const RADIAL_FIRST = 1.02
