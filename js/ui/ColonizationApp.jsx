import React, {ReactElement, useCallback, useEffect, useRef, useState} from 'react'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Divider from '@mui/material/Divider'
import FormControlLabel from '@mui/material/FormControlLabel'
import IconButton from '@mui/material/IconButton'
import Paper from '@mui/material/Paper'
import Slider from '@mui/material/Slider'
import Stack from '@mui/material/Stack'
import Switch from '@mui/material/Switch'
import TextField from '@mui/material/TextField'
import ToggleButton from '@mui/material/ToggleButton'
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup'
import Typography from '@mui/material/Typography'
import useStore from '../store/useStore'
import {DEFAULT_EXPANSION, EXPANSION_APP_ID, LIMITS} from '../store/ColonizationSlice'
import {catalogPositions, computeSpread, pathTo, statsAt, yearsAtProgress} from '../scene/Colonization'
import {hopColorCss, pathColorCss} from '../scene/ColonizationLines'
import MyLocationIcon from '@mui/icons-material/MyLocation'
import PauseIcon from '@mui/icons-material/Pause'
import PlayIcon from '@mui/icons-material/PlayArrow'
import RestartIcon from '@mui/icons-material/Replay'


const ZOOM_OUT_LY = 3000
// Long enough for the drawer to paint its busy state before the ~1 s compute.
const COMPUTE_DELAY_MS = 50
// A permalink's run waits for the stars, checking this often.
const RESTORE_POLL_MS = 250
const MS_PER_SEC = 1000
const [MIN_WIDTH_PX, MAX_WIDTH_PX] = LIMITS.width
// Size attenuation's reference distance, on a log slider: 10 to 10,000 ly.
const [ATTENUATION_LOG_MIN, ATTENUATION_LOG_MAX] = LIMITS.attenuationLy.map(Math.log10)
const MAX_TRAIL = LIMITS.trail[1]


/**
 * The Human Expansion app (a widget, ui/apps.js): parameters, playback and
 * line controls for a BFS of humans spreading from the Sun to neighboring
 * stars (scene/Colonization.md).  Stopping the app removes its lines
 * (Scene.removeColonization).
 *
 * Its state is in the permalink (design/URLs.md): it reports it to the
 * widgets slice as it changes, and starts from what's there, which a
 * permalink may have set.  A permalink's run is recomputed once the stars
 * have loaded, then put back at its place on the timeline.
 *
 * @property {object} celestiary
 * @returns {ReactElement}
 */
export default function ColonizationApp({celestiary}) {
  const isColonizationVisible = useStore((state) => state.isColonizationVisible)
  const committedStar = useStore((state) => state.committedStar)
  const openSearch = useStore((state) => state.openSearch)
  const dispatchWidgets = useStore((state) => state.dispatchWidgets)
  // Where it starts: the defaults, or as a permalink left it.
  const [saved] = useState(() => useStore.getState().widgets.appStates[EXPANSION_APP_ID] ?? DEFAULT_EXPANSION)
  const [speedC, setSpeedC] = useState(saved.speedC)
  const [numNeighbors, setNumNeighbors] = useState(saved.numNeighbors)
  const [launchDelayYears, setLaunchDelayYears] = useState(saved.launchDelayYears)
  const [playSeconds, setPlaySeconds] = useState(saved.playSeconds)
  const [run, setRun] = useState(null) // {spread, pos, hipToNdx, params}
  const [isComputing, setIsComputing] = useState(false)
  const [error, setError] = useState(null)
  const [pacing, setPacing] = useState(saved.pacing)
  const [progress, setProgressState] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [style, setStyle] = useState(saved.style)
  const [pulse, setPulse] = useState(saved.pulse)
  // The star whose route is drawn: the committed star, as picked or
  // searched for, or a permalink's.
  const [routeHip, setRouteHip] = useState(saved.routeHip ?? committedStar?.hipId ?? null)
  const committedStarRef = useRef(committedStar)
  // A permalink's run, still to compute: {progress, isPlaying}.
  const restoreRef = useRef(saved.isRun ? {progress: saved.progress, isPlaying: saved.isPlaying} : null)
  const progressRef = useRef(0)
  const scene = celestiary.scene
  const spread = run ? run.spread : null
  const years = spread ? yearsAtProgress(spread, progress, pacing) : 0
  const stats = spread ? statsAt(spread, years) : null
  const selectedNdx = run && routeHip !== null ? run.hipToNdx.get(routeHip) : undefined
  const route = selectedNdx === undefined ? null : pathTo(spread, run.pos, selectedNdx, run.params.speedC)
  const routeName = committedStar && committedStar.hipId === routeHip ?
    committedStar.displayName : String(scene.stars?.catalog?.getNameOrId(routeHip) ?? '')

  // Progress is 0 to 1 along the timeline, mapped to years by pacing.
  const setProgress = useCallback((p) => {
    progressRef.current = p
    setProgressState(p)
  }, [])

  /** @param {object} [restore] A permalink's {progress, isPlaying} */
  const compute = (restore) => {
    const catalog = scene.stars && scene.stars.catalog
    if (!isCatalogReady(scene)) {
      setError('Stars are still loading')
      return
    }
    setError(null)
    setIsPlaying(false)
    setIsComputing(true)
    setTimeout(() => {
      try {
        const params = {speedC, numNeighbors, launchDelayYears}
        const {pos, originNdx, hipIds} = catalogPositions(catalog)
        const s = computeSpread(pos, originNdx, params)
        const hipToNdx = new Map()
        hipIds.forEach((hipId, i) => hipToNdx.set(hipId, i))
        scene.getColonization().setSpread(s, pos)
        // A new run is meant to be seen, even after 'x' or 'V' hid the
        // lines.  A permalink's run follows the link's own `x`.
        if (!restore && !scene.getSetting('x')) {
          scene.toggleColonization()
        }
        setRun({spread: s, pos, hipToNdx, params})
        setProgress(restore ? restore.progress : 0)
        setIsPlaying(restore ? restore.isPlaying : true)
      } catch (e) {
        setError(e.message)
      } finally {
        restoreRef.current = null
        setIsComputing(false)
      }
    }, COMPUTE_DELAY_MS)
  }

  // A permalink's run, once the stars are in.
  useEffect(() => {
    if (!restoreRef.current) {
      return undefined
    }
    const timer = setInterval(() => {
      if (isCatalogReady(scene)) {
        clearInterval(timer)
        compute(restoreRef.current)
      }
    }, RESTORE_POLL_MS)
    return () => clearInterval(timer)
  }, [])

  // A star committed (picked or searched for) is the route's; leaving it
  // (to a planet, say) clears the route.
  useEffect(() => {
    if (committedStar !== committedStarRef.current) {
      committedStarRef.current = committedStar
      setRouteHip(committedStar ? committedStar.hipId : null)
    }
  }, [committedStar])

  // Report the state, for the permalink.  While it plays, the place on the
  // timeline is the one it started from; it's written again when it stops.
  // Not while a permalink's run is still to compute: that's the state.
  useEffect(() => {
    if (restoreRef.current) {
      return
    }
    dispatchWidgets({
      type: 'appState',
      id: EXPANSION_APP_ID,
      appState: {
        ...(run ? run.params : {speedC, numNeighbors, launchDelayYears}),
        playSeconds,
        isRun: run !== null,
        progress: progressRef.current,
        isPlaying,
        pacing,
        routeHip,
        style,
        pulse,
      },
    })
  }, [dispatchWidgets, run, speedC, numNeighbors, launchDelayYears, playSeconds,
    isPlaying, isPlaying ? null : progress, pacing, routeHip, style, pulse])

  const togglePlay = () => {
    if (!isPlaying && progressRef.current >= 1) {
      setProgress(0)
    }
    setIsPlaying(!isPlaying)
  }

  // As the search bar's crosshair: open search with the picker on.  A pick
  // commits the star (committedStar), which draws its route here.
  const pickStar = () => {
    openSearch()
    useStore.setState({isStarsSelectActive: true})
  }

  const changeStyle = (change) => setStyle((s) => ({...s, ...change}))
  const changePulse = (change) => setPulse((p) => ({...p, ...change}))

  useEffect(() => {
    scene.getColonization()?.setTime(years)
  }, [scene, years])

  // Again with each run: a link's style is set before the stars, so the
  // lines, exist.
  useEffect(() => {
    scene.getColonization()?.setStyle(style)
  }, [scene, style, run])

  useEffect(() => {
    scene.getColonization()?.setPulse(pulse)
  }, [scene, pulse, run])

  useEffect(() => {
    const path = selectedNdx === undefined ? null : pathTo(run.spread, run.pos, selectedNdx, run.speedC)
    scene.getColonization()?.setPath(path ? path.path : null, run?.pos)
  }, [scene, run, selectedNdx])

  useEffect(() => {
    if (!isPlaying || !spread) {
      return undefined
    }
    let last = performance.now()
    let frame = requestAnimationFrame(function step(now) {
      const dt = (now - last) / MS_PER_SEC
      last = now
      const next = Math.min(progressRef.current + (dt / playSeconds), 1)
      setProgress(next)
      if (next >= 1) {
        setIsPlaying(false)
        return
      }
      frame = requestAnimationFrame(step)
    })
    return () => cancelAnimationFrame(frame)
  }, [isPlaying, spread, playSeconds, setProgress])

  return (
    <Stack spacing={2} sx={{p: 2, pt: 0}} data-testid='colonization-drawer'>
      <Typography variant='body2' color='text.secondary'>
        Breadth-first spread from the Sun across the star catalog.  Each star links to
        its nearest neighbors; a colony waits the launch delay, then sends ships onward.
      </Typography>
      <FormControlLabel
        label='Show lines (x)'
        control={
          <Switch
            checked={isColonizationVisible}
            onChange={() => scene.toggleColonization()}
            data-testid='colonization-drawer-show'
          />
        }
      />

      <Section title='Model'>
        <ParamField label='Speed (fraction of c)' value={speedC} onChange={setSpeedC} min={0.001} max={1} step={0.05}/>
        <ParamField label='Nearest neighbors per star' value={numNeighbors} onChange={setNumNeighbors} min={1} max={32} step={1} isInt/>
        <ParamField label='Launch delay per colony (years)' value={launchDelayYears} onChange={setLaunchDelayYears} min={0} step={50}/>
        <ParamField label='Playback duration (seconds)' value={playSeconds} onChange={setPlaySeconds} min={1} step={5}/>
        <Stack direction='row' spacing={1}>
          <Button
            variant='contained'
            onClick={() => compute()}
            disabled={isComputing}
            sx={{borderRadius: 1}}
            data-testid='colonization-drawer-run'
          >
            {isComputing ? 'Computing…' : spread ? 'Recompute' : 'Run'}
          </Button>
          <Button
            variant='outlined'
            onClick={() => scene.setCameraDistance(ZOOM_OUT_LY)}
            sx={{borderRadius: 1}}
            data-testid='colonization-drawer-zoom-out'
          >
            Zoom out
          </Button>
        </Stack>
        {error && <Typography color='error'>{error}</Typography>}
      </Section>

      {spread && (
        <Section title='Timeline'>
          <Stack direction='row' alignItems='center' spacing={1}>
            <IconButton
              onClick={togglePlay}
              aria-label={isPlaying ? 'Pause expansion' : 'Play expansion'}
              data-testid='colonization-drawer-play'
            >
              {isPlaying ? <PauseIcon/> : <PlayIcon/>}
            </IconButton>
            <IconButton
              onClick={() => setProgress(0)}
              aria-label='Restart expansion'
              data-testid='colonization-drawer-restart'
            >
              <RestartIcon/>
            </IconButton>
            <Slider
              aria-label='Expansion timeline'
              data-testid='colonization-drawer-timeline'
              value={progress}
              min={0}
              max={1}
              step={0.001}
              onChange={(e, v) => {
                setIsPlaying(false)
                setProgress(v)
              }}
            />
          </Stack>
          <Stack direction='row' alignItems='center' justifyContent='space-between'>
            <Typography variant='body2' color='text.secondary'>Pace timeline</Typography>
            <ToggleButtonGroup
              size='small'
              exclusive
              value={pacing}
              onChange={(e, v) => v && setPacing(v)}
              sx={{'& .MuiToggleButton-root': {borderRadius: 1, px: 1.5, textTransform: 'none'}}}
            >
              <ToggleButton value='stars'>By stars</ToggleButton>
              <ToggleButton value='years'>By years</ToggleButton>
            </ToggleButtonGroup>
          </Stack>
          <Box>
            <Stat label='Years since launch' value={fmt(years)}/>
            <Stat label='Stars colonized' value={`${fmt(stats.numColonized)} / ${fmt(spread.numStars)}`}/>
            <Stat label='Hop reached' value={`${stats.hop} / ${spread.maxHop}`}/>
          </Box>
          <HopLegend maxHop={spread.maxHop} hop={stats.hop}/>
        </Section>
      )}

      {spread && (
        <Section title='Selected star'>
          {route ?
            <RouteInfo name={routeName || `HIP ${routeHip}`} route={route}/> :
            <Typography variant='body2' color='text.secondary'>
              Pick a star to trace its route from the Sun.
            </Typography>}
          <Box>
            <Button
              variant='outlined'
              size='small'
              startIcon={<MyLocationIcon fontSize='small'/>}
              onClick={pickStar}
              sx={{borderRadius: 1}}
              data-testid='colonization-drawer-pick'
            >
              {route ? 'Pick another star' : 'Pick a star'}
            </Button>
          </Box>
        </Section>
      )}

      <Section title='Lines'>
        <LabeledSlider
          label='Width, first hop'
          value={style.widthFirst}
          min={MIN_WIDTH_PX}
          max={MAX_WIDTH_PX}
          step={0.5}
          format={(v) => `${v} px`}
          onChange={(v) => changeStyle({widthFirst: v})}
          testId='colonization-drawer-width-first'
        />
        <LabeledSlider
          label='Width, last hop'
          value={style.widthLast}
          min={MIN_WIDTH_PX}
          max={MAX_WIDTH_PX}
          step={0.5}
          format={(v) => `${v} px`}
          onChange={(v) => changeStyle({widthLast: v})}
          testId='colonization-drawer-width-last'
        />
        <LabeledSlider
          label='Opacity'
          value={style.opacity}
          min={0.05}
          max={1}
          step={0.05}
          format={(v) => `${Math.round(v * 100)}%`}
          onChange={(v) => changeStyle({opacity: v})}
          testId='colonization-drawer-opacity'
        />
        <FormControlLabel
          label='Size attenuation'
          control={
            <Switch
              checked={style.sizeAttenuation}
              onChange={(e) => changeStyle({sizeAttenuation: e.target.checked})}
              data-testid='colonization-drawer-attenuation'
            />
          }
        />
        {style.sizeAttenuation &&
          <LabeledSlider
            label='Full width at'
            value={Math.log10(style.attenuationLy)}
            min={ATTENUATION_LOG_MIN}
            max={ATTENUATION_LOG_MAX}
            step={0.05}
            format={(v) => `${fmt(10 ** v)} ly`}
            onChange={(v) => changeStyle({attenuationLy: 10 ** v})}
            testId='colonization-drawer-attenuation-distance'
          />}
      </Section>

      <Section title='Pulse'>
        <FormControlLabel
          label='Pulse along the hops'
          control={
            <Switch
              checked={pulse.on}
              onChange={(e) => changePulse({on: e.target.checked})}
              data-testid='colonization-drawer-pulse'
            />
          }
        />
        <ParamField label='Seconds per hop (T)' value={pulse.stepSec} onChange={(v) => changePulse({stepSec: v})} min={0.02} step={0.05}/>
        <LabeledSlider
          label='Trail (N hops)'
          value={pulse.trail}
          min={0}
          max={MAX_TRAIL}
          step={1}
          format={(v) => (v ? `${v}` : 'none')}
          onChange={(v) => changePulse({trail: v})}
          testId='colonization-drawer-trail'
        />
      </Section>

      {spread && (
        <Section title='Whole spread'>
          <Box>
            <Stat label='Longest path' value={`${spread.maxHop} hops`}/>
            <Stat label='Time to reach all' value={`${fmt(spread.maxYears)} years`}/>
            <Stat label='Hop length, median' value={`${spread.medianHopLy.toFixed(1)} ly`}/>
            <Stat label='Hop length, mean' value={`${spread.meanHopLy.toFixed(1)} ly`}/>
            <Stat label='Hop length, max' value={`${fmt(spread.maxHopLy)} ly`}/>
            {spread.numBridges > 0 && <Stat label='Bridges between clusters' value={spread.numBridges}/>}
          </Box>
        </Section>
      )}
    </Stack>
  )
}


/** @returns {boolean} Whether the star catalog has loaded */
function isCatalogReady(scene) {
  const catalog = scene.stars && scene.stars.catalog
  return Boolean(catalog && catalog.starByHip.size > 1)
}


/** @returns {ReactElement} */
function Section({title, children}) {
  return (
    <>
      <Divider/>
      <Typography variant='overline' color='text.secondary' sx={{lineHeight: 1}}>{title}</Typography>
      {children}
    </>
  )
}


/** @returns {ReactElement} */
function RouteInfo({name, route}) {
  return (
    <Paper
      variant='outlined'
      sx={{p: 1.5, borderColor: pathColorCss(), backgroundColor: 'transparent'}}
      data-testid='colonization-drawer-route'
    >
      <Typography variant='subtitle2' sx={{color: pathColorCss()}}>Sun → {name}</Typography>
      {route.hops === 0 ?
        <Typography variant='body2' color='text.secondary'>The origin.</Typography> :
        <>
          <Stat label='Hops' value={route.hops}/>
          <Stat label='Arrives after' value={`${fmt(route.arriveYears)} years`}/>
          <Stat label='In transit' value={`${fmt(route.transitYears)} years`}/>
          <Stat label='Waiting at colonies' value={`${fmt(route.waitYears)} years`}/>
          <Stat label='Route length' value={`${fmtLy(route.pathLy)} ly`}/>
          <Stat label='Straight-line distance' value={`${fmtLy(route.directLy)} ly`}/>
          <Stat label='Hop length, min' value={`${fmtLy(route.minHopLy)} ly`}/>
          <Stat label='Hop length, max' value={`${fmtLy(route.maxHopLy)} ly`}/>
          <Stat label='Hop length, mean' value={`${fmtLy(route.meanHopLy)} ly`}/>
        </>}
    </Paper>
  )
}


/** @returns {ReactElement} */
function LabeledSlider({label, value, min, max, step, format, onChange, testId}) {
  return (
    <Box>
      <Stack direction='row' justifyContent='space-between'>
        <Typography variant='body2' color='text.secondary'>{label}</Typography>
        <Typography variant='body2'>{format(value)}</Typography>
      </Stack>
      <Slider
        size='small'
        aria-label={label}
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e, v) => onChange(v)}
        data-testid={testId}
      />
    </Box>
  )
}


/** @returns {ReactElement} */
function ParamField({label, value, onChange, min, max, step, isInt = false}) {
  return (
    <TextField
      type='number'
      size='small'
      label={label}
      defaultValue={value}
      inputProps={{min, max, step}}
      onChange={(e) => {
        const num = isInt ? parseInt(e.target.value) : parseFloat(e.target.value)
        if (!isNaN(num) && num >= min && (max === undefined || num <= max)) {
          onChange(num)
        }
      }}
    />
  )
}


/** @returns {ReactElement} */
function Stat({label, value}) {
  return (
    <Stack direction='row' justifyContent='space-between'>
      <Typography variant='body2' color='text.secondary'>{label}</Typography>
      <Typography variant='body2'>{value}</Typography>
    </Stack>
  )
}


/**
 * One swatch per hop, subdivided equally along the longest path.
 *
 * @returns {ReactElement}
 */
function HopLegend({maxHop, hop}) {
  const swatches = []
  for (let h = 1; h <= maxHop; h++) {
    swatches.push(
        <Box
          key={h}
          title={`Hop ${h}`}
          sx={{
            flex: 1,
            height: 12,
            backgroundColor: hopColorCss(h, maxHop),
            opacity: h <= hop ? 1 : 0.25,
          }}
        />)
  }
  return (
    <Box>
      <Stack direction='row' sx={{border: 'solid 1px #555'}}>{swatches}</Stack>
      <Stack direction='row' justifyContent='space-between'>
        <Typography variant='caption'>hop 1</Typography>
        <Typography variant='caption'>hop {maxHop}</Typography>
      </Stack>
    </Box>
  )
}


/** @returns {string} */
function fmt(num) {
  return Math.round(num).toLocaleString()
}


/** @returns {string} Light-years, a decimal below 100 */
function fmtLy(ly) {
  return ly < 100 ? ly.toFixed(1) : fmt(ly)
}
