import Measure from '@pablo-mayrgundter/measure.js/Measure.js';


const UNIT = Measure.Magnitude.UNIT;
const [METER, SECOND] = [Measure.Unit.METER, Measure.Unit.SECOND];

/**
 * Most measures are just passed on for display.  Some are needed to
 * be reified, like radius and mass.
 */
export default function reifyMeasures(obj) {
  function reify(obj, prop, name) {
    const val = obj[prop];
    if (val !== undefined && val !== null) {
      const type = typeof val;
      if (type == 'string') {
        const m = Measure.parse(val).convertToUnit();
        // The parse leaves small amount in the low-significant
        // decimals, meaningless for unit values in grams and meters
        // for celestial objects.
        m.scalar = Math.floor(m.scalar);
        obj[prop] = m;
      } else if (type == 'number') {
        switch (prop) {
          case 'siderealOrbitPeriod': obj[prop] = new Measure(val, UNIT, SECOND); break;
          case 'siderealRotationPeriod': obj[prop] = new Measure(val, UNIT, SECOND); break;
          case 'semiMajorAxis': obj[prop] = new Measure(val, UNIT, METER); break;
        }
      } else if (!(val instanceof Measure)) {
        console.warn(`unnormalized ${prop} for ${name}; val(${val}) type(${type})`);
      }
    }
  }
  const name = obj.name;
  reify(obj, 'radius', name);
  reify(obj, 'mass', name);
  reify(obj, 'siderealRotationPeriod', name);
  if (obj['orbit']) {
    reify(obj['orbit'], 'semiMajorAxis', name);
    reify(obj['orbit'], 'siderealOrbitPeriod', name);
  }
}
