import Measure from './measure.js';


/**
 * Most measures are just passed on for display.  Some are needed to
 * be reified, like radius and mass.
 */
export default function reifyMeasures(obj) {
  function reify(obj, prop, name) {
    if (obj[prop]) {
      if (typeof obj[prop] === 'string') {
        const m = Measure.parse(obj[prop]).convertToUnit();
        // The parse leaves small amount in the low-significant
        // decimals, meaningless for unit values in grams and meters
        // for celestial objects.
        m.scalar = Math.floor(m.scalar);
        obj[prop] = m;
      } else {
        console.log(`unnormalized ${prop} for ${name}`);
      }
    }
  }
  const name = obj.name;
  reify(obj, 'radius', name);
  reify(obj, 'mass', name);
}
