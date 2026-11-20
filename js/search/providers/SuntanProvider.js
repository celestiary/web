/** @typedef {import('../SearchProvider.js').SearchEntry} SearchEntry */


/**
 * The Suntan app's craft (scene/suntan/Suntan.md), the relay and the
 * lander, as search results of kind 'craft' while the app runs, and none
 * otherwise: Go targets one and goes to it, riding it as a satellite is
 * ridden (Scene.goTo); a pick targets it.  Registered once
 * (Celestiary._registerSearchProviders); the scene says when the app starts
 * or stops (Scene.onSuntanChange), which rebuilds the index.  The targets
 * are the feature's own (Scene.suntan.craft), so nothing of it is imported
 * here, in the first load.
 */
export default class SuntanProvider {
  /** @param {object} scene The Scene, whose `suntan` is the running feature or null */
  constructor(scene) {
    this.id = 'suntan'
    this.lazy = false
    this.scene = scene
  }


  /** @returns {SearchEntry[]} */
  collectAll() {
    const craft = this.scene.suntan?.craft
    if (!craft) {
      return []
    }
    return Object.values(craft).map((target) => ({
      id: `craft:suntan-${target.id}`,
      displayName: target.name,
      aliases: target.id === 'relay' ?
        ['suntan', 'relay orbiter', 'sun-synchronous relay'] : ['suntan', 'sun lander'],
      kind: 'craft',
      path: 'milkyway/sun',
      parent: null,
      payload: {target},
    }))
  }
}
