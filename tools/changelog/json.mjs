#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {changelogJson, parseChangelog} from './parse.mjs'
import {postedSocial} from '../posts/social.mjs'


/**
 * Writes public/data/changelog.json from CHANGELOG.md, for the app
 * (tools/changelog/README.md), and js/changelogStamp.json, the entries'
 * dates alone, which the app's bundle carries for What's new's "N new"
 * marker, so the changelog itself is fetched only when What's new opens
 * (#258).  The JSON also carries the links to each entry's live social posts,
 * from posts/drafts.md (tools/posts/social.mjs), so they're recorded in one
 * place; the stamp also has the featured entries' dates, which the "N new"
 * marker counts.  Both are committed, like the repo's other built data, and
 * a test fails when either has drifted from the Markdown and the drafts.
 *
 *   yarn changelog           writes them
 *   yarn changelog --check   exits 1 if either isn't what the Markdown says
 */

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(HERE, '..', '..')
export const CHANGELOG = path.join(ROOT, 'CHANGELOG.md')
export const OUTPUT = path.join(ROOT, 'public', 'data', 'changelog.json')
export const STAMP = path.join(ROOT, 'js', 'changelogStamp.json')
export const DRAFTS = path.join(ROOT, 'posts', 'drafts.md')


/**
 * @param {string} markdown CHANGELOG.md's text
 * @param {string} [drafts] posts/drafts.md's text: the live posts' URLs
 * @returns {string} The JSON file's text
 */
export function renderJson(markdown, drafts = '') {
  return `${JSON.stringify(changelogJson(markdown, postedSocial(drafts)), null, 2)}\n`
}


/**
 * @param {string} markdown CHANGELOG.md's text
 * @returns {string} The stamp's text: `{"dates": [[date, entries that day], ...], "featured": [...]}`, newest
 *   first, `featured` counting only the featured entries
 */
export function renderStamp(markdown) {
  const {entries} = parseChangelog(markdown)
  const count = (list) => {
    const counts = new Map()
    for (const {date} of list) {
      counts.set(date, (counts.get(date) ?? 0) + 1)
    }
    return [...counts].sort((a, b) => (a[0] < b[0] ? 1 : a[0] > b[0] ? -1 : 0))
  }
  return `${JSON.stringify({dates: count(entries), featured: count(entries.filter((e) => e.featured))})}\n`
}


if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const markdown = fs.readFileSync(CHANGELOG, 'utf8')
  const drafts = fs.existsSync(DRAFTS) ? fs.readFileSync(DRAFTS, 'utf8') : ''
  const outputs = [[OUTPUT, renderJson(markdown, drafts)], [STAMP, renderStamp(markdown)]]
  if (process.argv.includes('--check')) {
    for (const [file, text] of outputs) {
      const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''
      if (current !== text) {
        console.error(`${path.relative(ROOT, file)} is out of date with CHANGELOG.md and posts/drafts.md: run \`yarn changelog\`.`)
        process.exit(1)
      }
    }
    console.log('changelog.json and changelogStamp.json are current.')
  } else {
    for (const [file, text] of outputs) {
      fs.writeFileSync(file, text)
    }
    console.log(`Wrote ${path.relative(ROOT, OUTPUT)} (${JSON.parse(outputs[0][1]).entries.length} entries) ` +
      `and ${path.relative(ROOT, STAMP)}.`)
  }
}
