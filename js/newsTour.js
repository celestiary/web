import {holdMs, tourCaption} from './changelog'


/**
 * The changelog tour's sequencing (DESIGN.md "What's new"): the entries
 * that have a permalink, one after another.  For each: fly to its scene
 * (`go`, Celestiary's flight, which ends on the permalink's own restore),
 * show its headline and sentence as a caption once the camera is there,
 * hold while it's read, then fly on.  Pause holds the caption's clock (and
 * a flight under way: Celestiary reads `paused`); next and previous skip;
 * stop ends it.  Pure state on the frame clock, so the tests drive it with
 * numbers and a fake `go`.
 */


/** The most a frame steps the hold's clock, ms (as the homepage tour's driver). */
export const MAX_STEP_MS = 100
/** A stop whose scene never arrives (a link that doesn't resolve) is skipped after this long, ms. */
export const ARRIVAL_TIMEOUT_MS = 20000


/** Plays a list of changelog entries. */
export default class NewsTour {
  /**
   * @param {object} deps
   * @param {Function} deps.go Begins the flight to a stop's scene:
   *   called with the entry, and its index
   * @param {Function} deps.arrived Whether the camera has arrived at the
   *   stop `go` last began
   * @param {Function} [deps.onChange] Told of the state (`state`) when it
   *   changes: a new stop, arriving, pausing; with null when it ends
   * @param {Function} [deps.onEnd] Called once when the tour ends, with
   *   whether it ran out of stops (else it was stopped)
   */
  constructor({go, arrived, onChange = null, onEnd = null}) {
    this.go = go
    this.arrived = arrived
    this.onChange = onChange
    this.onEnd = onEnd
    this.stops = []
    this.index = 0
    this.active = false
    // 'flying' to the stop's scene, then 'holding' its caption.
    this.phase = 'flying'
    this.paused = false
    this._heldMs = 0
    this._flyingMs = 0
    this._lastMs = null
  }


  /**
   * The entry the tour is at.
   *
   * @returns {?object}
   */
  get entry() {
    return this.active ? this.stops[this.index] ?? null : null
  }


  /**
   * What a view of the tour shows (the caption, the controls).
   *
   * @returns {?{index: number, count: number, phase: string, paused: boolean,
   *   entry: object, caption: {headline: string, sentence: string}}}
   */
  get state() {
    const entry = this.entry
    if (!entry) {
      return null
    }
    return {
      index: this.index,
      count: this.stops.length,
      phase: this.phase,
      paused: this.paused,
      entry,
      caption: tourCaption(entry),
    }
  }


  /**
   * Begin at a stop.
   *
   * @param {Array<object>} stops Entries with a permalink (tourStops)
   * @param {number} [at] The stop to begin at
   * @returns {boolean} Whether there was anything to play
   */
  start(stops, at = 0) {
    this.stops = stops
    if (!stops.length) {
      this.active = false
      return false
    }
    this.active = true
    this.paused = false
    this._goTo(Math.min(Math.max(at, 0), stops.length - 1))
    return true
  }


  /**
   * Step the clock; from Celestiary's frame.
   *
   * @param {number} nowMs
   */
  frame(nowMs) {
    if (!this.active) {
      return
    }
    const dt = this._lastMs === null ? 0 : Math.min(Math.max(nowMs - this._lastMs, 0), MAX_STEP_MS)
    this._lastMs = nowMs
    if (this.paused) {
      return
    }
    if (this.phase === 'flying') {
      this._flyingMs += dt
      if (this.arrived()) {
        this.phase = 'holding'
        this._heldMs = 0
        this._emit()
      } else if (this._flyingMs >= ARRIVAL_TIMEOUT_MS) {
        this._advance()
      }
      return
    }
    this._heldMs += dt
    if (this._heldMs >= holdMs(tourCaption(this.entry))) {
      this._advance()
    }
  }


  /** Skip to the next stop; from the last, the tour ends. */
  next() {
    if (this.active) {
      this.paused = false
      this._advance()
    }
  }


  /** Back to the previous stop; from the first, it begins again. */
  previous() {
    if (this.active) {
      this.paused = false
      this._goTo(Math.max(this.index - 1, 0))
    }
  }


  /** Pause or carry on. */
  togglePause() {
    if (this.active) {
      this.paused = !this.paused
      this._emit()
    }
  }


  /** End it where it is. */
  stop() {
    this._end(false)
  }


  /** Drop it without ending it (Back to the homepage took the scene): nothing is told but the view. */
  abandon() {
    if (this.active) {
      this.active = false
      this.paused = false
      this.onChange?.(null)
    }
  }


  _advance() {
    if (this.index + 1 < this.stops.length) {
      this._goTo(this.index + 1)
    } else {
      this._end(true)
    }
  }


  _goTo(index) {
    this.index = index
    this.phase = 'flying'
    this._heldMs = 0
    this._flyingMs = 0
    this.go(this.stops[index], index)
    this._emit()
  }


  _end(finished) {
    if (!this.active) {
      return
    }
    this.active = false
    this.paused = false
    this.onChange?.(null)
    this.onEnd?.(finished)
  }


  _emit() {
    this.onChange?.(this.state)
  }
}
