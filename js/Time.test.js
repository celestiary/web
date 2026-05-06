import {timeToDateStr} from './Time'


// `toLocaleDateString` formats with an ICU-version-dependent separator
// between the date and the clock — "Apr 5 at 10:13" on some ICU builds,
// "Apr 5, 10:13" on others.  Both renderings are meaningfully equivalent
// for the human readers of the time HUD, so the assertions here only
// pin the year + month + day + clock components and accept either glue
// token.
const SEP = '(?:,| at)'


describe('Time', () => {
  describe('timeToDateStr', () => {
    it('handles start of unix epoch', () => {
      expect(timeToDateStr(0).toString()).toMatch(new RegExp(`^1970 Jan 1${SEP} 12:00:00 AM$`))
    })

    it('handles future', () => {
      expect(timeToDateStr(1000000000000000).toString())
          .toMatch(new RegExp(`^33,658 Sep 27${SEP} 1:46:40 AM$`))
    })

    it('handles past', () => {
      expect(timeToDateStr(-1000000000000000).toString())
          .toMatch(new RegExp(`^-29,719 Apr 5${SEP} 10:13:20 PM$`))
    })
  })
})
