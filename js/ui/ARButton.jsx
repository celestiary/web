import React, {ReactElement, useState} from 'react'
import IconButton from '@mui/material/IconButton'
import Stack from '@mui/material/Stack'
import Tooltip from '@mui/material/Tooltip'
import CenterFocusStrongIcon from '@mui/icons-material/CenterFocusStrong'
import CloseIcon from '@mui/icons-material/Close'
import ScreenSearchDesktopIcon from '@mui/icons-material/ScreenSearchDesktop'
import TuneIcon from '@mui/icons-material/Tune'
import useStore from '../store/useStore'


/**
 * Mobile AR sky-view entry point.  Three states:
 *
 *   1. AR inactive — renders an icon button "Enter AR Sky View".  Tapping
 *      it triggers `celestiary.enterAR(...)` from inside a real user
 *      gesture, which is required by iOS Safari for the sensor permission
 *      prompt to appear.
 *   2. AR pending — disabled while the controller is awaiting permissions
 *      and the first sensor sample.
 *   3. AR active — renders an Exit button plus an optional gear (only when
 *      the active pose source flagged `needsCalibration`).
 *
 * Capability gates: only mounted when DeviceOrientationEvent is available
 * AND the parent decided to render us (typically restricted to mobile via
 * `useIsMobile()`).  No GPS / camera-passthrough yet — Stage 1.
 *
 * The `onAlign` prop is wired in Stage 1d; for Stage 1a it's optional and
 * the gear is hidden if not provided.
 *
 * @param {object} props
 * @param {object} props.celestiary  Celestiary controller; must expose enterAR/exitAR
 * @param {Function} [props.onAlign]  Open the calibration tap-overlay
 * @param {{lat: number, lng: number, alt?: number, body?: string}} [props.observer]
 *   Manual observer pose for stage 1a (geolocation arrives in 1c).  When
 *   omitted, falls back to (0, 0, 2) so the user can at least see the
 *   chain working from the prime-meridian / equator point.
 * @returns {ReactElement}
 */
export default function ARButton({celestiary, onAlign, observer}) {
  const ar = useStore((s) => s.ar)
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
      await celestiary.enterAR({lat, lng, alt, body})
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
            <ScreenSearchDesktopIcon/>
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
      <Tooltip title='Exit AR Sky View'>
        <IconButton
          onClick={onExit}
          aria-label='Exit AR sky view'
          data-testid='ar-button-exit'
        >
          <CloseIcon/>
        </IconButton>
      </Tooltip>
      <CenterFocusStrongIcon fontSize='small' opacity={0.5}/>
    </Stack>
  )
}
