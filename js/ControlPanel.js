import Measure from '@pablo-mayrgundter/measure.js'
import * as collapsor from './collapsor.js'
import {CURVE_COLORS, rotationCurveSvg} from './scene/rotationCurve.js'
import {spectralTypeName} from './scene/stellar.js'
import {LIGHTYEAR_METER} from './shared.js'
import {capitalize} from './utils.js'


/** SPARC's Hubble types, by T (Lelli, McGaugh & Schombert 2016, Table 1). */
const GALAXY_TYPES = ['S0', 'Sa', 'Sab', 'Sb', 'Sbc', 'Sc', 'Scd', 'Sd', 'Sdm', 'Sm', 'Im', 'BCD']


/** */
export default class ControlPanel {
  /**
   * @param {object} containerElt
   * @param {object} loader
   */
  constructor(containerElt, loader) {
    this.containerElt = containerElt
    this.loader = loader
  }


  /**
   * @param {string} path
   * @returns {object}
   */
  getPathTarget(path) {
    return path[path.length - 1]
  }


  /**
   * Renders the recursive info tree for the target body into `containerElt`.
   * The breadcrumb path itself is now rendered by the React SearchBar component
   * (`js/ui/SearchBar.jsx`) from `store.committedPath`.
   *
   * @param {string[]} path
   */
  showNavDisplay(path) {
    const target = this.loader.loaded[this.getPathTarget(path)]
    if (!target || typeof target !== 'object') {
      return
    }
    const pathPrefix = path.join('/')
    let html = '<ul>\n'
    html += this.showInfoRecursive(target, pathPrefix, false, false)
    html += '</ul>\n'
    this.containerElt.innerHTML = html
    collapsor.makeCollapsable(this.containerElt)
  }


  /**
   * Renders a compact info summary for a catalog star (no JSON descriptor).
   * Used by the search-preview mechanism when the highlighted/selected entry
   * is a star rather than a body in `loader.loaded`.
   *
   * @param {object} preview {hipId, displayName, star}
   */
  showStarPreview(preview) {
    if (!preview || !preview.star) {
      return
    }
    const {hipId, star} = preview
    const specClass = spectralTypeName(star)
    const distanceLy = Math.sqrt(
        (star.x * star.x) + (star.y * star.y) + (star.z * star.z)) /
        LIGHTYEAR_METER
    const parts = []
    parts.push('<ul>')
    parts.push(`<li>HIP: ${hipId}</li>`)
    parts.push(`<li>star class: ${specClass}</li>`)
    parts.push(`<li>absolute magnitude: ${star.absMag.toFixed(2)}</li>`)
    parts.push(`<li>distance: ${distanceLy.toFixed(2)} ly</li>`)
    parts.push('</ul>')
    this.containerElt.innerHTML = parts.join('\n')
  }


  /**
   * A SPARC galaxy's summary (js/scene/Galaxies.md), and its rotation curve
   * against its baryons' once the curves are in (rotationCurve.js).
   *
   * @param {object} galaxy Its record (Galaxies.js)
   * @param {?object} galaxies Galaxies, for its curve
   */
  showGalaxyPreview(galaxy, galaxies) {
    if (!galaxy?.row) {
      return
    }
    const g = galaxy.row
    const m = galaxy.meta
    const parts = ['<ul>']
    parts.push(`<li>type: ${GALAXY_TYPES[g.T] ?? g.T}${g.rc3?.type ? ` (RC3 ${g.rc3.type.trim()})` : ''}</li>`)
    parts.push(`<li>distance: ${g.D} ± ${g.eD} Mpc</li>`)
    parts.push(`<li>inclination: ${g.inc}°, position angle: ${galaxy.place.paMeasured ? `${galaxy.place.pa}°` :
      'not measured'}</li>`)
    parts.push(`<li>luminosity: ${(galaxy.spec.L / 1e9).toPrecision(3)}e9 L☉ in V (${m.luminositySource}), ` +
      `${g.L36}e9 L☉ at 3.6 µm</li>`)
    parts.push(`<li>disc scale length: ${g.Rdisk} kpc</li>`)
    if (g.Vflat > 0) {
      parts.push(`<li>V<sub>flat</sub>: ${g.Vflat} ± ${g.eVflat} km/s</li>`)
    }
    parts.push(`<li>HI: ${g.MHI}e9 M☉</li>`)
    parts.push('</ul>')
    parts.push('<div class="galaxy-curve"></div>')
    this.containerElt.innerHTML = parts.join('\n')
    galaxies?.curve?.(galaxy.id).then((curve) => {
      const slot = this.containerElt.querySelector('.galaxy-curve')
      if (slot && curve) {
        slot.innerHTML = `<div>rotation curve: <span style="color: ${CURVE_COLORS.observed}">●</span> observed, ` +
          `<span style="color: ${CURVE_COLORS.baryons}">━</span> stars and gas alone</div>${rotationCurveSvg(curve)}`
      }
    }).catch(() => {/* No curve: the summary stands. */})
  }


  /**
   * @param {object} obj
   * @param {string} pathPrefix
   * @param {boolean} isArray
   * @param {boolean} isSystem
   * @returns {string}
   */
  showInfoRecursive(obj, pathPrefix, isArray, isSystem) {
    /**
     * @param {number} num
     * @returns {string}
     */
    function cleanZeros(num) {
      const str = `${num}`
      return str.replace(/0000+\d+/, ' ')
    }
    let html = ''
    for (const prop in obj) {
      if (prop === 'name' || prop === 'parent' || prop.startsWith('texture_') ||
         prop === 'apparentMagnitude' || prop === 'colorIndex') {
        continue
      }
      if (Object.prototype.hasOwnProperty.call(obj, prop)) {
        let val = obj[prop]
        if (prop === 'system' && typeof val === 'object' && Array.isArray(val) && val.length === 0) {
          continue
        }
        html += '<li>'
        if (!isArray) {
          let prettyName = prop
          switch (prop) {
            case 'axialInclination': prettyName = 'tilt'; break
            case 'siderealRotationPeriod': prettyName = 'rotation period'; break
            case 'spectralType': prettyName = 'star class'; break
            default:
          }
          html += `${prettyName }: `
        }
        if (val instanceof Measure) {
          switch (prop) {
            case 'radius': val = val.convertTo(Measure.Magnitude.KILO); break
            case 'mass': val = val.convertTo(Measure.Magnitude.KILO); break
            case 'semiMajorAxis':
              // TODO
              if (typeof val.scalar === 'string') {
                val.scalar = parseFloat(val.scalar)
              }
              val.scalar = val.scalar.toExponential(4)
              val = val.toString()
              break
            case 'siderealOrbitPeriod':
              val = secsToYDHMS(val.scalar)
              break
            case 'siderealRotationPeriod':
              val = secsToYDHMS(val.scalar)
              break
            default:
          }
          html += cleanZeros(val)
        } else if (val instanceof Array) {
          if (prop === 'system') {
            html += '<ol>\n'
          } else {
            html += '<ol class="collapsed">\n'
          }
          html += this.showInfoRecursive(val, pathPrefix, true, prop === 'system')
          html += '</ol>\n'
        } else if (val instanceof Object) {
          html += '<ul class="collapsed">\n'
          html += this.showInfoRecursive(val, pathPrefix, false, false)
          html += '</ul>\n'
        } else {
          if (isSystem) {
            let path = pathPrefix
            if (pathPrefix.length > 0) {
              path += '/'
            }
            path += val
            html += `<a href="#${ path }">`
            html += capitalize(val)
          } else {
            switch (prop) {
              case 'spectralType': {
                val = spectralTypeName(obj)
                break
              }
              case 'equatorialGravity':
              case 'escapeVelocity': {
                val = `${val } m/s^2`
                break
              }
              case 'axialInclination': val = `${val }°`; break
              default:
            }
            html += val
          }
          if (isSystem) {
            html += '</a>'
          }
        }
        html += '</li>\n'
      }
    }
    html = html.replaceAll('^2', '²')
    html = html.replaceAll('^3', '³')
    return html
  }
}


/**
 * @param {number|string} s
 * @returns {string}
 */
function secsToYDHMS(s) {
  const secsPerYear = 86400 * 365
  let str = ''
  const years = parseInt(s / secsPerYear)
  if (years > 0) {
    s -= years * secsPerYear
    str += `${years}y`
  }
  const days = parseInt(s / 86400)
  if (days > 0) {
    s -= days * 86400
    str += ` ${days}d`
  }
  const hours = parseInt(s / 3600)
  if (hours > 0) {
    s -= hours * 3600
    str += ` ${hours}h`
  }
  const minutes = parseInt(s / 60)
  if (minutes > 0) {
    s -= minutes * 60
    str += ` ${minutes}m`
  }
  const seconds = parseInt(s)
  if (seconds > 0) {
    str += ` ${seconds}s`
  }
  return str
}
