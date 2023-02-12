import Parser from '@pablo-mayrgundter/parser.js/Parser.js'


/** */
export default class AsterismsCatalog {
  /**
   * @param {object} starsCatalog
   */
  constructor(starsCatalog) {
    this.starsCatalog = starsCatalog
    this.byName = new Map()
    this.numAsterisms = 0
  }


  /**
   * @param {Function} cb
   */
  load(cb) {
    fetch('/data/asterisms.dat').then((rsp) => {
      rsp.text().then((text) => {
        this.read(text)
        if (cb) {
          cb()
        }
      })
    })
  }


  /**
   * Many records of this form
   * "Caelum"
   * [
   *   [ "Alpha Cae" "Beta Cae" ]
   *   ...
   * ]
   *
   * @param {string} text
   * @returns {object} this
   */
  read(text) {
    const records = []
    let recordName = null
    let paths = []
    let names = []
    let nameList = []
    const Grammar = {
      Start: { // List of records
        rule: ['Record', ['Start', Parser.Terminal]],
      },
      Record: {
        rule: ['Name', 'OuterArray'],
        callback: (state, match) => {
          recordName = names.pop()
          const record = {
            name: recordName,
            paths: paths,
          }
          this.byName.set(recordName, record)
          this.numAsterisms++
          records.push(record)
          recordName = null
          paths = []
          names = []
          nameList = []
        },
      },
      Name: {
        rule: [/"([\p{L}0-9 ]+)" */u],
        callback: (state, match) => {
          const name = match[1]
          names.push(name)
        },
      },
      NameList: {
        rule: ['Name', ['NameList', Parser.Terminal]],
        callback: (state, match) => {
          nameList.unshift(names.pop())
        },
      },
      OuterArray: {
        rule: [/\s*\[\s*/, 'ListInnerArray', /\s*\]\s*/],
      },
      ListInnerArray: {
        rule: ['Path', ['ListInnerArray', Parser.Terminal]],
      },
      Path: {
        rule: [/\s*\[\s*/, 'NameList', /\s*\]\s*/],
        callback: (state, match) => {
          paths.push(nameList)
          nameList = []
        },
      },
    }
    const offset = new Parser().parse(text, Grammar, 'Start')
    if (offset !== text.length) {
      console.warn(`Cannot parse asterisms, offset(${offset}) != text.length(${text.length})`)
    }
    return this
  }
}
