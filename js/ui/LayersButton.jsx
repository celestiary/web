import React, {useState} from 'react'
import Box from '@mui/material/Box'
import CircularProgress from '@mui/material/CircularProgress'
import Paper from '@mui/material/Paper'
import Switch from '@mui/material/Switch'
import ToggleButton from '@mui/material/ToggleButton'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import useStore from '../store/useStore'
import {bodyLayer} from '../store/LayersSlice'
import {capitalize} from '../utils'
import LayersIcon from '@mui/icons-material/Layers'
import PublicIcon from '@mui/icons-material/Public'
import TravelExploreIcon from '@mui/icons-material/TravelExplore'


const OPTIONS = [
  {
    value: 'default',
    label: 'Celestiary',
    icon: PublicIcon,
    tip: 'Celestiary: realistic surface and atmosphere, tuned for orbit',
  },
  {
    value: 'cesium',
    label: 'Cesium',
    icon: TravelExploreIcon,
    tip: 'Cesium: map data, terrain and imagery for inspecting the surface',
  },
]

const TILE_PX = 64

/** The New York layer's name in the control (CESIUM.md, "New York"). */
export const NEW_YORK_LABEL = 'New York (3D city)'
const NEW_YORK_WIDTH_PX = 248


/**
 * What the New York toggle shows, from the store, or null where it can't
 * work: Earth's Cesium layer not in use (active or warming), or the camera
 * out of the city's range (newYork.js newYorkRange; CesiumLayers publishes
 * `newYorkNear`).
 * There it is hidden, not disabled: the city is a place's layer, and the
 * panel elsewhere stays as it was (design/UI.md, reveal by intent).
 *
 * @param {{newYorkNear: boolean, newYorkOn: boolean, newYorkStatus: ?string}} state
 * @returns {?{checked: boolean, loading: boolean, error: boolean, caption: string}}
 */
export function newYorkControl({newYorkNear, newYorkOn, newYorkStatus}) {
  if (!newYorkNear) {
    return null
  }
  const checked = newYorkOn === true
  const loading = checked && newYorkStatus === 'loading'
  const error = checked && newYorkStatus === 'error'
  let caption = 'Manhattan\'s buildings, about 140 MB'
  if (loading) {
    caption = 'Building the city…'
  } else if (error) {
    caption = 'The city couldn\'t load'
  } else if (checked && newYorkStatus === 'ready') {
    caption = 'Slop New York, on Cesium\'s Earth'
  }
  return {checked, loading, error, caption}
}


/**
 * The New York layer's switch, under the renderer tiles: a labelled switch,
 * its caption the cost while off and the load state while on (a spinner
 * while the guest builds).
 *
 * @param {object} props
 * @param {object} props.control newYorkControl's
 * @param {Function} props.onChange (on: boolean) => void
 * @returns {React.ReactElement}
 */
export function NewYorkToggle({control, onChange}) {
  const {checked, loading, error, caption} = control
  return (
    <Box
      data-testid='layers-button-new-york'
      sx={{
        // One width whatever its caption says, so the panel doesn't jump as
        // the state changes.
        display: 'flex', alignItems: 'center', gap: 1, width: NEW_YORK_WIDTH_PX, boxSizing: 'border-box',
        pt: 1, mt: 0.5, borderTop: '1px solid var(--line-hairline)',
      }}
    >
      <Switch
        size='small'
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        inputProps={{'aria-label': NEW_YORK_LABEL, 'aria-describedby': 'layers-new-york-caption'}}
        data-testid='layers-button-new-york-switch'
        sx={{
          '& .MuiSwitch-switchBase.Mui-checked': {color: 'var(--accent)'},
          '& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track': {backgroundColor: 'var(--accent)'},
        }}
      />
      <Box sx={{display: 'flex', flexDirection: 'column', minWidth: 0, textAlign: 'left'}}>
        <Typography variant='body2' sx={{color: 'var(--ink)', lineHeight: 1.3}}>
          {NEW_YORK_LABEL}
        </Typography>
        <Typography
          id='layers-new-york-caption'
          variant='caption'
          role={loading || error ? 'status' : undefined}
          sx={{color: error ? 'var(--ink-2)' : 'var(--ink-3)', lineHeight: 1.3, display: 'flex', alignItems: 'center', gap: 0.75}}
        >
          {loading && <CircularProgress size={12} thickness={5} sx={{color: 'var(--accent)'}}/>}
          {caption}
        </Typography>
      </Box>
    </Box>
  )
}


/**
 * Render-layer picker for the body the camera is on (see CESIUM.md).
 * Hidden unless the camera is in range of a Cesium-capable body.  Collapsed it is
 * one Layers button; expanded, Google-Maps-style tiles for each layer.
 *
 * @returns {React.ReactElement|null}
 */
export default function LayersButton() {
  const layerBody = useStore((state) => state.layerBody)
  const bodyLayers = useStore((state) => state.bodyLayers)
  const layerStatus = useStore((state) => state.layerStatus)
  const setBodyLayer = useStore((state) => state.setBodyLayer)
  const newYorkNear = useStore((state) => state.newYorkNear)
  const newYorkOn = useStore((state) => state.newYorkOn)
  const newYorkStatus = useStore((state) => state.newYorkStatus)
  const setNewYorkOn = useStore((state) => state.setNewYorkOn)
  const [isOpen, setIsOpen] = useState(false)

  if (!layerBody) {
    return null
  }
  const current = bodyLayer(bodyLayers, layerBody)
  const status = layerStatus[layerBody]
  const bodyName = capitalize(layerBody)
  const newYork = layerBody === 'earth' && current === 'cesium' ?
    newYorkControl({newYorkNear, newYorkOn, newYorkStatus}) : null

  const choose = (value) => {
    setBodyLayer(layerBody, value)
    setIsOpen(false)
  }

  return (
    <Box sx={{display: 'flex', flexDirection: 'row', alignItems: 'flex-start', gap: 1}}>
      {isOpen &&
        <Paper
          elevation={4}
          sx={{display: 'flex', flexDirection: 'column', p: 1, backgroundColor: 'rgba(20, 20, 20, 0.85)'}}
          data-testid='layers-button-panel'
        >
          <Box sx={{display: 'flex', gap: 1}}>
            {OPTIONS.map(({value, label, icon: Icon, tip}) => {
              const isCesiumError = value === 'cesium' && status === 'error'
              const isLoading = value === 'cesium' && current === 'cesium' && status === 'loading'
              return (
                <Tooltip
                  key={value}
                  title={isCesiumError ? `Cesium couldn't load for ${bodyName}` : tip}
                  describeChild
                >
                  <span>
                    <ToggleButton
                      value={value}
                      selected={current === value}
                      disabled={isCesiumError}
                      onChange={() => choose(value)}
                      aria-label={`${label} layer for ${bodyName}`}
                      data-testid={`layers-button-option-${value}`}
                      sx={{
                        'width': TILE_PX,
                        'height': TILE_PX,
                        'flexDirection': 'column',
                        'gap': 0.5,
                        'borderRadius': 2,
                        '&.Mui-selected': {
                          color: '#90caf9',
                          boxShadow: 'inset 0 0 0 2px #90caf9',
                        },
                      }}
                    >
                      {isLoading ? <CircularProgress size={24}/> : <Icon/>}
                      <Typography variant='caption' sx={{lineHeight: 1, textTransform: 'none'}}>
                        {label}
                      </Typography>
                    </ToggleButton>
                  </span>
                </Tooltip>
              )
            })}
          </Box>
          {newYork && <NewYorkToggle control={newYork} onChange={setNewYorkOn}/>}
        </Paper>
      }
      <Tooltip title={`${bodyName} layers`} describeChild>
        <ToggleButton
          value='layers'
          selected={isOpen}
          onChange={() => setIsOpen(!isOpen)}
          size='small'
          aria-label={`${bodyName} layers`}
          aria-expanded={isOpen}
          data-testid='layers-button-toggle'
        >
          <LayersIcon/>
        </ToggleButton>
      </Tooltip>
    </Box>
  )
}
