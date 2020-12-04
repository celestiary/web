export default class Testing {
  constructor() {
    this.tests = [];
    this.asserts = 0;
  }

  add(description, fn, onlyThisOne = false) {
    if (onlyThisOne) {
      this.tests.length = 0;
    }
    this.tests.push([description, fn]);
  }

  assertTrue(cond, msg) {
    this.asserts++;
    if (!cond) {
      throw new Error(msg, 'Condition not true.');
    }
  }

  assertEquals(expected, actual, msg) {
    this.asserts++;
    if (expected !== actual) {
      throw new Error(msg ||
        `expected(${expected}) != actual(${actual}).`);
    }
  }

  assertFail(func, msg) {
    this.asserts++;
    try {
      func();
      throw new Error(msg || 'Function should throw error.');
    } catch (e) { /* expected */ }
  }

  run() {
    let ok = 0;
    let fail = 0;
    for (let i in this.tests) {
      const test = this.tests[i];
      const description = test[0];
      const fn = test[1];
      try {
        fn();
        ok++;
      } catch (e) {
        console.error(`FAIL: ${description} `, e.stack);
        fail++;
      }
    }
    console.log(`TOTAL OK: ${ok}, FAIL: ${fail}, ASSERTS: ${this.asserts}`);
  }
}
