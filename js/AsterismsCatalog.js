import * as THREE from 'three';
import Parser from '@pablo-mayrgundter/parser.js/Parser.js';

import StarsCatalog from './StarsCatalog.js';


export default class AsterismsCatalog {
  constructor(starsCatalog) {
    this.starsCatalog = starsCatalog;
    this.byName = {};
    this.numAsterisms = 0;
  }


  load(cb) {
    fetch('/data/asterisms.dat').then((rsp) => {
        rsp.text().then((text) => {
            this.read(text);
            if (cb)
              cb();
          });
      });
  }


  /**
   * Many records of this form
   * "Caelum"
   * [
   *   [ "Alpha Cae" "Beta Cae" ]
   *   ...
   * ]
   */
  read(text) {
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
          const record = {
            name: recordName,
            paths: paths
          };
          this.byName[recordName] = record;
          this.numAsterisms++;
          records.push(record);
          recordName = null;
          paths = [];
          names = [];
          nameList = [];
        }
      },
      'Name': {
        rule: [ /"([\p{L}0-9 ]+)" */u ],
        callback: (state, match) => {
          const name = match[1];
          names.push(name);
        }
      },
      'NameList': {
        rule: [ 'Name', [ 'NameList', Parser.Terminal ] ],
        callback: (state, match) => {
          nameList.unshift(names.pop());
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
        }
      }
    };
    const offset = new Parser().parse(text, Grammar, 'Start');
    if (offset != text.length) {
      console.warn(`Cannot parse asterisms, offset(${offset}) != text.length(${text.length})`);
    }
    return this;
  }
}
