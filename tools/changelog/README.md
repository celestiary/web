# Changelog tools

`CHANGELOG.md` is the user-facing record of what changed: what you can now
see or do in celestiary, by month, newest first. It is also the source of
`public/data/changelog.json`, which the app reads (the homepage's What's
new, [#246](https://github.com/celestiary/web/issues/246)) and the post
drafts are built from ([#247](https://github.com/celestiary/web/issues/247)).
The epic is [#244](https://github.com/celestiary/web/issues/244).

[ROADMAP.md](../../ROADMAP.md)'s *Done recently* stays the planning record.
A PR that changes what users see adds its CHANGELOG entry in the same PR, as
it adds its *Done recently* paragraph.

## An entry

```markdown
## October 2026

### A homepage at celestiary's address

Open celestiary with nothing after the address and you get a homepage.
A sentence or two, plain and concrete, about what you can see or do.

- Date: 2026-10-13
- PR: [#242](https://github.com/celestiary/web/pull/242)
- Issue: [#241](https://github.com/celestiary/web/issues/241)
- Epic: [#118](https://github.com/celestiary/web/issues/118) Navigation, time and sharing
- Permalink: [Open this view](https://celestiary.org/#sun/earth@...;t=...jd;cq=...;fov=45deg)
- Image: ![Earth at dusk](public/images/home/earth.webp)

Behind the scenes: dependency updates ([#124](https://github.com/celestiary/web/pull/124)).
```

- **Headline** (`###`): one line, what you can now see or do. Not what the
  code does.
- **Text**: one or two short paragraphs above the fields. Plain words,
  concrete numbers, no jargon the user hasn't met. Inline code is fine
  (`` `f` ``, `` `s=` ``); links go in the fields, not the text, because the
  JSON drops Markdown from the text.
- **Date**: `YYYY-MM-DD`, in the month of the heading, and no later than the
  entry above it. It is the merge date; for a PR still open, the day the
  entry is written. For a change made of several PRs it is the last one's.
- **PR**: one or more PRs, as full links whose number matches the label.
  **Issue** is the same for issues, and is left out when there are none.
- **Epic**: the epic issue (a label `epic`), with its title. For work that
  predates the epics, the one its topic belongs to in the roadmap. Left out
  when there is none.
- **Permalink**: a full URL to the view that shows the change, or `none`.
  `none` marks an entry whose view hasn't been found or checked: don't
  guess one. Take it from the PR body, ROADMAP.md or `tools/parity/views.json`,
  or build it from the app (`window.c.permalink()`), and open it before
  writing it down. A path alone (`#sun/earth/new-york`, `#galaxy:ngc2403`)
  flies to its target; a link with `@…;t=…;cq=…` restores time and view
  (js/permalink.md, design/URLs.md). The app opens the `#fragment`, so the
  host in the URL doesn't matter.
- **Image**: `![alt](public/images/…)`, a path in the repo under `public/`,
  left out when there is none. Cards for the homepage come from
  `tools/home/cards.mjs --gpu`.
- **Behind the scenes**: after a month's last entry, one line (or a whole
  month's, when it has no entries) for housekeeping, refactors, dependency
  updates, CI and documentation, each with its PR link. These are not
  entries and are not in the JSON.

The header of `CHANGELOG.md` and anything in a fenced block before the first
`##` month is ignored. Anything else that isn't in the format is an error
with a line number.

## The JSON

`yarn changelog` writes `public/data/changelog.json` from `CHANGELOG.md`
(`json.mjs`, parsing in `parse.mjs`). `yarn changelog --check` exits 1 when
the file is stale. The JSON is **committed**, like the repo's other small
built data under `public/data/` (places, SPARC), and a test
(`changelog.test.js`) fails when it has drifted, so `yarn precommit` and CI
catch a CHANGELOG edit without a rebuilt JSON.

```json
{"entries": [{
  "id": "2026-10-13-a-homepage-at-celestiary-s-address",
  "date": "2026-10-13",
  "headline": "A homepage at celestiary's address",
  "text": "Open celestiary with nothing after the address ...",
  "links": [{"kind": "pr", "number": 242, "url": "https://github.com/celestiary/web/pull/242"}],
  "epic": {"number": 118, "title": "Navigation, time and sharing", "url": "https://github.com/celestiary/web/issues/118"},
  "permalink": "#sun/earth@...",
  "image": {"src": "images/home/earth.webp", "alt": "Earth at dusk"}
}]}
```

Entries are newest first. `permalink` is the fragment with its `#`, or
`null`; the app opens it on whatever host it runs on. `image.src` is
relative to the site's root (the `public/` is dropped); `image` is `null`
when there is none. `epic` is `null` when there is none. `links` has the
PRs, then the issues. `text` is plain, paragraphs separated by a blank line.

## Drafting entries from merged PRs

`draft.mjs` is how the history was started, and it drafts a new batch the
same way. It reads two JSON files fetched beforehand, so it runs offline:

```sh
gh api --paginate 'repos/celestiary/web/pulls?state=closed&per_page=100' > pulls.json
gh api --paginate 'repos/celestiary/web/issues?state=all&per_page=100' > issues.json
yarn changelog:draft pulls.json issues.json > draft.md
```

It skips unmerged PRs and groups the rest by month (UTC merge time), newest
first. For each PR it takes the title, the merge date, the labels, the
issues it closes ("Closes #N"), the ones it is part of ("Part of #N",
"Refs #N", "Towards #N", "in #N") or links to, and the epic: the linked
issue if it is an epic, else its parent (the sub-issue link), else the epic
its body says it is part of. The output is in the entry format above with
`TODO` for the text and the PR's own words in a comment under it. A person
or an agent then writes the user-facing lines, folds the housekeeping into
the month's line, and adds permalinks.

## Tests

`bun test tools/changelog` runs the parsing and grouping tests on small
fixtures (no network), and the checks on the real file: every entry is
well-formed and in order, every permalink decodes, every image exists, and
the JSON is current.
