/**
 * The page's loading text (public/index.html `#loading`), shown from the
 * first paint: fades in after a moment, out when the scene is in
 * (Celestiary's reveal) or a page without a scene mounts (the guide).
 *
 * @param {object} [doc] The document
 * @returns {boolean} Whether it was showing and now fades out
 */
export function hideLoading(doc = globalThis.document) {
  const el = doc?.getElementById?.('loading')
  if (!el?.classList || el.classList.contains('done')) {
    return false
  }
  el.classList.add('done')
  // Out of the page once faded; a browser with reduced motion may not
  // transition, and a transparent element over nothing is harmless.
  el.addEventListener?.('transitionend', () => el.remove(), {once: true})
  return true
}


/** How long the loading title takes to move to the homepage's, ms. */
export const TITLE_HANDOFF_MS = 900


/**
 * The loading title becomes the homepage's (DESIGN.md "Homepage"): it
 * moves and grows from the middle of the page to where the homepage's
 * title is, as the Moon under it fades, and the homepage's title shows in its
 * place.  With no loading title to hand off (Back to the homepage, a page
 * that never showed it), or with reduced motion, the homepage's title
 * fades in.
 *
 * @param {?HTMLElement} target The homepage's title; it takes the class
 *   `title-in` when it should show
 * @param {object} [opts]
 * @param {boolean} [opts.reducedMotion]
 * @param {object} [opts.doc]
 * @returns {boolean} Whether the loading title moved
 */
export function handOffLoadingTitle(target, {reducedMotion = false, doc = globalThis.document} = {}) {
  const el = doc?.getElementById?.('loading')
  const title = el?.querySelector?.('.loading-title')
  const showTarget = () => target?.classList?.add('title-in')
  if (!target || !title || el.classList.contains('done') || reducedMotion) {
    hideLoading(doc)
    showTarget()
    return false
  }
  const from = title.getBoundingClientRect()
  const to = target.getBoundingClientRect()
  if (!(from.height > 0) || !(to.height > 0)) {
    hideLoading(doc)
    showTarget()
    return false
  }
  const dx = (to.left + (to.width / 2)) - (from.left + (from.width / 2))
  const dy = (to.top + (to.height / 2)) - (from.top + (from.height / 2))
  const scale = to.height / from.height
  el.classList.add('handoff')
  title.style.transition = `transform ${TITLE_HANDOFF_MS}ms cubic-bezier(0.25, 0.1, 0.25, 1)`
  title.style.transform = `translate(${dx}px, ${dy}px) scale(${scale})`
  let done = false
  const finish = () => {
    if (done) {
      return
    }
    done = true
    // The two are at one place and size now: the homepage's shows at
    // once (no transition), and the loading one goes.
    target.classList.add('title-in', 'title-now')
    el.remove()
  }
  title.addEventListener('transitionend', finish, {once: true})
  // In case no transitionend comes (a hidden tab).
  setTimeout(finish, TITLE_HANDOFF_MS + 200)
  return true
}
