import {timeToDateStr} from './Time'


describe('Time', () => {
  describe('timeToDateStr', () => {
    it('handles start of unix epoch', () => {
      expect(timeToDateStr(0).toString()).toEqual('1970 Jan 1 at 12:00:00 AM')
    })

    it('handles future', () => {
      expect(timeToDateStr(1000000000000000).toString()).toEqual('33,658 Sep 27 at 1:46:40 AM')
    })

    it('handles past', () => {
      expect(timeToDateStr(-1000000000000000).toString()).toEqual('-29,719 Apr 5 at 10:13:20 PM')
    })
  })
})

