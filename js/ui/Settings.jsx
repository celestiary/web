import React, {ReactElement, useEffect, useState} from 'react'
import {useLocation} from 'wouter'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Checkbox from '@mui/material/Checkbox'
import FormControlLabel from '@mui/material/FormControlLabel'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import Dialog from './Dialog'


/** Display labels for non-printable / multi-char keys.  Lookup by `event.key`
 * (which is `'ArrowUp'`, not `'ARROWUP'` — the previous all-caps map never
 * matched, so arrow keys appeared as their full string in the panel). */
const KEY_LABELS = {
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  ' ': 'Spc',
}

/** Group rendering order in the Settings dialog.  Groups not listed here
 * (or whose entries have no group label) fall through to "Other" at the
 * bottom. */
const GROUP_ORDER = ['Info', 'Labels', 'Orbits', 'Grids', 'Time', 'Camera', 'Targeting']
const OTHER_GROUP = 'Other'


/**
 * Settings dialog: lists every keyboard shortcut and click-only action
 * registered with `Keys`, grouped by `keys.groups[c]` / `action.group`.
 * Each group has its own master checkbox: indeterminate when members are
 * mixed, checked when all on, unchecked when all off.  Master click
 * forces all members in the group to true if any are false, otherwise
 * to false.
 *
 * @param {object} props
 * @param {object} props.keys      Keys instance (keymap, msgs, toggleStates, groups, actions)
 * @param {string} [props.href]    Wouter href to navigate to on close
 * @returns {ReactElement}
 */
export default function Settings({keys, href = '~/'}) {
  const [isOpen, setIsOpen] = useState(false)
  // Bumped on every toggle / master click so checkboxes re-evaluate
  // their getState().  Toggles flipped via the keyboard while the dialog
  // is open won't auto-refresh — fine for now.
  const [refreshTick, setRefreshTick] = useState(0)
  const [location] = useLocation()
  useEffect(() => setIsOpen(location === '/settings'), [location])
  const refresh = () => setRefreshTick((t) => t + 1)
  const groups = buildGroups(keys)
  return (
    <Dialog title='Settings' isOpen={isOpen} setIsOpen={setIsOpen} onCloseHref={href}>
      <Box data-refresh={refreshTick}>
        {groups.map((g) => (
          <Group key={g.title} group={g} onChange={refresh}/>
        ))}
      </Box>
    </Dialog>
  )
}


/**
 * One Settings section: title row with master checkbox, then per-entry rows.
 *
 * @param {object} props
 * @param {{title: string, entries: object[]}} props.group
 * @param {Function} props.onChange  Called after any toggle to refresh parent
 * @returns {ReactElement}
 */
function Group({group, onChange}) {
  const toggleEntries = group.entries.filter((e) => e.getState)
  const onCount = toggleEntries.filter((e) => !!e.getState()).length
  const allOn = toggleEntries.length > 0 && onCount === toggleEntries.length
  const allOff = onCount === 0
  const onMaster = () => {
    // If any are off → turn all on; if all on → turn all off.  Single
    // toggle pass per entry (idempotent if already in target state by
    // testing getState before flipping).
    const target = !allOn
    for (const e of toggleEntries) {
      if (!!e.getState() !== target) {
        e.fn()
      }
    }
    onChange()
  }
  return (
    <Box sx={{mb: '0.75em'}}>
      <Stack direction='row' alignItems='center' sx={{borderBottom: '1px solid rgba(255,255,255,0.15)'}}>
        {toggleEntries.length > 0 ? (
          <Checkbox
            size='small'
            checked={allOn}
            indeterminate={!allOn && !allOff}
            onChange={onMaster}
          />
        ) : <Box sx={{width: '38px'}}/>}
        <Typography variant='subtitle2' sx={{fontWeight: 600}}>{group.title}</Typography>
      </Stack>
      <Box sx={{pl: '1.5em'}}>
        {group.entries.map((entry, ndx) => (
          <Entry key={ndx} entry={entry} onChange={onChange}/>
        ))}
      </Box>
    </Box>
  )
}


/**
 * One row in a group — checkbox-with-label for toggles, key-button for
 * one-shot actions.
 *
 * @param {object} props
 * @param {object} props.entry  {key?, fn, msg, getState?}
 * @param {Function} props.onChange
 * @returns {ReactElement}
 */
function Entry({entry, onChange}) {
  const handleToggle = () => {
    entry.fn()
    onChange()
  }
  if (entry.getState) {
    const label = entry.key ?
      <><code style={{display: 'inline-block', minWidth: '1.5em', marginRight: '0.6em', opacity: 0.6}}>{labelFor(entry.key)}</code>{entry.msg}</> :
      entry.msg
    return (
      <Box>
        <FormControlLabel
          control={<Checkbox size='small' checked={!!entry.getState()} onChange={handleToggle}/>}
          label={label}
        />
      </Box>
    )
  }
  // One-shot action
  return (
    <Stack direction='row' alignItems='center' spacing={1} sx={{py: '0.15em'}}>
      {entry.key ?
        <Button size='small' onClick={entry.fn} sx={{minWidth: '2em', px: '0.4em'}}>{labelFor(entry.key)}</Button> :
        <Button size='small' onClick={entry.fn} sx={{minWidth: '2em', px: '0.4em'}}>•</Button>}
      <span>{entry.msg}</span>
    </Stack>
  )
}


/** @param {string} k */
function labelFor(k) {
  return KEY_LABELS[k] ?? k
}


/**
 * Walk `keys.keymap` and `keys.actions` and bucket each entry into its
 * group.  Preserves registration order within a group; emits groups in
 * `GROUP_ORDER`, with anything else under `OTHER_GROUP` last.
 *
 * @param {object} keys  Keys instance
 * @returns {Array<{title: string, entries: object[]}>}
 */
function buildGroups(keys) {
  const buckets = new Map()
  // Keymap entries — preserve insertion order.
  for (const key of numbersLastIterator(keys.keymap)) {
    const group = keys.groups?.[key] ?? OTHER_GROUP
    if (!buckets.has(group)) {
      buckets.set(group, [])
    }
    const entry = {
      key,
      fn: keys.keymap[key],
      msg: keys.msgs[key],
    }
    const getState = keys.toggleStates?.[key]
    if (getState) {
      entry.getState = getState
    }
    buckets.get(group).push(entry)
  }
  // Click-only actions — already objects with optional getState/group.
  for (const action of keys.actions ?? []) {
    const group = action.group ?? OTHER_GROUP
    if (!buckets.has(group)) {
      buckets.set(group, [])
    }
    buckets.get(group).push({...action})
  }
  // Emit in GROUP_ORDER, then anything else.
  const out = []
  for (const title of GROUP_ORDER) {
    if (buckets.has(title)) {
      out.push({title, entries: buckets.get(title)})
      buckets.delete(title)
    }
  }
  for (const [title, entries] of buckets) {
    out.push({title, entries})
  }
  return out
}


/**
 * Create a new iteration array for given object, with numbers last.
 *
 * @param {object} obj
 * @returns {Array<string>} keys, non-integer-like first
 */
function numbersLastIterator(obj) {
  const integerLikeKeys = []
  const nonIntegerLikeKeys = []
  Object.keys(obj).forEach((key) => {
    if (/^\d+$/.test(key)) {
      integerLikeKeys.push(key)
    } else {
      nonIntegerLikeKeys.push(key)
    }
  })
  return [...nonIntegerLikeKeys, ...integerLikeKeys]
}
