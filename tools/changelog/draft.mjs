#!/usr/bin/env node
import fs from 'node:fs'
import {fileURLToPath} from 'node:url'


/**
 * Drafts CHANGELOG.md entries from merged pull requests (tools/changelog/README.md).
 *
 * It reads two JSON files fetched beforehand, so it runs offline and the tests
 * never touch the network:
 *
 *   gh api --paginate 'repos/celestiary/web/pulls?state=closed&per_page=100' > pulls.json
 *   gh api --paginate 'repos/celestiary/web/issues?state=all&per_page=100' > issues.json
 *   node tools/changelog/draft.mjs pulls.json issues.json > draft.md
 *
 * The draft is a starting point for a person or an agent, who rewrites each
 * entry as a user-facing line (what you can now see or do), folds the
 * housekeeping into one line a month and adds permalinks.  Nothing here
 * decides what is worth a line.
 */

const REPO_URL = 'https://github.com/celestiary/web'
const EPIC_LABEL = 'epic'
const MONTH_LENGTH = 7
const DATE_LENGTH = 10
const SUMMARY_CHARS = 600
const NUMBERS = '#(\\d+)(?:\\s*(?:,|and|&)\\s*#(\\d+))*'
// "Closes #12", "fixes #3, #4 and #5", "Resolves: #9"
const CLOSING = new RegExp(`\\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\\b:?\\s+(?:celestiary/web)?${NUMBERS}`, 'gi')
// "Part of #244", "towards #12", "Refs #3", "step 2 of #86", "in #118", "for the epic #4"
const PART_OF = new RegExp(
    `\\b(?:part\\s+of|towards?|refs?|related\\s+to|step\\s+\\w+\\s+of|in|for(?:\\s+the\\s+epic)?)\\s+(?:celestiary/web)?${NUMBERS}`,
    'gi')
const ISSUE_LINK = /github\.com\/celestiary\/web\/issues\/(\d+)/g
const TRAILER = /(?:🤖\s*)?Generated with \[Claude Code\].*$/s
const EPIC_PREFIX = /^Epic:\s*/i
const SKIPPED_SECTIONS = /^#{1,6}\s*(?:test\s*plan|testing|verification|checklist|what i couldn't verify|not verified)\b.*$/i


/**
 * @param {string} text
 * @returns {Array<number>} Every issue or PR number in a "#1, #2 and #3" run
 */
function numbersIn(text) {
  return [...text.matchAll(/#(\d+)/g)].map((m) => Number(m[1]))
}


/**
 * @param {string|null|undefined} text A PR's title or body
 * @param {RegExp} re CLOSING or PART_OF
 * @returns {Array<number>} Distinct numbers the pattern finds, in order
 */
function matchNumbers(text, re) {
  const found = []
  for (const m of (text ?? '').matchAll(re)) {
    for (const n of numbersIn(m[0])) {
      if (!found.includes(n)) {
        found.push(n)
      }
    }
  }
  return found
}


/**
 * @param {string|null|undefined} text
 * @returns {Array<number>} Issues the text says it closes ("Closes #N", "Fixes #N")
 */
export function closingNumbers(text) {
  return matchNumbers(text, CLOSING)
}


/**
 * @param {string|null|undefined} text
 * @returns {Array<number>} Numbers the text says it is part of ("Part of #N", "towards #N")
 */
export function partOfNumbers(text) {
  return matchNumbers(text, PART_OF)
}


/**
 * @param {string|null|undefined} text
 * @returns {Array<number>} Numbers linked to by an issues URL
 */
export function issueLinkNumbers(text) {
  const found = []
  for (const m of (text ?? '').matchAll(ISSUE_LINK)) {
    const n = Number(m[1])
    if (!found.includes(n)) {
      found.push(n)
    }
  }
  return found
}


/**
 * @param {Array<object>} issues The issues API's rows, PRs among them
 * @returns {Map<number, object>} By number
 */
export function indexIssues(issues) {
  return new Map(issues.map((i) => [i.number, i]))
}


/**
 * @param {object} issue
 * @returns {boolean} Whether it carries the `epic` label
 */
export function isEpic(issue) {
  return (issue?.labels ?? []).some((l) => (l.name ?? l) === EPIC_LABEL)
}


/**
 * The epic an issue belongs to: itself if it is one, else its parent (the
 * sub-issue link), else the epic its body says it is "Part of".
 *
 * @param {object|undefined} issue
 * @param {Map<number, object>} byNumber
 * @returns {object|null} The epic's issue row
 */
export function epicOfIssue(issue, byNumber) {
  if (!issue) {
    return null
  }
  if (isEpic(issue)) {
    return issue
  }
  if (issue.parent_issue_url) {
    const parent = byNumber.get(Number(issue.parent_issue_url.split('/').pop()))
    if (isEpic(parent)) {
      return parent
    }
  }
  for (const n of [...partOfNumbers(issue.body), ...issueLinkNumbers(issue.body)]) {
    const candidate = byNumber.get(n)
    if (n !== issue.number && isEpic(candidate)) {
      return candidate
    }
  }
  return null
}


/**
 * @param {string|null|undefined} body A PR's body
 * @param {number} [max] Most characters to keep
 * @returns {string} The body without its trailer and test-plan sections, flattened to one paragraph and cut to `max`
 */
export function summarize(body, max = SUMMARY_CHARS) {
  const kept = []
  let skipping = false
  for (const line of (body ?? '').replace(TRAILER, '').split('\n')) {
    if (/^#{1,6}\s/.test(line)) {
      skipping = SKIPPED_SECTIONS.test(line)
    }
    if (!skipping && !/^#{1,6}\s/.test(line)) {
      kept.push(line)
    }
  }
  const flat = kept.join(' ').replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max).replace(/\s\S*$/, '')}...` : flat
}


/**
 * @param {object} issue A row of the issues API
 * @returns {string} Its page
 */
function issueUrl(issue) {
  return issue.html_url ?? `${REPO_URL}/issues/${issue.number}`
}


/**
 * One merged PR with what the draft needs from it.
 *
 * @param {object} pr A row of the pulls API
 * @param {Map<number, object>} byNumber The issues API's rows by number
 * @returns {object} {number, url, title, summary, mergedAt, date, month, labels, closes, partOf, issues, epic}
 */
export function describePr(pr, byNumber) {
  const text = `${pr.title}\n${pr.body ?? ''}`
  const closes = closingNumbers(text).filter((n) => n !== pr.number)
  const related = [...partOfNumbers(text), ...issueLinkNumbers(text)]
      .filter((n) => n !== pr.number && !closes.includes(n))
  const issueRows = [...closes, ...related]
      .map((n) => byNumber.get(n))
      .filter((i) => i && !i.pull_request)
  let epic = null
  for (const issue of issueRows) {
    epic = epicOfIssue(issue, byNumber)
    if (epic) {
      break
    }
  }
  return {
    number: pr.number,
    url: pr.html_url ?? `${REPO_URL}/pull/${pr.number}`,
    title: pr.title,
    summary: summarize(pr.body),
    mergedAt: pr.merged_at,
    date: pr.merged_at.slice(0, DATE_LENGTH),
    month: pr.merged_at.slice(0, MONTH_LENGTH),
    labels: (pr.labels ?? []).map((l) => l.name ?? l),
    closes: closes.filter((n) => issueRows.some((i) => i.number === n)),
    partOf: related.filter((n) => issueRows.some((i) => i.number === n)),
    issues: issueRows.filter((i) => !isEpic(i)).map((i) => ({number: i.number, title: i.title, url: issueUrl(i)})),
    epic: epic && {number: epic.number, title: epic.title.replace(EPIC_PREFIX, ''), url: issueUrl(epic)},
  }
}


/**
 * @param {Array<object>} pulls The pulls API's rows (closed ones, merged or not)
 * @param {Array<object>} issues The issues API's rows
 * @returns {Array<object>} The merged PRs only, described, newest merge first
 */
export function mergedPrs(pulls, issues) {
  const byNumber = indexIssues(issues)
  return pulls
      .filter((pr) => pr.merged_at)
      .map((pr) => describePr(pr, byNumber))
      .sort((a, b) => (a.mergedAt < b.mergedAt ? 1 : a.mergedAt > b.mergedAt ? -1 : b.number - a.number))
}


/**
 * @param {Array<object>} prs From mergedPrs
 * @returns {Array<{month: string, prs: Array<object>}>} By month ("2026-10"), newest first, each month's PRs newest first
 */
export function groupByMonth(prs) {
  const months = new Map()
  for (const pr of prs) {
    if (!months.has(pr.month)) {
      months.set(pr.month, [])
    }
    months.get(pr.month).push(pr)
  }
  return [...months.entries()]
      .sort(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0))
      .map(([month, list]) => ({month, prs: list}))
}


/**
 * @param {Array<{month: string, prs: Array<object>}>} groups From groupByMonth
 * @returns {string} A draft in CHANGELOG.md's entry format, the PR's own words in a comment under each entry
 */
export function formatDraft(groups) {
  const out = []
  for (const {month, prs} of groups) {
    out.push(`## ${month}\n`)
    for (const pr of prs) {
      out.push(`### ${pr.title}\n`)
      out.push('TODO: what you can now see or do.\n')
      out.push(`- Date: ${pr.date}`)
      out.push(`- PR: [#${pr.number}](${pr.url})`)
      for (const i of pr.issues) {
        out.push(`- Issue: [#${i.number}](${i.url}) ${i.title}`)
      }
      if (pr.epic) {
        out.push(`- Epic: [#${pr.epic.number}](${pr.epic.url}) ${pr.epic.title}`)
      }
      out.push('- Permalink: none')
      const labels = pr.labels.length > 0 ? ` [${pr.labels.join(', ')}]` : ''
      out.push(`\n<!-- draft${labels}: ${pr.summary.replaceAll('--', '- -')} -->\n`)
    }
  }
  return `${out.join('\n')}\n`
}


/**
 * @param {Array<string>} argv [pulls.json, issues.json]
 * @returns {string} The draft
 */
export function draftFromFiles(argv) {
  const [pullsFile, issuesFile] = argv
  if (!pullsFile || !issuesFile) {
    throw new Error('usage: draft.mjs pulls.json issues.json')
  }
  const pulls = JSON.parse(fs.readFileSync(pullsFile, 'utf8'))
  const issues = JSON.parse(fs.readFileSync(issuesFile, 'utf8'))
  return formatDraft(groupByMonth(mergedPrs(pulls, issues)))
}


if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.stdout.write(draftFromFiles(process.argv.slice(2)))
}
