import React, {ReactElement, useEffect, useMemo, useRef, useState} from 'react'
import Autocomplete from '@mui/material/Autocomplete'
import IconButton from '@mui/material/IconButton'
import TextField from '@mui/material/TextField'
import Tooltip from '@mui/material/Tooltip'
import {goToEntry, lookAtEntry, targetEntry} from '../search/commitEntry'
import {searchIndex} from '../search/SearchIndex'
import {anchorPathFor, breadcrumbItems as breadcrumbFor, breadcrumbStart} from '../store/SearchSlice'
import useStore from '../store/useStore'
import useIsMobile from '../useIsMobile'
import ArrowForwardIcon from '@mui/icons-material/ArrowForward'
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
 * anchor are hidden; an Autocomplete + Go (arrow) / Look at (magnifier) /
 * Picker / Clear buttons follow.  Enter is Go.
 *
 * On the homepage (`home`; DESIGN.md "Homepage") it is always expanded,
 * over everything, with no breadcrumb or picker, and focused on a desktop.
 * A pick in the list goes there, as Go does, and Go, Look at and Esc leave
 * the homepage (Celestiary.leaveHome); the tour's targets don't close it.
 *
 * @param {object} props
 * @param {object} props.celestiary
 * @param {boolean} [props.home] The homepage's
 * @returns {ReactElement}
 */
export default function SearchBar({celestiary, home = false}) {
  const committedPath = useStore((s) => s.committedPath)
  const committedStar = useStore((s) => s.committedStar)
  const committedTarget = useStore((s) => s.committedTarget)
  const isSearchOpen = useStore((s) => s.isSearchOpen)
  const openSearch = useStore((s) => s.openSearch)
  const closeSearch = useStore((s) => s.closeSearch)
  const searchQuery = useStore((s) => s.searchQuery)
  const setSearchQuery = useStore((s) => s.setSearchQuery)
  const searchSelection = useStore((s) => s.searchSelection)
  const setSearchSelection = useStore((s) => s.setSearchSelection)
  const setPreviewPath = useStore((s) => s.setPreviewPath)
  const setPreviewStar = useStore((s) => s.setPreviewStar)
  const setPreviewGalaxy = useStore((s) => s.setPreviewGalaxy)
  const clearPreview = useStore((s) => s.clearPreview)
  const anchorIndex = useStore((s) => s.anchorIndex)
  const hoveredAnchorIndex = useStore((s) => s.hoveredAnchorIndex)
  const setHoveredAnchorIndex = useStore((s) => s.setHoveredAnchorIndex)
  const isStarsSelectActive = useStore((s) => s.isStarsSelectActive)
  const toggleIsStarsSelectActive = useStore((s) => s.toggleIsStarsSelectActive)
  const searchHoverName = useStore((s) => s.searchHoverName)

  const [options, setOptions] = useState([])
  const [ready, setReady] = useState(false)
  // The index's builds (SearchIndex.onChange): a query asked while it was
  // stale (bodies, stars still loading) is asked again once it's rebuilt.
  const [indexVersion, setIndexVersion] = useState(searchIndex.version)
  const [inputFocused, setInputFocused] = useState(false)
  const isMobile = useIsMobile()
  // A phone's breadcrumb, expanded from its "…" chip, until the path changes.
  const [crumbsExpanded, setCrumbsExpanded] = useState(false)

  const hoverResetTimer = useRef(null)
  const blurCollapseTimer = useRef(null)
  const containerRef = useRef(null)
  // The target the bar's own last pick set, which doesn't close it.
  const ownPickRef = useRef(null)

  // When open, the anchorIndex is fixed; when closed, hover rules the visual.
  const effectiveIconIndex = isSearchOpen ?
    anchorIndex :
    (hoveredAnchorIndex !== null ? hoveredAnchorIndex : 0)

  // Breadcrumb source: the target (committedTarget).  A body's path, then a
  // place's name (Sun › Earth › Austin); a star or an asterism collapses it
  // to its name alone.  Each element's hash is its path in the link
  // (targetPath.js).  The hover/anchor logic doesn't branch on which one is
  // active.
  const breadcrumbItems = useMemo(
      () => breadcrumbFor(committedTarget, committedPath),
      [committedTarget, committedPath],
  )

  useEffect(() => setCrumbsExpanded(false), [breadcrumbItems])

  const anchorPath = useMemo(
      () => (committedStar ? 'milkyway' :
        anchorPathFor(committedPath, isSearchOpen ? anchorIndex : 0)),
      [committedStar, committedPath, anchorIndex, isSearchOpen],
  )

  // The homepage's is open from the start, scoped to everything.
  useEffect(() => {
    if (!home) {
      return
    }
    useStore.getState().setHoveredAnchorIndex(null)
    openSearch()
    return () => closeSearch()
  }, [home])

  useEffect(() => searchIndex.onChange((version) => setIndexVersion(version)), [])

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

  // The places on the bodies in scope load as the scope changes, once
  // something is typed (the query below runs again once they're in): the
  // homepage's bar is open from the start, and its places' index isn't
  // fetched until it's used (#258).
  const [placesVersion, setPlacesVersion] = useState(0)
  const hasQuery = (searchQuery ?? '').trim().length > 0
  useEffect(() => {
    if (!isSearchOpen || !hasQuery) {
      return
    }
    let cancelled = false
    searchIndex.ensureScope(anchorPath).then((loaded) => {
      if (!cancelled && loaded > 0) {
        setPlacesVersion((v) => v + 1)
      }
    }).catch((e) => console.warn('Search: loading places failed:', e))
    return () => {
      cancelled = true
    }
  }, [isSearchOpen, anchorPath, hasQuery])

  useEffect(() => {
    if (!ready) {
      setOptions([])
      return
    }
    const results = searchIndex.query(searchQuery, anchorPath, 20)
    setOptions(results.map((r) => r.entry))
  }, [searchQuery, anchorPath, ready, placesVersion, indexVersion])

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
      setPreviewForEntry(entry, {setPreviewPath, setPreviewStar, setPreviewGalaxy, clearPreview})
    }
  }, [searchHoverName, isStarsSelectActive, isSearchOpen, inputFocused, ready, anchorPath])

  // Close-on-outside-click: while the bar is open, a mousedown outside the
  // bar AND outside the Autocomplete's portaled popup is treated as an
  // explicit cancel (snappier than the 3s blur debounce).  The popper is
  // portaled out of our DOM tree, so check for its class explicitly.
  useEffect(() => {
    if (!isSearchOpen || home) {
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
  }, [isSearchOpen, closeSearch, home])

  // Any target change from outside the bar while it's open = cancel.
  // Catches breadcrumb-link clicks inside the bar, 'h' key home, hash edits,
  // a click on a label, etc.  The bar's own pick in the dropdown targets
  // the result (targetEntry) and leaves it open: the breadcrumb then names
  // the pick, and the scope is the same, as a result in scope is under the
  // anchor.  Go and Look at close it themselves.
  useEffect(() => {
    if (home || (committedTarget !== null && committedTarget === ownPickRef.current)) {
      return
    }
    if (useStore.getState().isSearchOpen) {
      closeSearch()
    }
  }, [committedTarget, closeSearch, home])

  // Blur-collapse: if bar is open and focus leaves, start a 3s timer.  Re-
  // focusing cancels it.  Escape / Clear collapse immediately.
  useEffect(() => {
    if (!isSearchOpen || home) {
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
  }, [isSearchOpen, closeSearch, home])

  // On the homepage, Go and Look at leave it first: the tour stops where it
  // is, and what they do follows from there (its link is written then).
  const leaveHome = () => {
    if (home) {
      celestiary.leaveHome({write: false})
    }
  }

  // Go: travel to the selection.  Enter in the field does this too.  On
  // the homepage, a flight there from the tour's view (goToResult).
  const handleCommit = (entry = searchSelection) => {
    if (!entry) {
      return
    }
    if (home) {
      celestiary.goToResult(entry)
    } else {
      goToEntry(entry, celestiary)
    }
    closeSearch()
  }

  // Look at: select the selection as the target and turn the camera in
  // place to face it; the camera doesn't travel.
  const handleLookAt = () => {
    if (!searchSelection) {
      return
    }
    leaveHome()
    lookAtEntry(searchSelection, celestiary)
    closeSearch()
  }

  const handleClear = () => {
    if (searchQuery) {
      setSearchQuery('')
      setSearchSelection(null)
    } else if (!home) {
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
  // On a phone, a long path's last chips behind a "…" that shows the rest.
  const start = breadcrumbStart(visibleItems.length, {phone: isMobile, open: isSearchOpen, expanded: crumbsExpanded})
  const moreActive = start > 0 && effectiveIconIndex < start

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
      id={home ? 'home-search-bar' : 'search-bar'}
      className={`${isSearchOpen ? 'open' : ''}${home ? ' search-home' : ''}`}
      data-testid={home ? 'home-search-bar' : (isSearchOpen ? 'search-bar-open' : 'search-bar')}
    >
      {!home && <span
        className='breadcrumb'
        onMouseEnter={onBreadcrumbEnter}
        onMouseLeave={onBreadcrumbLeave}
      >
        {/* Each element is a chip.  The chip contains an always-reserved
            icon slot (visibility toggled so metrics are identical across
            chips) plus the label.  Wrapping them together lets the whole
            chip be a hover target and a styled background. */}
        {start > 0 &&
          <span className={`chip chip-more${moreActive ? ' chip-active' : ''}`}>
            <span className='chip-icon' aria-hidden={!moreActive}>
              {iconButton}
            </span>
            <button
              type='button'
              className='chip-label chip-expand'
              aria-label={`Show the whole path: ${visibleItems.slice(0, start).map((item) => item.label).join(', ')}`}
              onClick={() => setCrumbsExpanded(true)}
              data-testid='breadcrumb-more'
            >
              …
            </button>
          </span>}
        {visibleItems.map((item, i) => {
          if (i < start) {
            return null
          }
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
      </span>}
      {home && <SearchIcon className='home-search-icon' fontSize='small' aria-hidden='true'/>}
      {isSearchOpen &&
        <>
          <Autocomplete
            size='small'
            sx={home ? {flex: 1, minWidth: 0} : {minWidth: 260, ml: 1}}
            options={options}
            getOptionLabel={(o) => (o && o.displayName) || ''}
            isOptionEqualToValue={(a, b) => a && b && a.id === b.id}
            filterOptions={(x) => x}
            freeSolo={false}
            openOnFocus={!home}
            forcePopupIcon={!home}
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
              if (home) {
                // On the homepage a pick goes there: there's no target to
                // show it as, and the tour would move on from it.
                handleCommit(v)
                return
              }
              setPreviewForEntry(v, {setPreviewPath, setPreviewStar, setPreviewGalaxy, clearPreview})
              targetEntry(v, celestiary)
              ownPickRef.current = useStore.getState().committedTarget
            }}
            onHighlightChange={(e, option) => {
              if (!home) {
                setPreviewForEntry(option, {setPreviewPath, setPreviewStar, setPreviewGalaxy, clearPreview})
              }
            }}
            renderInput={(params) => (
              <TextField
                {...params}
                autoFocus={!home || !isMobile}
                placeholder={home ? 'Search planets, moons, stars, places…' : 'Search…'}
                variant='standard'
                inputProps={{...params.inputProps, 'aria-label': 'Search'}}
                data-testid={home ? 'home-search-input' : 'search-bar-input'}
                onFocus={() => setInputFocused(true)}
                onBlur={() => setInputFocused(false)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && searchSelection) {
                    e.preventDefault()
                    handleCommit()
                  } else if (e.key === 'Enter' && home && searchQuery.trim() && options.length === 0) {
                    // Nothing in the list to pick yet (typed before it
                    // came up, the index still building): the best match,
                    // once it's built.  With a list, the Autocomplete
                    // picks its highlighted option (onChange).
                    e.preventDefault()
                    commitBestMatch(searchQuery, anchorPath, handleCommit)
                  } else if (e.key === 'Escape') {
                    if (home) {
                      celestiary.leaveHome()
                    } else {
                      closeSearch()
                    }
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
          <Tooltip title='Go to (Enter): travel there' describeChild>
            <span>
              <IconButton
                size='small'
                disabled={!searchSelection}
                onClick={() => handleCommit()}
                aria-label='Go to'
                data-testid='search-bar-go'
              >
                <ArrowForwardIcon fontSize='small'/>
              </IconButton>
            </span>
          </Tooltip>
          <Tooltip title='Look at: turn to face it, without moving' describeChild>
            <span>
              <IconButton
                size='small'
                disabled={!searchSelection}
                onClick={handleLookAt}
                aria-label='Look at'
                data-testid='search-bar-target'
              >
                <SearchIcon fontSize='small'/>
              </IconButton>
            </span>
          </Tooltip>
          {!home && <Tooltip title='Crosshairs picker' describeChild>
            <IconButton
              size='small'
              onClick={toggleIsStarsSelectActive}
              aria-label='Toggle scene picker'
              data-testid='search-bar-picker'
              className={isStarsSelectActive ? 'picker active' : 'picker'}
            >
              <MyLocationIcon fontSize='small'/>
            </IconButton>
          </Tooltip>}
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
 * Go to the best match for a query, once the index is built, with what a
 * search loads (the places, the galaxies): Enter on the homepage's search
 * before its list has come up.
 *
 * @param {string} query
 * @param {string} anchorPath
 * @param {Function} commit Called with the entry
 */
function commitBestMatch(query, anchorPath, commit) {
  searchIndex.ensureSearchable(anchorPath).then(() => {
    const best = searchIndex.query(query, anchorPath, 1)[0]
    if (best) {
      commit(best.entry)
    }
  }).catch((err) => console.warn('Search:', err))
}


/**
 * Push a SearchEntry into the preview store fields.  Stars use previewStar
 * (rendered via ControlPanel.showStarPreview), SPARC galaxies previewGalaxy
 * (showGalaxyPreview); bodies use previewPath.
 *
 * @param {SearchEntry|null} entry
 * @param {object} setters {setPreviewPath, setPreviewStar, setPreviewGalaxy, clearPreview}
 */
function setPreviewForEntry(entry, {setPreviewPath, setPreviewStar, setPreviewGalaxy, clearPreview}) {
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
  if (entry.payload?.galaxy) {
    setPreviewGalaxy(entry.payload.galaxy)
    return
  }
  // 'milkyway/sun/earth/moon' → ['sun', 'earth', 'moon']
  const parts = entry.path.split('/')
  if (parts[0] === 'milkyway') {
    parts.shift()
  }
  if (entry.kind === 'place' || entry.kind === 'satellite') {
    // The panel shows the place's or satellite's body: 'sun/earth/austin' →
    // ['sun', 'earth'].
    parts.pop()
  }
  if (parts.length === 0) {
    parts.push(entry.id)
  }
  setPreviewPath(parts)
}
