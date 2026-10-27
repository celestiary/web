// Cesium's credits, as data across the iframe (design/CesiumGuest.md): the
// guest reads what Cesium wrote into its credit container, and the host
// draws it with its own elements.  Never the guest's HTML.  Pure.


/** Most credits sent, and most characters of each one's text. */
export const MAX_CREDITS = 32
const MAX_TEXT = 300


/**
 * What Cesium shows as credits, as plain items.
 *
 * @param {object} root Cesium's credit container (a DOM element)
 * @returns {Array<{text?: string, href?: string, img?: string}>}
 */
export function creditsOf(root) {
  const items = []
  const walk = (el) => {
    if (items.length >= MAX_CREDITS) {
      return
    }
    const tag = el.tagName?.toLowerCase()
    if (tag === 'img') {
      items.push({img: el.src, href: el.closest?.('a')?.href})
      return
    }
    if (tag === 'a' && !el.querySelector?.('img')) {
      items.push({text: el.textContent, href: el.href})
      return
    }
    const kids = [...(el.children ?? [])]
    if (kids.length === 0) {
      const text = el.textContent?.trim()
      if (text) {
        items.push({text})
      }
      return
    }
    kids.forEach(walk)
  }
  walk(root)
  return sanitizeCredits(items)
}


/**
 * Keep only what the host may draw: text, http(s) links, and https or
 * data: images.
 *
 * @param {Array<object>} items
 * @returns {Array<{text?: string, href?: string, img?: string}>}
 */
export function sanitizeCredits(items) {
  if (!Array.isArray(items)) {
    return []
  }
  const out = []
  for (const item of items.slice(0, MAX_CREDITS)) {
    const credit = {}
    if (typeof item?.text === 'string' && item.text.trim()) {
      credit.text = item.text.trim().slice(0, MAX_TEXT)
    }
    if (isUrl(item?.href, ['https:', 'http:'])) {
      credit.href = item.href
    }
    if (isUrl(item?.img, ['https:']) || (typeof item?.img === 'string' && item.img.startsWith('data:image/'))) {
      credit.img = item.img
    }
    if (credit.text || credit.img) {
      out.push(credit)
    }
  }
  return out
}


/**
 * @param {*} url
 * @param {Array<string>} protocols
 * @returns {boolean}
 */
function isUrl(url, protocols) {
  if (typeof url !== 'string') {
    return false
  }
  try {
    return protocols.includes(new URL(url).protocol)
  } catch {
    return false
  }
}
