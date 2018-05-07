'use strict';

function Testing() {

  this.tests = [];

  this.add = (description, fn) => {
    this.tests.push([description, fn]);
  };

  this.assertTrue = (cond, msg) => {
    if (!cond) {
      throw new Error(msg, 'Condition not true.');
    }
  };

  this.assertEquals = (expected, actual, msg) => {
    if (expected !== actual) {
      throw new Error(msg ||
        `expected(${expected}) != actual(${actual}).`);
    }
  };

  this.assertFail = (func, msg) => {
    try {
      func();
      throw new Error(msg || 'Function should throw error.');
    } catch (e) { /* expected */ }
  };

  this.run = () => {
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
    console.log(`TOTAL OK: ${ok}, FAIL: ${fail}`);
  }
};

module.exports = Testing;
