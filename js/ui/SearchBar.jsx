import React, {ReactElement, useEffect, useMemo, useRef, useState} from 'react'
import Autocomplete from '@mui/material/Autocomplete'
import IconButton from '@mui/material/IconButton'
import TextField from '@mui/material/TextField'
import Tooltip from '@mui/material/Tooltip'
import {searchIndex} from '../search/SearchIndex'
import {anchorPathFor} from '../store/SearchSlice'
import useStore from '../store/useStore'
import {capitalize} from '../utils'
import CloseIcon from '@mui/icons-material/Close'
import MyLocationIcon from '@mui/icons-material/MyLocation'
import SearchIcon from '@mui/icons-material/Search'


const HOVER_RESET_MS = 600
const BLUR_COLLAPSE_MS = 3000


/**
 * Inline search bar anchored to the breadcrumb.
 *
 * Collapsed: search icon + breadcrumb.  The icon sits before the first element
 * by default; hovering a later breadcrumb element moves the icon in front of
 * it (visually scoping the search to that element's level — peers + below).
 *
 * Expanded: the clicked anchor position is frozen; elements right of the
 * anchor are hidden; an Autocomplete + Go / Picker / Clear buttons follow.
 *
 * @returns {ReactElement}
 */
export default function SearchBar({celestiary}) {
  const committedPath = useStore((s) => s.committedPath)
  const committedStar = useStore((s) => s.committedStar)
  const isSearchOpen = useStore((s) => s.isSearchOpen)
  const openSearch = useStore((s) => s.openSearch)
  const closeSearch = useStore((s) => s.closeSearch)
  const searchQuery = useStore((s) => s.searchQuery)
  const setSearchQuery = useStore((s) => s.setSearchQuery)
  const searchSelection = useStore((s) => s.searchSelection)
  const setSearchSelection = useStore((s) => s.setSearchSelection)
  const setPreviewPath = useStore((s) => s.setPreviewPath)
  const setPreviewStar = useStore((s) => s.setPreviewStar)
  const clearPreview = useStore((s) => s.clearPreview)
  const anchorIndex = useStore((s) => s.anchorIndex)
  const hoveredAnchorIndex = useStore((s) => s.hoveredAnchorIndex)
  const setHoveredAnchorIndex = useStore((s) => s.setHoveredAnchorIndex)
  const isStarsSelectActive = useStore((s) => s.isStarsSelectActive)
  const toggleIsStarsSelectActive = useStore((s) => s.toggleIsStarsSelectActive)
  const searchHoverName = useStore((s) => s.searchHoverName)

  const [options, setOptions] = useState([])
  const [ready, setReady] = useState(false)
  const [inputFocused, setInputFocused] = useState(false)

  const hoverResetTimer = useRef(null)
  const blurCollapseTimer = useRef(null)
  const containerRef = useRef(null)

  // When open, the anchorIndex is fixed; when closed, hover rules the visual.
  const effectiveIconIndex = isSearchOpen ?
    anchorIndex :
    (hoveredAnchorIndex !== null ? hoveredAnchorIndex : 0)

  // Breadcrumb source: a star commit collapses the path to a single element
  // (the star name).  Planet paths render as before.  The hover/anchor logic
  // doesn't branch on which one is active.
  const breadcrumbItems = useMemo(() => {
    if (committedStar) {
      return [{label: committedStar.displayName || `HIP ${committedStar.hipId}`, hash: null}]
    }
    return committedPath.map((name, i) => ({
      label: capitalize(name),
      hash: committedPath.slice(0, i + 1).join('/'),
    }))
  }, [committedStar, committedPath])

  const anchorPath = useMemo(
      () => (committedStar ? 'milkyway' :
        anchorPathFor(committedPath, isSearchOpen ? anchorIndex : 0)),
      [committedStar, committedPath, anchorIndex, isSearchOpen],
  )

  useEffect(() => {
    if (!isSearchOpen || ready) {
      return
    }
    let cancelled = false
    searchIndex.ensureReady().then(() => {
      if (!cancelled) {
        setReady(true)
      }
    })
    return () => {
      cancelled = true
    }
  }, [isSearchOpen, ready])

  useEffect(() => {
    if (!ready) {
      setOptions([])
      return
    }
    const results = searchIndex.query(searchQuery, anchorPath, 20)
    setOptions(results.map((r) => r.entry))
  }, [searchQuery, anchorPath, ready])

  // Pipe crosshair hover into the input + preview while picking mode is active
  // AND the user is not actively typing (no mutex: typed input wins over hover).
  useEffect(() => {
    if (!isSearchOpen || !isStarsSelectActive || inputFocused) {
      return
    }
    if (!searchHoverName) {
      return
    }
    setSearchQuery(searchHoverName)
    if (ready) {
      const entry = searchIndex.resolveByName(searchHoverName, anchorPath)
      setSearchSelection(entry)
      setPreviewForEntry(entry, {setPreviewPath, setPreviewStar, clearPreview})
    }
  }, [searchHoverName, isStarsSelectActive, isSearchOpen, inputFocused, ready, anchorPath])

  // Close-on-outside-click: while the bar is open, a mousedown outside the
  // bar AND outside the Autocomplete's portaled popup is treated as an
  // explicit cancel (snappier than the 3s blur debounce).  The popper is
  // portaled out of our DOM tree, so check for its class explicitly.
  useEffect(() => {
    if (!isSearchOpen) {
      return
    }
    const onDocMouseDown = (e) => {
      const container = containerRef.current
      if (!container) {
        return
      }
      if (container.contains(e.target)) {
        return
      }
      if (!e.target.closest) {
        return
      }
      // Autocomplete's popup is portaled outside our DOM tree — don't close.
      if (e.target.closest('.MuiAutocomplete-popper')) {
        return
      }
      // Scene canvas is part of the search's interaction surface (crosshair
      // picking clicks + dblclicks land here) — don't close.
      if (e.target.closest('#scene-id')) {
        return
      }
      closeSearch()
    }
    document.addEventListener('mousedown', onDocMouseDown)
    return () => document.removeEventListener('mousedown', onDocMouseDown)
  }, [isSearchOpen, closeSearch])

  // Any navigation (committedPath change) while the bar is open = cancel.
  // Catches breadcrumb-link clicks inside the bar, 'h' key home, hash edits,
  // etc.  The search's own commit also triggers this path but closeSearch is
  // idempotent — handleCommit has already flipped isSearchOpen=false by then.
  useEffect(() => {
    if (useStore.getState().isSearchOpen) {
      closeSearch()
    }
  }, [committedPath, closeSearch])

  // Blur-collapse: if bar is open and focus leaves, start a 3s timer.  Re-
  // focusing cancels it.  Escape / Clear collapse immediately.
  useEffect(() => {
    if (!isSearchOpen) {
      return
    }
    const onFocusIn = () => {
      if (blurCollapseTimer.current) {
        clearTimeout(blurCollapseTimer.current)
        blurCollapseTimer.current = null
      }
    }
    const onFocusOut = (e) => {
      if (containerRef.current && containerRef.current.contains(e.relatedTarget)) {
        return
      }
      if (blurCollapseTimer.current) {
        clearTimeout(blurCollapseTimer.current)
      }
      blurCollapseTimer.current = setTimeout(() => {
        blurCollapseTimer.current = null
        closeSearch()
      }, BLUR_COLLAPSE_MS)
    }
    const el = containerRef.current
    if (!el) {
      return
    }
    el.addEventListener('focusin', onFocusIn)
    el.addEventListener('focusout', onFocusOut)
    return () => {
      el.removeEventListener('focusin', onFocusIn)
      el.removeEventListener('focusout', onFocusOut)
      if (blurCollapseTimer.current) {
        clearTimeout(blurCollapseTimer.current)
        blurCollapseTimer.current = null
      }
    }
  }, [isSearchOpen, closeSearch])

  const handleCommit = () => {
    if (!searchSelection) {
      return
    }
    commitEntry(searchSelection, celestiary)
    closeSearch()
  }

  const handleClear = () => {
    if (searchQuery) {
      setSearchQuery('')
      setSearchSelection(null)
    } else {
      closeSearch()
    }
  }

  const clearHoverTimer = () => {
    if (hoverResetTimer.current) {
      clearTimeout(hoverResetTimer.current)
      hoverResetTimer.current = null
    }
  }

  const onSegmentEnter = (i) => {
    if (isSearchOpen) {
      return
    }
    clearHoverTimer()
    setHoveredAnchorIndex(i)
  }

  // Reset the anchor only when the mouse leaves the ENTIRE breadcrumb
  // container (not just a single segment) — otherwise moving diagonally from
  // a segment to the icon in front of it (which sits in a sibling slot) would
  // briefly leave the segment's bbox and yank the icon back to the root.
  const onBreadcrumbEnter = () => clearHoverTimer()
  const onBreadcrumbLeave = () => {
    if (isSearchOpen) {
      return
    }
    clearHoverTimer()
    hoverResetTimer.current = setTimeout(() => {
      hoverResetTimer.current = null
      setHoveredAnchorIndex(null)
    }, HOVER_RESET_MS)
  }

  // Breadcrumb slice rendered in expanded state: everything up to and
  // including the anchor element.  Right-of-anchor is cleared per design.
  const visibleItems = isSearchOpen ?
    breadcrumbItems.slice(0, Math.min(anchorIndex + 1, breadcrumbItems.length)) :
    breadcrumbItems

  const iconButton = (
    <Tooltip title='Search' describeChild>
      <IconButton
        size='small'
        aria-label='Search'
        data-testid='search-bar-icon'
        className='search-bar-icon'
        onClick={openSearch}
      >
        <SearchIcon fontSize='small'/>
      </IconButton>
    </Tooltip>
  )

  return (
    <div
      ref={containerRef}
      id='search-bar'
      className={isSearchOpen ? 'open' : ''}
      data-testid={isSearchOpen ? 'search-bar-open' : 'search-bar'}
    >
      <span
        className='breadcrumb'
        onMouseEnter={onBreadcrumbEnter}
        onMouseLeave={onBreadcrumbLeave}
      >
        {/* Each element is a chip.  The chip contains an always-reserved
            icon slot (visibility toggled so metrics are identical across
            chips) plus the label.  Wrapping them together lets the whole
            chip be a hover target and a styled background. */}
        {visibleItems.map((item, i) => {
          const key = item.hash || `star-${i}`
          const isLast = !isSearchOpen && i === visibleItems.length - 1
          const active = effectiveIconIndex === i
          const labelNode = isLast || !item.hash ?
            <span className='chip-label'>{item.label}</span> :
            <a className='chip-label' href={`#${item.hash}`}>{item.label}</a>
          return (
            <React.Fragment key={key}>
              {i > 0 && <span className='chip-sep' aria-hidden='true'>›</span>}
              <span
                className={`chip${active ? ' chip-active' : ''}`}
                onMouseEnter={() => onSegmentEnter(i)}
                aria-current={active ? 'true' : undefined}
              >
                <span className='chip-icon' aria-hidden={!active}>
                  {iconButton}
                </span>
                {labelNode}
              </span>
            </React.Fragment>
          )
        })}
      </span>
      {isSearchOpen &&
        <>
          <Autocomplete
            size='small'
            sx={{minWidth: 260, ml: 1}}
            options={options}
            getOptionLabel={(o) => (o && o.displayName) || ''}
            isOptionEqualToValue={(a, b) => a && b && a.id === b.id}
            filterOptions={(x) => x}
            freeSolo={false}
            openOnFocus
            autoHighlight
            slotProps={{
              paper: {
                sx: {
                  backgroundColor: 'rgba(30, 30, 30, 0.5)',
                  backdropFilter: 'blur(4px)',
                  color: '#fff',
                },
              },
            }}
            value={searchSelection}
            inputValue={searchQuery}
            onInputChange={(e, v) => setSearchQuery(v)}
            onChange={(e, v) => {
              setSearchSelection(v)
              setPreviewForEntry(v, {setPreviewPath, setPreviewStar, clearPreview})
            }}
            onHighlightChange={(e, option) => {
              setPreviewForEntry(option, {setPreviewPath, setPreviewStar, clearPreview})
            }}
            renderInput={(params) => (
              <TextField
                {...params}
                autoFocus
                placeholder='Search…'
                variant='standard'
                data-testid='search-bar-input'
                onFocus={() => setInputFocused(true)}
                onBlur={() => setInputFocused(false)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && searchSelection) {
                    e.preventDefault()
                    handleCommit()
                  } else if (e.key === 'Escape') {
                    closeSearch()
                  }
                }}
              />
            )}
            renderOption={(props, option) => (
              <li {...props} key={option.id}>
                {option.displayName}
              </li>
            )}
          />
          <Tooltip title='Go (Enter)' describeChild>
            <span>
              <IconButton
                size='small'
                disabled={!searchSelection}
                onClick={handleCommit}
                aria-label='Go to selection'
                data-testid='search-bar-go'
              >
                <SearchIcon fontSize='small'/>
              </IconButton>
            </span>
          </Tooltip>
          <Tooltip title='Crosshairs picker' describeChild>
            <IconButton
              size='small'
              onClick={toggleIsStarsSelectActive}
              aria-label='Toggle scene picker'
              data-testid='search-bar-picker'
              className={isStarsSelectActive ? 'picker active' : 'picker'}
            >
              <MyLocationIcon fontSize='small'/>
            </IconButton>
          </Tooltip>
          <Tooltip title='Clear / Close (Esc)' describeChild>
            <IconButton
              size='small'
              onClick={handleClear}
              aria-label='Clear or close search'
              data-testid='search-bar-clear'
            >
              <CloseIcon fontSize='small'/>
            </IconButton>
          </Tooltip>
        </>
      }
    </div>
  )
}


/**
 * Push a SearchEntry into the preview store fields.  Stars use previewStar
 * (rendered via ControlPanel.showStarPreview); bodies use previewPath.
 *
 * @param {SearchEntry|null} entry
 * @param {object} setters {setPreviewPath, setPreviewStar, clearPreview}
 */
function setPreviewForEntry(entry, {setPreviewPath, setPreviewStar, clearPreview}) {
  if (!entry) {
    clearPreview()
    return
  }
  if (entry.kind === 'star') {
    setPreviewStar({
      hipId: entry.payload && entry.payload.hipId,
      displayName: entry.displayName,
      star: entry.payload && entry.payload.star,
    })
    return
  }
  // 'milkyway/sun/earth/moon' → ['sun', 'earth', 'moon']
  const parts = entry.path.split('/')
  if (parts[0] === 'milkyway') {
    parts.shift()
  }
  if (parts.length === 0) {
    parts.push(entry.id)
  }
  setPreviewPath(parts)
}


/**
 * @param {SearchEntry} entry
 * @param {object} celestiary
 */
function commitEntry(entry, celestiary) {
  if (!entry || !celestiary) {
    return
  }
  if (entry.kind === 'star' && entry.payload && entry.payload.star) {
    celestiary.scene.goTo(entry.payload.star)
    celestiary.useStore.getState().setCommittedStar({
      hipId: entry.payload.hipId,
      displayName: entry.displayName,
      star: entry.payload.star,
    })
    return
  }
  const name = entry.payload && entry.payload.name
  if (!name) {
    return
  }
  const path = celestiary.loader.pathByName[name]
  if (path) {
    window.location.hash = path
  }
}
