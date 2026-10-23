#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {CAMPAIGN, NEW_ENTRIES_SINCE} from './campaign.mjs'
import {SITE, entryLink, makePost, plainPosts} from './draft.mjs'
import {field, lengths, mergeDrafts, parseDrafts, postId, textFor} from './file.mjs'
import {socialProblems} from './social.mjs'
import {PLATFORMS, lint} from './text.mjs'


/**
 * Draft social posts from CHANGELOG.md's entries into posts/drafts.md, for
 * the maintainer to review, edit and publish by hand.  Nothing is posted
 * (tools/posts/README.md).
 *
 *   yarn posts                       add the posts the file doesn't have; report
 *   yarn posts --check               change nothing; exit 1 on a post over a limit or a tone problem
 *   yarn posts --renders             print the commands that render the images that are missing
 *   yarn posts --since 2026-11-01    plain posts for featured entries dated after this (default: all)
 *   yarn posts --file other.md       a different drafts file
 */

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(HERE, '..', '..')
export const DRAFTS = path.join(ROOT, 'posts', 'drafts.md')
export const CHANGELOG_JSON = path.join(ROOT, 'public', 'data', 'changelog.json')
// Statuses a post can be in without anyone needing to check it.
const DONE = new Set(['posted', 'skip'])


/**
 * @param {Array<object>} entries Changelog entries (public/data/changelog.json's)
 * @param {Array<object>} campaign campaign.mjs's sections
 * @returns {Array<{title: string, intro: string, posts: Array<object>}>} The campaign's posts, made
 */
export function buildCampaign(entries, campaign) {
  const byId = new Map(entries.map((e) => [e.id, e]))
  const get = (id, what) => {
    if (!byId.has(id)) {
      throw new Error(`${what}: no changelog entry ${id}`)
    }
    return byId.get(id)
  }
  return campaign.map(({title, intro, posts}) => ({
    title,
    intro,
    posts: posts.map((p) => {
      const entry = get(p.entry, p.id)
      const source = p.linkFrom ? get(p.linkFrom, p.id) : entry
      const link = entryLink(source)
      return makePost({
        id: p.id, title: p.title, entry, date: p.date, image: p.image, alt: p.alt, notes: p.notes,
        permalink: source.permalink, text: `${p.text}\n\n${link}`,
        overrides: p.facebook ? {facebook: `${p.facebook}\n\n${link}`} : {},
      })
    }),
  }))
}


/**
 * @param {Array<{posts: Array<object>}>} sections
 * @returns {string} The latest date any post is given, or ''
 */
function lastDate(sections) {
  return sections.flatMap((s) => s.posts).map((p) => field(p, 'Date')).filter(Boolean).sort().pop() ?? ''
}


/**
 * What is wrong in a drafts file, and what is left to do.
 *
 * @param {string} markdown The drafts file
 * @param {string} root The repo's root, which an image's path is relative to
 * @returns {{problems: Array<string>, warnings: Array<string>, renders: Array<{id: string, image: string, command: string}>, posts: number, open: number}}
 */
export function review(markdown, root = ROOT) {
  const {sections} = parseDrafts(markdown)
  const problems = socialProblems(markdown)
  const warnings = []
  const renders = []
  let posts = 0
  let open = 0
  const ids = new Set()
  for (const s of sections) {
    for (const p of s.posts) {
      posts++
      const id = postId(p)
      if (ids.has(id)) {
        problems.push(`${id}: the id is used twice`)
      }
      ids.add(id)
      const status = field(p, 'Status')
      if (!['draft', 'scheduled', 'posted', 'skip'].includes(status)) {
        problems.push(`${id}: status "${status}" is not draft, scheduled, posted or skip`)
      }
      if (field(p, 'Date') !== '' && !/^\d{4}-\d{2}-\d{2}$/.test(field(p, 'Date'))) {
        problems.push(`${id}: date "${field(p, 'Date')}" is not YYYY-MM-DD`)
      }
      if (DONE.has(status)) {
        continue
      }
      open++
      const all = lengths(p)
      for (const {key, name, limit} of Object.values(PLATFORMS)) {
        if (all[key].over) {
          problems.push(`${id}: ${all[key].count} on ${name}, over its ${limit}`)
        }
        if (all[key].short) {
          warnings.push(`${id}: ${all[key].count} on ${name}, short of its ${PLATFORMS[key].min}`)
        }
        for (const issue of lint(textFor(p, key))) {
          problems.push(`${id}: ${issue}`)
        }
      }
      const image = field(p, 'Image')
      if (image === '' || image === 'none') {
        problems.push(`${id}: no image`)
      } else if (!fs.existsSync(path.join(root, image))) {
        const command = field(p, 'Render')
        if (command) {
          renders.push({id, image, command})
        } else {
          problems.push(`${id}: ${image} is not there and the post has no Render command`)
        }
      }
    }
  }
  return {problems, warnings, renders, posts, open}
}


/**
 * Merge the campaign and the plain posts into the drafts file's text.
 *
 * @param {object} args
 * @param {?string} args.existing The drafts file, or null
 * @param {Array<object>} args.entries
 * @param {Array<object>} [args.campaign]
 * @param {string} [args.since]
 * @returns {{text: string, added: Array<string>, kept: number}}
 */
export function update({existing, entries, campaign = CAMPAIGN, since = NEW_ENTRIES_SINCE}) {
  const made = buildCampaign(entries, campaign)
  const have = existing === null ? [] : parseDrafts(existing).sections
  const covered = new Set([...made, ...have].flatMap((s) => s.posts).map((p) => field(p, 'Entry')).filter(Boolean))
  const plain = plainPosts(entries, {
    since, skip: covered, after: lastDate([...made, ...have]) || since || new Date().toISOString().slice(0, 10),
  })
  const generated = [...made]
  if (plain.length > 0) {
    generated.push({
      title: 'From the changelog',
      intro: 'Plain posts for entries added since the campaign: the headline, as much of the text as fits, and ' +
        'the link.  Rewrite them freely.',
      posts: plain,
    })
  }
  return mergeDrafts(existing, generated)
}


/** @returns {object} The command line's options */
function parseArgs(argv) {
  const opts = {check: false, renders: false, since: NEW_ENTRIES_SINCE, file: DRAFTS}
  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case '--check': opts.check = true; break
      case '--renders': opts.renders = true; break
      case '--since': opts.since = argv[++i]; break
      case '--file': opts.file = path.resolve(argv[++i]); break
      default: throw new Error(`Unknown argument ${argv[i]}`)
    }
  }
  return opts
}


/** Run the command. */
function main() {
  const opts = parseArgs(process.argv.slice(2))
  const existing = fs.existsSync(opts.file) ? fs.readFileSync(opts.file, 'utf8') : null
  const {entries} = JSON.parse(fs.readFileSync(CHANGELOG_JSON, 'utf8'))
  let markdown = existing
  if (!opts.check && !opts.renders) {
    const {text, added, kept} = update({existing, entries, since: opts.since})
    fs.mkdirSync(path.dirname(opts.file), {recursive: true})
    fs.writeFileSync(opts.file, text)
    markdown = text
    console.log(`${path.relative(ROOT, opts.file)}: ${added.length} added, ${kept} kept as they were.`)
  } else if (existing === null) {
    throw new Error(`No drafts file at ${opts.file}: run \`yarn posts\` first`)
  }
  const {problems, warnings, renders, posts, open} = review(markdown)
  if (opts.renders) {
    for (const {command} of renders) {
      console.log(command)
    }
    return
  }
  console.log(`${posts} posts, ${open} not yet posted or skipped; the site is ${SITE}`)
  if (renders.length > 0) {
    console.log(`${renders.length} images to render on a GPU (\`yarn posts --renders\` prints the commands).`)
  }
  for (const w of warnings) {
    console.log(`  note: ${w}`)
  }
  for (const p of problems) {
    console.log(`  ${p}`)
  }
  if (problems.length > 0 && opts.check) {
    process.exit(1)
  }
}


if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main()
}
