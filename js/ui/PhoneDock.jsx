import React, {useEffect, useRef, useState} from 'react'
import {useLocation} from 'wouter'
import useStore from '../store/useStore'
import ARButton from './ARButton'
import {ARIcon, AboutIcon, AppsIcon, LayersIcon, MoreIcon, SettingsIcon, TimeIcon} from './DockIcons'
import DragModeToggle from './DragModeToggle'
import {LayerOptions} from './LayersButton'
import TimePanel from './TimePanel'


/**
 * The phone's one bar of controls (design/UI.md, "Phones: the dock"): Time,
 * Layers (near a Cesium body), AR, Apps and More along the bottom, each
 * opening its panel above the bar, one at a time.  At 600px wide or less it
 * takes the place of the floating controls down the right and the settings
 * buttons bottom-left (App.jsx).  Its bar's height goes to the store, for
 * the scene's inset and the widgets sheet (WidgetsDrawer); its whole height,
 * an open panel too, to `--phone-dock-height`, for the info sheet and
 * Cesium's credits.
 *
 * @property {object} celestiary
 * @property {string} timeStr the sim clock, as App has it
 * @property {boolean} isPaused
 * @property {Function} setIsPaused
 * @returns {React.ReactElement}
 */
export default function PhoneDock({celestiary, timeStr, isPaused, setIsPaused}) {
  const layerBody = useStore((state) => state.layerBody)
  const ar = useStore((state) => state.ar)
  const widgetsOpen = useStore((state) => state.widgets.isOpen)
  const dispatchWidgets = useStore((state) => state.dispatchWidgets)
  const setPhoneDockHeight = useStore((state) => state.setPhoneDockHeight)
  const [, navigate] = useLocation()
  const dockRef = useRef(null)

  // The bar's height goes to the store, for the scene's inset and the
  // widgets sheet; the whole dock's, an open panel too, to
  // --phone-dock-height, which the info sheet and Cesium's credits stand
  // on, so a panel lifts them rather than covering them.
  useEffect(() => {
    const dock = dockRef.current
    const bar = dock?.querySelector('.dock-bar')
    const root = document.documentElement
    const publish = () => {
      root.style.setProperty('--phone-dock-height', `${Math.round(dock?.getBoundingClientRect().height ?? 0)}px`)
      setPhoneDockHeight(Math.round(bar?.getBoundingClientRect().height ?? 0))
    }
    publish()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(publish)
    if (dock && bar) {
      observer?.observe(dock)
      observer?.observe(bar)
    }
    return () => {
      observer?.disconnect()
      root.style.setProperty('--phone-dock-height', '0px')
      setPhoneDockHeight(0)
    }
  }, [setPhoneDockHeight])

  return (
    <DockView
      dockRef={dockRef}
      celestiary={celestiary}
      timeStr={timeStr}
      isPaused={isPaused}
      setIsPaused={setIsPaused}
      layerBody={layerBody}
      ar={ar}
      widgetsOpen={widgetsOpen}
      onApps={() => dispatchWidgets({type: 'toggle'})}
      navigate={navigate}
    />
  )
}


/**
 * The dock as its state has it: the bar, and the open panel above it.
 *
 * @property {object} dockRef the dock's element, for its height and for
 *     telling a touch on the scene from one on the dock
 * @property {object} celestiary
 * @property {string} timeStr
 * @property {boolean} isPaused
 * @property {Function} setIsPaused
 * @property {?string} layerBody the Cesium body in range, if any
 * @property {?object} ar the AR session, if on
 * @property {boolean} widgetsOpen
 * @property {Function} onApps opens or closes the widgets drawer
 * @property {Function} navigate the router's, for Settings and About
 * @returns {React.ReactElement}
 */
export function DockView({
  dockRef, celestiary, timeStr, isPaused, setIsPaused, layerBody, ar, widgetsOpen, onApps, navigate,
}) {
  const [panel, setPanel] = useState(null)
  const time = celestiary.time
  // A panel whose button has gone (layers, away from a Cesium body) closes.
  const shown = panel === 'layers' && !layerBody ? null : panel
  const toggle = (name) => setPanel(shown === name ? null : name)

  // A touch on the scene closes the open panel.
  useEffect(() => {
    if (!shown) {
      return undefined
    }
    const onDown = (ev) => {
      if (!dockRef?.current?.contains(ev.target)) {
        setPanel(null)
      }
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [shown, dockRef])

  return (
    <div id='phone-dock' ref={dockRef} data-testid='phone-dock'>
      {(shown || ar) &&
        <div className='dock-panel' data-testid={`phone-dock-panel-${shown ?? 'ar'}`}>
          {shown === 'time' &&
            <TimePanel time={time} timeStr={timeStr} isPaused={isPaused} setIsPaused={setIsPaused}/>}
          {shown === 'layers' && <LayerOptions onChosen={() => setPanel(null)}/>}
          {shown === 'more' &&
            <div className='dock-more'>
              <div className='dock-more-row'>
                <span className='dock-more-label'>Drag</span>
                <DragModeToggle/>
              </div>
              <div className='dock-more-row'>
                <button type='button' className='dock-pill' onClick={() => navigate('/settings')}>
                  <SettingsIcon/> Settings
                </button>
                <button type='button' className='dock-pill' onClick={() => navigate('/about')}>
                  <AboutIcon/> About
                </button>
              </div>
            </div>}
          {!shown && ar && <ARButton celestiary={celestiary}/>}
        </div>}
      <nav className='dock-bar' aria-label='Controls'>
        <DockButton
          label={clockLabel(time, isPaused)}
          icon={<TimeIcon/>}
          active={shown === 'time'}
          onClick={() => toggle('time')}
          testId='time'
        />
        {layerBody &&
          <DockButton
            label='Layers'
            icon={<LayersIcon/>}
            active={shown === 'layers'}
            onClick={() => toggle('layers')}
            testId='layers'
          />}
        {ar ?
          <DockButton label='Exit AR' icon={<ARIcon/>} active onClick={() => celestiary.exitAR()} testId='ar'/> :
          <div className='dock-slot'>
            <ARButton celestiary={celestiary}/>
            <span className='dock-label'>AR</span>
          </div>}
        <DockButton
          label='Apps'
          icon={<AppsIcon/>}
          active={widgetsOpen}
          onClick={() => {
            setPanel(null)
            onApps()
          }}
          testId='apps'
        />
        <DockButton
          label='More'
          icon={<MoreIcon/>}
          active={shown === 'more'}
          onClick={() => toggle('more')}
          testId='more'
        />
      </nav>
    </div>
  )
}


/**
 * One of the bar's buttons: its icon over a word.
 *
 * @property {string} label
 * @property {React.ReactElement} icon
 * @property {boolean} active its panel open, or its mode on
 * @property {Function} onClick
 * @property {string} testId
 * @returns {React.ReactElement}
 */
function DockButton({label, icon, active, onClick, testId}) {
  return (
    <button
      type='button'
      className={`dock-slot dock-button${active ? ' active' : ''}`}
      aria-pressed={active}
      onClick={onClick}
      data-testid={`phone-dock-${testId}`}
    >
      {icon}
      <span className='dock-label'>{label}</span>
    </button>
  )
}


/** A rate's units, sim seconds per real second each, largest first. */
const RATE_UNITS = [[31557600, 'y'], [86400, 'd'], [3600, 'h'], [60, 'min'], [1, 's']]


/**
 * The Time button's word, short enough to sit under its icon: the sim
 * clock to the minute at real time, else how fast it runs, or that it's
 * paused.
 *
 * @param {object} time Time.js's: simTime (ms), timeScale (sim s per s)
 * @param {boolean} isPaused
 * @returns {string} e.g. `4:19 PM`, `Paused`, `1 d/s`, `-2 h/s`
 */
export function clockLabel(time, isPaused) {
  if (isPaused) {
    return 'Paused'
  }
  const scale = time.timeScale
  if (scale === 1) {
    return new Date(time.simTime).toLocaleTimeString('en-US', {hour: 'numeric', minute: '2-digit'})
  }
  const [per, unit] = RATE_UNITS.find(([s]) => Math.abs(scale) >= s) ?? RATE_UNITS[RATE_UNITS.length - 1]
  return `${Number(scale / per).toLocaleString('en-US', {maximumFractionDigits: 1})} ${unit}/s`
}
