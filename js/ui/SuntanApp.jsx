import React, {ReactElement, useEffect, useRef, useState} from 'react'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Divider from '@mui/material/Divider'
import FormControlLabel from '@mui/material/FormControlLabel'
import IconButton from '@mui/material/IconButton'
import Slider from '@mui/material/Slider'
import Stack from '@mui/material/Stack'
import Switch from '@mui/material/Switch'
import ToggleButton from '@mui/material/ToggleButton'
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import useStore from '../store/useStore'
import {DEFAULT_SUNTAN, SUNTAN_APP_ID, SUNTAN_RATES, formatSunlight, rateLabel} from '../store/suntanApp'
import {Vector3} from 'three'
import * as Shared from '../shared'
import NextIcon from '@mui/icons-material/SkipNext'
import PauseIcon from '@mui/icons-material/Pause'
import PlayIcon from '@mui/icons-material/PlayArrow'
import PreviousIcon from '@mui/icons-material/SkipPrevious'


const DAY_S = 86400
const READOUT_MS = 250
const RESTORE_POLL_MS = 250
// The inner Solar System from above the ecliptic, a little tilted: Parker's
// orbits out to Venus's, the relay's and the lander's fall.
const VIEW_DIST_M = 2.2 * Shared.ASTRO_UNIT_METER
const VIEW_TILT_RAD = 25 * Math.PI / 180


/**
 * The Suntan app (scene/suntan/Suntan.md): a concept mission that flies a
 * Parker Solar Probe trajectory to the Sun, settles a relay into a
 * sun-synchronous orbit and drops a lander to the photosphere.  Running it
 * builds and draws the mission (Scene.getSuntan); stopping removes it.  The
 * panel plays the mission on the app's own clock, from event to event, and
 * reads the relay's or the lander's simulated sensors.
 *
 * @property {object} celestiary
 * @returns {ReactElement}
 */
export default function SuntanApp({celestiary}) {
  const dispatchWidgets = useStore((state) => state.dispatchWidgets)
  const [saved] = useState(() => useStore.getState().widgets.appStates[SUNTAN_APP_ID] ?? DEFAULT_SUNTAN)
  const [vehicle, setVehicle] = useState(saved.vehicle)
  const [paths, setPaths] = useState(saved.paths !== false)
  const [ready, setReady] = useState(false)
  const [clock, setClock] = useState({ms: celestiary.time.simTime, paused: celestiary.time.isPaused,
    rate: celestiary.time.timeScale})
  const suntanRef = useRef(null)
  const scene = celestiary.scene
  const time = celestiary.time

  // Build and draw the mission once the Sun is in.
  useEffect(() => {
    let stopped = false
    const ask = async () => {
      const suntan = await scene.getSuntan()
      if (stopped) {
        return
      }
      if (!suntan) {
        setTimeout(ask, RESTORE_POLL_MS)
        return
      }
      suntanRef.current = suntan
      setReady(true)
    }
    ask()
    return () => {
      stopped = true
    }
  }, [scene])

  useEffect(() => {
    if (suntanRef.current) {
      suntanRef.current.track.paths.visible = paths
    }
  }, [paths, ready])

  // Report the state, for the permalink.
  useEffect(() => {
    dispatchWidgets({type: 'appState', id: SUNTAN_APP_ID, appState: {vehicle, paths}})
  }, [dispatchWidgets, vehicle, paths])

  // The clock isn't React state; read it a few times a second.
  useEffect(() => {
    const timer = setInterval(() => {
      setClock({ms: time.simTime, paused: time.isPaused, rate: time.timeScale})
    }, READOUT_MS)
    return () => clearInterval(timer)
  }, [time])

  const suntan = ready ? suntanRef.current : null
  const t = clock.ms / 1000
  const state = suntan?.mission.stateAt(t, vehicle) ?? null
  const sensors = suntan && state ? suntan.readSensors(state) : null
  const events = suntan?.events ?? []
  // An event passed in the last two seconds of the clock's running still
  // counts as here, so stepping back while it runs leaves it.
  const margin = Math.max(1, Math.abs(clock.rate) * 2)
  const previous = events.filter((event) => event.t < t - margin).pop()
  const next = events.find((event) => event.t > t + margin)
  const current = events.filter((event) => event.t <= t).pop()

  const jumpTo = (event) => {
    if (event) {
      time.setTime(event.t * 1000)
      setClock((c) => ({...c, ms: event.t * 1000}))
    }
  }
  const togglePause = () => {
    time.togglePause()
    setClock((c) => ({...c, paused: time.isPaused}))
  }
  const setRate = (e, rate) => {
    if (rate !== null) {
      time.setRate(rate)
      setClock((c) => ({...c, rate: time.timeScale}))
    }
  }
  // Go to the Sun, then, once there, lift the camera over the ecliptic's
  // north (scene +Y): from the go's own side the paths are edge-on.
  // Go to a craft and ride it (Scene.goTo, as for a satellite): the camera
  // arrives a few million km off and moves with it as time runs.  Before
  // launch there's nothing to find.
  const findCraft = (id) => {
    const target = suntanRef.current?.craft[id]
    if (!target || !suntanRef.current.nodeOf(id)) {
      return
    }
    scene.setTarget(target, {look: false})
    scene.goTo()
  }
  const inFlight = Boolean(suntan) && t >= suntan.mission.tStart

  const viewFromAbove = () => {
    scene.setTarget('sun')
    scene.goTo()
    const lift = () => {
      if (Shared.targets.tween) {
        requestAnimationFrame(lift)
        return
      }
      const {camera, controls} = celestiary.ui
      const frame = camera.parent
      const target = frame.localToWorld(controls.target.clone())
      const eye = target.clone().add(new Vector3(0, Math.cos(VIEW_TILT_RAD), Math.sin(VIEW_TILT_RAD))
          .multiplyScalar(VIEW_DIST_M))
      camera.position.copy(frame.worldToLocal(eye))
      camera.lookAt(target)
      celestiary.ui.onCameraChange?.()
    }
    requestAnimationFrame(lift)
  }

  return (
    <Box sx={{px: 2, pb: 2}} data-testid='suntan-app'>
      <Typography variant='body2' sx={{mb: 1.5}}>
        A concept study: follow Parker Solar Probe&apos;s seven Venus flybys to the Sun, settle a relay into
        an orbit that turns with the Sun&apos;s surface, and drop a lander to the photosphere. Parker&apos;s
        legs are rebuilt from its flown perihelia; the rest is sized here.
      </Typography>
      <Stack direction='row' spacing={1} useFlexGap flexWrap='wrap' alignItems='center' sx={{mb: 1}}>
        <Button variant='outlined' size='small' onClick={() => findCraft('relay')} disabled={!inFlight}
          data-testid='suntan-find-relay'>
          Find the relay
        </Button>
        <Button variant='outlined' size='small' onClick={() => findCraft('lander')} disabled={!inFlight}
          data-testid='suntan-find-lander'>
          Find the lander
        </Button>
        <Button variant='outlined' size='small' onClick={viewFromAbove} data-testid='suntan-view'>
          View from above
        </Button>
        <FormControlLabel
          control={<Switch size='small' checked={paths} onChange={(e) => setPaths(e.target.checked)}
            data-testid='suntan-paths'/>}
          label={<Typography variant='body2'>Trajectory</Typography>}
        />
      </Stack>
      <Divider sx={{my: 1.5}}/>
      <Typography variant='subtitle2'>Mission</Typography>
      <Box sx={{fontFamily: 'monospace', fontSize: '0.8rem', my: 0.5}} data-testid='suntan-clock'>
        <div>{new Date(clock.ms).toISOString().slice(0, 16).replace('T', ' ')} UTC</div>
        <div>
          {!suntan ? 'Building the mission…' :
            t < suntan.mission.tStart ? 'Before launch' :
              `T+${((t - suntan.mission.tStart) / DAY_S).toFixed(1)} days · ${state?.leg.name ?? ''}`}
        </div>
      </Box>
      <Stack direction='row' alignItems='center' spacing={0.5}>
        <Tooltip title={previous ? `Back to ${previous.name}` : 'Previous event'}>
          <span>
            <IconButton size='small' onClick={() => jumpTo(previous)} disabled={!previous}
              aria-label='Previous event' data-testid='suntan-previous'>
              <PreviousIcon fontSize='small'/>
            </IconButton>
          </span>
        </Tooltip>
        <IconButton size='small' onClick={togglePause} aria-label={clock.paused ? 'Play' : 'Pause'}
          data-testid='suntan-play'>
          {clock.paused ? <PlayIcon fontSize='small'/> : <PauseIcon fontSize='small'/>}
        </IconButton>
        <Tooltip title={next ? `On to ${next.name}` : 'Next event'}>
          <span>
            <IconButton size='small' onClick={() => jumpTo(next)} disabled={!next}
              aria-label='Next event' data-testid='suntan-next'>
              <NextIcon fontSize='small'/>
            </IconButton>
          </span>
        </Tooltip>
        <ToggleButtonGroup size='small' exclusive value={SUNTAN_RATES.includes(clock.rate) ? clock.rate : null}
          onChange={setRate} aria-label='Mission speed' sx={{flexWrap: 'wrap'}}>
          {SUNTAN_RATES.map((rate) => (
            <ToggleButton key={rate} value={rate} sx={{px: 0.75, py: 0.25, textTransform: 'none', fontSize: '0.7rem'}}>
              {rateLabel(rate)}
            </ToggleButton>))}
        </ToggleButtonGroup>
      </Stack>
      {suntan &&
        <Slider
          size='small'
          aria-label='Mission time'
          min={suntan.mission.tStart}
          max={suntan.mission.tEnd}
          value={Math.min(suntan.mission.tEnd, Math.max(suntan.mission.tStart, t))}
          onChange={(e, seconds) => jumpTo({t: seconds})}
          data-testid='suntan-slider'
        />}
      {/* A native select: MUI's Select brings its menu and popover into the
          first load, over its budget (esbuild/budget.js). */}
      <Box
        component='select'
        value={current?.id ?? ''}
        onChange={(e) => jumpTo(events.find((event) => event.id === e.target.value))}
        disabled={!suntan}
        aria-label='Jump to a mission event'
        data-testid='suntan-events'
        sx={{width: '100%', p: 0.5, fontSize: '0.8rem', color: 'text.primary', bgcolor: 'background.paper',
          border: 1, borderColor: 'divider', borderRadius: 1}}
      >
        <option value='' disabled>Jump to an event</option>
        {events.map((event) => (
          <option key={event.id} value={event.id}>
            {new Date(event.t * 1000).toISOString().slice(0, 10)} {event.name}
          </option>))}
      </Box>
      <Divider sx={{my: 1.5}}/>
      <Stack direction='row' justifyContent='space-between' alignItems='center'>
        <Typography variant='subtitle2'>Sensors</Typography>
        <ToggleButtonGroup size='small' exclusive value={vehicle} onChange={(e, v) => v && setVehicle(v)}
          aria-label='Craft'>
          <ToggleButton value='relay' sx={{px: 1, py: 0.25, textTransform: 'none'}} data-testid='suntan-relay'>
            Relay
          </ToggleButton>
          <ToggleButton value='lander' sx={{px: 1, py: 0.25, textTransform: 'none'}} data-testid='suntan-lander'>
            Lander
          </ToggleButton>
        </ToggleButtonGroup>
      </Stack>
      {sensors ? <Sensors sensors={sensors} suntan={suntan}/> :
        <Typography variant='caption' color='text.secondary'>
          {suntan ? 'No readings before launch.' : ''}
        </Typography>}
      <Typography variant='caption' color='text.secondary' display='block' sx={{mt: 1}}>
        Simulated from smooth averages of the standard picture: no active regions, flares or magnetic
        sectors. Each layer says how well its temperature is agreed.
      </Typography>
    </Box>
  )
}


/**
 * @property {object} sensors readSensors'
 * @property {object} suntan install.js's, for its formatters
 * @returns {ReactElement}
 */
function Sensors({sensors, suntan}) {
  const {formatField, formatTemperature} = suntan
  const rows = [
    ['Distance', `${sensors.distanceRs.toFixed(2)} R☉, ${Math.round(sensors.altitudeKm).toLocaleString('en-US')} km up`],
    ['Speed', `${sensors.speedKms.toFixed(1)} km/s`],
    ['Sunlight', `${formatSunlight(sensors.sunlightWm2)}, ${Math.round(sensors.suns).toLocaleString('en-US')} suns`],
    ['Plate, sun-facing', formatTemperature(sensors.plateTemperatureK)],
    ['Hull, bare sphere', formatTemperature(sensors.hullTemperatureK)],
    ['Gas', formatTemperature(sensors.gasTemperatureK)],
    ['Layer', `${sensors.layer} (${sensors.agreement})`],
    ['Solar wind', `${sensors.windSpeedKms.toFixed(0)} km/s`],
    ['Magnetic field', formatField(sensors.fieldNt)],
    ['radial, azimuthal', `${formatField(sensors.fieldRadialNt)}, ${formatField(sensors.fieldAzimuthalNt)}`],
  ]
  return (
    <Box component='table' sx={{width: '100%', borderSpacing: 0, fontSize: '0.8rem', mt: 0.5}}
      data-testid='suntan-sensors'>
      <tbody>
        {rows.map(([label, value]) => (
          <tr key={label}>
            <Box component='td' sx={{color: 'text.secondary', pr: 1, whiteSpace: 'nowrap', verticalAlign: 'top'}}>
              {label}
            </Box>
            <Box component='td' sx={{textAlign: 'right'}}>{value}</Box>
          </tr>))}
      </tbody>
    </Box>
  )
}
