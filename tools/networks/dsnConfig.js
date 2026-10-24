// DSN Now's configuration (https://eyes.nasa.gov/dsn/config.xml) to the
// app's public/data/networks/dsn.json (js/scene/networks/Networks.md, the
// DSN): the complexes, their dishes, and the spacecraft's friendly names.
// Pure, for fetch.mjs and its test.


const TAG = /<(site|dish|spacecraft)\b([^>]*?)\/?>/g
const ATTR = /([A-Za-z_][\w-]*)="([^"]*)"/g


/**
 * @param {string} s
 * @returns {object}
 */
function attrs(s) {
  return Object.fromEntries([...s.matchAll(ATTR)].map(([, k, v]) => [k, v.replace(/&amp;/g, '&')]))
}


/**
 * @param {string} xml config.xml
 * @param {object} meta source, url, fetched
 * @returns {object} dsn.json: `sites` [{name, friendlyName, lat, lng,
 *   dishes: [{name, friendlyName, type}]}], `spacecraft` {code: name}
 */
export function dsnConfig(xml, meta) {
  const sites = []
  const spacecraft = {}
  let site = null
  for (const [, tag, body] of xml.matchAll(TAG)) {
    const a = attrs(body)
    if (tag === 'site') {
      site = {name: a.name, friendlyName: a.friendlyName, lat: Number(a.latitude), lng: Number(a.longitude), dishes: []}
      sites.push(site)
    } else if (tag === 'dish' && site) {
      site.dishes.push({name: a.name, friendlyName: a.friendlyName, type: a.type})
    } else if (tag === 'spacecraft' && a.name) {
      spacecraft[a.name.toLowerCase()] = a.friendlyName || a.name
    }
  }
  return {...meta, sites, spacecraft}
}
