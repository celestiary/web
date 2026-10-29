import React, {ReactElement, useEffect, useRef, useState} from 'react'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Divider from '@mui/material/Divider'
import FormControlLabel from '@mui/material/FormControlLabel'
import Slider from '@mui/material/Slider'
import Stack from '@mui/material/Stack'
import Switch from '@mui/material/Switch'
import Typography from '@mui/material/Typography'
import useStore from '../store/useStore'
import {
  DEFAULT_RUBIN, RUBIN_APP_ID, RUBIN_MIN_EL_DEG as MIN_EL_DEG, RUBIN_RUN_END_MS as RUN_END_MS,
  RUBIN_RUN_START_MS as RUN_START_MS, RUBIN_SITE as SITE, RUBIN_TARGET as TARGET, fieldReadout,
} from '../store/rubinApp'
import {RUBIN} from '../scene/observer/instrument'
import {Quaternion, Vector3} from 'three'
import {newCameraLookTween} from '../camera'
import * as Shared from '../shared'
import PauseIcon from '@mui/icons-material/Pause'
import PlayIcon from '@mui/icons-material/PlayArrow'


const MS_PER_DAY = 86400e3
const RUN_DAYS = Math.round((RUN_END_MS - RUN_START_MS) / MS_PER_DAY)
// The run starts at 03:00 UTC: 23:00 at the site (Chile keeps UTC−4 in
// its winter), with the object rising in the east in April and crossing
// the meridian near midnight by June.
const NIGHT_START_HOURS_UTC = 3
// The clock's rate while the night plays: 256× is four and a quarter
// minutes a second, a night in about 2 minutes.
const RUN_RATE = 256
// Where the visitor stands outside: 170 m from the dome (the near plane's
// floor is 100 m on Earth, zoom.js), 2 m up, on the Sun's side by day
// (nothing lights the shaded side: it's black) and to the south-east by
// night.
const VIEW_DIST_M = 170
const VIEW_BEARING_DEG = 135
const VIEW_ALT_M = 2
// From the seat, the camera arrives looking this far along the telescope.
const SEAT_LOOK_M = 1e4
const READOUT_MS = 250
const RESTORE_POLL_MS = 250
const OUTER_SYSTEM_LY = 1.6e-3 // 100 AU
const toRad = Math.PI / 180
const toDeg = 180 / Math.PI


/**
 * A point a distance and bearing from the site, on Earth's sphere.
 *
 * @param {number} distM
 * @param {number} bearingDeg From north through east
 * @param {number} radius Earth's, metres
 * @returns {{lat: number, lng: number}}
 */
export function viewpoint(distM, bearingDeg, radius) {
  const b = bearingDeg * toRad
  return {
    lat: SITE.lat + ((distM * Math.cos(b)) / radius * toDeg),
    lng: SITE.lng + ((distM * Math.sin(b)) / (radius * Math.cos(SITE.lat * toRad)) * toDeg),
  }
}


/**
 * @param {number} ms
 * @returns {string} `15 May 2026`
 */
function dateLabel(ms) {
  return new Date(ms).toLocaleDateString('en-GB', {day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC'})
}


/**
 * The Rubin Observatory app (a widget, ui/apps.jsx; scene/rubin/Rubin.md):
 * the observatory on Cerro Pachón with the Simonyi Survey Telescope
 * following 2026 ED138, Rubin's first dwarf planet candidate, and the
 * object's apparent path on the sky over the nights that found it.  Opening
 * it builds both (Scene.getRubin); stopping removes them.
 *
 * Its state is in the permalink (`apps.rubin`): whether the path is drawn,
 * the night the slider is on, the shell, whether Rubin's optics hold
 * the field, and whether Rubin's pixel is drawn.  While it runs Rubin's
 * camera is the observer (ThreeUi.setInstrument: Rubin.md, "The optics").
 *
 * @property {object} celestiary
 * @returns {ReactElement}
 */
export default function RubinApp({celestiary}) {
  const dispatchWidgets = useStore((state) => state.dispatchWidgets)
  const [saved] = useState(() => useStore.getState().widgets.appStates[RUBIN_APP_ID] ?? DEFAULT_RUBIN)
  const [path, setPath] = useState(saved.path)
  const [nightMs, setNightMs] = useState(saved.nightMs)
  const [shell, setShell] = useState(saved.shell)
  const [optics, setOptics] = useState(saved.optics !== false)
  const [pixel, setPixel] = useState(saved.pixel === true)
  const [field, setField] = useState(null)
  const [ready, setReady] = useState(false)
  const [readout, setReadout] = useState(null)
  const rubinRef = useRef(null)
  // A watch asked from outside (askRubinWatch: the search's view), held
  // until the observatory is in.
  const watchAsked = useStore((state) => state.widgets.appStates[RUBIN_APP_ID]?.watch === true)
  const watchRef = useRef(saved.watch === true)
  const scene = celestiary.scene
  const time = celestiary.time
  const ui = celestiary.ui

  // Rubin's optics: the limit first, so a link's field with them off isn't
  // clamped by the instrument's arrival.
  useEffect(() => {
    ui.setFieldLimit?.(optics)
  }, [ui, optics])

  // Rubin's camera is the observer while the app runs; the naked eye again
  // when it stops (Scene.removeRubin does too).
  useEffect(() => {
    ui.setInstrument?.(RUBIN)
    return () => {
      if (ui.instrument === RUBIN) {
        ui.setInstrument(null)
      }
    }
  }, [ui])

  // Build the observatory and the path once Earth and the body are in.
  useEffect(() => {
    let stopped = false
    const ask = async () => {
      const rubin = await scene.getRubin()
      if (stopped) {
        return
      }
      if (!rubin) {
        setTimeout(ask, RESTORE_POLL_MS)
        return
      }
      rubinRef.current = rubin
      setReady(true)
    }
    ask()
    return () => {
      stopped = true
    }
  }, [scene])

  useEffect(() => {
    if (rubinRef.current) {
      rubinRef.current.path.visible = path
    }
  }, [path, ready])

  useEffect(() => {
    rubinRef.current?.observatory.setShell(shell)
  }, [shell, ready])

  useEffect(() => {
    if (rubinRef.current) {
      rubinRef.current.pixel.enabled = pixel
    }
  }, [pixel, ready])

  // Report the state, for the permalink.
  useEffect(() => {
    dispatchWidgets({type: 'appState', id: RUBIN_APP_ID, appState: {path, nightMs, shell, optics, pixel}})
  }, [dispatchWidgets, path, nightMs, shell, optics, pixel])

  // The telescope's pointing and the field, a few times a second.
  useEffect(() => {
    const timer = setInterval(() => {
      const state = rubinRef.current?.observatory.state
      setReadout(state ? {...state, paused: time.isPaused, ms: time.simTime} : null)
      const heightPx = ui.renderer?.domElement?.height || ui.height
      setField(fieldReadout(ui.camera.fov, ui.fieldRange?.() ?? null, heightPx, RUBIN))
    }, READOUT_MS)
    return () => clearInterval(timer)
  }, [time, ui])

  const goToObservatory = () => {
    const earth = scene.objects.earth
    const rubin = rubinRef.current
    if (!earth || !rubin) {
      return
    }
    const sun = rubin.observatory.state
    const bearing = sun && sun.sunEl > 0 ? sun.sunAz : VIEW_BEARING_DEG
    const {lat, lng} = viewpoint(VIEW_DIST_M, bearing, earth.props.radius.scalar)
    // On the observatory's own ground: the layer's sample at the viewpoint
    // has differed from the observatory's by a tile's level (a kilometre).
    scene.land('earth', lat, lng, VIEW_ALT_M, {groundHeight: rubin.observatory.altitude})
    // Landed, turn to the dome.
    Shared.targets.tweenNextFn = () => {
      Shared.targets.tween = newCameraLookTween(celestiary.ui.camera, rubin.observatory.domeWorldPosition())
      return Shared.targets.tween
    }
  }

  // The astronomer's seat: on the telescope's elevation structure, looking
  // along the tube, with 2026 ED138 targeted; tracking it once there, when
  // the telescope does, so the view holds it as the telescope holds it.
  const goToSeat = () => {
    const rubin = rubinRef.current
    if (!rubin) {
      return
    }
    const {observatory} = rubin
    const seat = observatory.seat
    celestiary.ui.scene.updateMatrixWorld()
    const seatPos = seat.getWorldPosition(new Vector3)
    const seatQuat = seat.getWorldQuaternion(new Quaternion)
    const lookAt = new Vector3(0, SEAT_LOOK_M, 0).applyQuaternion(seatQuat).add(seatPos)
    const up = new Vector3(0, 1, 0).applyQuaternion(observatory.getWorldQuaternion(new Quaternion))
    scene.rideSeat(seat, {lookAt, up})
    scene.setTarget(TARGET, {look: false})
    Shared.targets.tweenNextFn = () => {
      if (observatory.state?.tracking) {
        scene.setTracking(true)
      }
      return null
    }
  }

  const goToBody = () => {
    scene.setTarget(TARGET)
    scene.goTo()
  }

  const goToOrbit = () => {
    scene.setTarget('sun')
    scene.goTo()
    scene.setCameraDistance(OUTER_SYSTEM_LY)
  }

  const watchNight = () => {
    time.setTime(nightMs + (NIGHT_START_HOURS_UTC * 3600e3))
    time.setRate(RUN_RATE)
    time.setPaused(false)
    goToSeat()
  }

  useEffect(() => {
    if (watchAsked) {
      watchRef.current = true
    }
  }, [watchAsked])

  // The asked watch, once the observatory is in; then its mark is cleared
  // from the store (the state reported is the panel's own).
  useEffect(() => {
    if (!ready || !watchRef.current) {
      return
    }
    watchRef.current = false
    watchNight()
    dispatchWidgets({type: 'appState', id: RUBIN_APP_ID, appState: {path, nightMs, shell, optics, pixel}})
  })

  const nightDay = Math.round((nightMs - RUN_START_MS) / MS_PER_DAY)
  const el = readout ? readout.bodyEl : null

  return (
    <Box sx={{px: 2, pb: 2}} data-testid='rubin-app'>
      <Typography variant='body2' sx={{mb: 1.5}}>
        2026 ED138 is the first dwarf planet candidate found in the NSF–DOE Vera C. Rubin
        Observatory&apos;s images: about 1,000 km across, 46 au from the Sun, on a 281-year orbit beyond
        Pluto&apos;s. Matthew Holman found it on 13 October 2026 in Rubin&apos;s pictures of March to July,
        and the Minor Planet Center announced it on 27 October.
      </Typography>
      <Stack direction='row' spacing={1} useFlexGap flexWrap='wrap' sx={{mb: 1.5}}>
        <Button variant='outlined' size='small' onClick={goToObservatory} disabled={!ready} data-testid='rubin-go-observatory'>
          Observatory
        </Button>
        <Button variant='outlined' size='small' onClick={goToSeat} disabled={!ready} data-testid='rubin-go-seat'>
          Astronomer&apos;s seat
        </Button>
        <Button variant='outlined' size='small' onClick={goToBody} data-testid='rubin-go-body'>
          2026 ED138
        </Button>
        <Button variant='outlined' size='small' onClick={goToOrbit} data-testid='rubin-go-orbit'>
          Its orbit
        </Button>
      </Stack>
      <Divider sx={{my: 1.5}}/>
      <Typography variant='subtitle2'>A night&apos;s observing</Typography>
      <Typography variant='caption' color='text.secondary' display='block' sx={{mb: 1}}>
        The telescope follows 2026 ED138 whenever it is up by night, more than {MIN_EL_DEG}° over the horizon,
        and parks at the zenith with the dome shut by day. Pick a night of the run and watch it from the
        astronomer&apos;s seat on the telescope, riding its pointing and tracking the object with it, at {RUN_RATE}× time.
        Zoom in (the field of view) to see the sky it sees; scroll out to leave the seat.
      </Typography>
      <Typography variant='body2' id='rubin-night-label'>Night of {dateLabel(nightMs)}</Typography>
      <Slider
        value={nightDay}
        min={0}
        max={RUN_DAYS - 1}
        step={1}
        onChange={(e, v) => setNightMs(RUN_START_MS + (v * MS_PER_DAY))}
        aria-labelledby='rubin-night-label'
        size='small'
        data-testid='rubin-night-slider'
      />
      <Stack direction='row' spacing={1} alignItems='center' sx={{mb: 1}}>
        <Button variant='contained' size='small' startIcon={<PlayIcon/>} onClick={watchNight} disabled={!ready}
          data-testid='rubin-watch'>
          Watch the night
        </Button>
        <Button size='small' startIcon={readout?.paused ? <PlayIcon/> : <PauseIcon/>} onClick={() => time.togglePause()}
          data-testid='rubin-pause'>
          {readout?.paused ? 'Resume' : 'Pause'}
        </Button>
      </Stack>
      {readout &&
        <Box sx={{fontFamily: 'monospace', fontSize: '0.8rem', mb: 1}} data-testid='rubin-readout'>
          <div>{new Date(readout.ms).toISOString().slice(0, 16).replace('T', ' ')} UTC</div>
          <div>2026 ED138 {el >= 0 ? `${el.toFixed(1)}° up` : `${(-el).toFixed(1)}° below the horizon`}</div>
          <div>Sun {readout.sunEl.toFixed(1)}°, dome {readout.open ? 'open' : 'shut'}</div>
          <div>{readout.tracking ?
            `Tracking: azimuth ${readout.az.toFixed(1)}°, elevation ${readout.el.toFixed(1)}°` :
            'Parked at the zenith'}</div>
        </Box>}
      <Divider sx={{my: 1.5}}/>
      <FormControlLabel
        control={<Switch checked={optics} onChange={(e) => setOptics(e.target.checked)} size='small'
          data-testid='rubin-optics-switch'/>}
        label={'Rubin\'s optics'}
      />
      <Typography variant='caption' color='text.secondary' display='block' sx={{mb: 1}}>
        The field-of-view keys (, and .) zoom from the camera&apos;s {RUBIN.fieldMaxDeg}° field to where one of its
        {' '}{RUBIN.pixelScaleArcsec}″ pixels is a pixel on your screen, and stop there. Off, the field is free.
      </Typography>
      {field &&
        <Box sx={{fontFamily: 'monospace', fontSize: '0.8rem', mb: 1}} data-testid='rubin-field'>
          <div>Field {field.field}{field.end ? `, ${field.end}` : ''}</div>
          <div>Magnification {field.magnification} the eye&apos;s</div>
          <div>Rubin&apos;s pixel: {field.pixelPx} px on screen</div>
        </Box>}
      <FormControlLabel
        control={<Switch checked={pixel} onChange={(e) => setPixel(e.target.checked)} size='small'
          data-testid='rubin-pixel-switch'/>}
        label={'Rubin\'s pixel'}
      />
      <Typography variant='caption' color='text.secondary' display='block' sx={{mb: 1}}>
        A square at 2026 ED138 the camera&apos;s {RUBIN.pixelScaleArcsec}″ pixel across, and a fainter outline at
        the {RUBIN.resolutionArcsec}″ it resolves, to scale on your screen.
      </Typography>
      <FormControlLabel
        control={<Switch checked={shell} onChange={(e) => setShell(e.target.checked)} size='small' data-testid='rubin-shell-switch'/>}
        label='The dome and the building'
      />
      <Typography variant='caption' color='text.secondary' display='block' sx={{mb: 1}}>
        Off, the telescope stands on its mount in the open, to see it turn from outside.
      </Typography>
      <FormControlLabel
        control={<Switch checked={path} onChange={(e) => setPath(e.target.checked)} size='small' data-testid='rubin-path-switch'/>}
        label='Its path on the sky, March to August'
      />
      <Typography variant='caption' color='text.secondary' display='block' sx={{mb: 1}}>
        The arc is not the orbit: at 46 au the object crawls half a degree along it in five months. What
        Rubin saw is the Earth&apos;s own motion reflected, 2° of retrograde from the turn at the start of
        April. Open the path with the orbit lines on and look up from the dome.
      </Typography>
      <Typography variant='caption' color='text.secondary' display='block' data-testid='rubin-credit'>
        Telescope model: Rubin Observatory/NSF/AURA, from NOIRLab&apos;s 3D models. The dome and the object&apos;s
        surface are stand-ins.
      </Typography>
    </Box>
  )
}
