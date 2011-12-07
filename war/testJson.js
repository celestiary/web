var starsObj = {
  type: "stars",
  name: "stars",
  parent: "milkyway",
  count: 1000,
  radius: 6.9424800E7
}

var sunObj = {
  type: 'star',
  name: 'sun',
  parent: 'milky way',
  apparentMagnitude: -26.8,
  colorIndex: 1.0,
  mass: 1.9891E30,
  density: 1.41,
  radius: 6.955E5, // actual: E8
  siderealRotationPeriod: 2160000.0,
  axialInclination: 1.0,
  system: [ 'earth' ]
}

var earthObj = {
  type: 'planet',
  name: 'earth',
  parent: 'sun',
  apparentMagnitude: -3.86,
  colorIndex: 0.63369966,
  mass: '59.736Mg',
  density: 5.515,
  radius: 6.3710E6, // actual: E6
  siderealRotationPeriod: 86163.084,
  axialInclination: 23.45,
  albedo: 0.367,
  equatorialGravity: 9.780327,
  escapeVelocity: 11.186,
  orbit: {
    eccentricity: 0.01671022,
    inclination: 5.0E-5,
    longitudeOfAscendingNode: -11.26064,
    longitudeOfPerihelion: 102.94719,
    meanLongitude: 100.46435,
    semiMajorAxis: 1.49598261E11, // actual: E11
    siderealOrbitPeriod: 31536000
  },
  system: [ 'moon' ],
  texture_atmosphere: true,
  texture_hydrosphere: true,
  texture_terrain: true
}

var moonObj = {
  type: 'planet',
  name: 'moon',
  parent: 'earth',
  apparentMagnitude: -12.74,
  colorIndex: 0.63369966,
  mass: 0.7347,
  density: 3.344,
  radius: 1.73710E6, // actual: E6
  siderealRotationPeriod: 31449525.66,
  axialInclination: 5.0,
  albedo: 0.12,
  equatorialGravity: 1.622,
  escapeVelocity: 2.38,
  orbit:{
    eccentricity: 0.0554,
    inclination: 5.14,
    longitudeOfAscendingNode: 125.08,
    longitudeOfPerihelion: 0.0,
    meanLongitude: 0.0,
    semiMajorAxis: 3.84748E8, // actual: E8
    siderealOrbitPeriod: 2548108.8
  }
}
