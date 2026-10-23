// Which hosts may drive layer mode (design/LayerMode.md, "Origins"): the
// guest takes messages only from an allowed origin, and posts only to the
// host's.  Pure, for the page and its test.


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
 * The host's origin, from the page's `?host=` or its referrer, if allowed.
 *
 * @param {object} loc {search, referrer}
 * @param {Array<string>} [allowed]
 * @returns {?string}
 */
export function hostOrigin({search = '', referrer = ''}, allowed = ALLOWED_ORIGINS) {
  const fromQuery = new URLSearchParams(search).get('host')
  const candidates = [fromQuery, referrer && safeOrigin(referrer)]
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


/**
 * A NetGL transport to the host (portal-netgl's NetGLTransport shape:
 * `post` and `onMessage`), that drops any message from another window or a
 * disallowed origin, and posts only to the host's origin.  portal-netgl
 * 0.3.0's windowTransport filters by source but not origin.
 *
 * @param {object} opts
 * @param {object} opts.target the host's window (`parent`)
 * @param {string} opts.origin the host's origin
 * @param {object} [opts.win] the window to listen on
 * @param {Array<string>} [opts.allowed]
 * @returns {{post: Function, onMessage: Function}}
 */
export function originTransport({target, origin, win = globalThis, allowed = ALLOWED_ORIGINS}) {
  return {
    post(msg, transfer) {
      target.postMessage(msg, origin, transfer ?? [])
    },
    onMessage(listener) {
      const on = (ev) => {
        if (ev.source !== target || ev.origin !== origin || !isAllowedOrigin(ev.origin, allowed)) {
          return
        }
        if (ev.data && typeof ev.data === 'object') {
          listener(ev.data)
        }
      }
      win.addEventListener('message', on)
      return () => win.removeEventListener('message', on)
    },
  }
}
