#!/usr/bin/env node
import {execFileSync, spawnSync} from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'


/**
 * Generate a localhost + LAN-IP TLS certificate for the dev server using
 * mkcert, and write it to `dev-certs/{cert,key}.pem`.
 *
 * Usage:
 *   yarn cert:dev
 *
 * Prerequisites:
 *   - mkcert installed and `mkcert -install` run once on this machine
 *     (`brew install mkcert nss && mkcert -install`).
 *
 * For Android phone testing on the LAN, the laptop's mkcert root CA must
 * also be installed on the phone:
 *   1. Find it:    mkcert -CAROOT
 *   2. Copy `rootCA.pem` to the phone (Drive / email / `python3 -m
 *      http.server` from CAROOT).
 *   3. On phone:   Settings -> Security -> Encryption & credentials ->
 *                  Install a certificate -> CA certificate.
 *
 * Without the root CA on the phone, Chrome treats the connection as
 * insecure even after click-through, and DeviceOrientationEvent stays
 * disabled.
 */

const OUT_DIR = 'dev-certs'
const KEY_PATH = path.join(OUT_DIR, 'key.pem')
const CERT_PATH = path.join(OUT_DIR, 'cert.pem')


if (spawnSync('mkcert', ['-help'], {stdio: 'ignore'}).status !== 0) {
  console.error('mkcert not found.  Install it first:')
  console.error('  macOS:  brew install mkcert nss && mkcert -install')
  console.error('  Linux:  see https://github.com/FiloSottile/mkcert#installation')
  process.exit(1)
}

fs.mkdirSync(OUT_DIR, {recursive: true})

const hosts = ['localhost', '127.0.0.1', '::1', ...lanIPv4s()]
console.log(`Issuing dev cert for: ${hosts.join(', ')}`)

execFileSync('mkcert', ['-key-file', KEY_PATH, '-cert-file', CERT_PATH, ...hosts], {stdio: 'inherit'})

const caRoot = execFileSync('mkcert', ['-CAROOT'], {encoding: 'utf8'}).trim()
console.log('')
console.log(`Cert written to ${CERT_PATH}`)
console.log(`Key  written to ${KEY_PATH}`)
console.log('')
console.log('Run `yarn serve:https` to use it.')
console.log('')
console.log('For Android phone testing, install the mkcert root CA on the phone:')
console.log(`  Source:  ${path.join(caRoot, 'rootCA.pem')}`)
console.log('  Phone:   Settings -> Security -> Encryption & credentials -> Install a certificate -> CA certificate')


/**
 * @return {string[]} Non-internal IPv4 addresses on this machine
 */
function lanIPv4s() {
  const out = []
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const iface of ifaces ?? []) {
      if (iface.family === 'IPv4' && !iface.internal) {
        out.push(iface.address)
      }
    }
  }
  return out
}
