import React, {ReactElement, useState} from 'react'
import Box from '@mui/material/Box'
import CircularProgress from '@mui/material/CircularProgress'
import Paper from '@mui/material/Paper'
import ToggleButton from '@mui/material/ToggleButton'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import useStore from '../store/useStore'
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


/**
 * Render-layer picker for the body the camera is near (see CESIUM.md).
 * Hidden unless the camera is near a Cesium-capable body.  Collapsed it is
 * one Layers button; expanded, Google-Maps-style tiles for each layer.
 *
 * @returns {ReactElement|null}
 */
export default function LayersButton() {
  const layerBody = useStore((state) => state.layerBody)
  const bodyLayers = useStore((state) => state.bodyLayers)
  const layerStatus = useStore((state) => state.layerStatus)
  const setBodyLayer = useStore((state) => state.setBodyLayer)
  const [isOpen, setIsOpen] = useState(false)

  if (!layerBody) {
    return null
  }
  const current = bodyLayers[layerBody] ?? 'default'
  const status = layerStatus[layerBody]
  const bodyName = capitalize(layerBody)

  const choose = (value) => {
    setBodyLayer(layerBody, value)
    setIsOpen(false)
  }

  return (
    <Box sx={{display: 'flex', flexDirection: 'row', alignItems: 'flex-start', gap: 1}}>
      {isOpen &&
        <Paper
          elevation={4}
          sx={{display: 'flex', gap: 1, p: 1, backgroundColor: 'rgba(20, 20, 20, 0.85)'}}
          data-testid='layers-button-panel'
        >
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
