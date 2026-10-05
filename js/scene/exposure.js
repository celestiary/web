import {ASTRO_UNIT_METER, DISPLAY_GAIN, SUN_LIGHT_DECAY, SUN_LUMINOUS_INTENSITY} from '../shared.js'
import {HDR_MAX_VALUE} from './hdr.js'


/**
 * Target-keyed exposure: the renderer's tone-mapping exposure is set so the
 * targeted body's sunlit side renders at its albedo (a surface facing the
 * Sun shows its texture's colour), as a spacecraft camera adapts to what
 * it's pointed at.  Bodies far from the Sun would otherwise be dim and
 * near ones blown out; one fixed exposure (3e-16 before) put Mars's and
 * Earth's lit sides at ~12-18× albedo, compressed toward white.
 *
 * Celestiary's Sun is a PointLight: a surface d metres out facing it gets
 * irradiance E = I / d^decay, and a Lambertian one reflects E·albedo/π.
 * Scaled by exposure π·d^decay / I that is the albedo; DISPLAY_GAIN (shared
 * with Cesium's layers) brightens both alike.
 */


/**
 * @param {number} distanceMeters The body's distance from the Sun
 * @returns {number} toneMappingExposure for which it renders at its albedo
 *   times DISPLAY_GAIN
 */
export function exposureAt(distanceMeters) {
  return DISPLAY_GAIN * Math.PI / irradianceAt(distanceMeters)
}


/**
 * @param {number} distanceMeters Distance from the Sun
 * @returns {number} The Sun's irradiance there, in three's units (the
 *   PointLight's intensity over d^decay)
 */
export function irradianceAt(distanceMeters) {
  return SUN_LUMINOUS_INTENSITY / Math.pow(distanceMeters, SUN_LIGHT_DECAY)
}


/**
 * The atmosphere pass's sky scale (HDR.md, "The sky in exposure units"): its
 * in-scatter times a body's `sunIntensity` is the sky in exposure units when
 * the body is the exposure target, and this factor carries it to any other
 * exposure: the Sun's irradiance at the body, times the exposure, over the
 * π·DISPLAY_GAIN that exposureAt normalizes a sunlit surface by.  So 1 at
 * the body's own exposure; and the sky dims or brightens with the exposure
 * as the surface under it does.
 *
 * @param {number} distanceMeters The body's distance from the Sun
 * @param {number} exposure The renderer's toneMappingExposure
 * @returns {number}
 */
export function skyExposure(distanceMeters, exposure) {
  return irradianceAt(distanceMeters) * exposure / (DISPLAY_GAIN * Math.PI)
}


/**
 * Ease exposure toward its goal, evenly in log space (in stops), as an eye
 * or auto-exposing camera adapts.
 *
 * @param {number} current
 * @param {number} goal
 * @param {number} dtSeconds Time since the last step
 * @param {number} tauSeconds Time constant: ~63% of the way per tau
 * @returns {number}
 */
export function easeExposure(current, goal, dtSeconds, tauSeconds = EXPOSURE_TAU_SECONDS) {
  if (!(current > 0) || !(dtSeconds >= 0)) {
    return goal
  }
  const k = 1 - Math.exp(-dtSeconds / tauSeconds)
  if (k >= 1) {
    return goal
  }
  return Math.exp(Math.log(current) + ((Math.log(goal) - Math.log(current)) * k))
}


/** Adaptation time constant, seconds. */
export const EXPOSURE_TAU_SECONDS = 0.5


/**
 * The exposure relative to Earth's keyed one: 1 when a body 1 AU from the
 * Sun is the exposure target at its own exposure.  Everything of absolute
 * brightness (a star's light, the Milky Way's glow, the Sun's disc) is
 * scaled by it: a star's pixel value is its illuminance over the Sun's at
 * 1 AU, times π·DISPLAY_GAIN over the pixel's solid angle, times this
 * (HDR.md, "Physical stars").
 *
 * @param {number} exposure The renderer's toneMappingExposure
 * @returns {number}
 */
export function exposureRelative(exposure) {
  return exposure / exposureAt(ASTRO_UNIT_METER)
}


/**
 * The solid angle a point source's light lands in, steradians: one pixel,
 * for a vertical field of view over a viewport height, or the eye's patch
 * (EYE_POINT_RAD) where a pixel is finer.  The stars' shader does the same
 * (shaders/stars.vert; HDR.md "Physical stars").
 *
 * @param {number} fovDegrees
 * @param {number} heightPx
 * @returns {number}
 */
export function pointSolidAngle(fovDegrees, heightPx) {
  const radPerPx = Math.max((fovDegrees * Math.PI / 180) / Math.max(heightPx, 1), EYE_POINT_RAD)
  return radPerPx * radPerPx
}


/**
 * Metered exposure (HDR.md, "Metered exposure"): the mean log luminance of
 * the frame, in exposure units at the target-keyed exposure, over METER_KEY
 * gives a gain over that exposure, never below 1 for a sunlit target (it
 * keeps the look the keyed exposure gives it) and at most METER_GAIN_MAX (a
 * star field, with nothing but stars to meter, is lifted to the eye's dark
 * adaptation).  Pixels darker than METER_FLOOR count as METER_FLOOR, so
 * black is the floor's gain, not infinity.
 *
 * A sunlit body on black space (the Moon at quarter, 20% of the frame)
 * would read dark by the mean, with black counted as the floor; the gain
 * is also capped so that the luminance METER_HIGHLIGHT_FRACTION of the
 * frame exceeds maps to at most METER_HIGHLIGHT: a body covering more of
 * the frame than that anchors the exposure, while a star field, whose
 * sprites cover less, runs to the dark-adapted gain.
 *
 * And the one way down: where the luminance METER_BLOWN_FRACTION (a
 * quarter) of the frame exceeds is over METER_HIGHLIGHT_MAX, brighter than
 * a sunlit white surface (the Sun's disc, 46,000 of them, filling the
 * frame), the gain falls to bring it there, to METER_GAIN_MIN at most.  A
 * sunlit surface is never over it, so no planet is darkened; nor is a
 * frame for a small highlight that is (the sky round a low Sun, 2% of it
 * at 6), which clips, as a camera lets it.
 *
 * While the scene is loading (`canBeEmpty`: frameCanBeEmpty), a frame
 * with nothing in it at all (every sample exactly zero: a planet's
 * texture, or the star catalogue, still to come) asks for nothing: null,
 * and the gain stays where it is.  Running to the dark-adapted gain on a
 * black loading frame rendered the planet 3e6 times too bright when it
 * came.  Once the scene is loaded a black frame is a dark one, and asks
 * for the dark-adapted gain: the pixels can't be trusted to tell the two
 * apart.  The 32×32 meter samples under 1% of the pixels, one tap each,
 * and a star field at the keyed exposure is a few hundred 2 px points of
 * 1e-5 to 1e-7 (Sirius 4e-5), so on a large frame every tap can miss
 * them, and under half-float's smallest normal value (6.1e-5) a GPU may
 * flush them to zero outright; either way the meter read zero, took the
 * frame for empty, held the gain at 1 and showed no stars, with nothing
 * in the console (the user's M2 Mac, #153).  The LDR fallback's bytes
 * quantize a star field to zero, so it can't tell empty from dark
 * (`canBeEmpty` false) and takes the dark.
 *
 * The dark end is absolute.  The target-keyed exposure scales with the
 * Sun's irradiance at the target (exposureAt: 0.4× Earth's at Mercury,
 * 40× at Pluto), and the gain is over it; a floor and a ceiling in keyed
 * units would make a dark frame's exposure, and the stars' limit with it,
 * depend on the target (a magnitude shallower at Mercury, four deeper at
 * Pluto, which the user saw).  So the floor is METER_FLOOR at Earth's
 * keyed exposure, METER_FLOOR × keyedOverEarth at this one, and a black
 * frame asks for METER_GAIN_MAX over Earth's keyed exposure wherever the
 * camera is: the dark-adapted eye, the same everywhere.  The sunlit end
 * (never below 1, the highlight cap) stays relative to the keyed exposure:
 * a sunlit target shows at its albedo.
 *
 * @param {{meanLog: number, highlight: number, blown: number, max: number}} metered
 *   meanLogLuminance's measure of the frame as it was rendered
 * @param {number} renderedOverKeyed The exposure the frame was rendered at
 *   over the target-keyed exposure (its gain at the time)
 * @param {boolean} canBeEmpty Whether a frame of zeros means nothing drawn
 *   yet (frameCanBeEmpty), rather than a dark scene
 * @param {number} keyedOverEarth The target-keyed exposure over Earth's
 * @param {number} gainCap A ceiling on the gain from what is known to be in
 *   the frame (sunlitBodyCap): a resolved sunlit body anchors the exposure
 *   whatever fraction of the frame it is.  Never under 1.
 * @returns {number|null} The gain the scene asks for; null for no scene
 */
export function meteredGain({meanLog, highlight, blown, max}, renderedOverKeyed, canBeEmpty = true, keyedOverEarth = 1,
    gainCap = Infinity) {
  if (canBeEmpty && !(max > 0)) {
    return null
  }
  const rendered = Math.max(renderedOverKeyed, 1e-30)
  const lumaAtKeyed = Math.exp(meanLog) / rendered
  const highlightAtKeyed = highlight / rendered
  const blownAtKeyed = blown / rendered
  if (blownAtKeyed > METER_HIGHLIGHT_MAX) {
    // Brought to a sunlit surface (METER_HIGHLIGHT), not to a white: at
    // a white the tone map's shoulder flattened the Sun's granulation
    // (0.5-1 of its texture into 0.78-0.95 of the display: a flat grey
    // disc on the user's preview).
    return Math.max(METER_HIGHLIGHT / blownAtKeyed, METER_GAIN_MIN)
  }
  const floor = METER_FLOOR * Math.max(keyedOverEarth, 1e-30)
  const byMean = METER_KEY / Math.max(lumaAtKeyed, floor)
  const byHighlight = METER_HIGHLIGHT / Math.max(highlightAtKeyed, floor)
  const gain = Math.min(Math.max(Math.min(byMean, byHighlight), 1), METER_GAIN_MAX / Math.max(keyedOverEarth, 1e-30))
  return Math.min(gain, Math.max(gainCap, 1))
}


/**
 * A resolved sunlit body in the frame anchors the exposure, whatever
 * fraction of the frame it is (the meter's percentile rules miss a
 * crescent under 2% of the pixels, and ran a frame with Earth's crescent
 * in it to the dark-adapted gain: the crescent a flat white, the user's
 * preview).  An eye or a camera does the same: it won't blow out the
 * one lit thing in view.  The cap is the gain at which the body's
 * brightest sunlit pixel is a white (METER_HIGHLIGHT_MAX): its sunlit
 * white at the target-keyed exposure is DISPLAY_GAIN × keyed(target) /
 * keyed(body), and its brightest surface is HIGHLIGHT_ALBEDO_FACTOR
 * times its Bond albedo (Earth's clouds 0.9 over 0.37, the Moon's
 * highlands 0.2 over 0.12), to 1.  The Moon from Earth's night side:
 * 3.3, its highlands white and its maria at 0.6; Earth's crescent from
 * 94,000 km: 1.1, the clouds just white.  A body is resolved when its
 * disc is wider than the eye's patch (EYE_POINT_RAD): Jupiter from Earth
 * (40″) is a point and stays a star of the night; the Moon (31′) and a
 * planet from orbit anchor.  Only a disc that fits in the frame
 * (angularRadius at most halfFov) anchors: the lit fraction is the whole
 * disc's, and from the ground or low orbit on a body's night side the lit
 * part is outside the frame; there the keyed exposure and the percentile
 * rules have the sunlit ground, and the dark ground adapts.  And only
 * when at least LIT_FRACTION_MIN of the disc is lit: a thin limb crescent
 * (phase past 154°) doesn't hold the night side of Earth from orbit at
 * the keyed exposure and put out its cities.  Never under 1: the
 * target's own sunlit side keeps its keyed exposure.
 *
 * @param {Array<{angularRadius: number, litFraction: number, keyedExposure: number, albedo: number}>} bodies
 *   Each body in view: its angular radius (radians), its lit fraction
 *   ((1 + cos phase) / 2), exposureAt its distance from the Sun, and its
 *   Bond albedo
 * @param {number} targetKeyedExposure exposureAt the exposure target's distance
 * @param {number} [halfFov] Half the vertical field of view, radians
 * @returns {number} The gain cap; Infinity for no resolved sunlit body
 */
export function sunlitBodyCap(bodies, targetKeyedExposure, halfFov = Math.PI) {
  let cap = Infinity
  for (const {angularRadius, litFraction, keyedExposure, albedo} of bodies) {
    if (!(angularRadius >= EYE_POINT_RAD / 2) || !(angularRadius <= halfFov) || !(litFraction >= LIT_FRACTION_MIN) ||
        !(keyedExposure > 0)) {
      continue
    }
    const white = DISPLAY_GAIN * targetKeyedExposure / keyedExposure
    const highlightAlbedo = Math.min(HIGHLIGHT_ALBEDO_FACTOR * (albedo > 0 ? albedo : 0.3), 1)
    cap = Math.min(cap, METER_HIGHLIGHT_MAX / (white * highlightAlbedo))
  }
  return Math.max(cap, 1)
}


/**
 * A body's brightest sunlit surface over its Bond albedo (sunlitBodyCap):
 * Earth's clouds are 0.9 over its 0.37, the Moon's highlands 0.2 over
 * its 0.12.
 */
export const HIGHLIGHT_ALBEDO_FACTOR = 2.5
/** The least of a body's disc that must be lit for it to anchor the gain (sunlitBodyCap). */
export const LIT_FRACTION_MIN = 0.05


/**
 * Whether a frame of zeros can mean "nothing drawn yet" (meteredGain's
 * canBeEmpty): only while the scene is loading, in the HDR path.  Once
 * the star catalogue is drawn and the exposure target's surface is in, a
 * black frame is a dark scene and asks for the dark-adapted gain; deciding
 * it from the pixels missed sparse, faint stars (above).  The LDR fallback
 * never takes a frame for empty: its bytes can't tell.
 *
 * @param {boolean} hdr The HDR path (a float meter)
 * @param {boolean} starsDrawn The star catalogue is loaded and in the scene
 * @param {boolean} surfaceReady The exposure target's surface is drawn (no
 *   target, or one whose surface is ready)
 * @returns {boolean}
 */
export function frameCanBeEmpty(hdr, starsDrawn, surfaceReady) {
  return Boolean(hdr) && !(Boolean(starsDrawn) && Boolean(surfaceReady))
}

/**
 * @param {Float32Array|Uint8Array} rgba Pixels, RGBA: floats, or bytes
 *   (the LDR fallback's target), which count as their value over 255
 * @param {number} count How many pixels
 * @returns {{meanLog: number, highlight: number, blown: number, max: number}}
 *   The mean of ln(max(luma, METER_FLOOR)), the luminance
 *   METER_HIGHLIGHT_FRACTION of the pixels exceed, the one
 *   METER_BLOWN_FRACTION of them exceed, and the brightest; a pixel that
 *   isn't finite (overflowed) counts as the buffer's most, HDR_MAX_VALUE
 */
export function meanLogLuminance(rgba, count) {
  const scale = rgba instanceof Uint8Array ? 1 / 255 : 1
  let sum = 0
  const lumas = []
  for (let i = 0; i < count; i++) {
    let luma = ((0.2126 * rgba[i * 4]) + (0.7152 * rgba[(i * 4) + 1]) + (0.0722 * rgba[(i * 4) + 2])) * scale
    if (!Number.isFinite(luma)) {
      luma = HDR_MAX_VALUE
    }
    sum += Math.log(Math.max(luma, METER_FLOOR))
    lumas.push(luma)
  }
  if (lumas.length === 0) {
    return {meanLog: Math.log(METER_FLOOR), highlight: METER_FLOOR, blown: METER_FLOOR, max: 0}
  }
  lumas.sort((a, b) => b - a)
  const exceeded = (fraction) => Math.max(lumas[Math.min(lumas.length - 1, Math.floor(fraction * lumas.length))], METER_FLOOR)
  return {
    meanLog: sum / lumas.length,
    highlight: exceeded(METER_HIGHLIGHT_FRACTION),
    blown: exceeded(METER_BLOWN_FRACTION),
    max: lumas[0],
  }
}


/** The mean luminance, in exposure units, the metered exposure aims for. */
export const METER_KEY = 0.3
/**
 * Pixels darker than this, in exposure units, count as this: it sets the
 * dark-adapted gain, METER_KEY over it, 4e6 over Earth's keyed exposure
 * wherever the camera is (meteredGain), which shows a scene of 8e-3 cd/m²
 * (a sunlit white is 3e4) as a sunlit one.  The eye adapts to
 * 1e-6 cd/m², so this is well within its range; it is set so that a star
 * of magnitude 6.5, 2.9e-8 of a sunlit white over the eye's patch, just
 * shows, 0.12 in exposure units, 12 of 255 through Neutral's toe (HDR.md,
 * "Physical stars": the naked-eye limit at a dark site).  At 1e-7, 3e6,
 * the limit was magnitude 6; at 3e-8, 1e7, magnitude 7.5: the toe makes
 * the faint end steeper than the light.
 */
export const METER_FLOOR = 7.5e-8
/** The most the metered exposure rises over the target-keyed one. */
export const METER_GAIN_MAX = METER_KEY / METER_FLOOR
/** The share of the frame whose luminance the highlight cap looks at. */
export const METER_HIGHLIGHT_FRACTION = 0.02
/**
 * The most that luminance is lifted to, in exposure units: a sunlit
 * surface of albedo 0.4 (DISPLAY_GAIN × 0.4).  Brighter than that, the
 * frame holds a sunlit surface and the keyed exposure stands (the Moon at
 * quarter, Mars from orbit, Earth's clouds); dimmer (a low Sun's sky and
 * ground, twilight), the frame is lifted toward the key.
 */
export const METER_HIGHLIGHT = 0.6
/**
 * The most that luminance is let stand at, in exposure units: a sunlit
 * white surface (DISPLAY_GAIN); over it the gain falls below 1.
 */
export const METER_HIGHLIGHT_MAX = DISPLAY_GAIN
/** The share of the frame that must be over it for the gain to fall. */
export const METER_BLOWN_FRACTION = 0.25
/**
 * The least the metered exposure falls to under the target-keyed one: the
 * Sun's disc, 6e4 in the buffer, brought to METER_HIGHLIGHT needs 1e-5,
 * with room.
 */
export const METER_GAIN_MIN = 5e-6
/**
 * The metered gain's adaptation time constants, seconds (log space): up,
 * as the eye adapts to the dark, slowly; down, to the light, fast, as a
 * camera's auto-exposure, so a planet come upon from a star field is
 * blown out for a second, not five.
 */
export const METER_TAU_UP_SECONDS = 1.5
export const METER_TAU_DOWN_SECONDS = 0.3
/** Frames between meterings. */
export const METER_EVERY_FRAMES = 4


/**
 * The limiting magnitude (HDR.md, "Physical stars"): the naked eye's at a
 * dark site, dark adapted, which is the metered exposure's dark-adapted
 * gain (METER_GAIN_MAX).  The one parameter the star field is calibrated
 * on: a star of this magnitude shows LIMIT_VALUE there, brighter ones
 * 2.5× more light per magnitude, fainter ones less, down into black
 * smoothly (no pop); the eye's patch, over which a star's light is
 * spread, follows from it (EYE_PATCH_SR).  At any other exposure the
 * limit moves with the gain (limitingMagnitude): by day only the planets
 * and the brightest stars; with a user's star gain, fainter (a longer
 * exposure, a telescope).
 */
export const LIMITING_MAGNITUDE = 6.5
/**
 * What a star at the limit shows, in exposure units: 12 of 255 through
 * Neutral's toe, just visible.
 */
export const LIMIT_VALUE = 0.12
/** The Sun's apparent magnitude. */
export const SUN_APPARENT_MAGNITUDE = -26.74


/**
 * @param {number} magnitude Apparent
 * @returns {number} The star's illuminance over the Sun's at 1 AU
 */
export function illuminanceRatio(magnitude) {
  return Math.pow(10, -0.4 * (magnitude - SUN_APPARENT_MAGNITUDE))
}


/**
 * The eye's patch, steradians: the solid angle a point's light is spread
 * over, so that a star at LIMITING_MAGNITUDE shows LIMIT_VALUE at the
 * dark-adapted gain (a star's value is DISPLAY_GAIN·π·ratio/Ω·gain,
 * stars.vert).  8.2e-6 sr, a 9.9 arcmin square: the dark-adapted eye's
 * resolution of a point (rod acuity, ~20/200, 10 arcmin), which is why
 * the calibration is physical.
 */
export const EYE_PATCH_SR = DISPLAY_GAIN * Math.PI * illuminanceRatio(LIMITING_MAGNITUDE) * METER_GAIN_MAX / LIMIT_VALUE
/** The eye's patch's side, radians. */
export const EYE_POINT_RAD = Math.sqrt(EYE_PATCH_SR)


/**
 * The limiting magnitude at an exposure: the magnitude whose star shows
 * LIMIT_VALUE at this gain over Earth's keyed exposure (exposureRelative)
 * times the user's star gain.  6.5 at the dark-adapted gain; −10 at the
 * keyed exposure by day, where only the Sun, the Moon and Venus pass.
 *
 * @param {number} gainOverKeyed The exposure over Earth's keyed one (exposureRelative)
 * @param {number} starGain
 * @returns {number}
 */
export function limitingMagnitude(gainOverKeyed, starGain = 1) {
  return LIMITING_MAGNITUDE + (2.5 * Math.log10(Math.max(gainOverKeyed * starGain, 1e-300) / METER_GAIN_MAX))
}


/**
 * @param {number} magnitude The limit wanted at the dark-adapted gain
 * @returns {number} The star gain that puts it there (1 at LIMITING_MAGNITUDE)
 */
export function starGainForLimit(magnitude) {
  return Math.pow(10, 0.4 * (magnitude - LIMITING_MAGNITUDE))
}


/**
 * The star sprite's law, as shaders/stars.vert computes it, for tests and
 * probes (HDR.md, "Physical stars"): the star's radiance over the eye's
 * patch at this exposure, the kernel's width and peak, and the quad.
 *
 * @param {number} ratio The star's illuminance over the Sun's at 1 AU
 * @param {number} gainOverEarth The exposure over Earth's keyed one (exposureRelative)
 * @param {object} [opts]
 * @param {number} [opts.fovDegrees] Vertical field of view
 * @param {number} [opts.heightPx] Viewport height
 * @param {number} [opts.starGain] The user's gain
 * @param {number} [opts.discRad] The star's disc's angular diameter, radians
 * @returns {{value: number, patchPx: number, sigma: number, peak: number,
 *   sizePx: number, coreRadiusPx: number, flat: boolean, glareCapped: boolean}} value is the
 *   radiance in exposure units; coreRadiusPx where the kernel passes white
 *   (0.76 after the tone map's shoulder), 0 for a star under it; flat for
 *   the one-pixel sprite of a coarse viewport (sigma 0)
 */
export function starSprite(ratio, gainOverEarth, {fovDegrees = 45, heightPx = 300, starGain = 1, discRad = 0} = {}) {
  const pxRad = (fovDegrees * Math.PI / 180) / Math.max(heightPx, 1)
  const patchRad = Math.max(pxRad, EYE_POINT_RAD)
  const patchPx = Math.max(Math.floor((patchRad / pxRad) + 0.5), 1)
  let value = DISPLAY_GAIN * Math.PI * ratio / (patchRad * patchRad) * gainOverEarth * starGain
  if (discRad > 0) {
    value *= Math.min(1, (patchRad * patchRad) / (discRad * discRad))
  }
  const light = value * patchPx * patchPx
  const sigma0 = Math.max(STAR_SIGMA_PER_PATCH * patchPx, STAR_SIGMA_MIN_PX)
  const peak0 = light / (2 * Math.PI * sigma0 * sigma0)
  if (patchPx < 1.5 && peak0 < 1) {
    return {value, patchPx, sigma: 0, peak: Math.min(value, HDR_MAX_VALUE), sizePx: 1, coreRadiusPx: 0, flat: true}
  }
  const decades = Math.max(Math.log10(Math.max(peak0, 1e-30)), 0)
  const sigma = sigma0 + (STAR_BLOOM_SIGMA_PX_PER_DECADE * decades)
  const peakRaw = Math.min(light / (2 * Math.PI * sigma * sigma), HDR_MAX_VALUE)
  // The glare cap: the saturated core is at most STAR_GLARE_CORE_PATCHES
  // patches in radius, so the peak is at most what puts the kernel at
  // white (0.76) there; the halo falls off from it.
  const coreMax = STAR_GLARE_CORE_PATCHES * patchPx
  const peak = Math.min(peakRaw, 0.76 * Math.exp(coreMax * coreMax / (2 * sigma * sigma)))
  const visibleRadius = sigma * Math.sqrt(2 * Math.log(Math.max(peak / STAR_VISIBLE_VALUE, 1)))
  const sizePx = Math.min(Math.max((2 * visibleRadius) + 2, 1), STAR_MAX_SIZE_PX)
  const coreRadiusPx = sigma * Math.sqrt(2 * Math.log(Math.max(peak / 0.76, 1)))
  return {value, patchPx, sigma, peak, sizePx, coreRadiusPx, flat: false, glareCapped: peak < peakRaw}
}


/**
 * The kernel's width as a fraction of the patch (stars.vert): narrower
 * than the patch, so its peak is patch² / 2πσ² = 2.5 × the patch's
 * radiance (STAR_PEAK_OVER_RADIANCE) and a faint star stays above the
 * tone map's toe.
 */
export const STAR_SIGMA_PER_PATCH = 0.25
/** The kernel's least width, pixels, so the peak doesn't depend on where the star falls. */
export const STAR_SIGMA_MIN_PX = 0.6
/** A star's peak over its radiance on a screen whose patch is 3 px or more. */
export const STAR_PEAK_OVER_RADIANCE = 1 / (2 * Math.PI * STAR_SIGMA_PER_PATCH * STAR_SIGMA_PER_PATCH)
/** The kernel's width grows this many pixels per decade of light over white (bloom). */
export const STAR_BLOOM_SIGMA_PX_PER_DECADE = 0.75
/** The quad holds the kernel out to where it falls under this, exposure units. */
export const STAR_VISIBLE_VALUE = 0.004
/** The quad's largest side, pixels (Stars.js MAX_STAR_SIZE_PX). */
export const STAR_MAX_SIZE_PX = 96
/**
 * The saturated core's largest radius, in patches (stars.vert): the
 * bloom's core grew with the log of the light without limit, and the Sun
 * from 52 AU, 1e9 over white at the dark gain, was a 120 px disc on the
 * user's screen where it should read as a dazzling star.  The eye's
 * glare has a core of about this size (20′: two patches), with the halo
 * falling off round it; past the cap the light is lost, as it is to a
 * saturated retina.
 */
export const STAR_GLARE_CORE_PATCHES = 2
