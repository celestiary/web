/**
 * The first campaign (#247): the copy for the posts, and their days.
 * `yarn posts` writes these into posts/drafts.md the first time and adds any
 * it doesn't have after that; once a post is in that file the file's text is
 * the post, and this one isn't read for it again.
 *
 * Each post is about one changelog entry (`entry`, its id in CHANGELOG.md).
 * Its link is the entry's permalink, or `linkFrom`'s (another entry's, when
 * this one has no view of its own), or celestiary.org; it is added after
 * the text.  The image is `image` (a file in the repo), else the entry's, else
 * the view rendered by tools/home/cards.mjs, which the maintainer runs on a
 * GPU.
 *
 * Voice: for a curious reader who hasn't seen celestiary.  Say what you can
 * look at, with the numbers the changelog has, and no hype.  At most two
 * hashtags (#astronomy, #space).  `text` is for X, with its link counted as 23
 * (280); `facebook` is a short paragraph or two, 300 to 500 characters, link
 * in the text too.  Both are checked (posts.test.js).
 */

// Entries dated after this, with a view or an image, that no post here covers
// get a plain post (headline and first sentences) when `yarn posts` is run.
export const NEW_ENTRIES_SINCE = '2026-10-20'

const HOME_EARTH = 'public/images/home/earth.webp'
const HOME_GAIA = 'public/images/home/gaia.webp'
const HOME_MOON = 'public/images/home/occultation.webp'
const HOME_TONIGHT = 'public/images/home/tonight.webp'

export const CAMPAIGN = [
  {
    title: 'Since spring: a thread',
    intro: 'Seven posts for the same day, 2026-10-26.  On X each is a reply to the one before it; Facebook has no ' +
      'threads, so there they are separate posts that day, in this order.  The first has the site\'s address; ' +
      'the rest, each its own view.',
    posts: [
      {
        id: 'spring-1-intro',
        title: 'Since spring: what you can look at now',
        entry: '2026-10-14-celestiary-has-its-own-address-celestiary-org',
        date: '2026-10-26',
        text: 'Since spring, celestiary has gained 925,686 of Gaia\'s stars, 175 galaxies, a Sun with sunspots and a ' +
          'corona, real clouds on Earth, and an address of its own. It runs in your browser. A thread on what you ' +
          'can look at now. #astronomy',
        facebook: 'Since spring, celestiary has gained a lot you can look at. Gaia\'s brightest stars, 925,686 of them, ' +
          'now load in as you look. 175 galaxies can be searched for and flown to. The Sun has sunspots, flares ' +
          'and a corona that follow the date, and Earth has the real clouds of the day you pick. It all runs in ' +
          'your browser. Over the next few posts, a look at each. #astronomy',
        image: HOME_EARTH,
        alt: 'Earth at dusk: the night side reaching South America across the Pacific, with a storm turning off Chile.',
      },
      {
        id: 'spring-2-gaia',
        title: 'Gaia\'s stars',
        entry: '2026-10-11-a-million-of-gaia-s-stars',
        date: '2026-10-26',
        text: 'Gaia\'s brightest stars, down to magnitude 10.8: 925,686 of them, added to the older Hipparcos ' +
          'catalogue. They load in tiles as you look, brightest first, and move with the date. This is 3,200 ' +
          'light-years out, with the Milky Way around them. #astronomy',
        facebook: 'Gaia is a European Space Agency satellite that has been measuring the positions of stars. Celestiary ' +
          'now holds 925,686 of its brightest, down to magnitude 10.8, on top of the older Hipparcos catalogue. ' +
          'They load in tiles as you look, brightest first, and they move with the date. This view is 3,200 ' +
          'light-years out, with the Milky Way around the stars. #astronomy',
        image: HOME_GAIA,
        alt: 'A dense field of stars with the glow of the Milky Way, seen from 3,200 light-years out.',
      },
      {
        id: 'spring-3-galaxies',
        title: '175 galaxies',
        entry: '2026-10-10-175-galaxies-you-can-fly-to',
        date: '2026-10-26',
        text: 'Past the Milky Way: 175 disc galaxies from the SPARC survey, each drawn from its published size, ' +
          'distance, tilt and rotation. Search one and fly there. Its panel plots how fast it turns against ' +
          'what its visible matter alone would give. NGC 2403 here.',
        facebook: 'Beyond the Milky Way, celestiary now has 175 disc galaxies from the SPARC survey. Each is drawn from ' +
          'its published size, distance, tilt and rotation. Search one by name and fly there. Its panel plots ' +
          'how fast the galaxy turns, against the speed its visible matter alone would give. This is NGC 2403.',
        alt: 'The spiral galaxy NGC 2403, drawn from its published size, tilt and rotation.',
      },
      {
        id: 'spring-4-sun',
        title: 'The Sun, its corona and an eclipse',
        entry: '2026-10-11-the-sun-has-sunspots-a-corona-and-eclipses',
        date: '2026-10-26',
        text: 'The Sun follows the date: sunspots from the observed record (1997 to now, then the forecast), ' +
          'flares, prominences, a changing corona. Near the disc, glare veils the sky; in totality it goes and ' +
          'the corona shows. Dallas at mid-totality, 8 April 2024.',
        facebook: 'The Sun now follows the date. Its sunspots come from the observed record, from 1997 to today and ' +
          'then the forecast, with flares, prominences and a corona that changes with the cycle. Look near the ' +
          'disc and the eye\'s glare veils the sky around it; in a total eclipse the glare goes and the corona ' +
          'shows. This is Dallas at mid-totality, 8 April 2024.',
        alt: 'The Sun\'s corona around the Moon\'s dark disc at mid-totality, seen from Dallas on 8 April 2024.',
      },
      {
        id: 'spring-5-night-side',
        title: 'Earth\'s night side and the homepage tour',
        entry: '2026-10-13-the-homepage-tour-flies-into-earth-s-shadow-to',
        linkFrom: '2026-10-06-city-lights-on-cesium-s-earth',
        date: '2026-10-26',
        text: 'Earth\'s night side shows city lights. The homepage tour flies into Earth\'s shadow, waits while your ' +
          'eyes adjust, and the lights come up (NASA\'s Black Marble): Europe, India, East Asia or the Americas, ' +
          'whichever is near midnight. Europe, 4,000 km up.',
        facebook: 'Earth\'s night side has city lights, from NASA\'s Black Marble. The tour on the homepage flies into ' +
          'Earth\'s shadow, where the Sun is hidden behind the planet, waits while your eyes adjust, and the ' +
          'lights come up over Europe, India, East Asia or the Americas, whichever is near midnight when you ' +
          'visit. This view is Europe from 4,000 km.',
        alt: 'Europe\'s city lights on Earth\'s night side, seen from 4,000 km.',
      },
      {
        id: 'spring-6-homepage',
        title: 'The homepage and What\'s new',
        entry: '2026-10-13-a-homepage-at-celestiary-s-address',
        date: '2026-10-26',
        text: 'Open the site with nothing after the address and you get a tour of the solar system, a search box ' +
          'and four cards: tonight\'s sky, Earth at dusk, the Moon hiding Jupiter, Gaia\'s stars. Each flies to ' +
          'its view. A What\'s new button lists recent changes.',
        facebook: 'Open celestiary.org with nothing after the address and you get a homepage: a slow tour of the solar ' +
          'system, a search box, and four cards. They are tonight\'s sky where you are, Earth at dusk, the Moon ' +
          'hiding Jupiter, and Gaia\'s stars, and each flies to its view. A What\'s new button lists the latest ' +
          'changes, and the ones with a view fly there too.',
        image: HOME_TONIGHT,
        alt: 'A dark sky of scattered stars with the faint band of the Milky Way: the homepage\'s Tonight\'s sky card.',
      },
      {
        id: 'spring-7-links',
        title: 'Every view is a link',
        entry: '2026-03-25-shareable-links-to-any-view',
        date: '2026-10-26',
        text: 'Every view is a link. The address holds the target, the date, the camera\'s place and direction and ' +
          'the field of view, so pasting it in a new tab reopens the view nearly pixel for pixel. Links can hold ' +
          'the clock and your settings too. Here is Mars. #space',
        facebook: 'Every view in celestiary is a link. The address holds the target, the date, the camera\'s place and ' +
          'direction, and the field of view, so pasting it in a new tab reopens the view nearly pixel for ' +
          'pixel. Links can also hold the clock and your settings. This one is Mars, and every link in this ' +
          'thread works the same way. #space',
        alt: 'Mars from 6,200 km, lit from the side.',
      },
    ],
  },
  {
    title: 'Schedule: one post per notable entry',
    intro: 'Tuesday, Thursday and Saturday from 2026-10-27.  Entries further on get a plain post of their own ' +
      '(headline and first sentences) when `yarn posts` is run after they are in CHANGELOG.md.',
    posts: [
      {
        id: 'clouds-katrina',
        title: 'Clouds you can fly into',
        entry: '2026-10-11-clouds-you-can-fly-into',
        date: '2026-10-27',
        text: 'Earth\'s clouds follow the date you set: NASA\'s daily satellite picture, back to the year 2000. From ' +
          'about 30 km down they become clouds you can fly into. This is the Gulf of Mexico on 28 August 2005, ' +
          'the day before Hurricane Katrina\'s landfall.',
        facebook: 'Earth\'s clouds follow the date you set. They come from NASA\'s daily satellite picture, back to the ' +
          'year 2000. From about 30 km down they become clouds with depth that you can fly into. This view ' +
          'looks straight down from 12 km over the Gulf of Mexico on 28 August 2005, the day before Hurricane ' +
          'Katrina made landfall.',
        alt: 'Looking straight down from 12 km at clouds over the Gulf of Mexico, 28 August 2005.',
      },
      {
        id: 'moon-hides-jupiter',
        title: 'The Moon hides Jupiter',
        entry: '2026-10-08-the-moon-lit-and-shaped-like-the-real-moon',
        date: '2026-10-29',
        text: 'Jupiter and its moons slip behind the Moon\'s limb, seen from Ohio. The Moon is lit by one brightness ' +
          'law: full Moon flat to the limb, a crescent not too bright, crater walls catching the low Sun at the ' +
          'terminator, and earthshine on the dark side.',
        facebook: 'Jupiter and its moons slip behind the Moon\'s limb, as seen from Ohio. Celestiary lights the Moon by ' +
          'one brightness law: the full Moon is flat to the limb, a crescent is no longer too bright, crater ' +
          'walls catch the low Sun along the terminator, and the dark side shows earthshine. Open the link to ' +
          'watch it happen.',
        image: HOME_MOON,
        alt: 'A crescent Moon with Jupiter and its moons as small points beside its limb.',
      },
      {
        id: 'human-expansion',
        title: 'Humans spread across the stars',
        entry: '2026-10-02-human-expansion-spread-across-the-stars',
        linkFrom: '2026-10-02-the-widgets-drawer-and-its-apps-are-in-the-link',
        date: '2026-10-31',
        text: 'What if humans left the Sun at half the speed of light and spread from star to star? This app draws ' +
          'it, one line per hop. At the defaults every star in its catalogue is reached in 50 hops and about ' +
          '46,000 years. Halfway along here. #astronomy',
        facebook: 'What if humans left the Sun at half the speed of light and spread from star to star? A small app in ' +
          'celestiary draws it, one line per hop. With the defaults, every star in its catalogue is reached in ' +
          '50 hops and about 46,000 years. This view is halfway along, and you can change the speed and how ' +
          'many neighbours each star links to. #astronomy',
        alt: 'Lines linking stars from the Sun outward, one per hop of the spread.',
      },
      {
        id: 'mars-sky',
        title: 'Mars\'s sky from Valles Marineris',
        entry: '2026-10-02-mars-s-day-sky',
        date: '2026-11-03',
        text: 'Look up from inside Valles Marineris, the canyon system on Mars. Dust scatters sunlight all round, ' +
          'so the sky is lit away from the Sun too. You can stand below a body\'s reference surface here, or at ' +
          'the Dead Sea on Earth. #space',
        facebook: 'Look up from inside Valles Marineris, the canyon system on Mars. Dust scatters the sunlight all ' +
          'round, so the sky is lit away from the Sun too, using published properties of Mars\'s dust. ' +
          'Celestiary also lets you stand below a body\'s reference surface, here or at the Dead Sea on Earth, ' +
          'and see a sky and a horizon with no black bands. #space',
        alt: 'The sky over Valles Marineris on Mars, lit all round by scattered light.',
      },
      {
        id: 'phone-sky-view',
        title: 'The sky view for your phone',
        entry: '2026-05-07-a-sky-view-for-your-phone',
        date: '2026-11-05',
        text: 'Open celestiary on a phone, start the sky view and hold it up at night: the planets, stars and ' +
          'constellations line up with the real sky, using the phone\'s orientation sensors. Land on Mars and ' +
          'look up to see its sky. iOS Safari and Chrome on Android.',
        facebook: 'Open celestiary on a phone, start the sky view and hold the phone up at night: the planets, stars ' +
          'and constellations line up with the real sky, using the phone\'s orientation sensors. It works on iOS ' +
          'Safari and Chrome on Android. Land on Mars and look up, and you see Mars\'s sky instead. On a desktop ' +
          'it shows what the view would be. #astronomy',
        image: HOME_TONIGHT,
        alt: 'A dark sky of scattered stars with the faint band of the Milky Way.',
        notes: 'A screenshot of the sky view on a phone would show it better than the homepage card.',
      },
      {
        id: 'milky-way-model',
        title: 'The Milky Way from a published model',
        entry: '2026-10-06-the-milky-way-from-a-published-structural-model',
        date: '2026-11-07',
        text: 'The Milky Way as its stars\' combined light, from published models: a bar at 27 degrees, four arms as ' +
          'Reid and colleagues measured them, dust lanes, the warp, thin and thick discs, a boxy bulge. This is ' +
          'about 150,000 light-years out. #astronomy',
        facebook: 'The Milky Way in celestiary is its stars\' combined light, drawn from published models: a bar at 27 ' +
          'degrees, four arms as Reid and colleagues measured them, dust lanes, the warp, thin and thick discs ' +
          'and a boxy bulge. From outside it frames itself like a photograph. This view is about 150,000 light- ' +
          'years out. #astronomy',
        alt: 'The Milky Way seen from outside: a barred spiral with four arms and dust lanes.',
      },
      {
        id: 'saturn-rings',
        title: 'Saturn\'s rings, lit and shadowed',
        entry: '2026-03-25-saturn-s-rings-lit-and-shadowed',
        date: '2026-11-10',
        text: 'Saturn\'s rings have a shader of their own: ice glints, rings that brighten when backlit, Saturn\'s ' +
          'shadow falling across them, and the rings\' shadow on Saturn. Drag to orbit it, scroll to come closer. ' +
          '#astronomy',
        facebook: 'Saturn\'s rings have a shader of their own: ice glints, rings that brighten when backlit, Saturn\'s ' +
          'shadow falling across them, and the rings\' shadow on the planet. Drag to orbit Saturn from afar and ' +
          'scroll to come closer. The date is in the link, so everyone who opens it sees the same light. ' +
          '#astronomy',
        alt: 'Saturn and its rings, with Saturn\'s shadow across the rings and the rings\' shadow on the planet.',
      },
      {
        id: 'outback-twilight',
        title: 'Twilight in the outback',
        entry: '2026-10-05-exposure-that-adapts-like-the-eye',
        date: '2026-11-12',
        text: 'Twilight in the Australian outback, with a sky that works as an eye does: the bright sky hides the ' +
          'stars by its light, and as it darkens they come out. The exposure follows what is on screen and ' +
          'eases over about a second. #astronomy',
        facebook: 'Twilight in the Australian outback, with a sky that works the way an eye does. The bright sky hides ' +
          'the stars by its light, and as it darkens they come out. Celestiary meters the picture from what is ' +
          'on screen, and the exposure eases over about a second, as your eyes would adapt. Stars, the Milky ' +
          'Way and the Sun\'s disc are drawn in physical units. #astronomy',
        alt: 'The sky over the Australian outback at civil twilight, with the first stars showing.',
      },
      {
        id: 'blue-marble-month',
        title: 'Earth in the month\'s Blue Marble',
        entry: '2026-09-29-earth-in-the-month-s-blue-marble',
        date: '2026-11-14',
        text: 'Earth is NASA\'s Blue Marble for the month of the date you set, so the picture changes as the ' +
          'calendar does. Close to the ground, higher-resolution detail comes in. This is Africa from 20,000 km ' +
          'on 12 April 2025. #space',
        facebook: 'Earth in celestiary is NASA\'s Blue Marble for the month of the date you set, so the picture changes ' +
          'as the calendar does. Close to the ground, higher-resolution detail comes in. This view is Africa ' +
          'from 20,000 km on 12 April 2025. Change the date and the surface follows. #space',
        alt: 'Africa from 20,000 km, in NASA\'s Blue Marble picture for April.',
      },
      {
        id: 'follow-a-body',
        title: 'The camera follows a body along its orbit',
        entry: '2026-10-09-f-makes-the-camera-follow-a-body-along-its-orbit',
        date: '2026-11-17',
        text: 'Press f and the camera rides a body\'s orbit as time runs, so the planet stays put on screen while ' +
          'you look around. It turns on when you go to a body, and the link keeps it. Here is Jupiter, ' +
          'followed, with time running at 16,384 times real speed.',
        facebook: 'Press f in celestiary and the camera rides a body\'s orbit as time runs, so the planet stays put on ' +
          'screen while you look around. It turns on when you go to a body, and the link keeps it, so a shared ' +
          'view reloads still following. This one is Jupiter, followed, with time running at 16,384 times real ' +
          'speed.',
        alt: 'Jupiter, with the clock running at 16,384 times real speed.',
        notes: 'A still shows little of this: a screen recording of the view, with f on, shows it.',
      },
    ],
  },
]
