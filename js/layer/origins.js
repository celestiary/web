// Which hosts may drive layer mode (design/LayerMode.md, "Origins"): the
// guest takes messages only from an allowed origin, and posts only to the
// host's.  The page finds the host's origin here, against a list that may
// name a host on any port, then pins portal-netgl's `parentTransport` to
// that one exact origin.  Pure, for the page and its test.


/* global __LAYER_ORIGINS__ */
/**
 * The allow-list: exact origins, or a host with any port (`http://localhost:*`).
 * A build adds more with LAYER_ORIGINS (comma-separated; esbuild/common.js),
 * never at run time.
 */
export const ALLOWED_ORIGINS = [
  'https://pablo-mayrgundter.github.io',
  'https://celestiary.org',
  'https://celestiary.github.io',
  'http://localhost:*',
  'http://127.0.0.1:*',
  ...(typeof __LAYER_ORIGINS__ === 'string' ? __LAYER_ORIGINS__.split(',').map((o) => o.trim()).filter(Boolean) : []),
]


/**
 * @param {string} origin e.g. 'http://localhost:5173'
 * @param {Array<string>} [allowed]
 * @returns {boolean}
 */
export function isAllowedOrigin(origin, allowed = ALLOWED_ORIGINS) {
  if (typeof origin !== 'string' || origin === 'null') {
    return false
  }
  return allowed.some((a) => {
    if (a.endsWith(':*')) {
      const base = a.slice(0, -2)
      return origin === base || (origin.startsWith(`${base}:`) && /^\d+$/.test(origin.slice(base.length + 1)))
    }
    return origin === a
  })
}


/**
 * The host's origin, as portal RFC 0001 §10.2 and portal-netgl's
 * `resolveParentOrigin` find it: `location.ancestorOrigins[0]` (Chromium,
 * WebKit), else the referrer's origin (Firefox), else `?host=`.  Each only
 * if it's on the allow-list: the URL may pick an allowed origin, never add
 * one.
 *
 * @param {object} loc {search, referrer, ancestors (location.ancestorOrigins)}
 * @param {Array<string>} [allowed]
 * @returns {?string}
 */
export function hostOrigin({search = '', referrer = '', ancestors = null}, allowed = ALLOWED_ORIGINS) {
  const fromQuery = new URLSearchParams(search).get('host')
  const candidates = [ancestors?.length ? ancestors[0] : null, referrer && safeOrigin(referrer), fromQuery]
  return candidates.find((o) => o && isAllowedOrigin(o, allowed)) ?? null
}


/**
 * @param {string} url
 * @returns {?string} its origin, or null if it isn't a URL
 */
function safeOrigin(url) {
  try {
    return new URL(url).origin
  } catch {
    return null
  }
}

