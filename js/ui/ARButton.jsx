import React, {ReactElement, useState} from 'react'
import IconButton from '@mui/material/IconButton'
import Stack from '@mui/material/Stack'
import Tooltip from '@mui/material/Tooltip'
import BlurOnIcon from '@mui/icons-material/BlurOn'
import BoltIcon from '@mui/icons-material/Bolt'
import CloseIcon from '@mui/icons-material/Close'
import TuneIcon from '@mui/icons-material/Tune'
import ViewInArIcon from '@mui/icons-material/ViewInAr'
import WavesIcon from '@mui/icons-material/Waves'
import useStore from '../store/useStore'


/** Geolocation timeout for AR observer-fix.  Long enough for the OS to
 * fall back from GPS to wifi/cell, short enough not to make the AR
 * button feel hung. */
const GEO_TIMEOUT_MS = 5000

/** Cached fix freshness — re-use last reading if it's under this old. */
const GEO_MAX_AGE_MS = 60 * 1000


/**
 * Damping presets surfaced as inline icon buttons in the active-AR
 * tray.  Names must match the keys of `ALPHA_FILTER_PRESETS` in
 * `js/ar/DeviceOrientationPoseSource.js`.  Increasing visual intensity
 * (Bolt → Waves → BlurOn) maps to increasing smoothing.
 */
const DAMPING_BUTTONS = [
  {name: 'light', icon: <BoltIcon fontSize='small'/>, tip: 'Light damping (responsive, more jitter)'},
  {name: 'medium', icon: <WavesIcon fontSize='small'/>, tip: 'Medium damping (balanced — default)'},
  {name: 'heavy', icon: <BlurOnIcon fontSize='small'/>, tip: 'Heavy damping (very smooth, more lag)'},
]


/**
 * Mobile AR sky-view entry point.  Three states:
 *
 *   1. AR inactive — renders an icon button "Enter AR Sky View".  Tapping
 *      it triggers `celestiary.enterAR(...)` from inside a real user
 *      gesture, which is required by iOS Safari for the sensor permission
 *      prompt to appear.
 *   2. AR pending — disabled while the controller is awaiting permissions
 *      and the first sensor sample.
 *   3. AR active — renders an Exit button, an optional gear (when the
 *      pose source flagged `needsCalibration`), and three damping mode
 *      selectors that swap the alpha-axis 1€ filter preset on the
 *      running pose source.
 *
 * @param {object} props
 * @param {object} props.celestiary  Celestiary controller; must expose
 *   enterAR / exitAR / setARAlphaDamping
 * @param {Function} [props.onAlign]  Open the calibration tap-overlay
 * @param {{lat: number, lng: number, alt?: number, body?: string}} [props.observer]
 *   Manual observer pose override.  When omitted, ARButton requests
 *   browser geolocation.
 * @returns {ReactElement}
 */
export default function ARButton({celestiary, onAlign, observer}) {
  const ar = useStore((s) => s.ar)
  const damping = useStore((s) => s.arAlphaDamping)
  const setStoreDamping = useStore((s) => s.setARAlphaDamping)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState(null)

  const isActive = !!ar
  const lat = observer?.lat ?? 0
  const lng = observer?.lng ?? 0
  const alt = observer?.alt ?? 2
  const body = observer?.body

  const onEnter = async () => {
    if (pending || isActive) {
      return
    }
    setPending(true)
    setError(null)
    try {
      // Best-effort geolocation — the AR sky view is only meaningful when
      // the simulated celestial sphere matches what's actually overhead.
      // The observer prop, when provided, wins; otherwise we ask the
      // browser for real coords.  Permission denied / timeout / no
      // geolocation API just falls back to the (0, 0) default rather
      // than blocking the AR entry — the user can still validate the
      // sensor → camera frame chain there, just without local-sky truth.
      let actualLat = lat
      let actualLng = lng
      if (!observer && typeof navigator !== 'undefined' && navigator.geolocation) {
        try {
          const pos = await new Promise((resolve, reject) => {
            navigator.geolocation.getCurrentPosition(resolve, reject, {
              enableHighAccuracy: false, // city-block accuracy is plenty for sky alignment
              timeout: GEO_TIMEOUT_MS,
              maximumAge: GEO_MAX_AGE_MS,
            })
          })
          actualLat = pos.coords.latitude
          actualLng = pos.coords.longitude
        } catch (geoErr) {
          // Surface as a non-blocking warning; AR still enters.
          console.warn('AR: geolocation unavailable, using default (0, 0):', geoErr?.message ?? geoErr)
        }
      }
      await celestiary.enterAR({lat: actualLat, lng: actualLng, alt, body})
      // Apply current store damping to the freshly-started pose source —
      // pose source seeded itself at its own default; user's last
      // selection should win.
      celestiary.setARAlphaDamping?.(damping)
    } catch (e) {
      setError(e.message ?? String(e))
    } finally {
      setPending(false)
    }
  }

  const onExit = () => {
    celestiary.exitAR()
    setError(null)
  }

  const onPickDamping = (name) => () => {
    setStoreDamping(name)
    celestiary.setARAlphaDamping?.(name)
  }

  if (!isActive) {
    return (
      <Tooltip title={error ?? 'Enter AR Sky View'}>
        <span>
          <IconButton
            onClick={onEnter}
            disabled={pending}
            aria-label='Enter AR sky view'
            data-testid='ar-button-enter'
          >
            <ViewInArIcon/>
          </IconButton>
        </span>
      </Tooltip>
    )
  }

  return (
    <Stack direction='row' spacing={0.5} alignItems='center'>
      {ar.needsCalibration && onAlign && (
        <Tooltip title='Align: tap a known star or planet to calibrate the sky'>
          <IconButton
            onClick={onAlign}
            aria-label='Calibrate AR alignment'
            data-testid='ar-button-calibrate'
          >
            <TuneIcon/>
          </IconButton>
        </Tooltip>
      )}
      {DAMPING_BUTTONS.map((b) => (
        <Tooltip key={b.name} title={b.tip}>
          <IconButton
            onClick={onPickDamping(b.name)}
            aria-label={`Damping: ${b.name}`}
            aria-pressed={damping === b.name}
            data-testid={`ar-button-damping-${b.name}`}
            sx={{
              opacity: damping === b.name ? 1 : 0.4,
              p: '4px',
            }}
          >
            {b.icon}
          </IconButton>
        </Tooltip>
      ))}
      <Tooltip title='Exit AR Sky View'>
        <IconButton
          onClick={onExit}
          aria-label='Exit AR sky view'
          data-testid='ar-button-exit'
        >
          <CloseIcon/>
        </IconButton>
      </Tooltip>
    </Stack>
  )
}
