# Post drafts

Drafts of social posts from CHANGELOG.md's entries, and the first campaign,
for X (@celestiary_org) and Facebook.  Nothing here is posted for you: you
publish each one by hand (tools/posts/README.md).

- **Edit freely.** `yarn posts` never changes a post that is in this file,
  only adds new ones and works out each `Length` again.
- **Mark each post's `Status`:** `draft`, `scheduled`, `posted` or `skip`.
  `Date` is a suggestion.  When a post is `posted`, paste its URLs into
  `X` and `Facebook` and run `yarn changelog`: What's new then links its
  entry to them.
- **The text** is the post as you'd paste it, link included, and is for X:
  at most 280, a link counting 23.  The `#### Facebook` block under it is
  Facebook's: a short paragraph or two, 300 to 500 characters, link in the
  text.  A heading for another platform in the table (`PLATFORMS` in
  tools/posts/text.mjs) works the same way.
- **Images:** attach `Image` on both.  Facebook can't unfurl a link's own
  picture yet: every page has the same tags, whatever follows the `#`.  If
  `Render` is there and the file isn't, run that command first (after
  `yarn build`), on a machine with a GPU.  Look at the result and check its
  `Alt`, which was written from the link, not the render.

## Since spring: a thread

Seven posts for the same day, 2026-10-26.  On X each is a reply to the one before it; Facebook has no threads, so there they are separate posts that day, in this order.  The first has the site's address; the rest, each its own view.

### Since spring: what you can look at now

- ID: spring-1-intro
- Status: draft
- X:
- Facebook:
- Date: 2026-10-26
- Entry: 2026-10-14-celestiary-has-its-own-address-celestiary-org
- Image: public/images/home/earth.webp
- Alt: Earth at dusk: the night side reaching South America across the Pacific, with a storm turning off Chile.
- Notes:
- Length: X 256/280, Facebook 392/500

```text
Since spring, celestiary has gained 925,686 of Gaia's stars, 175 galaxies, a Sun with sunspots and a corona, real clouds on Earth, and an address of its own. It runs in your browser. A thread on what you can look at now. #astronomy

https://celestiary.org/
```

#### Facebook

```text
Since spring, celestiary has gained a lot you can look at. Gaia's brightest stars, 925,686 of them, now load in as you look. 175 galaxies can be searched for and flown to. The Sun has sunspots, flares and a corona that follow the date, and Earth has the real clouds of the day you pick. It all runs in your browser. Over the next few posts, a look at each. #astronomy

https://celestiary.org/
```

### Gaia's stars

- ID: spring-2-gaia
- Status: draft
- X:
- Facebook:
- Date: 2026-10-26
- Entry: 2026-10-11-a-million-of-gaia-s-stars
- Image: public/images/home/gaia.webp
- Alt: A dense field of stars with the glow of the Milky Way, seen from 3,200 light-years out.
- Notes:
- Length: X 276/280, Facebook 388/500

```text
Gaia's brightest stars, down to magnitude 10.8: 925,686 of them, added to the older Hipparcos catalogue. They load in tiles as you look, brightest first, and move with the date. This is 3,200 light-years out, with the Milky Way around them. #astronomy

https://celestiary.org/#sun/earth@43.3389,-9.9593,30373373.021376Tm;t=9779.5692jd;cq=-0.436,0.7975,0.0666,0.4116;fov=45deg;ev=1.33;s=alovTF
```

#### Facebook

```text
Gaia is a European Space Agency satellite that has been measuring the positions of stars. Celestiary now holds 925,686 of its brightest, down to magnitude 10.8, on top of the older Hipparcos catalogue. They load in tiles as you look, brightest first, and they move with the date. This view is 3,200 light-years out, with the Milky Way around the stars. #astronomy

https://celestiary.org/#sun/earth@43.3389,-9.9593,30373373.021376Tm;t=9779.5692jd;cq=-0.436,0.7975,0.0666,0.4116;fov=45deg;ev=1.33;s=alovTF
```

### 175 galaxies

- ID: spring-3-galaxies
- Status: draft
- X:
- Facebook:
- Date: 2026-10-26
- Entry: 2026-10-10-175-galaxies-you-can-fly-to
- Image: posts/images/spring-3-galaxies.png
- Alt: The spiral galaxy NGC 2403, drawn from its published size, tilt and rotation.
- Render: node tools/home/cards.mjs --gpu --id spring-3-galaxies --hash 'galaxy:ngc2403' --png posts/images
- Notes:
- Length: X 275/280, Facebook 324/500

```text
Past the Milky Way: 175 disc galaxies from the SPARC survey, each drawn from its published size, distance, tilt and rotation. Search one and fly there. Its panel plots how fast it turns against what its visible matter alone would give. NGC 2403 here.

https://celestiary.org/#galaxy:ngc2403
```

#### Facebook

```text
Beyond the Milky Way, celestiary now has 175 disc galaxies from the SPARC survey. Each is drawn from its published size, distance, tilt and rotation. Search one by name and fly there. Its panel plots how fast the galaxy turns, against the speed its visible matter alone would give. This is NGC 2403.

https://celestiary.org/#galaxy:ngc2403
```

### The Sun, its corona and an eclipse

- ID: spring-4-sun
- Status: draft
- X:
- Facebook:
- Date: 2026-10-26
- Entry: 2026-10-11-the-sun-has-sunspots-a-corona-and-eclipses
- Image: posts/images/spring-4-sun.png
- Alt: The Sun's corona around the Moon's dark disc at mid-totality, seen from Dallas on 8 April 2024.
- Render: node tools/home/cards.mjs --gpu --id spring-4-sun --hash 'sun/earth@32.78,-96.8009,200m;t=8864.2801jd;cq=0,-0.5777,0,0.8162;fov=3deg;s=lpoxF;time:pause' --png posts/images
- Notes:
- Length: X 274/280, Facebook 373/500

```text
The Sun follows the date: sunspots from the observed record (1997 to now, then the forecast), flares, prominences, a changing corona. Near the disc, glare veils the sky; in totality it goes and the corona shows. Dallas at mid-totality, 8 April 2024.

https://celestiary.org/#sun/earth@32.78,-96.8009,200m;t=8864.2801jd;cq=0,-0.5777,0,0.8162;fov=3deg;s=lpoxF;time:pause
```

#### Facebook

```text
The Sun now follows the date. Its sunspots come from the observed record, from 1997 to today and then the forecast, with flares, prominences and a corona that changes with the cycle. Look near the disc and the eye's glare veils the sky around it; in a total eclipse the glare goes and the corona shows. This is Dallas at mid-totality, 8 April 2024.

https://celestiary.org/#sun/earth@32.78,-96.8009,200m;t=8864.2801jd;cq=0,-0.5777,0,0.8162;fov=3deg;s=lpoxF;time:pause
```

### Earth's night side and the homepage tour

- ID: spring-5-night-side
- Status: draft
- X:
- Facebook:
- Date: 2026-10-26
- Entry: 2026-10-13-the-homepage-tour-flies-into-earth-s-shadow-to
- Image: posts/images/spring-5-night-side.png
- Alt: Europe's city lights on Earth's night side, seen from 4,000 km.
- Render: node tools/home/cards.mjs --gpu --id spring-5-night-side --hash 'sun/earth@40,9.9942,4Mm;t=9851.4722jd;cq=0.0005,0.9896,0.1439,-0.0037;fov=45deg;s=alpoU' --png posts/images
- Notes:
- Length: X 274/280, Facebook 359/500

```text
Earth's night side shows city lights. The homepage tour flies into Earth's shadow, waits while your eyes adjust, and the lights come up (NASA's Black Marble): Europe, India, East Asia or the Americas, whichever is near midnight. Europe, 4,000 km up.

https://celestiary.org/#sun/earth@40,9.9942,4Mm;t=9851.4722jd;cq=0.0005,0.9896,0.1439,-0.0037;fov=45deg;s=alpoU
```

#### Facebook

```text
Earth's night side has city lights, from NASA's Black Marble. The tour on the homepage flies into Earth's shadow, where the Sun is hidden behind the planet, waits while your eyes adjust, and the lights come up over Europe, India, East Asia or the Americas, whichever is near midnight when you visit. This view is Europe from 4,000 km.

https://celestiary.org/#sun/earth@40,9.9942,4Mm;t=9851.4722jd;cq=0.0005,0.9896,0.1439,-0.0037;fov=45deg;s=alpoU
```

### The homepage and What's new

- ID: spring-6-homepage
- Status: draft
- X:
- Facebook:
- Date: 2026-10-26
- Entry: 2026-10-13-a-homepage-at-celestiary-s-address
- Image: public/images/home/tonight.webp
- Alt: A dark sky of scattered stars with the faint band of the Milky Way: the homepage's Tonight's sky card.
- Notes:
- Length: X 273/280, Facebook 372/500

```text
Open the site with nothing after the address and you get a tour of the solar system, a search box and four cards: tonight's sky, Earth at dusk, the Moon hiding Jupiter, Gaia's stars. Each flies to its view. A What's new button lists recent changes.

https://celestiary.org/
```

#### Facebook

```text
Open celestiary.org with nothing after the address and you get a homepage: a slow tour of the solar system, a search box, and four cards. They are tonight's sky where you are, Earth at dusk, the Moon hiding Jupiter, and Gaia's stars, and each flies to its view. A What's new button lists the latest changes, and the ones with a view fly there too.

https://celestiary.org/
```

### Every view is a link

- ID: spring-7-links
- Status: draft
- X:
- Facebook:
- Date: 2026-10-26
- Entry: 2026-03-25-shareable-links-to-any-view
- Image: posts/images/spring-7-links.png
- Alt: Mars from 6,200 km, lit from the side.
- Render: node tools/home/cards.mjs --gpu --id spring-7-links --hash 'sun/mars@-22.0096,-139.5125,6.210169Mm;t=9579.9256jd;cq=0.2236,-0.5002,0.085,0.8322;fov=45deg' --png posts/images
- Notes:
- Length: X 279/280, Facebook 349/500

```text
Every view is a link. The address holds the target, the date, the camera's place and direction and the field of view, so pasting it in a new tab reopens the view nearly pixel for pixel. Links can hold the clock and your settings too. Here is Mars. #space

https://celestiary.org/#sun/mars@-22.0096,-139.5125,6.210169Mm;t=9579.9256jd;cq=0.2236,-0.5002,0.085,0.8322;fov=45deg
```

#### Facebook

```text
Every view in celestiary is a link. The address holds the target, the date, the camera's place and direction, and the field of view, so pasting it in a new tab reopens the view nearly pixel for pixel. Links can also hold the clock and your settings. This one is Mars, and every link in this thread works the same way. #space

https://celestiary.org/#sun/mars@-22.0096,-139.5125,6.210169Mm;t=9579.9256jd;cq=0.2236,-0.5002,0.085,0.8322;fov=45deg
```

## Schedule: one post per notable entry

Tuesday, Thursday and Saturday from 2026-10-27.  Entries further on get a plain post of their own (headline and first sentences) when `yarn posts` is run after they are in CHANGELOG.md.

### Clouds you can fly into

- ID: clouds-katrina
- Status: draft
- X:
- Facebook:
- Date: 2026-10-27
- Entry: 2026-10-11-clouds-you-can-fly-into
- Image: posts/images/clouds-katrina.png
- Alt: Looking straight down from 12 km at clouds over the Gulf of Mexico, 28 August 2005.
- Render: node tools/home/cards.mjs --gpu --id clouds-katrina --hash 'sun/earth@25,-88,12km;t=2066.4167jd;cq=-0.3707,-0.4287,-0.0058,0.8239;fov=45deg;s=alpoU' --png posts/images
- Notes:
- Length: X 269/280, Facebook 341/500

```text
Earth's clouds follow the date you set: NASA's daily satellite picture, back to the year 2000. From about 30 km down they become clouds you can fly into. This is the Gulf of Mexico on 28 August 2005, the day before Hurricane Katrina's landfall.

https://celestiary.org/#sun/earth@25,-88,12km;t=2066.4167jd;cq=-0.3707,-0.4287,-0.0058,0.8239;fov=45deg;s=alpoU
```

#### Facebook

```text
Earth's clouds follow the date you set. They come from NASA's daily satellite picture, back to the year 2000. From about 30 km down they become clouds with depth that you can fly into. This view looks straight down from 12 km over the Gulf of Mexico on 28 August 2005, the day before Hurricane Katrina made landfall.

https://celestiary.org/#sun/earth@25,-88,12km;t=2066.4167jd;cq=-0.3707,-0.4287,-0.0058,0.8239;fov=45deg;s=alpoU
```

### The Moon hides Jupiter

- ID: moon-hides-jupiter
- Status: draft
- X:
- Facebook:
- Date: 2026-10-29
- Entry: 2026-10-08-the-moon-lit-and-shaped-like-the-real-moon
- Image: public/images/home/occultation.webp
- Alt: A crescent Moon with Jupiter and its moons as small points beside its limb.
- Notes:
- Length: X 271/280, Facebook 338/500

```text
Jupiter and its moons slip behind the Moon's limb, seen from Ohio. The Moon is lit by one brightness law: full Moon flat to the limb, a crescent not too bright, crater walls catching the low Sun at the terminator, and earthshine on the dark side.

https://celestiary.org/#sun/jupiter@41.2054,-82.3901,169m;from=sun/earth;t=9774.891jd;cq=0.3372,-0.7003,-0.112,0.6191;fov=0.91deg;s=oL
```

#### Facebook

```text
Jupiter and its moons slip behind the Moon's limb, as seen from Ohio. Celestiary lights the Moon by one brightness law: the full Moon is flat to the limb, a crescent is no longer too bright, crater walls catch the low Sun along the terminator, and the dark side shows earthshine. Open the link to watch it happen.

https://celestiary.org/#sun/jupiter@41.2054,-82.3901,169m;from=sun/earth;t=9774.891jd;cq=0.3372,-0.7003,-0.112,0.6191;fov=0.91deg;s=oL
```

### Humans spread across the stars

- ID: human-expansion
- Status: draft
- X:
- Facebook:
- Date: 2026-10-31
- Entry: 2026-10-02-human-expansion-spread-across-the-stars
- Image: posts/images/human-expansion.png
- Alt: Lines linking stars from the Sun outward, one per hop of the spread.
- Render: node tools/home/cards.mjs --gpu --id human-expansion --hash 'sun@12.3,-45.6,20.5Tm;t=9771.1jd;cq=0.1,0.2,0.3,0.927;fov=45deg;apps:open,view=expansion;apps.expansion:k=6,run=1,at=0.5,star=71683' --png posts/images
- Notes:
- Length: X 267/280, Facebook 368/500

```text
What if humans left the Sun at half the speed of light and spread from star to star? This app draws it, one line per hop. At the defaults every star in its catalogue is reached in 50 hops and about 46,000 years. Halfway along here. #astronomy

https://celestiary.org/#sun@12.3,-45.6,20.5Tm;t=9771.1jd;cq=0.1,0.2,0.3,0.927;fov=45deg;apps:open,view=expansion;apps.expansion:k=6,run=1,at=0.5,star=71683
```

#### Facebook

```text
What if humans left the Sun at half the speed of light and spread from star to star? A small app in celestiary draws it, one line per hop. With the defaults, every star in its catalogue is reached in 50 hops and about 46,000 years. This view is halfway along, and you can change the speed and how many neighbours each star links to. #astronomy

https://celestiary.org/#sun@12.3,-45.6,20.5Tm;t=9771.1jd;cq=0.1,0.2,0.3,0.927;fov=45deg;apps:open,view=expansion;apps.expansion:k=6,run=1,at=0.5,star=71683
```

### Mars's sky from Valles Marineris

- ID: mars-sky
- Status: draft
- X:
- Facebook:
- Date: 2026-11-03
- Entry: 2026-10-02-mars-s-day-sky
- Image: posts/images/mars-sky.png
- Alt: The sky over Valles Marineris on Mars, lit all round by scattered light.
- Render: node tools/home/cards.mjs --gpu --id mars-sky --hash 'sun/mars@-10.7408,-68.893,-796m;t=9770.31455jd;cq=-0.5182,0.7149,-0.3829,0.2716;fov=45deg;s=alpoU' --png posts/images
- Notes:
- Length: X 253/280, Facebook 366/500

```text
Look up from inside Valles Marineris, the canyon system on Mars. Dust scatters sunlight all round, so the sky is lit away from the Sun too. You can stand below a body's reference surface here, or at the Dead Sea on Earth. #space

https://celestiary.org/#sun/mars@-10.7408,-68.893,-796m;t=9770.31455jd;cq=-0.5182,0.7149,-0.3829,0.2716;fov=45deg;s=alpoU
```

#### Facebook

```text
Look up from inside Valles Marineris, the canyon system on Mars. Dust scatters the sunlight all round, so the sky is lit away from the Sun too, using published properties of Mars's dust. Celestiary also lets you stand below a body's reference surface, here or at the Dead Sea on Earth, and see a sky and a horizon with no black bands. #space

https://celestiary.org/#sun/mars@-10.7408,-68.893,-796m;t=9770.31455jd;cq=-0.5182,0.7149,-0.3829,0.2716;fov=45deg;s=alpoU
```

### The sky view for your phone

- ID: phone-sky-view
- Status: draft
- X:
- Facebook:
- Date: 2026-11-05
- Entry: 2026-05-07-a-sky-view-for-your-phone
- Image: public/images/home/tonight.webp
- Alt: A dark sky of scattered stars with the faint band of the Milky Way.
- Notes: A screenshot of the sky view on a phone would show it better than the homepage card.
- Length: X 275/280, Facebook 368/500

```text
Open celestiary on a phone, start the sky view and hold it up at night: the planets, stars and constellations line up with the real sky, using the phone's orientation sensors. Land on Mars and look up to see its sky. iOS Safari and Chrome on Android.

https://celestiary.org/
```

#### Facebook

```text
Open celestiary on a phone, start the sky view and hold the phone up at night: the planets, stars and constellations line up with the real sky, using the phone's orientation sensors. It works on iOS Safari and Chrome on Android. Land on Mars and look up, and you see Mars's sky instead. On a desktop it shows what the view would be. #astronomy

https://celestiary.org/
```

### The Milky Way from a published model

- ID: milky-way-model
- Status: draft
- X:
- Facebook:
- Date: 2026-11-07
- Entry: 2026-10-06-the-milky-way-from-a-published-structural-model
- Image: posts/images/milky-way-model.png
- Alt: The Milky Way seen from outside: a barred spiral with four arms and dust lanes.
- Render: node tools/home/cards.mjs --gpu --id milky-way-model --hash 'sun@28.1629,-168.012,1411144323.815593Tm;t=9774.7819jd;cq=-0.3859,0.59,0.6319,-0.322;fov=50deg' --png posts/images
- Notes:
- Length: X 268/280, Facebook 346/500

```text
The Milky Way as its stars' combined light, from published models: a bar at 27 degrees, four arms as Reid and colleagues measured them, dust lanes, the warp, thin and thick discs, a boxy bulge. This is about 150,000 light-years out. #astronomy

https://celestiary.org/#sun@28.1629,-168.012,1411144323.815593Tm;t=9774.7819jd;cq=-0.3859,0.59,0.6319,-0.322;fov=50deg
```

#### Facebook

```text
The Milky Way in celestiary is its stars' combined light, drawn from published models: a bar at 27 degrees, four arms as Reid and colleagues measured them, dust lanes, the warp, thin and thick discs and a boxy bulge. From outside it frames itself like a photograph. This view is about 150,000 light- years out. #astronomy

https://celestiary.org/#sun@28.1629,-168.012,1411144323.815593Tm;t=9774.7819jd;cq=-0.3859,0.59,0.6319,-0.322;fov=50deg
```

### Saturn's rings, lit and shadowed

- ID: saturn-rings
- Status: draft
- X:
- Facebook:
- Date: 2026-11-10
- Entry: 2026-03-25-saturn-s-rings-lit-and-shadowed
- Image: posts/images/saturn-rings.png
- Alt: Saturn and its rings, with Saturn's shadow across the rings and the rings' shadow on the planet.
- Render: node tools/home/cards.mjs --gpu --id saturn-rings --hash 'sun/saturn@21.6445,-12.6257,215.888389Mm;t=9580.0073jd;cq=-0.0914,0.5421,0.0816,0.8314;fov=45deg' --png posts/images
- Notes:
- Length: X 235/280, Facebook 327/500

```text
Saturn's rings have a shader of their own: ice glints, rings that brighten when backlit, Saturn's shadow falling across them, and the rings' shadow on Saturn. Drag to orbit it, scroll to come closer. #astronomy

https://celestiary.org/#sun/saturn@21.6445,-12.6257,215.888389Mm;t=9580.0073jd;cq=-0.0914,0.5421,0.0816,0.8314;fov=45deg
```

#### Facebook

```text
Saturn's rings have a shader of their own: ice glints, rings that brighten when backlit, Saturn's shadow falling across them, and the rings' shadow on the planet. Drag to orbit Saturn from afar and scroll to come closer. The date is in the link, so everyone who opens it sees the same light. #astronomy

https://celestiary.org/#sun/saturn@21.6445,-12.6257,215.888389Mm;t=9580.0073jd;cq=-0.0914,0.5421,0.0816,0.8314;fov=45deg
```

### Twilight in the outback

- ID: outback-twilight
- Status: draft
- X:
- Facebook:
- Date: 2026-11-12
- Entry: 2026-10-05-exposure-that-adapts-like-the-eye
- Image: posts/images/outback-twilight.png
- Alt: The sky over the Australian outback at civil twilight, with the first stars showing.
- Render: node tools/home/cards.mjs --gpu --id outback-twilight --hash 'sun/earth@-25.5,131,3000m;t=10055.4036jd;cq=0.6969,-0.5514,0.452,-0.0775;fov=45deg;s=alpoUL' --png posts/images
- Notes:
- Length: X 257/280, Facebook 385/500

```text
Twilight in the Australian outback, with a sky that works as an eye does: the bright sky hides the stars by its light, and as it darkens they come out. The exposure follows what is on screen and eases over about a second. #astronomy

https://celestiary.org/#sun/earth@-25.5,131,3000m;t=10055.4036jd;cq=0.6969,-0.5514,0.452,-0.0775;fov=45deg;s=alpoUL
```

#### Facebook

```text
Twilight in the Australian outback, with a sky that works the way an eye does. The bright sky hides the stars by its light, and as it darkens they come out. Celestiary meters the picture from what is on screen, and the exposure eases over about a second, as your eyes would adapt. Stars, the Milky Way and the Sun's disc are drawn in physical units. #astronomy

https://celestiary.org/#sun/earth@-25.5,131,3000m;t=10055.4036jd;cq=0.6969,-0.5514,0.452,-0.0775;fov=45deg;s=alpoUL
```

### Earth in the month's Blue Marble

- ID: blue-marble-month
- Status: draft
- X:
- Facebook:
- Date: 2026-11-14
- Entry: 2026-09-29-earth-in-the-month-s-blue-marble
- Image: posts/images/blue-marble-month.png
- Alt: Africa from 20,000 km, in NASA's Blue Marble picture for April.
- Render: node tools/home/cards.mjs --gpu --id blue-marble-month --hash 'sun/earth@15,20.7446,20Mm;t=9233.1234jd;cq=-0.0108,0.9967,-0.0736,0.031;fov=45deg;s=alpoU' --png posts/images
- Notes:
- Length: X 243/280, Facebook 303/500

```text
Earth is NASA's Blue Marble for the month of the date you set, so the picture changes as the calendar does. Close to the ground, higher-resolution detail comes in. This is Africa from 20,000 km on 12 April 2025. #space

https://celestiary.org/#sun/earth@15,20.7446,20Mm;t=9233.1234jd;cq=-0.0108,0.9967,-0.0736,0.031;fov=45deg;s=alpoU
```

#### Facebook

```text
Earth in celestiary is NASA's Blue Marble for the month of the date you set, so the picture changes as the calendar does. Close to the ground, higher-resolution detail comes in. This view is Africa from 20,000 km on 12 April 2025. Change the date and the surface follows. #space

https://celestiary.org/#sun/earth@15,20.7446,20Mm;t=9233.1234jd;cq=-0.0108,0.9967,-0.0736,0.031;fov=45deg;s=alpoU
```

### The camera follows a body along its orbit

- ID: follow-a-body
- Status: draft
- X:
- Facebook:
- Date: 2026-11-17
- Entry: 2026-10-09-f-makes-the-camera-follow-a-body-along-its-orbit
- Image: posts/images/follow-a-body.png
- Alt: Jupiter, with the clock running at 16,384 times real speed.
- Render: node tools/home/cards.mjs --gpu --id follow-a-body --hash 'sun/jupiter@10.9426,97.5052,388.346569Mm;t=9496.5jd;cq=0.1228,0.4092,0.0818,0.9004;fov=45deg;s=TF;time:rate=16384' --png posts/images
- Notes: A still shows little of this: a screen recording of the view, with f on, shows it.
- Length: X 270/280, Facebook 330/500

```text
Press f and the camera rides a body's orbit as time runs, so the planet stays put on screen while you look around. It turns on when you go to a body, and the link keeps it. Here is Jupiter, followed, with time running at 16,384 times real speed.

https://celestiary.org/#sun/jupiter@10.9426,97.5052,388.346569Mm;t=9496.5jd;cq=0.1228,0.4092,0.0818,0.9004;fov=45deg;s=TF;time:rate=16384
```

#### Facebook

```text
Press f in celestiary and the camera rides a body's orbit as time runs, so the planet stays put on screen while you look around. It turns on when you go to a body, and the link keeps it, so a shared view reloads still following. This one is Jupiter, followed, with time running at 16,384 times real speed.

https://celestiary.org/#sun/jupiter@10.9426,97.5052,388.346569Mm;t=9496.5jd;cq=0.1228,0.4092,0.0818,0.9004;fov=45deg;s=TF;time:rate=16384
```

## From the changelog

Plain posts for entries added since the campaign: the headline, as much of the text as fits, and the link.  Rewrite them freely.

### Satellites round Earth: the ISS, GPS, the geostationary ring

- ID: 2026-10-23-satellites-round-earth-the-iss-gps-the
- Status: draft
- X:
- Facebook:
- Date: 2026-11-19
- Entry: 2026-10-23-satellites-round-earth-the-iss-gps-the
- Image: posts/images/2026-10-23-satellites-round-earth-the-iss-gps-the.png
- Alt:
- Render: node tools/home/cards.mjs --gpu --id 2026-10-23-satellites-round-earth-the-iss-gps-the --hash 'sat:25544@-23.1092,93.6224,184.75929Mm;t=9791.8729jd;cq=0,-0.0829,0,0.9966;fov=45deg;s=F' --png posts/images
- Notes:
- Length: X 86/280, Facebook 355/500

```text
Satellites round Earth: the ISS, GPS, the geostationary ring.

https://celestiary.org/#sat:25544@-23.1092,93.6224,184.75929Mm;t=9791.8729jd;cq=0,-0.0829,0,0.9966;fov=45deg;s=F
```

#### Facebook

```text
Satellites round Earth: the ISS, GPS, the geostationary ring.

Near Earth, with the orbits on, about 450 real satellites now circle it where they are on the date: the space stations, Hubble, every navigation satellite, weather satellites, the Molniya satellites on their long northern loops and a sample of the geostationary ring.

https://celestiary.org/#sat:25544@-23.1092,93.6224,184.75929Mm;t=9791.8729jd;cq=0,-0.0829,0,0.9966;fov=45deg;s=F
```

### The Moon's frozen orbits: the few low orbits that last

- ID: 2026-10-23-the-moon-s-frozen-orbits-the-few-low-orbits
- Status: draft
- X:
- Facebook:
- Date: 2026-11-21
- Entry: 2026-10-23-the-moon-s-frozen-orbits-the-few-low-orbits
- Image: posts/images/2026-10-23-the-moon-s-frozen-orbits-the-few-low-orbits.png
- Alt:
- Render: node tools/home/cards.mjs --gpu --id 2026-10-23-the-moon-s-frozen-orbits-the-few-low-orbits --hash 'sun/earth/moon@16.3925,115.3122,4.2619Mm;t=9791jd;cq=-0.1519,0.1194,0.0086,0.9811;fov=45deg;s=F;time:pause' --png posts/images
- Notes:
- Length: X 193/280, Facebook 481/500

```text
The Moon's frozen orbits: the few low orbits that last.

With the Moon selected, the orbits spacecraft use near it are drawn around it. Low lunar orbit is a thin shell.

https://celestiary.org/#sun/earth/moon@16.3925,115.3122,4.2619Mm;t=9791jd;cq=-0.1519,0.1194,0.0086,0.9811;fov=45deg;s=F;time:pause
```

#### Facebook

```text
The Moon's frozen orbits: the few low orbits that last.

With the Moon selected, the orbits spacecraft use near it are drawn around it. Low lunar orbit is a thin shell. The four "frozen" inclinations, 27°, 50°, 76° and 86°, are where the pulls of the Moon's lumpy mass concentrations average out, so an orbit lasts for years. Also drawn are the Lunar Reconnaissance Orbiter's two orbits and a 30-hour elliptical frozen orbit that hangs over the south pole.

https://celestiary.org/#sun/earth/moon@16.3925,115.3122,4.2619Mm;t=9791jd;cq=-0.1519,0.1194,0.0086,0.9811;fov=45deg;s=F;time:pause
```

### Fly a spacecraft to the Moon

- ID: 2026-10-23-fly-a-spacecraft-to-the-moon
- Status: draft
- X:
- Facebook:
- Date: 2026-11-24
- Entry: 2026-10-23-fly-a-spacecraft-to-the-moon
- Image: posts/images/2026-10-23-fly-a-spacecraft-to-the-moon.png
- Alt:
- Render: node tools/home/cards.mjs --gpu --id 2026-10-23-fly-a-spacecraft-to-the-moon --hash 'sun/earth/moon@61.929,-24.8021,497.959344Mm;t=9794jd;cq=-0.6681,-0.2315,-0.2315,0.6681;fov=45deg;s=alF;time:pause;craft:tli=9791.5' --png posts/images
- Notes:
- Length: X 54/280, Facebook 440/500

```text
Fly a spacecraft to the Moon.

https://celestiary.org/#sun/earth/moon@61.929,-24.8021,497.959344Mm;t=9794jd;cq=-0.6681,-0.2315,-0.2315,0.6681;fov=45deg;s=alF;time:pause;craft:tli=9791.5
```

#### Facebook

```text
Fly a spacecraft to the Moon.

The Earth's and the Moon's panels now have a Craft section: switch on transfer to the Moon and a spacecraft leaves a low orbit round the Earth that day, burns once, and coasts four and a half days to pass 100 km over the Moon. Its path is drawn with the craft where it is at the clock's time, and the panel gives its burn, how long it takes and what it would cost to stop at the Moon.

https://celestiary.org/#sun/earth/moon@61.929,-24.8021,497.959344Mm;t=9794jd;cq=-0.6681,-0.2315,-0.2315,0.6681;fov=45deg;s=alF;time:pause;craft:tli=9791.5
```

### All of Starlink joins the satellites, with a search, and you choose which to see

- ID: 2026-10-23-all-of-starlink-joins-the-satellites-with-a
- Status: draft
- X:
- Facebook:
- Date: 2026-11-26
- Entry: 2026-10-23-all-of-starlink-joins-the-satellites-with-a
- Image: posts/images/2026-10-23-all-of-starlink-joins-the-satellites-with-a.png
- Alt:
- Render: node tools/home/cards.mjs --gpu --id 2026-10-23-all-of-starlink-joins-the-satellites-with-a --hash 'sun/earth@2.3217,30.6675,15.963766Mm;t=9792.863603jd;cq=-0.0436,-0.6266,-0.0542,0.7762;fov=45deg;s=F;info:open=population;pop:earth=starlink,earth.labels=300,earth.starlink=11116' --png posts/images
- Notes:
- Length: X 277/280, Facebook 496/500

```text
All of Starlink joins the satellites, with a search, and you choose which to see.

All 11,116 Starlink satellites can now show round Earth, with a slider for how many, the first by serial number, from one to all; and Iridium's 80 in their polar planes.

https://celestiary.org/#sun/earth@2.3217,30.6675,15.963766Mm;t=9792.863603jd;cq=-0.0436,-0.6266,-0.0542,0.7762;fov=45deg;s=F;info:open=population;pop:earth=starlink,earth.labels=300,earth.starlink=11116
```

#### Facebook

```text
All of Starlink joins the satellites, with a search, and you choose which to see.

All 11,116 Starlink satellites can now show round Earth, with a slider for how many, the first by serial number, from one to all; and Iridium's 80 in their polar planes. In Earth's panel, the Satellites section has a search that finds Earth's satellites alone, a switch for each kind (Starlink, Iridium, navigation, weather, the space stations...) and a slider for how many names to show.

https://celestiary.org/#sun/earth@2.3217,30.6675,15.963766Mm;t=9792.863603jd;cq=-0.0436,-0.6266,-0.0542,0.7762;fov=45deg;s=F;info:open=population;pop:earth=starlink,earth.labels=300,earth.starlink=11116
```

### New York in 3D: Manhattan's streets and towers on Earth

- ID: 2026-10-23-new-york-in-3d-manhattan-s-streets-and-towers
- Status: draft
- X:
- Facebook:
- Date: 2026-11-28
- Entry: 2026-10-23-new-york-in-3d-manhattan-s-streets-and-towers
- Image: posts/images/2026-10-23-new-york-in-3d-manhattan-s-streets-and-towers.png
- Alt:
- Render: node tools/home/cards.mjs --gpu --id 2026-10-23-new-york-in-3d-manhattan-s-streets-and-towers --hash 'sun/earth@40.5025,-74.0298,780m;t=9792.377067jd;cq=0.2348,-0.1201,-0.2007,0.9435;fov=45deg;time:pause;layers:nyc' --png posts/images
- Notes:
- Length: X 246/280, Facebook 458/500

```text
New York in 3D: Manhattan's streets and towers on Earth.

Come down over New York, within a few tens of kilometres of Manhattan and under 30 km up, open the layers button at the top right and switch on New York (3D city).

https://celestiary.org/#sun/earth@40.5025,-74.0298,780m;t=9792.377067jd;cq=0.2348,-0.1201,-0.2007,0.9435;fov=45deg;time:pause;layers:nyc
```

#### Facebook

```text
New York in 3D: Manhattan's streets and towers on Earth.

Come down over New York, within a few tens of kilometres of Manhattan and under 30 km up, open the layers button at the top right and switch on New York (3D city). Slop New York, a 3D model of Manhattan's buildings, streets, parks and piers, builds in a few seconds and stands at its place on the globe, lit by the same Sun at the simulation's time and hazed by the same air.

https://celestiary.org/#sun/earth@40.5025,-74.0298,780m;t=9792.377067jd;cq=0.2348,-0.1201,-0.2007,0.9435;fov=45deg;time:pause;layers:nyc
```

### Starlink, Iridium's crosslinks and the Deep Space Network's live links

- ID: 2026-10-23-starlink-iridium-s-crosslinks-and-the-deep
- Status: draft
- X:
- Facebook:
- Date: 2026-12-01
- Entry: 2026-10-23-starlink-iridium-s-crosslinks-and-the-deep
- Image: posts/images/2026-10-23-starlink-iridium-s-crosslinks-and-the-deep.png
- Alt:
- Render: node tools/home/cards.mjs --gpu --id 2026-10-23-starlink-iridium-s-crosslinks-and-the-deep --hash 'sun/earth@17.7323,14.5345,19.62899Mm;t=9792.2086jd;cq=-0.2991,0.3157,0.1056,0.8943;fov=45deg;s=SIF' --png posts/images
- Notes:
- Length: X 96/280, Facebook 96/500 SHORT

```text
Starlink, Iridium's crosslinks and the Deep Space Network's live links.

https://celestiary.org/#sun/earth@17.7323,14.5345,19.62899Mm;t=9792.2086jd;cq=-0.2991,0.3157,0.1056,0.8943;fov=45deg;s=SIF
```

#### Facebook

```text
Starlink, Iridium's crosslinks and the Deep Space Network's live links.

https://celestiary.org/#sun/earth@17.7323,14.5345,19.62899Mm;t=9792.2086jd;cq=-0.2991,0.3157,0.1056,0.8943;fov=45deg;s=SIF
```

### Red light, for looking at the night sky

- ID: 2026-10-24-red-light-for-looking-at-the-night-sky
- Status: draft
- X:
- Facebook:
- Date: 2026-12-03
- Entry: 2026-10-24-red-light-for-looking-at-the-night-sky
- Image: posts/images/2026-10-24-red-light-for-looking-at-the-night-sky.png
- Alt:
- Render: node tools/home/cards.mjs --gpu --id 2026-10-24-red-light-for-looking-at-the-night-sky --hash 'sun/earth@36.0544,-112.1401,2.2km;t=9792.770833jd;cq=0.145,-0.9312,0.2525,0.2194;fov=45deg;s=LFR;time:pause' --png posts/images
- Notes:
- Length: X 260/280, Facebook 494/500

```text
Red light, for looking at the night sky.

For using celestiary outdoors at night, the whole screen can now turn red, the sky and the planets as well as the buttons and panels, as through a red torch, so your eyes stay used to the dark.

https://celestiary.org/#sun/earth@36.0544,-112.1401,2.2km;t=9792.770833jd;cq=0.145,-0.9312,0.2525,0.2194;fov=45deg;s=LFR;time:pause
```

#### Facebook

```text
Red light, for looking at the night sky.

For using celestiary outdoors at night, the whole screen can now turn red, the sky and the planets as well as the buttons and panels, as through a red torch, so your eyes stay used to the dark. Press r, or Red light under More on a phone; it stays on until you turn it off, and starting the AR sky view after dark offers it. On a phone, a long path at the top now shows only its last two steps, and a tap on "…" shows the rest.

https://celestiary.org/#sun/earth@36.0544,-112.1401,2.2km;t=9792.770833jd;cq=0.145,-0.9312,0.2525,0.2194;fov=45deg;s=LFR;time:pause
```
