/** @typedef {import('../SearchProvider.js').SearchEntry} SearchEntry */


/**
 * Views: the apps' ways in (store/appViews.js), as search
 * results of kind 'view': "Watch 2026 ED138 from the Rubin Observatory".
 * Go opens the app and runs the view (`payload.open`, with the
 * Celestiary); a pick or Look at targets the view's body
 * (`payload.target`), so the panel shows it meanwhile.  Static: an app's
 * views are declared with it, so the provider is built once
 * (Celestiary._registerSearchProviders).
 */
export default class ViewsProvider {
  /**
   * @param {Array<{id: string, name: string, aliases?: string[], path: string, target?: string,
   *   open: (celestiary: object) => void}>} views
   */
  constructor(views) {
    this.id = 'views'
    this.lazy = false
    this.views = views
  }


  /** @returns {SearchEntry[]} */
  collectAll() {
    return this.views.map((v) => ({
      id: `view:${v.id}`,
      displayName: v.name,
      aliases: v.aliases ? v.aliases.slice() : [],
      kind: 'view',
      path: v.path,
      parent: null,
      payload: {open: v.open, target: v.target ?? null},
    }))
  }
}
