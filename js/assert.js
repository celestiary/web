/**
 * If cond is true, do nothing.  Otherwise, throw error with msg.
 *
 * @param {boolean} cond Test condition.
 * @param {string} msg path to the button icon.
 * @throws If the condition is false.
 */
export function assert(cond, msg) {
  if (cond) {
    return
  }
  throw new Error(msg)
}


/**
 * Equivalent to calling assertDefined on each parameter.
 *
 * @param {any} args Variable length arguments to assert are defined.
 * @return {any} args That was passed in
 * @throws If any argument is not defined.
 */
export function assertDefined(...args) {
  for (const ndx in args) {
    if (Object.prototype.hasOwnProperty.call(args, ndx)) {
      const arg = args[ndx]
      assert(arg !== null && arg !== undefined, `Arg ${ndx} is not defined`)
      if (Array.isArray(arg)) {
        for (let i = 0; i < arg.length; i++) {
          assertDefined(arg[i], `Arg ${ndx} is an array with undefined index ${i}`)
        }
      }
    }
  }
  if (args.length === 1) {
    return args[0]
  }
  return args
}



/**
 * @param {any} arrays Variable length arguments to assert are defined.
 * @return {Array<Array<any>>} The arrays
 */
export function assertArraysEqualLength(...arrays) {
  if (arrays.length <= 1) {
    throw new Error('Expected multiple arrays')
  }
  const arrLength = arrays[0].length
  for (const ndx in arrays) {
    if (Object.prototype.hasOwnProperty.call(arrays, ndx)) {
      const array = arrays[ndx]
      assertDefined(array)
      assert(arrLength === array.length, `Array ${ndx} has unexpected length ${array.length} != ${arrLength}`)
    }
  }
  return arrays
}


/**
 * String must be defined and not the empty string.
 *
 * @param {string} str
 */
export function assertStringNotEmpty(str) {
  if (str === undefined || str === null || str === '') {
    throw new Error('String must be defined and not empty')
  }
}

/**
 * Checks that each named param is defined and returns the object for chaining.
 *
 * @param {any} obj Variable length arguments to assert are defined.
 * @param {Array<string>} keys That was passed in
 * @return {any} obj That object that was passed in, if valid
 * @throws If any argument is not defined.
 */
export function assertValues(obj, keys) {
  const undefinedKeys = keys.filter((key) => obj[key] === undefined)
  if (undefinedKeys.length > 0) {
    throw new Error(`The following keys are undefined: 
      ${undefinedKeys.join(', ')}`)
  }
  return obj
}


/**
 * @param {any} x
 * @returns {any}
 */
export function assertNotNullOrUndefined(x) {
  if (x === null) {
    throw new Error('Variable may not be null')
  }
  if (x === undefined) {
    throw new Error('Variable may not be undefined')
  }
  return x
}


/**
 * @param {Array.<any>} args
 */
export function assertArgs(...args) {
  for (let i = 0; i < args.length; i++) {
    if (args[i] === null || args[i] === undefined) {
      throw new Error(`Arg ${i} is null or undefined`)
    }
  }
}


/**
 * @param {number} x
 * @returns {number} x
 * @throws Error if !Number.isFinite(x)
 */
export function assertFinite(x) {
  if (!Number.isFinite(x)) {
    throw new Error('Number not finite')
  }
  return x
}


/**
 * @param {any} expected
 * @param {any} actual
 * @returns {any} The actual value
 * @throws Error if expected !== value
 */
export function assertEquals(expected, actual) {
  if (expected !== actual) {
    throw new Error(`Expected: ${expected} === actual: ${actual}`)
  }
  return actual
}
