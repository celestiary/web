/**
 * Singleton registry of SearchProviders.  Providers register themselves once
 * their underlying data source (loader, stars catalog, places catalog) is
 * ready.  The SearchIndex consults the registry when building.
 */


const providers = []


/**
 * @param {object} provider A SearchProvider instance.
 */
export function register(provider) {
  if (!provider || typeof provider.id !== 'string') {
    throw new Error('SearchProvider must have a string id')
  }
  const existing = providers.findIndex((p) => p.id === provider.id)
  if (existing >= 0) {
    providers[existing] = provider
  } else {
    providers.push(provider)
  }
}


/** @returns {object[]} */
export function list() {
  return providers.slice()
}


/** Clear all registered providers.  Used by tests. */
export function _reset() {
  providers.length = 0
}
