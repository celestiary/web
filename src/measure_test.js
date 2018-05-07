const testing = require('./testing.js');
const Measure = require('./measure.js');

const tests = new testing();

// Magnitude
tests.add('Magnitude from', () => {
  tests.assertEquals(1, Measure.Magnitude.KILO.from(1000, Measure.Magnitude.UNIT));
  tests.assertEquals(1000, Measure.Magnitude.UNIT.from(1, Measure.Magnitude.KILO));
});

// Measure
tests.add('Test equals', () => {
  const first = new Measure(1, Measure.Magnitude.UNIT, Measure.Unit.METER);
  const second = new Measure(1, Measure.Magnitude.UNIT, Measure.Unit.METER);
  tests.assertTrue(first.equals(second), `expected (${first}).equals(${second})`);
});

tests.add('Test parse', () => {
  const expected = new Measure(1, Measure.Magnitude.UNIT, Measure.Unit.METER);
  const actual = Measure.parse('1 m');
  tests.assertTrue(expected.equals(actual), `expected: ${expected}, actual: ${actual}`);
});

tests.add('Test scalar not equals', () => {
  const first = new Measure(1, Measure.Magnitude.UNIT, Measure.Unit.METER);
  const second = new Measure(2, Measure.Magnitude.UNIT, Measure.Unit.METER);
  tests.assertTrue(!first.equals(second), `expected (${first}).equals(${second})`);
});

tests.add('Test unit not equals', () => {
  const first = new Measure(1, Measure.Magnitude.UNIT, Measure.Unit.METER);
  const second = new Measure(2, Measure.Magnitude.UNIT, Measure.Unit.GRAM);
  tests.assertTrue(!first.equals(second), `expected (${first}).equals(${second})`);
});

tests.add('Test magnitude not equals', () => {
  const first = new Measure(1, Measure.Magnitude.UNIT, Measure.Unit.METER);
  const second = new Measure(2, Measure.Magnitude.KILO, Measure.Unit.GRAM);
  tests.assertTrue(!first.equals(second), `expected (${first}).equals(${second})`);
});

tests.add('Test convertTo magnitude', () => {
  const input = new Measure(1000, Measure.Magnitude.UNIT, Measure.Unit.METER);
  const out = input.convertTo(Measure.Magnitude.KILO);
  tests.assertEquals(1, out.scalar);
  tests.assertEquals(Measure.Unit.METER, out.unit);
  tests.assertEquals(Measure.Magnitude.KILO, out.magnitude);
});

tests.add('Test toString', () => {
  const input = new Measure(1000, Measure.Magnitude.UNIT, Measure.Unit.METER);
  tests.assertEquals('1000m', input.toString());
  const out = input.convertTo(Measure.Magnitude.KILO);
  tests.assertEquals('1km', out.toString());
});

tests.run();
