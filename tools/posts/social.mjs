import {SOCIAL_PLATFORMS, socialUrlProblem} from '../../js/socialLinks.mjs'
import {field, parseDrafts, postId} from './file.mjs'


/**
 * The links to the live posts, from the drafts file to the changelog
 * (tools/posts/README.md "Links to the live posts").  The maintainer records
 * a post's URLs in one place, its block in posts/drafts.md (`- X:` and
 * `- Facebook:`, when its status is `posted`), and `yarn changelog` joins
 * them onto the post's entry in public/data/changelog.json.
 */

// A post's field for each platform.
const FIELD_OF = Object.freeze({x: 'X', facebook: 'Facebook'})


/**
 * @param {string} markdown The drafts file (posts/drafts.md)
 * @returns {Array<string>} A problem for each URL that isn't https on the platform's own host, or that is on a post
 *   that isn't `posted`
 */
export function socialProblems(markdown) {
  const problems = []
  for (const section of parseDrafts(markdown).sections) {
    for (const post of section.posts) {
      for (const key of Object.keys(SOCIAL_PLATFORMS)) {
        const url = field(post, FIELD_OF[key])
        if (url === '') {
          continue
        }
        const problem = socialUrlProblem(key, url)
        if (problem) {
          problems.push(`${postId(post)}: ${FIELD_OF[key]}: ${problem}`)
        } else if (field(post, 'Status') !== 'posted') {
          problems.push(`${postId(post)}: has a ${FIELD_OF[key]} URL but its status is "${field(post, 'Status')}", not posted`)
        }
      }
    }
  }
  return problems
}


/**
 * The URLs of the posts that are live, by the entry they are about.  A post
 * counts once its status is `posted`; an entry with several posts (a
 * thread) takes the first URL on each platform, in the file's order.
 *
 * @param {string} markdown The drafts file
 * @returns {{[entryId: string]: {[platform: string]: string}}} In the icons' order; an entry with none isn't there
 * @throws {Error} On a bad URL, naming the post
 */
export function postedSocial(markdown) {
  const problems = socialProblems(markdown)
  if (problems.length > 0) {
    throw new Error(`posts/drafts.md: ${problems.join('; ')}`)
  }
  const found = {}
  for (const section of parseDrafts(markdown).sections) {
    for (const post of section.posts) {
      const entry = field(post, 'Entry')
      if (!entry || field(post, 'Status') !== 'posted') {
        continue
      }
      for (const key of Object.keys(SOCIAL_PLATFORMS)) {
        const url = field(post, FIELD_OF[key])
        if (url !== '') {
          found[entry] ??= {}
          found[entry][key] ??= url
        }
      }
    }
  }
  // The icons' order, whichever platform came first.
  return Object.fromEntries(Object.entries(found).map(([id, urls]) => [
    id, Object.fromEntries(Object.keys(SOCIAL_PLATFORMS).filter((k) => urls[k]).map((k) => [k, urls[k]])),
  ]))
}
