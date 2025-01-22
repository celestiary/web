import Keys from './Keys'


describe('Keys', () => {
  it('', () => {
    const keys = new Keys({addEventListener: jest.fn()})
    const cbA = jest.fn()
    const cbB = jest.fn()
    keys.map('a', cbA, 'a key')
    keys.map('B', cbB, 'B key')

    expect(cbA).not.toHaveBeenCalled()
    expect(cbB).not.toHaveBeenCalled()

    keys.onKeyDown({key: 'a'})
    expect(cbA).toHaveBeenCalledTimes(1)
    expect(cbB).toHaveBeenCalledTimes(0)

    keys.onKeyDown({key: 'b'})
    expect(cbA).toHaveBeenCalledTimes(1)
    expect(cbB).toHaveBeenCalledTimes(1)
  })
})
