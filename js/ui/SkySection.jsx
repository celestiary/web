/** @jsxRuntime classic */
import {skyRows, surveyFields, turnToSkyField} from '../scene/sky/install.js'


// The layers panel's sky imagery, drawn (js/scene/sky/Sky.md, "The
// control"): a switch per survey, and while one is on, a button per
// showpiece field that turns the view to it.  Lazily loaded with the
// surveys' manifests and the layer (SkyImagery.jsx loads it), and it
// imports nothing of the first load's: the MUI components, the store's
// state and the camera's turn are handed in, since a lazy chunk that shared
// MUI's modules split the first load's chunks and cost 5 KB gzipped.  So is
// React: the JSX is the classic runtime's (the pragma above), React.createElement
// on the React handed in, not an import of react/jsx-runtime, which split
// that from the first load's chunk too.

export {turnToSkyField}


/**
 * @param {object} props
 * @param {object} props.mui The first load's React, and its components: Box, Button, Typography, LayerSwitch
 * @param {Array<string>} props.skyOn The store's
 * @param {Function} props.onSwitch (key, on) => void
 * @param {Function} props.onField (field) => void, a field as surveyFields gives it
 * @param {?object} props.scene For the fields' directions
 * @param {string} props.note Under the list: a field below the horizon
 * @param {boolean} [props.divided] A hairline over it, under a body's layers
 * @returns {React.ReactElement}
 */
export default function SkySection({mui: {React, Box, Button, Typography, LayerSwitch}, skyOn, onSwitch, onField, scene, note,
  divided = false}) {
  return (
    <Box
      data-testid='layers-sky'
      sx={{
        width: 248, maxWidth: '100%', boxSizing: 'border-box', textAlign: 'left',
        ...(divided ? {pt: 1, mt: 0.5, borderTop: '1px solid var(--line-hairline)'} : {}),
      }}
    >
      <Typography variant='overline' component='h3' sx={{color: 'var(--ink-3)', lineHeight: 1.6}}>
        Sky imagery
      </Typography>
      {skyRows(skyOn).map((row) =>
        <Box key={row.key} sx={{py: 0.5}}>
          <LayerSwitch
            id={`layers-sky-${row.key}`}
            label={row.title}
            caption={row.about}
            checked={row.on}
            onChange={(on) => onSwitch(row.key, on)}
          />
          {row.fields.length > 0 &&
            <Box sx={{display: 'flex', flexWrap: 'wrap', gap: 0.5, pl: 5.5, pt: 0.5}}>
              {row.fields.map((f) =>
                <Button
                  key={f.key}
                  variant='outlined'
                  size='small'
                  disabled={!scene}
                  onClick={() => onField(surveyFields(scene, row.survey).find((g) => g.key === f.key))}
                  data-testid={`layers-sky-${row.key}-field-${f.key}`}
                  sx={{textTransform: 'none', py: 0, px: 1, minWidth: 0, fontSize: '0.75rem'}}
                >
                  {f.label}
                </Button>)}
            </Box>}
        </Box>)}
      {note &&
        <Typography variant='caption' role='status' sx={{color: 'var(--ink-2)', display: 'block', pt: 0.5}}
          data-testid='layers-sky-note'>
          {note}
        </Typography>}
    </Box>
  )
}
