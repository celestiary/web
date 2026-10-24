import {describe, expect, it} from 'bun:test'
import {dsnConfig} from './dsnConfig.js'


const XML = `<?xml version="1.0" encoding="UTF-8"?>
<config>
  <sites>
    <site name="mdscc" friendlyName="Madrid" longitude="-4.2480085" latitude="40.2413554">
      <dish name="DSS63" friendlyName="DSS 63" type="70M"></dish>
    </site>
    <site name="cdscc" friendlyName="Canberra" longitude="148.9812673" latitude="-35.2209189">
      <dish name="DSS43" friendlyName="DSS 43" type="70M"></dish>
      <dish name="DSS34" friendlyName="DSS 34" type="34M"></dish>
    </site>
  </sites>
  <spacecraftMap>
    <spacecraft name="vgr1" explorerName="sc_voyager_1" friendlyName="Voyager 1" thumbnail="true"></spacecraft>
    <spacecraft name="M01O" explorerName="" friendlyName="Mars Odyssey &amp; friends"></spacecraft>
  </spacecraftMap>
</config>`


describe('DSN Now config', () => {
  it('keeps the complexes, their dishes and the spacecraft\'s names', () => {
    const out = dsnConfig(XML, {source: 's', fetched: 'f'})
    expect(out.source).toBe('s')
    expect(out.sites).toEqual([
      {name: 'mdscc', friendlyName: 'Madrid', lat: 40.2413554, lng: -4.2480085, dishes: [{name: 'DSS63', friendlyName: 'DSS 63', type: '70M'}]},
      {name: 'cdscc', friendlyName: 'Canberra', lat: -35.2209189, lng: 148.9812673, dishes: [
        {name: 'DSS43', friendlyName: 'DSS 43', type: '70M'}, {name: 'DSS34', friendlyName: 'DSS 34', type: '34M'},
      ]},
    ])
    expect(out.spacecraft).toEqual({'vgr1': 'Voyager 1', 'm01o': 'Mars Odyssey & friends'})
  })
})
