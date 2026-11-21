/**
 * The colour theme: every designed colour in the app, in one place
 * (design/UI.md, "The theme").  The chrome's tokens (`uiColors`) and the scene's
 * overlay colours (`sceneColors`) share it, so the panel's numbers can be keyed to
 * the scene's lines (design/UI.md, principle 3) and a whole theme can be
 * swapped (the observing red theme, design/UI.md phase 2).
 *
 * - `uiColors` holds CSS colours (strings).  `js/index.css`'s `:root` colour
 *   tokens are written from it by `yarn theme` (tools/theme/css.mjs), and a
 *   test fails when they drift; MUI's palette reads it (Style.jsx).
 * - `sceneColors` holds 0xRRGGBB numbers, as three's `Color` and `setHex` take them;
 *   `css()` turns one into a CSS colour for a canvas or the DOM.
 *
 * Values are sRGB, as a designer gives them.  How a scene colour reaches the
 * screen (three's colour management decodes a hex to linear) is the
 * renderer's business, not the theme's (js/scene/HDR.md, "Colour spaces").
 *
 * Not here: physical colours (a body's albedo, a star's blackbody, a model's
 * paint), which are data; and developer tools' own (js/perf, the AR debug
 * HUD).
 */


/**
 * @param {number} hex 0xRRGGBB
 * @returns {string} '#rrggbb'
 */
export function css(hex) {
  return `#${hex.toString(16).padStart(6, '0')}`
}


/**
 * @param {string} hex '#rrggbb'
 * @param {number} a Alpha, 0 to 1
 * @returns {string} 'rgba(r, g, b, a)'
 */
export function alpha(hex, a) {
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`
}


const ACCENT = '#869fdb'
const ACCENT_SOFT = '#c4d2f2'
const SURFACE = '#0a0c14'
const LABEL = '#7fa0e0'
const INK = '#dfe5f3'
const INK_LINK = '#b8cdea'


/**
 * The chrome's colours.  Each key is a CSS custom property of the same name
 * in kebab case (`inkLink` is `--ink-link`).
 */
export const uiColors = Object.freeze({
  // Surfaces.  The sky is the ground: nothing paints a page background.
  surface: SURFACE,
  // Behind small text over the scene: dark enough for --ink-3 over a sunlit
  // day side (about 4.4:1 on white), quiet on the night sky.
  surfaceVeil: alpha(SURFACE, 0.75),
  // Lines: borders, not shadows.
  lineHairline: 'rgba(255, 255, 255, 0.08)',
  line: 'rgba(255, 255, 255, 0.12)',
  lineStrong: 'rgba(255, 255, 255, 0.16)',
  lineAccent: alpha(ACCENT, 0.55),
  // The one signal colour, never a large fill.
  accent: ACCENT,
  accentSoft: ACCENT_SOFT,
  accentFill: alpha(ACCENT, 0.14),
  accentFillHover: alpha(ACCENT, 0.28),
  // Ink, brightest first; each holds 4.5:1 on the sheet.  --ink-4 only on an
  // opaque surface.
  inkBright: '#ffffff',
  ink: INK,
  ink2: '#b9c3d9',
  ink3: '#a9b4cc',
  ink4: '#8f9bb5',
  inkLink: INK_LINK,
  // The scene's label blue, where the chrome names what the scene labels.
  label: LABEL,
  // Shade: the dark behind text over pictures and the scene.
  shadow: '#000000',
  // Raised surfaces over the homepage's scene: the search box and the news
  // card, the news card hovered, the news panel, a news button hovered;
  // and the well behind a card's image.
  surfaceRaised: 'rgba(12, 14, 24, 0.72)',
  surfaceRaisedHover: 'rgba(24, 30, 52, 0.8)',
  surfaceDeep: 'rgba(3, 5, 10, 0.74)',
  surfaceButtonHover: 'rgba(40, 48, 78, 0.85)',
  imageWell: '#05060a',
  // Off the palette: near the inks above, and to be folded into them (a
  // visible change, so not in the refactor that brought them here).
  inkTitle: '#d8deec', // the homepage's title, by --ink
  inkChipHover: '#dde8f7', // a search chip hovered, by --ink
  inkCount: '#e6ebf7', // What's new's count, by --ink
  inkCaption: '#eef1fa', // a news caption, by --ink-bright
  inkCaptionMeta: '#c3cbe0', // a news caption's date line, by --ink-2
  inkTag: '#a9b9e3', // What's new's featured and fix tags, by --ink-3
  inkFaint: '#7f8cab', // What's new's social links, by --ink-4
  // MUI's default blues, where the chrome hasn't moved to the accent: a
  // selected toggle's ink (the drag mode, the layers menu) and its halo.
  controlSelected: '#90caf9',
  controlHalo: '#2196f3',
  // Ad-hoc dark surfaces: the layers menu, the search box's list, the widgets
  // drawer; and the settings list's divider.  By --surface and --line.
  menuSurface: 'rgba(20, 20, 20, 0.85)',
  listSurface: 'rgba(30, 30, 30, 0.5)',
  drawerSurface: '#121212',
  settingsDivider: 'rgba(255, 255, 255, 0.15)',
  // The legacy chrome's (design/UI.md phase 5: retire .dialog, .text-label,
  // collapsor.js): CSS's grey, #ccc and #069.
  legacyGrey: 'grey',
  legacyInk: '#cccccc',
  legacyLink: '#006699',
})


/** The scene's overlay colours (0xRRGGBB): labels, lines, marks and keys. */
export const sceneColors = Object.freeze({
  // Names of stars, bodies, places and asterisms, and the asterisms' lines.
  label: parseInt(LABEL.slice(1), 16),
  // Names of galaxies: apart from the stars' blue.
  galaxyLabel: 0xc8b0e8,
  // A planet's orbit line.
  orbit: 0x0000ff,
  // The celestial grids (Grids.js).
  grid: Object.freeze({equatorial: 0xddaa44, ecliptic: 0xff66cc, galactic: 0x44ddee}),
  // Orbital regimes (regimes.js).
  regime: Object.freeze({
    low: 0x7fd0ff, // LEO, LLO
    medium: 0xb59bff, // MEO
    far: 0xd8c27f, // 100,000 km
    cislunar: 0xd8a07f,
    graveyard: 0x9a9a9a,
    gps: 0x9fe09f,
    molniya: 0xff9f9f,
    tundra: 0xffc07f,
    sunSync: 0xfff07f,
    frozen: 0x8fe0c0, // the Moon's frozen orbits
  }),
  // Lagrange points, Hill spheres, synchronous orbits and manifolds (LagrangeMarks.js).
  lagrange: Object.freeze({
    point: 0x8fe3b0, hill: 0x8fb8e3, sync: 0xe3c88f, unstable: 0x9a9a9a,
    manifoldStable: 0x60e080, manifoldUnstable: 0xff7060,
  }),
  // Three-body periodic orbits (periodicOrbits.js).
  periodic: Object.freeze({
    l1Lyapunov: 0x9fd0ff, l2Lyapunov: 0x9fb0ff, l1Halo: 0xffb0e0, l2Halo: 0xe0a0ff, dro: 0xa0ffd0, nrho: 0xffe080,
  }),
  // A craft's flights (craft/catalog.js).
  craft: Object.freeze({tli: 0xffc070, blt: 0x9fe870}),
  // Orbital elements, in the diagram and the panel (orbitElements.js).
  element: Object.freeze({
    semiMajorAxis: 0xffb02e, eccentricity: 0xff6ad5, inclination: 0x4cd964, node: 0x2ec7e6,
    pericenter: 0x8c8cff, anomaly: 0xff5f57,
  }),
  // The orbit diagram (orbitDiagram.js).
  diagram: Object.freeze({
    orbit: 0x6fa8ff, reference: 0xb0b0b0, orbitPlane: 0xe0d070, direction: 0xd0d0d0, body: 0xffffff,
    barycentre: 0xffe08a,
  }),
  // The space networks (networks/).
  iridium: Object.freeze({
    planes: Object.freeze([0xff8f6f, 0xffc46f, 0xe8f06f, 0x8ff08f, 0x6fd8ff, 0xb09fff]),
    spare: 0x8a8a8a, crosslink: 0xe8e8ff,
  }),
  starlink: Object.freeze({shell43: 0x6fe0c8, shell53: 0x7fb8ff, shell70: 0xc89fff, polar: 0xffa8d8}),
  dsn: Object.freeze({up: 0xffa040, down: 0x50d8ff, dish: 0xffffff, siteLabel: 0xe8f4ff, craftLabel: 0xa8ecff}),
  // A population's group with no colour of its own (population/Population.js).
  populationOther: 0xc8c8c8,
  // Suntan's legs (suntan/SuntanTrack.js).
  suntan: Object.freeze({psp: 0xd08040, transfer: 0xffe040, sync: 0x40ff90, relay: 0x40ff90, descent: 0xff4060}),
  // Rubin: the object's apparent path and the telescope's beam (rubin/).
  rubin: Object.freeze({path: 0x4fd8c8, beam: 0x9fe8ff}),
  // A galaxy's rotation curve plot (rotationCurve.js).
  rotationCurve: Object.freeze({observed: 0x3987e5, baryons: 0xd95926}),
  // Human expansion's lines (ColonizationLines.js): rgb triples, 0 to 1,
  // written into the lines' buffer as they are (never through three's Color,
  // so not decoded as the hex colours above are).  The hops' ramp, near to
  // far, and a selected star's route: amber over the ramp's blues.
  colonization: Object.freeze({
    ramp: Object.freeze([
      Object.freeze([0.95, 0.97, 1.00]),
      Object.freeze([0.62, 0.77, 1.00]),
      Object.freeze([0.25, 0.50, 0.92]),
      Object.freeze([0.09, 0.22, 0.52]),
      Object.freeze([0.02, 0.03, 0.07]),
    ]),
    path: Object.freeze([1.0, 0.7, 0.15]),
  }),
})
