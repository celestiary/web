import {
  closingNumbers, describePr, epicOfIssue, formatDraft, groupByMonth, indexIssues, issueLinkNumbers, mergedPrs, partOfNumbers,
  summarize,
} from './draft.mjs'


const EPIC = {
  number: 244, title: 'Epic: What\'s new', labels: [{name: 'epic'}],
  html_url: 'https://github.com/celestiary/web/issues/244', body: '',
}
const SUB = {
  number: 245, title: 'What\'s new 1', labels: [], body: 'Part of #244.',
  html_url: 'https://github.com/celestiary/web/issues/245', parent_issue_url: 'https://api.github.com/repos/celestiary/web/issues/244',
}
const LOOSE = {number: 99, title: 'A loose issue', labels: [], body: 'See [the epic](https://github.com/celestiary/web/issues/244).'}
const PLAIN = {number: 50, title: 'Plain', labels: [], body: ''}
const PR_AS_ISSUE = {number: 7, title: 'An old PR', labels: [], pull_request: {}}
const ISSUES = [EPIC, SUB, LOOSE, PLAIN, PR_AS_ISSUE]

/**
 * @param {object} fields
 * @returns {object} A pulls API row
 */
function pr(fields) {
  return {
    html_url: `https://github.com/celestiary/web/pull/${fields.number}`,
    body: '', labels: [], merged_at: '2026-10-05T12:00:00Z', ...fields,
  }
}


describe('linked issues', () => {
  it('finds the closing keywords, lists included', () => {
    expect(closingNumbers('Closes #12 and fixes #3, #4 and #5. Resolves: #9')).toEqual([12, 3, 4, 5, 9])
    expect(closingNumbers('closed #1')).toEqual([1])
    expect(closingNumbers('Disclosed #1')).toEqual([])
    expect(closingNumbers(null)).toEqual([])
  })

  it('finds "part of" and its relatives', () => {
    expect(partOfNumbers('Part of #244.')).toEqual([244])
    expect(partOfNumbers('Refs #189 (step 1). Towards #86')).toEqual([189, 86])
    expect(partOfNumbers('Closes #241 (in #118).')).toEqual([118])
    expect(partOfNumbers('Nothing here #12')).toEqual([])
  })

  it('finds issue links by URL', () => {
    const base = 'https://github.com/celestiary/web/issues'
    const text = `see ${base}/118 and [x](${base}/7) twice ${base}/118`
    expect(issueLinkNumbers(text)).toEqual([118, 7])
  })
})


describe('epics', () => {
  const byNumber = indexIssues(ISSUES)

  it('is the issue itself when it is an epic', () => {
    expect(epicOfIssue(EPIC, byNumber)).toBe(EPIC)
  })

  it('is the parent of a sub-issue', () => {
    expect(epicOfIssue({...SUB, body: ''}, byNumber)).toBe(EPIC)
  })

  it('is the epic the body says it is part of, or links to', () => {
    expect(epicOfIssue({...SUB, parent_issue_url: null}, byNumber)).toBe(EPIC)
    expect(epicOfIssue(LOOSE, byNumber)).toBe(EPIC)
  })

  it('is null for an issue in no epic, or none', () => {
    expect(epicOfIssue(PLAIN, byNumber)).toBeNull()
    expect(epicOfIssue(undefined, byNumber)).toBeNull()
  })
})


describe('summarize', () => {
  it('flattens the body, drops the trailer and the test plan', () => {
    const trailer = '🤖 Generated with [Claude Code](https://claude.com/claude-code)\n\nhttps://claude.ai/code/session_1'
    const body = `Adds a thing.\n\n## Test plan\n- [x] ran it\n\n## Notes\nSecond.\n\n${trailer}`
    expect(summarize(body)).toBe('Adds a thing. Second.')
  })

  it('cuts at a word and marks the cut', () => {
    expect(summarize('one two three four five', 14)).toBe('one two three...')
    expect(summarize(null)).toBe('')
  })
})


describe('describePr', () => {
  const byNumber = indexIssues(ISSUES)

  it('collects the closed and related issues, and their epic', () => {
    const merged = pr({number: 300, title: 'Do it', body: 'Closes #245. Also part of #50.', labels: [{name: 'enhancement'}]})
    const d = describePr(merged, byNumber)
    expect(d.closes).toEqual([245])
    expect(d.partOf).toEqual([50])
    expect(d.issues.map((i) => i.number)).toEqual([245, 50])
    expect(d.epic).toEqual({number: 244, title: 'What\'s new', url: 'https://github.com/celestiary/web/issues/244'})
    expect(d.labels).toEqual(['enhancement'])
    expect(d.date).toBe('2026-10-05')
    expect(d.month).toBe('2026-10')
  })

  it('leaves out PRs, itself and epics from the issues, and keeps the epic apart', () => {
    const d = describePr(pr({number: 301, title: 'x', body: 'Part of #244. Refs #7 and #301.'}), byNumber)
    expect(d.issues).toEqual([])
    expect(d.epic.number).toBe(244)
  })

  it('has no epic when nothing links to one', () => {
    expect(describePr(pr({number: 302, title: 'x', body: 'Fixes #50'}), byNumber).epic).toBeNull()
    expect(describePr(pr({number: 303, title: 'x'}), byNumber).issues).toEqual([])
  })
})


describe('mergedPrs and groupByMonth', () => {
  const pulls = [
    pr({number: 1, title: 'Old', merged_at: '2025-01-03T00:00:00Z'}),
    pr({number: 2, title: 'Closed unmerged', merged_at: null}),
    pr({number: 3, title: 'Late October', merged_at: '2026-10-20T09:00:00Z'}),
    pr({number: 4, title: 'Early October', merged_at: '2026-10-02T09:00:00Z'}),
    pr({number: 5, title: 'Same moment, higher number', merged_at: '2026-10-20T09:00:00Z'}),
    pr({number: 6, title: 'September', merged_at: '2026-09-30T23:59:59Z'}),
  ]

  it('skips unmerged PRs and sorts newest first', () => {
    const merged = mergedPrs(pulls, ISSUES)
    expect(merged.map((p) => p.number)).toEqual([5, 3, 4, 6, 1])
  })

  it('groups by the month of the merge, months and PRs newest first', () => {
    const groups = groupByMonth(mergedPrs(pulls, ISSUES))
    expect(groups.map((g) => g.month)).toEqual(['2026-10', '2026-09', '2025-01'])
    expect(groups[0].prs.map((p) => p.number)).toEqual([5, 3, 4])
  })

  it('takes the month from the UTC merge time', () => {
    const [g] = groupByMonth(mergedPrs([pr({number: 8, title: 'Edge', merged_at: '2026-11-01T00:00:01Z'})], ISSUES))
    expect(g.month).toBe('2026-11')
  })
})


describe('formatDraft', () => {
  it('writes entries in the changelog format, with the PR\'s own words in a comment', () => {
    const groups = groupByMonth(mergedPrs([
      pr({number: 300, title: 'Do it', body: 'Closes #245.\n\nDetails --- here.', labels: [{name: 'bug'}]}),
    ], ISSUES))
    const draft = formatDraft(groups)
    expect(draft).toContain('## 2026-10\n')
    expect(draft).toContain('### Do it\n')
    expect(draft).toContain('- Date: 2026-10-05\n')
    expect(draft).toContain('- PR: [#300](https://github.com/celestiary/web/pull/300)\n')
    expect(draft).toContain('- Issue: [#245](https://github.com/celestiary/web/issues/245) What\'s new 1\n')
    expect(draft).toContain('- Epic: [#244](https://github.com/celestiary/web/issues/244) What\'s new\n')
    expect(draft).toContain('- Permalink: none\n')
    expect(draft).toContain('<!-- draft [bug]: Closes #245. Details - -- here. -->')
  })
})
