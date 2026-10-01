import React, {ReactElement, useCallback, useEffect, useRef, useState} from 'react'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Divider from '@mui/material/Divider'
import Drawer from '@mui/material/Drawer'
import IconButton from '@mui/material/IconButton'
import Slider from '@mui/material/Slider'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import ToggleButton from '@mui/material/ToggleButton'
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup'
import Typography from '@mui/material/Typography'
import CloseIcon from '@mui/icons-material/Close'
import PauseIcon from '@mui/icons-material/Pause'
import PlayIcon from '@mui/icons-material/PlayArrow'
import RestartIcon from '@mui/icons-material/Replay'
import {DEFAULT_PARAMS, catalogPositions, computeSpread, statsAt, yearsAtProgress} from '../scene/Colonization'
import {hopColorCss} from '../scene/ColonizationLines'
import useIsMobile from '../useIsMobile'


const DRAWER_WIDTH = 340
const DEFAULT_PLAY_SECONDS = 30
const ZOOM_OUT_LY = 3000
// Long enough for the drawer to paint its busy state before the ~1 s compute.
const COMPUTE_DELAY_MS = 50
const MS_PER_SEC = 1000


/**
 * Side drawer with parameters and playback for a BFS of humans spreading
 * from the Sun to neighboring stars (scene/Colonization.md).
 *
 * @property {object} scene Celestiary Scene
 * @property {boolean} isOpen
 * @property {Function} onClose
 * @returns {ReactElement}
 */
export default function ColonizationDrawer({scene, isOpen, onClose}) {
  const [speedC, setSpeedC] = useState(DEFAULT_PARAMS.speedC)
  const [numNeighbors, setNumNeighbors] = useState(DEFAULT_PARAMS.numNeighbors)
  const [launchDelayYears, setLaunchDelayYears] = useState(DEFAULT_PARAMS.launchDelayYears)
  const [playSeconds, setPlaySeconds] = useState(DEFAULT_PLAY_SECONDS)
  const [spread, setSpread] = useState(null)
  const [isComputing, setIsComputing] = useState(false)
  const [error, setError] = useState(null)
  const [pacing, setPacing] = useState('stars')
  const [progress, setProgressState] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const progressRef = useRef(0)
  const isMobile = useIsMobile()
  const years = spread ? yearsAtProgress(spread, progress, pacing) : 0
  const stats = spread ? statsAt(spread, years) : null

  // Progress is 0 to 1 along the timeline, mapped to years by pacing.
  const setProgress = useCallback((p) => {
    progressRef.current = p
    setProgressState(p)
  }, [])

  const run = () => {
    const catalog = scene.stars && scene.stars.catalog
    if (!catalog || catalog.starByHip.size <= 1) {
      setError('Stars are still loading')
      return
    }
    setError(null)
    setIsPlaying(false)
    setIsComputing(true)
    // Let the drawer render its busy state before the ~1s computation.
    setTimeout(() => {
      try {
        const {pos, originNdx} = catalogPositions(catalog)
        const s = computeSpread(pos, originNdx, {speedC, numNeighbors, launchDelayYears})
        const lines = scene.getColonization()
        lines.setSpread(s, pos)
        // A new run is meant to be seen, even after 'x' or 'V' hid the lines.
        if (!scene.getSetting('x')) {
          scene.toggleColonization()
        }
        setSpread(s)
        setProgress(0)
        setIsPlaying(true)
      } catch (e) {
        setError(e.message)
      } finally {
        setIsComputing(false)
      }
    }, COMPUTE_DELAY_MS)
  }

  const togglePlay = () => {
    if (!isPlaying && progressRef.current >= 1) {
      setProgress(0)
    }
    setIsPlaying(!isPlaying)
  }

  useEffect(() => {
    const lines = scene.getColonization()
    if (lines) {
      lines.setTime(years)
    }
  }, [scene, years])

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
    <Drawer
      anchor='right'
      variant='persistent'
      open={isOpen}
      PaperProps={{sx: {width: isMobile ? '100%' : DRAWER_WIDTH, backgroundColor: '#121212'}}}
      id='colonization-drawer'
      data-testid='colonization-drawer'
    >
      <Stack spacing={2} sx={{p: 2}}>
        <Stack direction='row' justifyContent='space-between' alignItems='center'>
          <Typography variant='h5'>Human Expansion</Typography>
          <IconButton onClick={onClose} aria-label='Close' data-testid='colonization-drawer-close'><CloseIcon/></IconButton>
        </Stack>
        <Typography variant='body2' color='text.secondary'>
          Breadth-first spread from the Sun across the star catalog.  Each star links to
          its nearest neighbors; a colony waits the launch delay, then sends ships onward.
          Segments are colored by hop, near-white for the first hop to near-black for the last.
        </Typography>

        <ParamField label='Speed (fraction of c)' value={speedC} onChange={setSpeedC} min={0.001} max={1} step={0.05}/>
        <ParamField label='Nearest neighbors per star' value={numNeighbors} onChange={setNumNeighbors} min={1} max={32} step={1} isInt/>
        <ParamField label='Launch delay per colony (years)' value={launchDelayYears} onChange={setLaunchDelayYears} min={0} step={50}/>
        <ParamField label='Playback duration (seconds)' value={playSeconds} onChange={setPlaySeconds} min={1} step={5}/>

        <Stack direction='row' spacing={1}>
          <Button variant='contained' onClick={run} disabled={isComputing} sx={{borderRadius: 1}} data-testid='colonization-drawer-run'>
            {isComputing ? 'Computing…' : spread ? 'Recompute' : 'Run'}
          </Button>
          <Button variant='outlined' onClick={() => scene.setCameraDistance(ZOOM_OUT_LY)} sx={{borderRadius: 1}} data-testid='colonization-drawer-zoom-out'>
            Zoom out
          </Button>
        </Stack>
        {error && <Typography color='error'>{error}</Typography>}

        {spread && (
          <>
            <Divider/>
            <Stack direction='row' alignItems='center' spacing={1}>
              <IconButton onClick={togglePlay} aria-label={isPlaying ? 'Pause expansion' : 'Play expansion'} data-testid='colonization-drawer-play'>
                {isPlaying ? <PauseIcon/> : <PlayIcon/>}
              </IconButton>
              <IconButton onClick={() => setProgress(0)} aria-label='Restart expansion' data-testid='colonization-drawer-restart'><RestartIcon/></IconButton>
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
            <Divider/>
            <Box>
              <Stat label='Longest path' value={`${spread.maxHop} hops`}/>
              <Stat label='Time to reach all' value={`${fmt(spread.maxYears)} years`}/>
              <Stat label='Hop length, median' value={`${spread.medianHopLy.toFixed(1)} ly`}/>
              <Stat label='Hop length, mean' value={`${spread.meanHopLy.toFixed(1)} ly`}/>
              <Stat label='Hop length, max' value={`${fmt(spread.maxHopLy)} ly`}/>
              {spread.numBridges > 0 && <Stat label='Bridges between clusters' value={spread.numBridges}/>}
            </Box>
          </>
        )}
      </Stack>
    </Drawer>
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
