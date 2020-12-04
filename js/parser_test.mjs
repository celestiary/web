import Testing from './testing.mjs';
import Parser from './parser.mjs';
import {info} from './log.mjs';

const tests = new Testing();

tests.add('Simple sequence', () => {
    const G = {
      'Start': {
        rule: [/abc/]
      }
    };
    tests.assertEquals(-1, new Parser().parse('', G, 'Start'));
    tests.assertEquals(-1, new Parser().parse('a', G, 'Start'));
    tests.assertEquals(-1, new Parser().parse('b', G, 'Start'));
    tests.assertEquals(-1, new Parser().parse('c', G, 'Start'));
    tests.assertEquals(-1, new Parser().parse('ab', G, 'Start'));
    tests.assertEquals(-1, new Parser().parse('bc', G, 'Start'));
    tests.assertEquals(3, new Parser().parse('abc', G, 'Start'));
    tests.assertEquals(-1, new Parser().parse('cba', G, 'Start'));
    tests.assertEquals(-1, new Parser().parse('cab', G, 'Start'));
    tests.assertEquals(-1, new Parser().parse('bac', G, 'Start'));
    tests.assertEquals(-1, new Parser().parse('bca', G, 'Start'));
    tests.assertEquals(-1, new Parser().parse('abcd', G, 'Start'));
    tests.assertEquals(-1, new Parser().parse('0abc', G, 'Start'));
  });

tests.add('Multiple sequences', () => {
    const G = {
      'Start': {
        rule: [/(abc)+/, /(def)+/]
      }
    };
    tests.assertEquals(6, new Parser().parse('abcdef', G, 'Start'));
    tests.assertEquals(9, new Parser().parse('abcabcdef', G, 'Start'));
    tests.assertEquals(9, new Parser().parse('abcdefdef', G, 'Start'));
    tests.assertEquals(12, new Parser().parse('abcabcdefdef', G, 'Start'));
  });

tests.add('Chained states', () => {
    const G = {
      'Start': {
        rule: [/(abc)+/, 'Def']
      },
      'Def': {
        rule: [/(def)+/, 'Hij']
      },
      'Hij': {
        rule: [/(hij)*/]
      }
    };
    tests.assertEquals(6, new Parser().parse('abcdef', G, 'Start'));
    tests.assertEquals(9, new Parser().parse('abcdefhij', G, 'Start'));
    tests.assertEquals(12, new Parser().parse('abcabcdefdef', G, 'Start'));
    tests.assertEquals(15, new Parser().parse('abcabcdefdefhij', G, 'Start'));
  });

tests.add('Choice', () => {
    const G = {
      'Start': {
        rule: [/(abc)+/, ['AA', 'BB'], /(def)+/]
      },
      'AA': {
        rule: [/AA/]
      },
      'BB': {
        rule: [/BB/]
      }
    };
    tests.assertEquals(8, new Parser().parse('abcAAdef', G, 'Start'));
    tests.assertEquals(8, new Parser().parse('abcBBdef', G, 'Start'));
  });

tests.add('Recursion', () => {
    const G = {
      'Start': {
        rule: [/\(/, ['Start', 'String'], /\)/],
      },
      'String': {
        rule: /[a-z]*/
      }
    };
    tests.assertEquals(-1, new Parser().parse('', G, 'Start'));
    tests.assertEquals(-1, new Parser().parse('(', G, 'Start'));
    tests.assertEquals(-1, new Parser().parse('((', G, 'Start'));
    tests.assertEquals(-1, new Parser().parse(')', G, 'Start'));
    tests.assertEquals(-1, new Parser().parse('))', G, 'Start'));
    tests.assertEquals(-1, new Parser().parse(')(', G, 'Start'));
    tests.assertEquals(-1, new Parser().parse(')((', G, 'Start'));
    tests.assertEquals(2, new Parser().parse('()', G, 'Start'));
    tests.assertEquals(4, new Parser().parse('(())', G, 'Start'));
    tests.assertEquals(6, new Parser().parse('((()))', G, 'Start'));
    tests.assertEquals(8, new Parser().parse('(((())))', G, 'Start'));
    tests.assertEquals(10, new Parser().parse('((((()))))', G, 'Start'));
    tests.assertEquals(12, new Parser().parse('(((((())))))', G, 'Start'));
    tests.assertEquals(5, new Parser().parse('(abc)', G, 'Start'));
    tests.assertEquals(7, new Parser().parse('((abc))', G, 'Start'));
  });

tests.add('Lists', () => {
  let numRecords = 0;
  const G = {
    'Start': { // List of name
      rule: [ 'Name', [ 'Start', Parser.Terminal ] ]
    },
    'Name': {
      rule: [ /\s*\"([A-Za-z0-9 ]+)\"\s*/ ],
    }
  };
  const parser = new Parser();
  tests.assertEquals(5, parser.parse('"Foo"', G, 'Start'));
  tests.assertEquals(11, parser.parse('"Foo" "Bar"', G, 'Start'));
  tests.assertEquals(-1, parser.parse('"Foo" "Bar")', G, 'Start'));
  tests.assertEquals(17, parser.parse('"Foo" "Bar" "Baz"', G, 'Start'));
  tests.assertEquals(-1, parser.parse('"Foo" "Bar" "Baz', G, 'Start'));
  });

tests.add('Celestia parse', () => {
  let numRecords = 0;
  // "Caelum"
  // [
  //   [ "Aa Bb" "Cc" "Dd" ]
  //   [ "1a 2b" "3c" "4d" ]
  // ]
  const Grammar = {
    'Start': { // List of records
      rule: [ 'Record', [ 'Start', Parser.Terminal ] ]
    },
    'Record': {
      rule: [ 'Name', 'OuterArray' ],
    },
    'Name': {
      rule: [ /\"([A-Za-z0-9 ]+)\"\s*/ ],
    },
    'NameList': {
      rule: [ 'Name', [ 'NameList', Parser.Terminal ] ]
    },
    'OuterArray': {
      rule: [ /\s*\[\s*/ , 'ListInnerArray' , /\s*\]\s*/ ],
    },
    'ListInnerArray': {
      rule: [ 'InnerArray', [ 'ListInnerArray', Parser.Terminal ] ]
    },
    'InnerArray': {
      rule: [ /\s*\[\s*/ , 'NameList', /\s*\]\s*/ ],
    }
  };
  const parser = new Parser();
  const record1 = '"ABC" [ [ "abc" "def" ] ]';
  tests.assertEquals(record1.length, parser.parse(record1, Grammar, 'Start'));
  const record2 =
`"Caelum"
  [
    [ "Aa Bb" "Cc" "Dd" ]
    [ "1a 2b" "3c" "4d" ]
  ]
 `;
  tests.assertEquals(record2.length, parser.parse(record2, Grammar, 'Start'));
  const record3 = record2 + record2;
  tests.assertEquals(record3.length, parser.parse(record3, Grammar, 'Start'));
});

tests.run();
