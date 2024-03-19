import React, {ReactElement} from 'react'
import TextField from '@mui/material/TextField'


/** @returns {ReactElement} */
export default function NumberField({onChange, ...props}) {
  return (
    <TextField
      type='number'
      onChange={(e) => {
        const num = parseInt(e.target.value)
        if (isNaN(num)) {
          return
        }
        onChange(num)
      }}
      {...props}
    />
  )
}
