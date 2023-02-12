import Measure from '@pablo-mayrgundter/measure.js'


const UNIT = Measure.Magnitude.UNIT
const [METER, SECOND] = [Measure.Unit.METER, Measure.Unit.SECOND]

/**
 * Most measures are just passed on for display.  Some are needed to
 * be reified, like radius and mass.
 */
export default function reifyMeasures(obj) {
  /**
   *
   */
  function reify(o, prop, name) {
    const val = o[prop]
    if (val !== undefined && val !== null) {
      const type = typeof val
      if (type === 'string') {
        o[prop] = Measure.parse(val).convertToUnit()
      } else if (type === 'number') {
        let v = o[prop]
        switch (prop) {
          case 'siderealOrbitPeriod': v = new Measure(val, UNIT, SECOND); break
          case 'siderealRotationPeriod': v = new Measure(val, UNIT, SECOND); break
          case 'semiMajorAxis': v = new Measure(val, UNIT, METER); break
          default:
        }
        if (v && v.scalar && parseFloat(v.scalar)) {
          o[prop] = v
        }
      } else if (!(val instanceof Measure)) {
        console.warn(`unnormalized ${prop} for ${name}; val(${val}) type(${type})`)
      }
    }
  }
  const name = obj.name
  reify(obj, 'radius', name)
  reify(obj, 'mass', name)
  reify(obj, 'siderealRotationPeriod', name)
  if (obj['orbit']) {
    reify(obj['orbit'], 'semiMajorAxis', name)
    reify(obj['orbit'], 'siderealOrbitPeriod', name)
  }
}
