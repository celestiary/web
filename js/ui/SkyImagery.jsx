import React, {useEffect, useState} from 'react'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Typography from '@mui/material/Typography'
import useStore from '../store/useStore'
import {newCameraLookTween} from '../camera'
import * as Shared from '../shared'
import {LayerSwitch} from './LayersButton'


// The layers panel's sky imagery (js/scene/sky/Sky.md, "The control"): in
// the first load, only this, which loads the section (SkySection.jsx, with
// the surveys' manifests and the layer) the first time it's drawn and hands
// it what it needs of the first load.

const MUI = {React, Box, Button, Typography, LayerSwitch}
/** The lazy module, once in: shared by every SkyImagery. */
let loaded = null


/**
 * @property {object} [celestiary] Its scene and ui, for the fields' buttons
 * @property {boolean} [divided] A hairline over it, under a body's layers
 * @property {object} [section] SkySection.jsx's module, handed in (tests)
 * @returns {?React.ReactElement}
 */
export default function SkyImagery({celestiary, divided = false, section = null}) {
  const skyOn = useStore((state) => state.skyOn)
  const setSkySurvey = useStore((state) => state.setSkySurvey)
  const [note, setNote] = useState('')
  const [m, setM] = useState(section ?? loaded)
  useEffect(() => {
    if (!m) {
      import('./SkySection.jsx').then((mod) => setM(loaded = mod))
    }
  }, [m])
  return m && <m.default
    mui={MUI}
    skyOn={skyOn}
    onSwitch={setSkySurvey}
    scene={celestiary?.scene}
    onField={(f) => setNote(m.turnToSkyField(celestiary.scene, celestiary.ui, f, {Shared, newCameraLookTween}))}
    note={note}
    divided={divided}
  />
}
