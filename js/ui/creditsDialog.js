import {CREDITS_CATALOG, activeCredits, creditsContext, factsOf} from '../credits/catalog.js'


/**
 * The credits dialog (design/UI.md, "The credits footer"), opened by the
 * footer's info icon and loaded on its first open (CreditsFooter
 * loadCreditsDialog): **Active**, the sources whose data is in the scene
 * now, and **All**, every source the app can show (credits/catalog.js).
 * Each entry: its name, its attribution and licence, a note where its terms
 * ask for one, and its facts (credits/facts.js), live, refreshed each second
 * while open.  As the app's other dialogs (ui/Dialog.jsx: MUI's, with its
 * focus trap and Esc), but not routed, so the scene's link stays as it is;
 * full screen on a phone.  The tabs are the WAI-ARIA pattern: arrow keys,
 * Home and End move between them.
 *
 * No JSX and no imports from the first load: what this chunk shares with
 * the first load (React, MUI's dialog, the registry, the tables the facts
 * read) comes in `deps` from CreditsFooter, which has them already.  A
 * module both import would make esbuild split the first load's chunks
 * again (five more files and 4 KB, the first try: esbuild/budget.js).
 *
 * @param {object} deps {React, Dialog, DialogTitle, DialogContent,
 *   IconButton, CloseIcon, useIsMobile, getCredits, hasCredit,
 *   subscribeCredits, refs}
 * @returns {{CreditsDialog: Function, CreditsList: Function, DialogTabs: Function}}
 */
export function creditsDialog(deps) {
  const {React, Dialog, DialogTitle, DialogContent, IconButton, CloseIcon, useIsMobile, getCredits, hasCredit,
    subscribeCredits, refs} = deps
  const h = React.createElement
  const {Fragment, useEffect, useRef, useState, useSyncExternalStore} = React


  /**
   * @param {object} props
   * @param {boolean} props.open
   * @param {Function} props.onClose
   * @param {?object} props.celestiary
   * @returns {object} The dialog
   */
  function CreditsDialog({open, onClose, celestiary}) {
    const isMobile = useIsMobile()
    const [tab, setTab] = useState('active')
    // The footer's credits, so Active follows them, and a tick for the rest.
    useSyncExternalStore(subscribeCredits, getCredits, getCredits)
    const [, setTick] = useState(0)
    useEffect(() => {
      if (!open) {
        return undefined
      }
      const id = setInterval(() => setTick((t) => t + 1), REFRESH_MS)
      return () => clearInterval(id)
    }, [open])
    const ctx = creditsContext(celestiary, hasCredit, refs)
    const active = activeCredits(CREDITS_CATALOG, ctx)
    const tabs = [{id: 'active', label: `Active (${active.length})`}, {id: 'all', label: `All (${CREDITS_CATALOG.length})`}]
    return h(Dialog, {open, onClose, 'fullScreen': isMobile, 'fullWidth': true, 'maxWidth': 'sm',
      'aria-labelledby': 'credits-dialog-title', 'data-testid': 'credits-dialog'},
    h(DialogTitle, {id: 'credits-dialog-title', sx: {fontSize: '1.5rem'}}, 'Credits',
        h(IconButton, {'aria-label': 'Close', 'onClick': onClose, 'sx': {float: 'right'}}, h(CloseIcon))),
    h(DialogTabs, {tabs, value: tab, onChange: setTab}),
    h(DialogContent, {'dividers': true, 'id': 'credits-panel', 'role': 'tabpanel', 'aria-labelledby': `credits-tab-${tab}`,
      'sx': LIST_SX},
    h(CreditsList, {entries: tab === 'active' ? active : CREDITS_CATALOG, ctx,
      empty: 'Nothing credited is in the scene now.'})))
  }


  /**
   * The tabs (role tablist), keyboard-navigable: the selected tab is the one
   * in the tab order, arrows and Home and End move and select.
   *
   * @param {object} props
   * @param {Array<{id: string, label: string}>} props.tabs
   * @param {string} props.value
   * @param {Function} props.onChange
   * @returns {object}
   */
  function DialogTabs({tabs, value, onChange}) {
    const buttons = useRef({})
    const onKeyDown = (ev) => {
      const i = tabs.findIndex((t) => t.id === value)
      const next = tabKey(ev.key, i, tabs.length)
      if (next !== null) {
        ev.preventDefault()
        onChange(tabs[next].id)
        buttons.current[tabs[next].id]?.focus?.()
      }
    }
    return h('div', {'role': 'tablist', 'aria-label': 'Credits', 'className': 'credits-tabs', 'style': TABS_STYLE, onKeyDown},
        tabs.map((t) => h('button', {
          'key': t.id, 'type': 'button', 'role': 'tab', 'id': `credits-tab-${t.id}`, 'aria-controls': 'credits-panel',
          'aria-selected': t.id === value, 'tabIndex': t.id === value ? 0 : -1, 'onClick': () => onChange(t.id),
          'ref': (el) => {
            buttons.current[t.id] = el
          },
          'style': t.id === value ? TAB_SELECTED_STYLE : TAB_STYLE,
        }, t.label)))
  }


  /**
   * The dialog's list, from props, for tests.
   *
   * @param {object} props
   * @param {Array<object>} props.entries Catalogue entries
   * @param {object} props.ctx creditsContext's
   * @param {string} [props.empty] What to say with none
   * @returns {object}
   */
  function CreditsList({entries, ctx, empty = ''}) {
    if (entries.length === 0) {
      return h('p', {className: 'credits-empty'}, empty)
    }
    return h('div', {className: 'credits-list'}, entries.map((entry) => h(CreditEntry, {key: entry.id, entry, ctx})))
  }


  /**
   * @param {object} props
   * @param {object} props.entry A catalogue entry
   * @param {object} props.ctx
   * @returns {object}
   */
  function CreditEntry({entry, ctx}) {
    const facts = factsOf(entry, ctx)
    const link = (a, extra = {}) => h('a', {href: a.href, target: '_blank', rel: 'noopener noreferrer', ...extra}, a.text)
    const links = []
    entry.attribution.forEach((a, i) => {
      links.push(i > 0 ? ' · ' : null, h(Fragment, {key: `a${i}`}, link(a)))
    })
    if (entry.licence) {
      links.push(' · ', h(Fragment, {key: 'licence'}, link(entry.licence, {className: 'credits-licence'})))
    }
    return h('section', {'className': 'credits-source', 'aria-labelledby': `credit-${entry.id}`, 'data-source': entry.id},
        h('h3', {id: `credit-${entry.id}`}, entry.name),
        h('p', {className: 'credits-attribution'}, ...links.filter((x) => x !== null)),
        entry.note ? h('p', {className: 'credits-note'}, entry.note) : null,
        facts.length > 0 ?
          h('dl', {className: 'credits-facts'}, facts.map((f) => h(Fragment, {key: f.label},
              h('dt', null, f.label), h('dd', null, f.value)))) :
          null,
        h('p', {className: 'credits-where'},
            entry.footer ? 'In the footer while its data is drawn' : 'Listed here only'))
  }

  return {CreditsDialog, CreditsList, DialogTabs}
}


/**
 * A key on the tabs, WAI-ARIA's tabs pattern with automatic activation.
 *
 * @param {string} key
 * @param {number} i The selected tab
 * @param {number} n Tabs
 * @returns {?number} The tab to select, or null for a key that isn't one of
 *   theirs
 */
export function tabKey(key, i, n) {
  switch (key) {
    case 'ArrowRight': return (i + 1) % n
    case 'ArrowLeft': return (i - 1 + n) % n
    case 'Home': return 0
    case 'End': return n - 1
    default: return null
  }
}


/** How often the open dialog's facts are read again, ms. */
export const REFRESH_MS = 1000


const TAB_STYLE = {
  padding: '8px 16px', border: 0, borderBottom: '2px solid transparent', background: 'none', font: 'inherit',
  fontSize: '0.875rem', color: 'var(--ink-3)', cursor: 'pointer',
}
const TAB_SELECTED_STYLE = {...TAB_STYLE, color: 'var(--ink)', borderBottomColor: 'var(--accent)'}
const TABS_STYLE = {display: 'flex', gap: '8px', padding: '0 24px'}


/**
 * The list's look, here rather than index.css so it loads with the dialog:
 * the design system's tokens (design/UI.md), a source a section with its
 * name, links, note and facts as a two-column list.
 */
const LIST_SX = {
  '& .credits-source': {py: 1.5, borderBottom: '1px solid var(--line-hairline)'},
  '& .credits-source:last-child': {borderBottom: 0},
  '& h3': {m: 0, fontSize: '1rem', fontWeight: 600, color: 'var(--ink)'},
  '& .credits-attribution, & .credits-note, & .credits-where, & .credits-empty': {
    m: '4px 0', fontSize: '0.8125rem', color: 'var(--ink-2)',
  },
  '& .credits-attribution a': {color: 'var(--ink-link)'},
  '& .credits-note': {fontStyle: 'italic'},
  '& .credits-where': {color: 'var(--ink-3)', fontSize: '0.75rem'},
  '& .credits-facts': {
    display: 'grid', gridTemplateColumns: 'minmax(7em, max-content) 1fr', columnGap: 2, rowGap: 0.5,
    m: '8px 0', fontSize: '0.8125rem',
  },
  '& .credits-facts dt': {color: 'var(--ink-3)'},
  '& .credits-facts dd': {m: 0, color: 'var(--ink)', fontVariantNumeric: 'tabular-nums'},
}
