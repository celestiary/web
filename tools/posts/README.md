# Post drafts

`yarn posts` drafts social posts from `CHANGELOG.md`'s entries into one
reviewable file, [`posts/drafts.md`](../../posts/drafts.md). **Nothing is
ever posted for you**: you read the drafts, edit them, and publish each one
by hand. It is the third output of the What's new epic
([#244](https://github.com/celestiary/web/issues/244)), after the changelog
and the homepage's What's new; the work is
[#247](https://github.com/celestiary/web/issues/247).

The platforms, for now: **X** (the account is **@celestiary_org**; 280
characters, a link counts 23) and **Facebook** (a short paragraph or two,
300 to 500 characters, link in the text). Bluesky and Mastodon were
dropped for now. The platforms are a table, `PLATFORMS` in `text.mjs`
(limit, target, how text and links are counted), so another is a row there.

## Running it

```sh
yarn posts             # add the posts the file doesn't have; report
yarn posts --check     # change nothing; exit 1 on a post over a limit or a tone problem
yarn posts --renders   # print the commands that render the images that are missing
yarn posts --since 2026-11-01   # plain posts for entries dated after this
```

The first run writes `posts/drafts.md` from two things:

- **The first campaign** (`campaign.mjs`): a "since spring" thread of seven
  posts, then one post for each of ten notable entries, on Tuesdays,
  Thursdays and Saturdays from 2026-10-27. The copy is written by hand, for
  someone who hasn't seen celestiary, from the changelog's own numbers.
- **Plain posts** (`draft.mjs`) for the **featured** entries the campaign
  doesn't cover (`- Featured: yes` in CHANGELOG.md, which the PR that adds
  an entry decides; `--since` limits them by date): the headline, as many of
  the entry's sentences as fit, for X and for Facebook, and the link (the
  sentence about "the link" is dropped, since the post has it). Entries that
  aren't featured get no draft, whatever they have. Each is dated on the next
  free Tuesday, Thursday or Saturday. A featured entry with no view and no
  image gets `Image: none`, which `--check` reports.

So after a PR adds a CHANGELOG entry and `yarn changelog` rebuilds the JSON,
`yarn posts` adds its draft at the end of the file. It reads
`public/data/changelog.json`, which is committed and tested to be current.

## The file

```markdown
## Section

### A post's title

- ID: gaia-night
- Status: draft
- X: (the post's URL, once it is live)
- Facebook: (the same)
- Date: 2026-10-27
- Entry: 2026-10-11-a-million-of-gaia-s-stars
- Image: public/images/home/gaia.webp
- Alt: what the image shows
- Render: node tools/home/cards.mjs --gpu --id ... --png posts/images
- Notes: anything you like
- Length: X 276/280, Facebook 410/500

(the text, link and all, in a fenced block)
```

- **Status** is yours: `draft`, `scheduled`, `posted` or `skip`. Posts that are
  `posted` or `skip` aren't checked again.
- **Date** is a suggestion.
- **The text** is the post as you'd paste it, for X. To differ on a platform,
  add a `#### Facebook` (or `#### X`) heading and a fenced block under the
  post's own: that platform gets it instead. Every campaign post has a
  Facebook one; a plain post for a new entry gets one too, made of as many of
  the entry's sentences as fit in 500.
- **Length** is the one thing the script writes, on every run, from the text
  as it is now, so it is right after you edit. `OVER` marks a platform the
  text doesn't fit.
- **Image** and **Alt**: the file to attach and its description (below).

### Merging: a re-run never undoes your edits

A post is the same post by its `ID`. A run **adds** the posts the file doesn't
have, at the end of their section, and leaves every post in the file as it is,
apart from `Length`: status, date, text, overrides, fields and notes of your
own, the preamble and the sections' introductions. A post that has gone from
the changelog, or that you wrote yourself, stays. **To drop a draft, mark it
`skip`; don't delete it**, or the next run adds it back. Changing the copy in
`campaign.mjs` doesn't change a post already in the file: edit the file.

## How a post is counted

`text.mjs`, tested in `text.test.js`:

- **X:** 280. A link counts 23 however long it is, and so does a bare domain
  such as `celestiary.org` (X links those too). Latin text and punctuation
  weigh 1; CJK and emoji weigh 2.
- **Facebook:** the platform allows 63,206 characters, so the numbers here
  are the maintainer's target: **300 to 500**, over 500 is `OVER` and under
  300 is `SHORT` (a note, not an error). Characters are counted as written,
  except that a link counts 23 too, so the target is for the words round
  it. Each post has its own Facebook text, under a `#### Facebook` heading:
  a paragraph or two for a reader who doesn't know celestiary, link in the
  text.

A permalink is about 150 characters, so X's 23 for a link is what makes these
posts fit.

`--check` and the tests also hold the tone, on each text: at most two hashtags
(`#astronomy`, `#space`), no emoji, no exclamation marks, and none of a list
of hype words.

## Links to the live posts

What's new on the homepage lists the featured entries, and a featured entry
whose post is live links to it with a small X and Facebook mark. The URLs are
recorded **once, here**, and not copied by hand into the changelog:

1. Publish the post, and set its `Status` to `posted`.
2. Paste its URLs into its block's `- X:` and `- Facebook:` fields (the ones
   it went out on; leave the other empty). Add the line if an older block
   lacks it.
3. Run `yarn changelog`. It joins the URLs onto the post's `Entry` in
   `public/data/changelog.json` (`social: {x, facebook}`); commit both files.

**Why `yarn changelog` and not `yarn posts`:** `changelog.json` is built from
CHANGELOG.md by `yarn changelog` and tested to be current against its sources,
so the joined file has one writer and one freshness test; `yarn posts` writes
only `posts/drafts.md`, and would otherwise have to rewrite the changelog's
file too. Only `posted` posts are joined, a URL on a post in any other status
is reported (a problem for `yarn posts --check`), and an entry with several
posts (the thread's) takes the first URL on each platform in the file's order.

The URLs must be https on `x.com` or `twitter.com` (X) or `facebook.com`
(Facebook), or `yarn changelog` stops and names the post: they become links in
the app. `js/socialLinks.mjs` holds the rule, and the app applies it again
and drops anything else.

## Images, and what a link shows

Links don't unfurl with the scene yet. What celestiary.org gives a crawler
today (`esbuild/site.js`'s `{{SITE_HEAD}}` and `public/index.html`) is a
`<title>`, a description, a canonical link and **only `og:url`**, always
`https://celestiary.org/`: no `og:title`, no `og:description` and no
`og:image`. A crawler also never sees the `#fragment`, so every permalink
unfurls as the same page, whatever view it points to. Facebook shows such a
link as a plain title and description, with no picture. Pasting a permalink
alone makes a poor post.

So **every post, on X and on Facebook, attaches its image** and keeps the link
in the text; none of them relies on the unfurl. (On Facebook a post with a
photo shows the photo and the link as text, with no link card. Posting the
link without a photo would give the bare card.) This changes when the portal
snapshot proxy ([portal/DESIGN.md](../../portal/DESIGN.md)) is built for
celestiary, with `og:` tags per link: then a post can rely on the unfurl and
the image becomes optional.

Each post names an image:

- **An existing one** where there is one: the homepage cards in
  `public/images/home/` (`earth`, `gaia`, `occultation`, `tonight`, 600 × 375
  WebP; X and Facebook both take WebP). They are SwiftShader captures.
  `node tools/home/cards.mjs --gpu` on a machine with a GPU replaces them in
  place with sharper ones.
- **Otherwise one to render**, from the post's permalink, as a 1200 × 750
  PNG in `posts/images/` (not committed: it's in `.gitignore`). `Render` has
  the exact command. It needs a build and **a real GPU, which the sandbox
  lacks**, so these are for the maintainer:

  ```sh
  yarn build
  yarn posts --renders                         # the commands, one per line
  node tools/posts/posts.mjs --renders | sh    # or run them all (not through yarn, which adds a header line)
  ```

  `tools/home/cards.mjs --hash <fragment> --id <name> --png <dir>` is the
  card renderer pointed at any view: the HUD and the labels off, the scene
  settled, celestiary's own Earth (`--cesium` for Cesium's, which needs an
  ion token). It writes only the PNG.

**Seen on SwiftShader, unknown on a GPU:** a link without the `L` setting
(`s=...L...`, landed) to a far body (Saturn, from the Sun's end of the tour)
rendered the Sun's glare and no planet, with the same link plus `L` fine
(headless, this PR); the home cards' own links render fine. Not looked into,
and unknown on a GPU. If a render shows glare and no body, that is it:
compare with `;s=alpoUL` added to the `--hash`.

Look at each render before you attach it, and check its `Alt`, which was
written from the link and not from the picture.

What this can't make: a view that is Cesium's own (Earth's terrain, the Moon
and Mars as Cesium's tiles) needs `--cesium` and a token, so no campaign post
is about one; the homepage tour and the changelog tour are moving, so they
want a screen recording (`#;news:tour,n=3` is the tour for the campaign's
reel), not a still.

## Publishing by hand

1. Run `yarn posts`, and read `posts/drafts.md` from the top.
2. For each post you'll send: edit the text, make sure `Length` has no `OVER`
   for the platforms you're using, render or pick its image, and open its
   link in a browser to see the view it points to.
3. Paste the platform's text into its composer (the link is the last line; X
   gets the post's own block, Facebook the `#### Facebook` one), attach the
   `Image`, with its `Alt` as the image description, and post.
4. For the thread, post the first on X and reply to it with the second, and so
   on, in the file's order. Facebook has no threads: post them as separate
   posts that day, in order.
5. Mark the post `posted` (or `scheduled`, when you've queued it in the
   platform's scheduler) and commit the file.

## Tests

`bun test tools/posts` (in `yarn test`): the length and link counting for each
platform (X, Facebook), the merge (every kind of edit kept, a re-run changing nothing, a new
post added at the end of its section), the plain posts, and the campaign's own
rules: it fits every limit, is plain in tone, links views the app restores,
has an image for each post and its days are Tuesday, Thursday or Saturday.
It also checks that `posts/drafts.md` is well-formed and within its limits, so
a draft you've edited over the limit fails `yarn precommit` until you cut it
or mark it `posted` or `skip`.
