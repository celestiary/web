import fs from 'node:fs'
import path from 'node:path'
import {CAMPAIGN, NEW_ENTRIES_SINCE} from './campaign.mjs'
import {SITE, entryLink, makePost, nextSlot, plainPostText, plainPosts, renderCommand, sentences} from './draft.mjs'
import {field, lengths, parseDrafts, postId, textFor} from './file.mjs'
import {CHANGELOG_JSON, DRAFTS, buildCampaign, review, update} from './posts.mjs'
import {PLATFORMS, lint, measureAll} from './text.mjs'
import {decodePermalink} from '../../js/permalink.js'
import {parseArgs} from '../home/cards.mjs'


const ROOT = path.join(path.dirname(DRAFTS), '..')
const {entries} = JSON.parse(fs.readFileSync(CHANGELOG_JSON, 'utf8'))
const byId = new Map(entries.map((e) => [e.id, e]))

const ENTRY = {
  id: '2026-11-03-a-new-view',
  date: '2026-11-03',
  headline: 'A `new` view of Saturn',
  text: 'Saturn now has a new look from the pole. The rings show their gaps. The link is Saturn from the pole. ' +
    'It uses a model with a very long description that goes on and on and on, far past anything that could be ' +
    'sent in a single post on any of the three platforms we have, so it must be left out of the draft.',
  permalink: '#sun/saturn@80,0,2Mm;t=9800jd;cq=0,0,0,1;fov=45deg',
  image: null,
}
const FIX = {...ENTRY, id: '2026-11-04-fixed', headline: 'Fixed: a black disc', date: '2026-11-04'}
const QUIET = {...ENTRY, id: '2026-11-05-quiet', headline: 'Faster loading', date: '2026-11-05', permalink: null}
const OLD = {...ENTRY, id: '2026-10-01-old', headline: 'Old news', date: '2026-10-01'}


describe('a plain post for an entry', () => {
  it('has the headline, the sentences that fit, and the link', () => {
    const text = plainPostText(ENTRY)
    expect(text).toBe(
        'A new view of Saturn.\n\nSaturn now has a new look from the pole. The rings show their gaps.\n\n' +
        `${SITE}#sun/saturn@80,0,2Mm;t=9800jd;cq=0,0,0,1;fov=45deg`)
    expect(measureAll(text).x.over).toBe(false)
  })

  it('leaves out the sentence about the link, and code quotes', () => {
    expect(sentences('Press `f` to follow. The link is Jupiter. It rides the orbit.')).toEqual(['Press f to follow.', 'It rides the orbit.'])
  })

  it('points at the site when the entry has no view', () => {
    expect(entryLink(QUIET)).toBe(SITE)
    expect(entryLink(ENTRY)).toBe(`${SITE}#sun/saturn@80,0,2Mm;t=9800jd;cq=0,0,0,1;fov=45deg`)
  })

  it('always fits X, whatever the entry says', () => {
    const long = {...ENTRY, headline: 'H'.repeat(100), text: 'Word '.repeat(100) + 'end.'}
    expect(measureAll(plainPostText(long)).x.over).toBe(false)
    expect(measureAll(plainPostText(long, 'facebook')).facebook.over).toBe(false)
  })

  it('has a longer text for Facebook: more of the sentences, up to 500', () => {
    const entry = {...ENTRY, text: 'First sentence here. '.repeat(40)}
    const facebook = plainPostText(entry, 'facebook')
    expect(facebook.length).toBeGreaterThan(plainPostText(entry).length)
    expect(measureAll(facebook).facebook.over).toBe(false)
    expect(measureAll(facebook).facebook.short).toBe(false)
  })
})

describe('the image', () => {
  it('is the entry\'s own, when it has one', () => {
    const p = makePost({id: 'a', title: 'A', text: 't', entry: {...ENTRY, image: {src: 'images/home/gaia.webp', alt: 'Gaia'}}})
    expect(field(p, 'Image')).toBe('public/images/home/gaia.webp')
    expect(field(p, 'Alt')).toBe('Gaia')
    expect(field(p, 'Render')).toBe('')
  })

  it('is one to render, with the command, when the entry has a view and no image', () => {
    const p = makePost({id: 'a-view', title: 'A', text: 't', entry: ENTRY})
    expect(field(p, 'Image')).toBe('posts/images/a-view.png')
    expect(field(p, 'Render')).toBe(
        'node tools/home/cards.mjs --gpu --id a-view --hash \'sun/saturn@80,0,2Mm;t=9800jd;cq=0,0,0,1;fov=45deg\' --png posts/images')
  })

  it('is none when there is neither', () => {
    expect(field(makePost({id: 'a', title: 'A', text: 't', entry: QUIET}), 'Image')).toBe('none')
  })

  it('has a render command the card renderer reads back as the same view', () => {
    const command = renderCommand('x-1', '#galaxy:ngc2403')
    // Split as a shell would, for this command's single quotes.
    const argv = command.match(/'[^']*'|\S+/g).slice(2).map((a) => a.replace(/^'|'$/g, ''))
    const opts = parseArgs(argv.filter((a) => a !== '--gpu'))
    expect(opts.hash).toBe('galaxy:ngc2403')
    expect(opts.id).toBe('x-1')
    expect(opts.png).toBe('posts/images')
  })

  it('has no quoting trouble in a permalink the command can\'t hold', () => {
    expect(() => renderCommand('a', '#sun/it\'s')).toThrow(/quotes/)
  })
})

describe('the cards renderer\'s arguments', () => {
  it('keeps its own, and takes --hash with an id and a folder', () => {
    expect(parseArgs(['--gpu', '--only', 'earth,gaia']).only).toEqual(['earth', 'gaia'])
    expect(() => parseArgs(['--hash', 'sun/earth'])).toThrow(/--id/)
    expect(() => parseArgs(['--hash', 'sun/earth', '--id', 'a b', '--png', 'x'])).toThrow(/name/)
    expect(parseArgs(['--hash', '#sun/earth', '--id', 'a', '--png', 'x']).hash).toBe('sun/earth')
  })
})

describe('the days', () => {
  it('are Tuesday, Thursday and Saturday', () => {
    expect(nextSlot('2026-10-26')).toBe('2026-10-27')
    expect(nextSlot('2026-10-27')).toBe('2026-10-29')
    expect(nextSlot('2026-10-29')).toBe('2026-10-31')
    expect(nextSlot('2026-10-31')).toBe('2026-11-03')
  })
})

describe('plain posts for entries added after the campaign', () => {
  const args = {since: '2026-10-20', skip: new Set(), after: '2026-11-03'}

  it('are made for entries with a view or an image, dated after, in the order they came, on the next days', () => {
    const posts = plainPosts([QUIET, FIX, ENTRY, OLD], args)
    expect(posts.map(postId)).toEqual([ENTRY.id])
    expect(field(posts[0], 'Date')).toBe('2026-11-05')
    expect(field(posts[0], 'Entry')).toBe(ENTRY.id)
  })

  it('go oldest first, and not for an entry that has a post', () => {
    const later = {...ENTRY, id: 'later', date: '2026-11-10'}
    const posts = plainPosts([later, ENTRY], args)
    expect(posts.map(postId)).toEqual([ENTRY.id, 'later'])
    expect(posts.map((p) => field(p, 'Date'))).toEqual(['2026-11-05', '2026-11-07'])
    expect(plainPosts([later, ENTRY], {...args, skip: new Set([ENTRY.id])}).map(postId)).toEqual(['later'])
  })
})

describe('updating the drafts file from the changelog', () => {
  const campaign = [{
    title: 'Campaign', intro: 'Intro.',
    posts: [{id: 'p1', title: 'P1', entry: ENTRY.id, date: '2026-11-03', text: 'About Saturn. #astronomy', alt: 'Saturn'}],
  }]
  const make = (existing, list = [ENTRY]) => update({existing, entries: list, campaign, since: '2026-11-03'})

  it('makes the campaign\'s posts with the link added, and none for an entry the campaign covers', () => {
    const {text, added} = make(null)
    expect(added).toEqual(['p1'])
    const [p1] = parseDrafts(text).sections[0].posts
    expect(p1.text).toBe(`About Saturn. #astronomy\n\n${entryLink(ENTRY)}`)
    expect(field(p1, 'Entry')).toBe(ENTRY.id)
  })

  it('adds a plain post for an entry that is new, after the others, and then leaves it alone', () => {
    const first = make(null).text
    const newer = {...ENTRY, id: '2026-11-12-newer', headline: 'Newer', date: '2026-11-12', text: 'Something new.'}
    const second = make(first, [newer, ENTRY])
    expect(second.added).toEqual([newer.id])
    const sections = parseDrafts(second.text).sections
    expect(sections.map((s) => s.title)).toEqual(['Campaign', 'From the changelog'])
    expect(field(sections[1].posts[0], 'Date')).toBe('2026-11-05')
    expect(parseDrafts(second.text).sections[0].posts[0].text).toBe(`About Saturn. #astronomy\n\n${entryLink(ENTRY)}`)
    const third = make(second.text, [newer, ENTRY])
    expect(third.added).toEqual([])
    expect(third.text).toBe(second.text)
  })

  it('does not add a post again that the maintainer has marked skip', () => {
    const first = make(null).text
    const newer = {...ENTRY, id: '2026-11-12-newer', headline: 'Newer', date: '2026-11-12', text: 'Something new.'}
    const withNewer = make(first, [newer, ENTRY]).text
    const skipped = withNewer.replace(/- Status: draft(\n- Date: 2026-11-05\n- Entry: 2026-11-12)/, '- Status: skip$1')
    expect(skipped).not.toBe(withNewer)
    expect(make(skipped, [newer, ENTRY]).text).toBe(skipped)
  })

  it('names a campaign post whose entry is not in the changelog', () => {
    expect(() => make(null, [])).toThrow(/p1: no changelog entry/)
  })
})


describe('the first campaign', () => {
  const sections = buildCampaign(entries, CAMPAIGN)
  const [thread, schedule] = sections.map((s) => s.posts)
  const all = [...thread, ...schedule]

  it('is a thread of 5 to 8 posts, then a schedule', () => {
    expect(sections).toHaveLength(2)
    expect(thread.length).toBeGreaterThanOrEqual(5)
    expect(thread.length).toBeLessThanOrEqual(8)
    expect(schedule.length).toBeGreaterThanOrEqual(8)
  })

  it('covers the highlights: Gaia, the galaxies, the Sun, Earth\'s night side, the homepage and the site', () => {
    const text = thread.map((p) => p.text).join('\n').toLowerCase()
    for (const word of ['gaia', 'galax', 'corona', 'glare', 'city lights', 'homepage', 'celestiary.org']) {
      expect(text, word).toContain(word)
    }
  })

  it('has unique ids, each about an entry that exists', () => {
    expect(new Set(all.map(postId)).size).toBe(all.length)
    for (const p of all) {
      expect(byId.has(field(p, 'Entry')), postId(p)).toBe(true)
    }
  })

  it('fits X, and has a Facebook text of 300 to 500 characters, links counted as each counts them', () => {
    for (const p of all) {
      expect(p.overrides.facebook, postId(p)).toBeDefined()
      for (const [key, r] of Object.entries(lengths(p))) {
        expect(r.over, `${postId(p)} on ${key}: ${r.count}/${r.limit}`).toBe(false)
        expect(r.short, `${postId(p)} on ${key}: ${r.count}`).toBe(false)
      }
    }
  })

  it('has the same link in both texts, as its last line', () => {
    for (const p of all) {
      expect(p.overrides.facebook.split('\n').at(-1), postId(p)).toBe(p.text.split('\n').at(-1))
    }
  })

  it('is plain on each platform: at most two hashtags, no emoji, no hype, no exclamations', () => {
    for (const p of all) {
      for (const key of Object.keys(PLATFORMS)) {
        expect(lint(textFor(p, key)), `${postId(p)} on ${key}`).toEqual([])
      }
    }
  })

  it('ends each post with one link to celestiary.org, and nothing else with a link', () => {
    for (const p of all) {
      const lines = p.text.split('\n')
      expect(lines.at(-2), postId(p)).toBe('')
      expect(lines.at(-1), postId(p)).toMatch(/^https:\/\/celestiary\.org\/(#\S*)?$/)
      expect(p.text.match(/https?:\/\//g)).toHaveLength(1)
    }
  })

  it('links permalinks the app can restore', () => {
    for (const p of all) {
      const link = p.text.split('\n').at(-1)
      const fragment = link.slice(SITE.length + 1)
      if (fragment.includes('@')) {
        expect(decodePermalink(fragment), postId(p)).not.toBeNull()
      }
    }
  })

  it('has an image for every post: one in the repo, or one to render with its command', () => {
    for (const p of all) {
      const id = postId(p)
      const image = field(p, 'Image')
      expect(image, id).not.toBe('none')
      if (field(p, 'Render')) {
        expect(image, id).toBe(`posts/images/${id}.png`)
        expect(field(p, 'Render'), id).toContain(`--id ${id} `)
      } else {
        expect(fs.existsSync(path.join(ROOT, image)), `${id}: ${image}`).toBe(true)
      }
      expect(field(p, 'Alt'), id).not.toBe('')
    }
  })

  it('is dated: the thread on one day, then Tuesday, Thursday or Saturday from 2026-10-27, in order', () => {
    expect(new Set(thread.map((p) => field(p, 'Date'))).size).toBe(1)
    expect(field(thread[0], 'Date') < '2026-10-27').toBe(true)
    const dates = schedule.map((p) => field(p, 'Date'))
    expect(dates[0]).toBe('2026-10-27')
    expect(dates).toEqual([...dates].sort())
    expect(new Set(dates).size).toBe(dates.length)
    for (const d of dates) {
      expect([2, 4, 6], d).toContain(new Date(`${d}T00:00:00Z`).getUTCDay())
    }
    const weeks = new Map()
    for (const d of dates) {
      const week = Math.floor((Date.parse(d) - Date.parse('2026-10-26')) / (7 * 864e5))
      weeks.set(week, (weeks.get(week) ?? 0) + 1)
    }
    expect(Math.max(...weeks.values())).toBeLessThanOrEqual(3)
  })

  it('starts plain posts after the entries it was written from', () => {
    const newest = entries.map((e) => e.date).sort().pop()
    expect(NEW_ENTRIES_SINCE >= newest).toBe(true)
  })
})


describe('posts/drafts.md', () => {
  const markdown = fs.readFileSync(DRAFTS, 'utf8')

  it('has the campaign\'s posts, every one a draft or later, each within its limits and in a tone that fits', () => {
    const {sections} = parseDrafts(markdown)
    const ids = sections.flatMap((s) => s.posts).map(postId)
    for (const p of buildCampaign(entries, CAMPAIGN).flatMap((s) => s.posts)) {
      expect(ids).toContain(postId(p))
    }
    expect(review(markdown, ROOT).problems).toEqual([])
  })

  it('is what a run changes nothing in, apart from posts for new entries', () => {
    const {text, added} = update({existing: markdown, entries})
    expect(added).toEqual([])
    expect(text).toBe(markdown)
  })
})
