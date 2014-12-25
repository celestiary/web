// copied from phys/measure.js
/**
 * Measure formatting and conversion utility.  The system of measure
 * used is a a slight variation of the System International (SI)
 * system (http://scienceworld.wolfram.com/physics/SI.html).  There
 * are two particular variations.
 *
 * This first variation is that no unit has an implicit magnitude.
 * This is in contrast to the MKS or Meters, Kilograms, Seconds system
 * which has the "kilo" magnitude for its mass unit, or the CGS or
 * Centimeters, Grams, Seconds which has the "centi" magnitude for its
 * length unit.
 *
 * The second variation is that the "deca" magnitude's abbreviation is
 * defined as "D" instead of "da" so that a decagram can be
 * represented as "Dg" instead of "dag" or "da gram", which is
 * congruent with the usage of the other unit abbreviations.
 *
 * @author <a href="mailto:pablo@freality.com">Pablo Mayrgundter</a>
 * @version $Revision: 1.1.1.1 $
 */

var unitByAbbrev = {};
var unitByName = {};

function Unit(symbol, abbrev, name) {
  this.symbol = symbol;
  this.abbrev = abbrev;
  this.name = name;
  unitByAbbrev[abbrev] = this;
  unitByName[name] = this;
}

Unit.prototype.toString = function() {
  return this.name;
};

Unit.lookup = function(str) {
  var unit = unitByAbbrev[str];
  if (unit)
    return unit;
  return unitByName[str];
};

Unit.LENGTH = new Unit("l", "m", "meter");
Unit.MASS = new Unit("m", "g", "gram");
Unit.TIME = new Unit("t", "s", "second");
Unit.CURRENT = new Unit("I", "A", "Ampere");
Unit.TEMPERATURE = new Unit("T", "K", "Kelvin");
Unit.LUMINOUS_INTENSITY = new Unit("L", "cd", "candela");
Unit.AMOUNT_OF_SUBSTANCE = new Unit("n", "mol", "mole");

magnitudeByAbbrev = {};
magnitudeByName = {};

function Magnitude(exponent, name, abbrev) {
  this.exponent = exponent;
  this.name = name;
  this.abbrev = abbrev;

  magnitudeByAbbrev[abbrev] = this;
  magnitudeByName[name] = this;

}

Magnitude.prototype.toString = function() {
  return this.name;
};

Magnitude.lookup = function(str) {
  var magnitude = magnitudeByAbbrev[str];
  if (magnitude)
    return magnitude;
  return magnitudeByName[str];
};

/**
 * Converts the given scalar in the given magnitude to the
 * equivalent scalar in this magnitude.
 */
Magnitude.prototype.convert = function(scalar, mag) {
  return scalar * Math.pow(10, mag.exponent - this.exponent);
};

Magnitude.YOTTA = new Magnitude(24, "yotta", "Y");
Magnitude.ZETTA = new Magnitude(21, "zetta", "Z");
Magnitude.EXA = new Magnitude(18, "exa", "E");
Magnitude.PETA = new Magnitude(15, "peta", "P");
Magnitude.TERA = new Magnitude(12, "tera", "T");
Magnitude.GIGA = new Magnitude(9, "giga", "G");
Magnitude.MEGA = new Magnitude(6, "mega", "M");
Magnitude.KILO = new Magnitude(3, "kilo", "k");
Magnitude.HECTO = new Magnitude(2, "hecto", "h");
Magnitude.DECA = new Magnitude(1, "deca", "D");
Magnitude.UNIT = new Magnitude(0, "", "");
Magnitude.DECI = new Magnitude(-1, "deci", "d");
Magnitude.CENTI = new Magnitude(-2, "centi", "c");
Magnitude.MILLI = new Magnitude(-3, "milli", "m");
Magnitude.MICRO = new Magnitude(-6, "micro", "\u03BC");
Magnitude.NANO = new Magnitude(-9, "nano", "n");
Magnitude.PICO = new Magnitude(-12, "pico", "p");
Magnitude.FEMTO = new Magnitude(-15, "femto", "f");
Magnitude.ATTO = new Magnitude(-18, "atto", "a");
Magnitude.ZETO = new Magnitude(-21, "zepto", "z");
Magnitude.YOCTO = new Magnitude(-24, "yocto", "y");

function Measure(scalar, unit, magnitude) {
  if (!scalar)
    throw "Null scalar given.";
  if (!unit)
    throw "Null unit given.";
  this.scalar = scalar;
  this.unit = unit;
  this.magnitude = magnitude || Magnitude.UNIT;

  this.convert = function(mag) {
    return new Measure(mag.convert(this.scalar, this.magnitude), this.unit, mag);
  };

  this.toUnitScalar = function() {
    return UNIT.convert(this.scalar, this.magnitude);
  };

  this.toString = function() {
    var canonical = this.convert(Magnitude.UNIT);
    var s = '';
    s += canonical.scalar;
    s += canonical.magnitude.abbrev;
    s += canonical.unit.abbrev;
    return s;
  };
}

/**
 * @throws If the string does not contain a parsable measure.
 */
Measure.parseMeasure = function(s) {
  if (!s)
    throw "Given string is null";
  //var MEASURE_PATTERN = new RegExp(/(-?\\d+(?:.\\d+)?(?:E\\d+)?)\\s*([khdnmgtpfaezy\u03BC]|(?:yotta|zetta|exa|peta|tera|giga|mega|kilo|hecto|deca|deci|centi|milli|micro|nano|pico|femto|atto|zepto|yocto))?\\s*([mgsAKLn]|(?:meter|gram|second|Ampere|Kelvin|candela|mole))/);
  var m = s.match(/(-?\d+(?:.\d+)?(?:E\d+)?)\s*([khdnmgtpfaezy\u03BC])?\s*([mgsAKLn])/);
  if (!m)
    throw "Could not parse measure from given string: " + s;

  // console.log("#groups: " + m.length);
  var scalar = m[1];
  // console.log("scalar: " + scalar);

  if (m.length == 2) {
    var unit = m[2];
    console.log("unit: " + unit);
    return new Measure(parseFloat(scalar), Unit.lookup(unit));
  }

  var magnitude = m[2];
  // console.log("magnitude: " + magnitude);

  var unit = m[3];
  // console.log("unit: " + unit);

  return new Measure(scalar == null ? 0.0 : parseFloat(scalar),
                     Unit.lookup(unit),
                     magnitude == null ? Magnitude.prototype.UNIT :
                     Magnitude.lookup(magnitude));
};
