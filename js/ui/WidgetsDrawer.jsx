import React, {ReactElement, useEffect, useRef} from 'react'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import ButtonBase from '@mui/material/ButtonBase'
import Divider from '@mui/material/Divider'
import Drawer from '@mui/material/Drawer'
import IconButton from '@mui/material/IconButton'
import Stack from '@mui/material/Stack'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import {TRAY, isDockVisible} from '../store/WidgetsSlice'
import useStore from '../store/useStore'
import useIsMobile from '../useIsMobile'
import {APPS, appById} from './apps'
import AppsIcon from '@mui/icons-material/AppsOutlined'
import BackIcon from '@mui/icons-material/ArrowBack'
import CloseDrawerIcon from '@mui/icons-material/KeyboardDoubleArrowRight'
import DockIcon from '@mui/icons-material/ViewSidebarOutlined'
import PinIcon from '@mui/icons-material/PushPin'
import PinOutlinedIcon from '@mui/icons-material/PushPinOutlined'
import StopIcon from '@mui/icons-material/Close'


const DRAWER_WIDTH = 360
export const DOCK_WIDTH = 56
const PANEL_BG = '#121212'


/**
 * The widgets drawer and dock.  Three states (store/WidgetsSlice.js):
 *
 * - closed: neither shows; the top-right Widgets button opens the drawer.
 * - open: the drawer, over the right of the canvas, showing the app tray or
 *   one app, with that app's pin and stop.
 * - dock: a bar of icons right of the canvas (the canvas narrows for it):
 *   the tray, and each pinned app.  Shows while docked or any app is
 *   pinned; the drawer, when open too, sits left of it.
 *
 * @property {object} celestiary
 * @returns {ReactElement}
 */
export default function WidgetsDrawer({celestiary}) {
  const widgets = useStore((state) => state.widgets)
  const dispatch = useStore((state) => state.dispatchWidgets)
  const runningRef = useRef([])
  const isMobile = useIsMobile()
  const isDocked = isDockVisible(widgets)
  const inset = isDocked ? DOCK_WIDTH : 0
  const app = appById(widgets.view)

  // An app leaving `running` (stopped, or the drawer closed with it
  // unpinned) takes its additions out of the scene.
  useEffect(() => {
    for (const id of runningRef.current) {
      if (!widgets.running.includes(id)) {
        appById(id)?.stop(celestiary)
      }
    }
    runningRef.current = widgets.running
  }, [widgets.running, celestiary])

  useEffect(() => {
    document.documentElement.style.setProperty('--dock-width', `${inset}px`)
    celestiary.setRightInset(inset)
  }, [inset, celestiary])

  return (
    <>
      <Drawer
        anchor='right'
        variant='persistent'
        open={widgets.isOpen}
        id='widgets-drawer'
        data-testid='widgets-drawer'
        PaperProps={{
          sx: {
            width: isMobile ? `calc(100% - ${inset}px)` : DRAWER_WIDTH,
            right: inset,
            backgroundColor: PANEL_BG,
          },
        }}
      >
        <Stack direction='row' alignItems='center' sx={{px: 1, pt: 1}}>
          {app ?
            <Button
              startIcon={<BackIcon/>}
              onClick={() => dispatch({type: 'tray'})}
              sx={{borderRadius: 1}}
              data-testid='widgets-back'
            >
              Apps
            </Button> :
            <Typography variant='overline' color='text.secondary' sx={{px: 1}}>Apps</Typography>}
          <Box sx={{flex: 1}}/>
          <Tooltip title={widgets.isDocked ? 'Undock' : 'Dock'} describeChild>
            <span>
              <IconButton
                onClick={() => dispatch({type: 'toggleDock'})}
                disabled={widgets.pinned.length > 0}
                aria-label={widgets.isDocked ? 'Undock' : 'Dock'}
                data-testid='widgets-dock-toggle'
              >
                <DockIcon color={isDocked ? 'primary' : 'inherit'}/>
              </IconButton>
            </span>
          </Tooltip>
          <Tooltip title='Close drawer' describeChild>
            <IconButton onClick={() => dispatch({type: 'close'})} aria-label='Close drawer' data-testid='widgets-close'>
              <CloseDrawerIcon/>
            </IconButton>
          </Tooltip>
        </Stack>
        {widgets.view === TRAY && <Tray running={widgets.running} dispatch={dispatch}/>}
        {widgets.running.map((id) => {
          const {name, Icon, Panel} = appById(id)
          const isPinned = widgets.pinned.includes(id)
          return (
            <Box key={id} sx={{display: id === widgets.view ? 'block' : 'none'}}>
              <Stack direction='row' alignItems='center' spacing={1} sx={{px: 2, py: 1}}>
                <Icon/>
                <Typography variant='h5' sx={{flex: 1}}>{name}</Typography>
                <Tooltip title={isPinned ? 'Unpin' : 'Pin: keep it running with the drawer closed'} describeChild>
                  <IconButton
                    onClick={() => dispatch({type: isPinned ? 'unpin' : 'pin', id})}
                    aria-label={isPinned ? 'Unpin' : 'Pin'}
                    aria-pressed={isPinned}
                    data-testid='widgets-app-pin'
                  >
                    {isPinned ? <PinIcon color='primary'/> : <PinOutlinedIcon/>}
                  </IconButton>
                </Tooltip>
                <Tooltip title='Stop: remove it from the scene' describeChild>
                  <IconButton onClick={() => dispatch({type: 'stop', id})} aria-label='Stop' data-testid='widgets-app-stop'>
                    <StopIcon/>
                  </IconButton>
                </Tooltip>
              </Stack>
              <Panel celestiary={celestiary}/>
            </Box>
          )
        })}
      </Drawer>
      {isDocked && <Dock widgets={widgets} dispatch={dispatch}/>}
    </>
  )
}


/** @returns {ReactElement} The app tray: a tile per app */
function Tray({running, dispatch}) {
  return (
    <Stack spacing={1} sx={{p: 2}} data-testid='widgets-tray'>
      {APPS.map(({id, name, description, Icon}) => (
        <ButtonBase
          key={id}
          onClick={() => dispatch({type: 'openApp', id})}
          sx={{
            justifyContent: 'flex-start',
            textAlign: 'left',
            p: 1.5,
            borderRadius: 1,
            border: 'solid 1px',
            borderColor: running.includes(id) ? 'primary.main' : 'divider',
          }}
          data-testid={`widgets-tray-${id}`}
        >
          <Icon sx={{fontSize: 40, mr: 1.5}}/>
          <Box>
            <Typography variant='subtitle1'>{name}</Typography>
            <Typography variant='body2' color='text.secondary'>{description}</Typography>
          </Box>
        </ButtonBase>
      ))}
    </Stack>
  )
}


/** @returns {ReactElement} The dock: the tray, then each pinned app */
function Dock({widgets, dispatch}) {
  return (
    <Stack
      id='widgets-dock'
      data-testid='widgets-dock'
      alignItems='center'
      spacing={1}
      sx={{
        position: 'fixed',
        top: 0,
        right: 0,
        bottom: 0,
        width: DOCK_WIDTH,
        py: 1,
        backgroundColor: PANEL_BG,
        borderLeft: 'solid 1px',
        borderColor: 'divider',
        zIndex: (theme) => theme.zIndex.drawer,
      }}
    >
      <Tooltip title='Apps' placement='left' describeChild>
        <IconButton
          onClick={() => dispatch(widgets.isOpen && widgets.view === TRAY ? {type: 'close'} : {type: 'open'})}
          aria-label='Apps'
          data-testid='widgets-dock-apps'
        >
          <AppsIcon/>
        </IconButton>
      </Tooltip>
      <Divider flexItem/>
      {widgets.pinned.map((id) => {
        const {name, Icon} = appById(id)
        const isShowing = widgets.isOpen && widgets.view === id
        return (
          <Tooltip key={id} title={name} placement='left' describeChild>
            <IconButton
              onClick={() => dispatch(isShowing ? {type: 'close'} : {type: 'openApp', id})}
              aria-label={name}
              data-testid={`widgets-dock-${id}`}
            >
              <Icon color={isShowing ? 'primary' : 'inherit'}/>
            </IconButton>
          </Tooltip>
        )
      })}
    </Stack>
  )
}
