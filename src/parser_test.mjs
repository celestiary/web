import Testing from './testing.mjs';
import Parser from './parser.mjs';

const tests = new Testing();

// Magnitude
tests.add('Grammar parse', () => {
  let numRecords = 0;
  const Grammar = {
    rules: {
      0: {
        rule: [ 1, 2 ],
        callback: (state, termIndex, choiceIndex) => {
          console.log(`Named record! choiceIndex(${choiceIndex}), numRecords(${numRecords})`);
          numRecords++;
          if (++numRecords > 10) {
            throw new Error('too many!');
          }
        }
      },
      1: { // Repeatedly match quoted names, e.g. "Alpha Cae" "Beta Cae"
        rule: [ /\"([A-Za-z0-9 ]+)\"\s*/g ],
        callback: (state, termIndex, match) => {
          console.log(`Name encountered: match(${match})`);
        }
      },
      2: { // Array record, peels off the outside brackets.
      }
    }
  };
  const parser = new Parser();
  tests.assertEquals(5, parser.parse('"Foo"', Grammar, 0));
  tests.assertEquals(11, parser.parse('"Foo" "Bar"', Grammar, 0));
  tests.assertEquals(11, parser.parse('"Foo" "Bar")', Grammar, 0));
  tests.assertEquals(-1, parser.parse('asdf', Grammar, 0));
});

tests.run();
