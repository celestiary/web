/**
 * Write the redirect stub served at celestiary.org/web/ (esbuild/site.js
 * webStubFiles) into a directory, for gh-pages.yml to deploy.  It needs no
 * dependencies, so the deploy skips the install and the app's build.
 *
 *   node esbuild/webStub.js OUT_DIR
 */
import fs from 'node:fs'
import path from 'node:path'
import {webStubFiles} from './site.js'


const outDir = process.argv[2]
if (!outDir) {
  console.error('usage: node esbuild/webStub.js OUT_DIR')
  process.exit(2)
}
const template = fs.readFileSync(new URL('../public/404.html', import.meta.url), 'utf8')
fs.mkdirSync(outDir, {recursive: true})
for (const [name, content] of Object.entries(webStubFiles(template))) {
  fs.writeFileSync(path.join(outDir, name), content)
}
console.log(`Wrote the /web/ redirect stub to ${outDir}`)
