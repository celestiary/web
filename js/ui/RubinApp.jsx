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
  RUBIN_RUN_START_MS as RUN_START_MS, RUBIN_SITE as SITE, RUBIN_TARGET as TARGET,
} from '../store/rubinApp'
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
// Where the visitor stands: 170 m from the dome (the near plane's floor is
// 100 m on Earth, zoom.js), 2 m up, on the Sun's side by day (nothing
// lights the shaded side: it's black) and to the south-east by night.
const VIEW_DIST_M = 170
const VIEW_BEARING_DEG = 135
const VIEW_ALT_M = 2
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
 * Its state is in the permalink (`apps.rubin`): whether the path is drawn
 * and the night the slider is on.
 *
 * @property {object} celestiary
 * @returns {ReactElement}
 */
export default function RubinApp({celestiary}) {
  const dispatchWidgets = useStore((state) => state.dispatchWidgets)
  const [saved] = useState(() => useStore.getState().widgets.appStates[RUBIN_APP_ID] ?? DEFAULT_RUBIN)
  const [path, setPath] = useState(saved.path)
  const [nightMs, setNightMs] = useState(saved.nightMs)
  const [ready, setReady] = useState(false)
  const [readout, setReadout] = useState(null)
  const rubinRef = useRef(null)
  const scene = celestiary.scene
  const time = celestiary.time

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

  // Report the state, for the permalink.
  useEffect(() => {
    dispatchWidgets({type: 'appState', id: RUBIN_APP_ID, appState: {path, nightMs}})
  }, [dispatchWidgets, path, nightMs])

  // The telescope's pointing, a few times a second.
  useEffect(() => {
    const timer = setInterval(() => {
      const state = rubinRef.current?.observatory.state
      setReadout(state ? {...state, paused: time.isPaused, ms: time.simTime} : null)
    }, READOUT_MS)
    return () => clearInterval(timer)
  }, [time])

  const goToObservatory = () => {
    const earth = scene.objects.earth
    const rubin = rubinRef.current
    if (!earth || !rubin) {
      return
    }
    const sun = rubin.observatory.state
    const bearing = sun && sun.sunEl > 0 ? sun.sunAz : VIEW_BEARING_DEG
    const {lat, lng} = viewpoint(VIEW_DIST_M, bearing, earth.props.radius.scalar)
    scene.land('earth', lat, lng, VIEW_ALT_M)
    // Landed, turn to the dome.
    Shared.targets.tweenNextFn = () => {
      Shared.targets.tween = newCameraLookTween(celestiary.ui.camera, rubin.observatory.domeWorldPosition())
      return Shared.targets.tween
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
    goToObservatory()
  }

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
        and parks at the zenith with the dome shut by day. Pick a night of the run and watch it, from
        beside the dome, at {RUN_RATE}× time.
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
