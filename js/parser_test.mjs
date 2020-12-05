import Testing from './testing.mjs';
import Parser from './parser.mjs';
import {info} from './log.mjs';

const tests = new Testing();

tests.add('Simple sequence', () => {
    const out = {};
    const G = {
      'Start': {
        rule: [/abc/],
        callback: (state, match) => {
          out.name = match[0];
        }
      }
    };
    tests.assertEquals(-1, new Parser().parse('', G, 'Start'));
    tests.assertEquals(-1, new Parser().parse('a', G, 'Start'));
    tests.assertEquals(-1, new Parser().parse('b', G, 'Start'));
    tests.assertEquals(-1, new Parser().parse('c', G, 'Start'));
    tests.assertEquals(-1, new Parser().parse('ab', G, 'Start'));
    tests.assertEquals(-1, new Parser().parse('bc', G, 'Start'));
    tests.assertEquals(3, new Parser().parse('abc', G, 'Start'));
    tests.assertEquals('abc', out.name);
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
    const out = { levels: 0 };
    const G = {
      'Start': {
        rule: [/\(/, ['Start', 'String'], /\)/],
        callback: (state, match) => {
          out.levels++;
        }
      },
      'String': {
        rule: /[a-z]*/,
        callback: (state, match) => {
          out.inner = match[0];
        }
      }
    };
    tests.assertEquals(-1, new Parser().parse('', G, 'Start'));
    tests.assertEquals(-1, new Parser().parse('(', G, 'Start'));
    tests.assertEquals(-1, new Parser().parse('((', G, 'Start'));
    tests.assertEquals(-1, new Parser().parse(')', G, 'Start'));
    tests.assertEquals(-1, new Parser().parse('))', G, 'Start'));
    tests.assertEquals(-1, new Parser().parse(')(', G, 'Start'));
    tests.assertEquals(-1, new Parser().parse(')((', G, 'Start'));

    out.levels = 0;
    tests.assertEquals(2, new Parser().parse('()', G, 'Start'));
    tests.assertEquals(1, out.levels);

    out.levels = 0;
    tests.assertEquals(4, new Parser().parse('(())', G, 'Start'));
    tests.assertEquals(2, out.levels);

    out.levels = 0;
    tests.assertEquals(6, new Parser().parse('((()))', G, 'Start'));
    tests.assertEquals(3, out.levels);

    out.levels = 0;
    out.inner = '';
    tests.assertEquals(5, new Parser().parse('(abc)', G, 'Start'));
    tests.assertEquals(1, out.levels);
    tests.assertEquals('abc', out.inner);

    out.levels = 0;
    out.inner = '';
    tests.assertEquals(7, new Parser().parse('((abc))', G, 'Start'));
    tests.assertEquals(2, out.levels);
    tests.assertEquals('abc', out.inner);
  });


tests.add('Lists', () => {
    const out = [];
    const G = {
      'Start': { // List of name
        rule: [ 'Name', [ 'Start', Parser.Terminal ] ]
      },
      'Name': {
        rule: [ /\s*\"([A-Za-z0-9 ]+)\"\s*/ ],
        callback: (state, match) => {
          out.push(match[1]);
        }
      }
    };

    const parser = new Parser();
    tests.assertEquals(5, parser.parse('"Foo"', G, 'Start'));
    tests.assertEquals("Foo", out[0]);

    out.length = 0;
    tests.assertEquals(11, parser.parse('"Foo" "Bar"', G, 'Start'));
    tests.assertEquals("Foo", out[0]);
    tests.assertEquals("Bar", out[1]);

    out.length = 0;
    tests.assertEquals(-1, parser.parse('"Foo" "Bar")', G, 'Start'));
    tests.assertEquals("Foo", out[0]);
    tests.assertEquals("Bar", out[1]);

    out.length = 0;
    tests.assertEquals(17, parser.parse('"Foo" "Bar" "Baz"', G, 'Start'));
    tests.assertEquals("Foo", out[0]);
    tests.assertEquals("Bar", out[1]);
    tests.assertEquals("Baz", out[2]);

    out.length = 0;
    tests.assertEquals(-1, parser.parse('"Foo" "Bar" "Baz', G, 'Start'));
    tests.assertEquals("Foo", out[0]);
    tests.assertEquals("Bar", out[1]);
  });


tests.add('Array of strings', () => {
    let names = [];
    let nameList = [];
    let array = null;
    const Grammar = {
      'Start': {
        rule: [ /\s*\[\s*/ , 'NameList', /\s*\]\s*/ ],
        callback: (state, match) => {
          array = nameList;
        }
      },
      'Name': {
        rule: [ /\"([A-Za-z0-9 ]+)\"\s*/ ],
        callback: (state, match) => {
          names.push(match[1]);
        }
      },
      'NameList': {
        rule: [ 'Name', [ 'NameList', Parser.Terminal ] ],
        callback: (state, match) => {
          nameList.unshift(names.pop());
        }
      },
    };
    const parser = new Parser();
    let str;

    str = '[ "abc" ]';
    tests.assertEquals(str.length, parser.parse(str, Grammar, 'Start'));
    tests.assertEquals(1, array.length);
    tests.assertEquals('abc', nameList[0]);

    names.length = nameList.length = 0;
    str = '[ "abc" "def" ]';
    tests.assertEquals(str.length, parser.parse(str, Grammar, 'Start'));
    tests.assertEquals(2, array.length);
    tests.assertEquals('abc', nameList[0]);
    tests.assertEquals('def', nameList[1]);

    names.length = nameList.length = 0;
    str = '[ "abc" "def" "hij" ]';
    tests.assertEquals(str.length, parser.parse(str, Grammar, 'Start'));
    tests.assertEquals(3, array.length);
    tests.assertEquals('abc', nameList[0]);
    tests.assertEquals('def', nameList[1]);
    tests.assertEquals('hij', nameList[2]);

    names.length = nameList.length = 0;
    str = '[ "Beta Aps" "Gamma Aps" "Delta1 Aps" "Alpha Aps" ]';
    tests.assertEquals(str.length, parser.parse(str, Grammar, 'Start'));
    tests.assertEquals(4, array.length);
    tests.assertEquals('Beta Aps', nameList[0]);
    tests.assertEquals('Gamma Aps', nameList[1]);
    tests.assertEquals('Delta1 Aps', nameList[2]);
    tests.assertEquals('Alpha Aps', nameList[3]);
  });


tests.add('Array of array of strings', () => {
    let names = [];
    let nameList = [];
    let innerArrays = [];
    const Grammar = {
      'Start': { // Outer array
        rule: [ /\s*\[\s*/ , 'ListInnerArray' , /\s*\]\s*/ ],
      },
      'Name': {
        rule: [ /\"([A-Za-z0-9 ]+)\"\s*/ ],
        callback: (state, match) => {
          names.push(match[1]);
        }
      },
      'NameList': {
        rule: [ 'Name', [ 'NameList', Parser.Terminal ]],
        callback: (state, match) => {
          nameList.unshift(names.pop());
        }
      },
      'ListInnerArray': {
        rule: [ 'InnerArray', [ 'ListInnerArray', Parser.Terminal ] ]
      },
      'InnerArray': {
        rule: [ /\s*\[\s*/ , 'NameList', /\s*\]\s*/ ],
        callback: (state, match) => {
          innerArrays.push(nameList);
          nameList = [];
        }
      },
    };
    const parser = new Parser();
    let str;

    str = '[[ "aa" ]]';
    tests.assertEquals(str.length, parser.parse(str, Grammar, 'Start'));
    tests.assertEquals(1, innerArrays.length);

    names.length = nameList.length = innerArrays.length = 0;
    str = '[[ "aa" ][ "bb" "cc" ]]';
    tests.assertEquals(str.length, parser.parse(str, Grammar, 'Start'));
    tests.assertEquals(2, innerArrays.length);
    tests.assertEquals('aa', innerArrays[0][0]);
    tests.assertEquals('bb', innerArrays[1][0]);
    tests.assertEquals('cc', innerArrays[1][1]);
  });


tests.add('Celestia parse', () => {
    let records = [];
    let recordName = null;
    let paths = [];
    let path = [];
    let names = [];
    let nameList = [];
    const Grammar = {
      'Start': { // List of records
        rule: [ 'Record', [ 'Start', Parser.Terminal ] ]
      },
      'Record': {
        rule: [ 'Name', 'OuterArray' ],
        callback: (state, match) => {
          recordName = names.pop();
          records.push({
              name: recordName,
              paths: paths
            });
          recordName = null;
          paths = [];
          names = [];
          nameList = [];
        }
      },
      'Name': {
        rule: [ /\"([A-Za-z0-9 ]+)\"\s*/ ],
        callback: (state, match) => {
          names.push(match[1]);
        }
      },
      'NameList': {
        rule: [ 'Name', [ 'NameList', Parser.Terminal ] ],
        callback: (state, match) => {
          nameList.unshift(names.pop());
          console.log('nameList after: ', nameList);
        }
      },
      'OuterArray': {
        rule: [ /\s*\[\s*/ , 'ListInnerArray' , /\s*\]\s*/ ],
      },
      'ListInnerArray': {
        rule: [ 'Path', [ 'ListInnerArray', Parser.Terminal ] ],
      },
      'Path': {
        rule: [ /\s*\[\s*/ , 'NameList', /\s*\]\s*/ ],
        callback: (state, match) => {
          paths.push(nameList);
          nameList = [];
          console.log('paths after: ', paths);
        }
      }
    };
    const parser = new Parser();
    let recordStr, record;
    recordStr = `"R1" [ [ "a" ] ]`;
    tests.assertEquals(recordStr.length, parser.parse(recordStr, Grammar, 'Start'));
    tests.assertEquals(1, records.length);
    record = records[0];
    tests.assertEquals('R1', record.name);
    tests.assertEquals(1, record.paths.length);

    paths.length = 0; names.length = nameList.length = paths.length = records.length = 0;
    recordStr = `"R2" [ [ "aa" ] [ "bb" "cc" ] ]`;
    tests.assertEquals(recordStr.length, parser.parse(recordStr, Grammar, 'Start'));
    tests.assertEquals(1, records.length);
    record = records[0];
    tests.assertEquals('R2', record.name);
    tests.assertEquals(2, record.paths.length);
    tests.assertEquals('aa', record.paths[0][0]);
    tests.assertEquals('bb', record.paths[1][0]);
    tests.assertEquals('cc', record.paths[1][1]);

    paths.length = 0; names.length = nameList.length = paths.length = records.length = 0;
    recordStr = `"R1" [ [ "aa" ] [ "bb" "cc" ] ] "R2" [ [ "1" ] [ "2" "3" ] [ "4"] ]`;
    tests.assertEquals(recordStr.length, parser.parse(recordStr, Grammar, 'Start'));
    tests.assertEquals(2, records.length);
    record = records[0];
    tests.assertEquals('R1', record.name);
    tests.assertEquals(2, record.paths.length);
    tests.assertEquals('aa', record.paths[0][0]);
    tests.assertEquals('bb', record.paths[1][0]);
    tests.assertEquals('cc', record.paths[1][1]);

    record = records[1];
    tests.assertEquals('R2', record.name);
    tests.assertEquals(3, record.paths.length);
    tests.assertEquals('1', record.paths[0][0]);
    tests.assertEquals('2', record.paths[1][0]);
    tests.assertEquals('3', record.paths[1][1]);
    tests.assertEquals('4', record.paths[2][0]);

    paths.length = 0; names.length = nameList.length = paths.length = records.length = 0;
    recordStr = `"R1" [ [ "aa" ] [ "bb" "cc" ] ] "R2" [ [ "1" ] [ "2" "3" ] [ "4"] ] "R3" [[ "foo" ]]`;
    tests.assertEquals(recordStr.length, parser.parse(recordStr, Grammar, 'Start'));
    tests.assertEquals(3, records.length);
    record = records[0];
    tests.assertEquals('R1', record.name);
    tests.assertEquals(2, record.paths.length);
    tests.assertEquals('aa', record.paths[0][0]);
    tests.assertEquals('bb', record.paths[1][0]);
    tests.assertEquals('cc', record.paths[1][1]);

    record = records[1];
    tests.assertEquals('R2', record.name);
    tests.assertEquals(3, record.paths.length);
    tests.assertEquals('1', record.paths[0][0]);
    tests.assertEquals('2', record.paths[1][0]);
    tests.assertEquals('3', record.paths[1][1]);
    tests.assertEquals('4', record.paths[2][0]);

    record = records[2];
    tests.assertEquals('R3', record.name);
    tests.assertEquals(1, record.paths.length);
    tests.assertEquals('foo', record.paths[0][0]);
  });

tests.run();
