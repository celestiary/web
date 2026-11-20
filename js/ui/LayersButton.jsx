import React, {useState} from 'react'
import Box from '@mui/material/Box'
import CircularProgress from '@mui/material/CircularProgress'
import Paper from '@mui/material/Paper'
import Switch from '@mui/material/Switch'
import ToggleButton from '@mui/material/ToggleButton'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import useStore from '../store/useStore'
import SkyImagery from './SkyImagery'
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
 * An optional layer's switch in the layers panel: a labelled switch and its
 * caption (a spinner beside it while the layer loads).  The New York toggle
 * and each sky survey's are one.
 *
 * @param {object} props
 * @param {string} props.id The test id and the caption's id: `layers-button-new-york`, `layers-sky-hst-acs`
 * @param {string} props.label
 * @param {string} props.caption
 * @param {boolean} props.checked
 * @param {Function} props.onChange (on: boolean) => void
 * @param {boolean} [props.loading]
 * @param {boolean} [props.error]
 * @param {object} [props.sx] The row's own
 * @returns {React.ReactElement}
 */
export function LayerSwitch({id, label, caption, checked, onChange, loading = false, error = false, sx}) {
  return (
    <Box data-testid={id} sx={{display: 'flex', alignItems: 'center', gap: 1, boxSizing: 'border-box', ...sx}}>
      <Switch
        size='small'
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        inputProps={{'aria-label': label, 'aria-describedby': `${id}-caption`}}
        data-testid={`${id}-switch`}
        sx={{
          '& .MuiSwitch-switchBase.Mui-checked': {color: 'var(--accent)'},
          '& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track': {backgroundColor: 'var(--accent)'},
        }}
      />
      <Box sx={{display: 'flex', flexDirection: 'column', minWidth: 0, textAlign: 'left'}}>
        <Typography variant='body2' sx={{color: 'var(--ink)', lineHeight: 1.3}}>
          {label}
        </Typography>
        <Typography
          id={`${id}-caption`}
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
 * The New York layer's switch, under the renderer tiles: its caption the
 * cost while off and the load state while on (a spinner while the guest
 * builds).
 *
 * @param {object} props
 * @param {object} props.control newYorkControl's
 * @param {Function} props.onChange (on: boolean) => void
 * @returns {React.ReactElement}
 */
export function NewYorkToggle({control, onChange}) {
  return (
    <LayerSwitch
      id='layers-button-new-york'
      label={NEW_YORK_LABEL}
      {...control}
      onChange={onChange}
      // One width whatever its caption says, so the panel doesn't jump as
      // the state changes.
      sx={{width: NEW_YORK_WIDTH_PX, pt: 1, mt: 0.5, borderTop: '1px solid var(--line-hairline)'}}
    />
  )
}


/**
 * The layers panel: the layer tiles for the body the camera is near
 * (Google-Maps-style, one per layer) while it's near one, and the sky
 * imagery's surveys everywhere.  LayersButton shows it beside its button;
 * the phone dock (PhoneDock) above its bar.
 *
 * @property {object} [celestiary] For the sky imagery's fields
 * @property {Function} [onChosen] called after a body's tile is picked
 * @returns {ReactElement}
 */
export function LayerOptions({celestiary, onChosen}) {
  const layerBody = useStore((state) => state.layerBody)
  return (
    <Paper
      elevation={4}
      // Scrolls rather than run off the window: the button's top is 222 px
      // down the right-hand stack, whatever the window's size.
      sx={{
        display: 'flex', flexDirection: 'column', p: 1, backgroundColor: 'rgba(20, 20, 20, 0.85)',
        maxHeight: 'calc(100vh - 240px)', overflowY: 'auto', maxWidth: 'calc(100vw - 32px)', boxSizing: 'border-box',
      }}
      data-testid='layers-button-panel'
    >
      {layerBody && <BodyLayers layerBody={layerBody} onChosen={onChosen}/>}
      <SkyImagery celestiary={celestiary} divided={Boolean(layerBody)}/>
    </Paper>
  )
}


/**
 * The body's layer tiles, and the New York toggle under them.
 *
 * @property {string} layerBody The Cesium body in range
 * @property {Function} [onChosen] called after a tile is picked
 * @returns {ReactElement}
 */
function BodyLayers({layerBody, onChosen}) {
  const bodyLayers = useStore((state) => state.bodyLayers)
  const layerStatus = useStore((state) => state.layerStatus)
  const setBodyLayer = useStore((state) => state.setBodyLayer)
  const newYorkNear = useStore((state) => state.newYorkNear)
  const newYorkOn = useStore((state) => state.newYorkOn)
  const newYorkStatus = useStore((state) => state.newYorkStatus)
  const setNewYorkOn = useStore((state) => state.setNewYorkOn)
  const current = bodyLayer(bodyLayers, layerBody)
  const status = layerStatus[layerBody]
  const bodyName = capitalize(layerBody)
  const newYork = layerBody === 'earth' && current === 'cesium' ?
    newYorkControl({newYorkNear, newYorkOn, newYorkStatus}) : null
  const choose = (value) => {
    setBodyLayer(layerBody, value)
    onChosen?.()
  }
  return (
    <>
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
    </>
  )
}


/**
 * The layers control (see CESIUM.md and js/scene/sky/Sky.md): one Layers
 * button; open, the body's render layers while the camera is in range of a
 * Cesium-capable body, and the sky imagery's surveys everywhere.
 *
 * @property {object} [celestiary]
 * @returns {React.ReactElement}
 */
export default function LayersButton({celestiary}) {
  const [isOpen, setIsOpen] = useState(false)

  return (
    <Box sx={{display: 'flex', flexDirection: 'row', alignItems: 'flex-start', gap: 1}}>
      {isOpen && <LayerOptions celestiary={celestiary} onChosen={() => setIsOpen(false)}/>}
      <Tooltip title='Layers' describeChild>
        <ToggleButton
          value='layers'
          selected={isOpen}
          onChange={() => setIsOpen(!isOpen)}
          size='small'
          aria-label='Layers'
          aria-expanded={isOpen}
          data-testid='layers-button-toggle'
        >
          <LayersIcon/>
        </ToggleButton>
      </Tooltip>
    </Box>
  )
}
