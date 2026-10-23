import {SOCIAL_PLATFORMS, socialUrlProblem, validSocial} from '../../js/socialLinks.mjs'
import {mergeDrafts, parseDrafts, postId, field} from './file.mjs'
import {postedSocial, socialProblems} from './social.mjs'


/**
 * @param {string} id
 * @param {object} [more] Fields and their values
 * @returns {object} A post
 */
function post(id, more = {}) {
  const fields = [['ID', id], ['Status', 'draft'], ['X', ''], ['Facebook', ''], ['Date', '2026-10-27'], ['Entry', `entry-${id}`]]
  for (const [k, v] of Object.entries(more)) {
    const at = fields.findIndex(([name]) => name === k)
    if (at >= 0) {
      fields[at][1] = v
    } else {
      fields.push([k, v])
    }
  }
  return {title: `Post ${id}`, fields, text: `Text of ${id}.\n\nhttps://celestiary.org/`, overrides: {}, extra: ''}
}

const drafts = (...posts) => mergeDrafts(null, [{title: 'S', intro: '', posts}]).text
const X = 'https://x.com/celestiary_org/status/1849000000000000000'
const FB = 'https://www.facebook.com/celestiary/posts/123'


describe('a social URL', () => {
  it('is https on the platform\'s own host: x.com or twitter.com for X, facebook.com for Facebook', () => {
    expect(socialUrlProblem('x', X)).toBeNull()
    expect(socialUrlProblem('x', 'https://twitter.com/celestiary_org/status/1')).toBeNull()
    expect(socialUrlProblem('x', 'https://mobile.twitter.com/a/status/1')).toBeNull()
    expect(socialUrlProblem('facebook', FB)).toBeNull()
    expect(socialUrlProblem('facebook', 'https://m.facebook.com/story.php?id=1')).toBeNull()
  })

  it('is refused when it is http, on another host, on a look-alike host, has a login, or is not a URL', () => {
    expect(socialUrlProblem('x', 'http://x.com/a/status/1')).toContain('not https')
    expect(socialUrlProblem('x', 'https://example.com/a')).toContain('not on x.com')
    expect(socialUrlProblem('x', 'https://notx.com/a')).toContain('not on')
    expect(socialUrlProblem('x', 'https://x.com.evil.example/a')).toContain('not on')
    expect(socialUrlProblem('x', 'https://evil@x.com/a')).toContain('login')
    expect(socialUrlProblem('facebook', X)).toContain('not on facebook.com')
    expect(socialUrlProblem('x', FB)).toContain('not on')
    expect(socialUrlProblem('x', 'javascript:alert(1)')).toContain('not https')
    expect(socialUrlProblem('x', 'not a url')).toContain('not a URL')
    expect(socialUrlProblem('x', undefined)).toBe('not a URL')
    expect(socialUrlProblem('threads', X)).toContain('unknown platform')
  })

  it('has its valid ones kept, in the icons\' order, and the rest dropped', () => {
    expect(validSocial({facebook: FB, x: X})).toEqual({x: X, facebook: FB})
    expect(validSocial({x: 'http://x.com/a', facebook: FB})).toEqual({facebook: FB})
    expect(validSocial({x: 'http://x.com/a'})).toBeNull()
    expect(validSocial(null)).toBeNull()
    expect(Object.keys(SOCIAL_PLATFORMS)).toEqual(['x', 'facebook'])
    expect(SOCIAL_PLATFORMS.x.aria).toBe('on X')
    expect(SOCIAL_PLATFORMS.facebook.aria).toBe('on Facebook')
  })
})


describe('the live posts\' URLs in the drafts file', () => {
  it('are the X and Facebook fields of a post: parsed, kept by a re-run, and empty in a new one', () => {
    const text = drafts(post('a'))
    expect(text).toContain('- X:\n- Facebook:\n')
    const edited = text.replace('- X:\n- Facebook:\n', `- X: ${X}\n- Facebook: ${FB}\n`)
    const [a] = parseDrafts(edited).sections[0].posts
    expect(field(a, 'X')).toBe(X)
    expect(field(a, 'Facebook')).toBe(FB)
    expect(mergeDrafts(edited, [{title: 'S', intro: '', posts: [post('a')]}]).text).toBe(edited)
  })

  it('are joined onto the post\'s entry once its status is posted', () => {
    const text = drafts(
        post('a', {Status: 'posted', X, Facebook: FB}), post('b', {Status: 'posted', Facebook: FB}),
        post('c', {Status: 'scheduled'}), post('d', {Status: 'posted'}))
    expect(postedSocial(text)).toEqual({'entry-a': {x: X, facebook: FB}, 'entry-b': {facebook: FB}})
  })

  it('take the first URL on each platform when an entry has several posts', () => {
    const second = 'https://x.com/celestiary_org/status/2'
    const text = drafts(post('a', {Status: 'posted', X}), post('a2', {Status: 'posted', X: second, Entry: 'entry-a', Facebook: FB}))
    expect(postedSocial(text)['entry-a']).toEqual({x: X, facebook: FB})
  })

  it('are refused when they are not https on the platform\'s host, naming the post', () => {
    const bad = drafts(post('a', {Status: 'posted', X: 'http://x.com/a/status/1'}), post('b', {Status: 'posted', Facebook: X}))
    expect(socialProblems(bad)).toHaveLength(2)
    expect(socialProblems(bad)[0]).toContain('a: X:')
    expect(() => postedSocial(bad)).toThrow('b: Facebook:')
  })

  it('are a problem on a post that is not posted yet, and so are not joined', () => {
    const early = drafts(post('a', {Status: 'draft', X}))
    expect(socialProblems(early)[0]).toContain('not posted')
    expect(() => postedSocial(early)).toThrow('not posted')
  })

  it('are none for a file with no URLs, or no file', () => {
    expect(postedSocial(drafts(post('a')))).toEqual({})
    expect(postedSocial('')).toEqual({})
    expect(postId(post('a'))).toBe('a')
  })
})
