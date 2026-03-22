import * as THREE from 'three'
import Animation from './Animation'
import ControlPanel from './ControlPanel'
import Keys from './Keys'
import Loader from './Loader'
import Scene from './Scene'
import ThreeUi from './ThreeUI'
import Time from './Time'
import reifyMeasures from './reify'
import * as Shapes from './shapes'
import * as Shared from './shared'
import {assertArgs} from './assert'
import {elt} from './utils'


/** Main application class. */
export default class Celestiary {
  /**
   * @param {Element} store Zustand store for sharing application state
   * @param {Element} canvasContainer
   * @param {Element} navElt
   * @param {Function} setTimeStr
   * @param {Function} setIsPaused
   */
  constructor(useStore, canvasContainer, navElt, setTimeStr, setIsPaused) {
    assertArgs(...arguments)
    this.useStore = useStore
    this.time = new Time(setTimeStr)
    this.setIsPaused = setIsPaused
    this.animation = new Animation(this.time)
    canvasContainer.style.width = `${window.innerWidth}px`
    canvasContainer.style.height = `${window.innerHeight}px`
    const animCb = (scene) => {
      this.animation.animate(scene)
      if (Shared.targets.track) {
        this.scene.lookAtTarget()
      }
    }
    this.ui = new ThreeUi(canvasContainer, animCb)
    this.ui.configLargeScene()
    this.ui.useStore = useStore
    this.scene = new Scene(this.ui)
    this.loader = new Loader()
    this.controlPanel = new ControlPanel(navElt, this.loader)
    this.load()
    this.setupPathListeners()
    this.setupKeyListeners(useStore)
    canvasContainer.addEventListener('mousedown', (e) => e.preventDefault())
    this.navVisible = true
    // these are here for convenience debugging from jsconsole.
    this.shared = Shared
    this.shapes = Shapes
    this.three = THREE
    this.toggleHelp = null
    window.c = this
    this.firstTime = true
  }


  /** @returns {string} */
  getTime() {
    if (this.time === null) {
      throw new Error('Null time')
    }
    return this.time
  }


  /** */
  load() {
    let path
    if (location.hash) {
      path = location.hash.substring(1)
    } else {
      path = DEFAULT_TARGET
      location.hash = path
    }
    this.onLoad = (name, obj) => {
      reifyMeasures(obj)
      this.scene.add(obj)
    }
    this.onDone = (path, obj) => {
      this.controlPanel.showNavDisplay(path.split('/'), this.loader)
      // TODO(pablo): Hack to handle load order.  The path is loaded,
      // but not yet animated so positions will be incorrect.  So
      // schedule this after the next pass.
      setTimeout(() => {
        const parts = path.split('/')
        let targetName = parts[parts.length - 1]
        if (targetName.indexOf('-') >= 0) {
          targetName = targetName.split('-')[0]
        }
        this.scene.targetNamed(targetName)
        this.scene.goTo()
        if (this.firstTime) {
          this.scene.toggleAsterisms()
          this.scene.toggleStarLabels()
          this.firstTime = false
        }
      }, 0)
    }
    this.loader.loadPath('milkyway', this.onLoad, () => {
      this.loader.loadPath(path, this.onLoad, this.onDone, () => {
        // On error.
        setTimeout(() => location.hash = DEFAULT_TARGET, 1000)
      })
    })
  }


  /** */
  goTo() {
    const tObj = this.shared.targets.obj
    if (tObj) {
      if (tObj.props && tObj.props.name) {
        const path = this.loader.pathByName[tObj.props.name]
        if (path) {
          window.location.hash = path
        } else {
          console.error(`no loaded path for ${tObj.props.name}: ${path}`)
        }
      } else {
        console.error('target obj has no name prop: ', tObj)
      }
    } else {
      console.error('no target obj!')
    }
  }


  setupPathListeners() {
    window.addEventListener('hashchange', (e) => {
      this.loader.loadPath((window.location.hash || '#').substring(1), this.onLoad, this.onDone)
    },
    false)
  }


  setupKeyListeners(useStore) {
    const k = new Keys(window, useStore)

    // Order determines listing in Settings panel.

    // Nav panels
    k.map('v', () => {
      const panels = [elt('nav-id'), elt('top-right')]
      panels.map((panel) => {
        panel.style.visibility = this.navVisible ? 'hidden' : 'visible'
      })
      this.navVisible = !this.navVisible
    }, 'Hide/show navigation panels')

    // Scene elements
    k.map('a', () => {
      this.scene.toggleAsterisms()
    },
    'Show/hide constellations')
    k.map('p', () => {
      this.scene.togglePlanetLabels()
    },
    'Show/hide planet and moon names')
    k.map('s', () => {
      this.scene.toggleStarLabels()
    },
    'Show/hide star names')
    k.map('o', () => {
      this.scene.toggleOrbits()
    },
    'Show/hide orbits')

    // Time
    k.map(' ', () => {
      this.setIsPaused(this.time.togglePause())
    },
    'Toggle time pause')
    k.map('\\', () => {
      this.time.changeTimeScale(0)
    },
    'Change time scale to real-time')
    k.map('!', () => {
      this.time.setTimeToNow()
    },
    'Set time to now')
    k.map('j', () => {
      this.time.invertTimeScale()
    },
    'Reverse time')
    k.map('k', () => {
      this.time.changeTimeScale(-1)
    },
    'Slow down time')
    k.map('l', () => {
      this.time.changeTimeScale(1)
    },
    'Speed up time')
    k.map('n', () => {
      this.time.setTimeToNow()
    },
    'Set time to now')

    // View
    k.map(',', () => {
      this.ui.multFov(0.9)
    },
    'Narrow field-of-vision')
    k.map('.', () => {
      this.ui.multFov(1.1)
    },
    'Broaden field-of-vision')
    k.map('/', () => {
      this.ui.resetFov()
    },
    `Reset field-of-vision to ${ Shared.INITIAL_FOV }º`)

    // Numbered views
    k.map('0', () => {
      this.scene.targetCurNode()
    },
    'Target current system')
    for (let i = 1; i <= 9; i++) {
      k.map(`${i}`, () => {
        const ndx = i
        this.scene.targetNode(ndx)
      },
      `Look at child ${i} of current system`)
    }
    k.map('c', () => {
      this.scene.lookAtTarget()
    },
    'Look at target')
    k.map('f', () => {
      this.scene.follow()
    },
    'Follow current node')
    k.map('g', () => {
      this.goTo()
    },
    'Go to target node')
    k.map('t', () => {
      this.scene.track()
    },
    'Track target node')
    k.map('u', () => {
      this.scene.targetParent()
    },
    'Look at parent of current system')

    // Arrow keys use held-key logic in ThreeUI._initArrowKeys; no-op here for Settings listing.
    k.map('ArrowUp', () => {}, 'Pitch camera up (hold)')
    k.map('ArrowDown', () => {}, 'Pitch camera down (hold)')
    k.map('ArrowLeft', () => {}, 'Roll camera left (hold)')
    k.map('ArrowRight', () => {}, 'Roll camera right (hold)')
    k.msgs['MOUSEDRAG'] = 'Drag to pitch/yaw camera'
    k.msgs['ALT+MOUSEDRAG'] = 'Option+drag to orbit target'

    this.keys = k
  }


  /** */
  hideActiveDialog() {
    document.querySelectorAll('.dialog').forEach((e) => this.hideElt(e))
  }


  /** @param {Element} elt */
  hideElt(e) {
    e.style.display = 'none'
  }


  /**
   * @param {Element} elt
   * @returns {boolean} Iff showing
   */
  toggleEltDisplay(e) {
    if (e.style.display === 'block') {
      this.hideElt(elt)
      return false
    } else {
      this.hideActiveDialog()
      e.style.display = 'block'
      return true
    }
  }


  /** */
  hideHelpOnEscape() {
    const keysElt = elt('keys-id')
    keysElt.style.display = 'none'
  }
}


const DEFAULT_TARGET = 'sun'
