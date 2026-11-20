# Suntan: What Parker Solar Probe Actually Tells Us — Working Study

*Purpose: a sourced, working reference on Parker Solar Probe (PSP) and the solar atmosphere, to be folded into the Suntan concept doc (which still quotes 2015 "Solar Probe+" plans).*
*Date: 2026-11-20. Status: working draft. Anything marked `(unverified)` was not confirmed against a source in this research pass.*

**Research caveat.** Most primary-source sites (JHUAPL, NASA's www.nasa.gov, Wikipedia, publisher sites) were not fetchable from the research environment; only `science.nasa.gov` pages could be read in full. Other facts come from search-result summaries. Treat the tables as a starting point and check key numbers against the NASA/JHUAPL mission pages and Fox et al. (Space Sci. Rev.) before use.

---

## 1. PSP mission as flown

**Launch.** 12 Aug 2018, 07:31 UTC, Cape Canaveral SLC-37, Delta IV Heavy with upper stage; about 685 kg at launch ([NASA mission page](https://science.nasa.gov/mission/parker-solar-probe/); [SpaceNews](https://spacenews.com/on-parker-solar-probe-nasa-leaves-the-driving-to-aerojet-rocketdyne)). Launch C3: one low-authority student site gives 154 km²/s² ([search result, spaceref/student page](https://spaceref.com/?p=17936)) `(unverified)`. Heat shield is about 2.4 m (8 ft) across; total spacecraft dimensions `(unverified)`.

**Design.** Seven Venus gravity assists over about seven years, 24 solar orbits, each flyby shortening the orbit and lowering perihelion ([NASA mission page](https://science.nasa.gov/mission/parker-solar-probe/); [NASA, Sept 2024](https://science.nasa.gov/blogs/parker-solar-probe/2024/09/06/parker-solar-probe-lines-up-for-final-venus-flyby/)). Venus-7 passed closer to Venus than the previous six and was "the critical gravity assist" for minimum solar distance (same NASA post).

**Venus flybys and the perihelion each produced.** Distances: R☉ = 695,700 km, 1 AU = 149.6 million km; AU and "Mkm above surface" computed here from the Rs value. Altitude = (Rs − 1) × R☉.

| Venus flyby | Date | Resulting perihelion (Rs) | AU | Mkm above surface | Period (d) | Perihelion speed (km/s) | First perihelion at this distance |
|---|---|---|---|---|---|---|---|
| V1 | 3 Oct 2018 ([NASA blog](https://blogs.nasa.gov/parkersolarprobe/2019/12)) | 35.66 ([search summary](https://huggingface.co/datasets/juliensimon/parker-solar-probe-encounters)) | 0.166 | 24.1 | ~150 `(unverified)` | ~95 `(unverified)` | P1, Nov 2018 `(unverified)` |
| V2 | 26 Dec 2019 (NASA blog above) | 27.86 ([Springer review search](https://link.springer.com/article/10.1007/s11214-023-00952-4)) | 0.130 | 18.7 | 130 ([draft table](https://www.wikipedia.com/wiki/User:AzseicsoK/Parker_Table), low confidence) | 109 (same draft table) | P4, Jan 2020 `(unverified)` |
| V3 | 11 Jul 2020 | 20.3 (P6, 27 Sep 2020, 0.09 AU; [Guo et al.](https://www.sciencedirect.com/science/article/pii/S0094576523005271)) | 0.094 | 13.4 | 112.5 (draft table) | 129 (draft table) | P6, 27 Sep 2020 |
| V4 | 20 Feb 2021 | ~16 (planned 20→16 for E8, 29 Apr 2021; [search summary](https://blogs.nasa.gov/parkersolarprobe/category/parker-solar-probe/page/4)) | 0.074 | 10.4 | 102 (draft table) | 147 (draft table) | P8, 29 Apr 2021 |
| V5 | 16 Oct 2021 | 13.27–13.3 (Guo et al.) | 0.062 | 8.5 | 96 (draft table) | 163 (draft table) | P10, 21 Nov 2021 |
| V6 | 21 Aug 2023 | 11.4 (Guo et al.) | 0.053 | 7.3 | 92 (draft table) | 176 ([Big Think](https://develop.bigthink.com/?p=522742)) | P17, Sep 2023 |
| V7 | 6 Nov 2024 ([NASA](https://science.nasa.gov/blogs/parker-solar-probe/2024/09/06/parker-solar-probe-lines-up-for-final-venus-flyby/)) | 9.86 | 0.046 | 6.2 | 88 | ~192 (Big Think; [NASA: 430,000 mph](https://science.nasa.gov/science-research/heliophysics/nasas-parker-solar-probe-makes-history-with-closest-pass-to-Sun)) | P22, 24 Dec 2024 |

Notes on the table: (1) The flyby dates for V3–V6 match a Springer review per search summaries, but a GitHub timeline gives different dates (6 Jul 2020, 11 Oct 2021, 16 Aug 2023), so sources disagree; the dates above are the ones the most sources support. (2) A search-result source attached each perihelion value to the *preceding* flyby; I resolved this by dated perihelion events (e.g. 13.3 Rs perihelia on 21 Nov 2021, after V5). (3) The "draft table" is a user-edited Wikipedia draft: its perihelion distances (19.4, 14.2, 11.1, 9.2, 7.9 Mkm) are from the Sun's centre, matching 27.9, 20.4, 16.0, 13.2, 11.4 Rs. (4) Speed and period for P1–P3 are from memory.

**Final orbit.** Perihelion 9.86 Rs (about 6.9 million km from the Sun's centre, ~6.1–6.2 Mkm above the surface), aphelion about 0.73 AU (~109 Mkm), inclination 3.4° to the ecliptic, period 88 days ([Wikipedia infobox, via search](https://en.wikipedia.org/wiki/Parker_Solar_Probe)). Near perihelion PSP outruns the Sun's rotation and sweeps a wide longitude range quickly: it "sampled almost 40% of the solar circumference within one day" at P29 ([NASA, Sep 2026](https://science.nasa.gov/blogs/parker-solar-probe/2026/09/10/after-latest-swing-past-sun-nasas-parker-solar-probe-checks-in/)).

**Records.** Closest approach 3.8 million miles (~6.1 Mkm) above the surface and about 430,000 mph (~692,000 km/h, ~192 km/s), first set 24 Dec 2024 ([NASA](https://science.nasa.gov/science-research/heliophysics/nasas-parker-solar-probe-makes-history-with-closest-pass-to-Sun)). First entry into the solar atmosphere: 28 Apr 2021 (Section 3). Perihelion time on 24 Dec 2024 is reported as 11:53 UTC (secondary press) `(unverified)`.

**Status as of 2026-11-20.**
- Perihelion 26: 13 Dec 2025; P27: 11 Mar 2026; P28: 8 Jun 2026; P29: 4 Sep 2026 ([HAO campaign pages](https://whpi.hao.ucar.edu/whpi_campaign-psp29p.php)).
- After P29 (encounter 30 Aug – 9 Sep), NASA says the speed and distance matched the Dec 2024 records, the beacon on 7 Sep said "operating normally" after nine days of planned autonomous operation, and the mission has been **extended into 2029** following the 2026 Heliophysics Senior Review, staying in its current orbit ([NASA, 10 Sep 2026](https://science.nasa.gov/blogs/parker-solar-probe/2026/09/10/after-latest-swing-past-sun-nasas-parker-solar-probe-checks-in/)). One secondary summary says the extension decision is still pending; the NASA page is the primary source.
- Next perihelion (P30) would fall about 88 days after 4 Sep, i.e. around 1–2 Dec 2026 (my arithmetic, `unverified` as a NASA date). No post-September health report found.
- Budget: an earlier NASA Spaceflight report says the request funds the mission at $15M/yr through 2030 ([NASASpaceflight](https://www.nasaspaceflight.com/2025/07/psp-close-approach-images/)).

---

## 2. Spacecraft engineering that bears on going closer

**Thermal Protection System (TPS).**
- Two carbon-carbon composite face sheets sandwiching a carbon foam core ~4.5 in (11.4 cm) thick, ~97% air; about 8 ft (2.4 m) across, ~72 kg ([APS Physics, via search](https://physics.aps.org/articles/pdf/10.1103/Physics.14.176); [JHU Hub](https://hub.jhu.edu/2018/08/06/parker-solar-probe-heat-shield-explained/)). Panels by Carbon-Carbon Advanced Technologies, foam by Ultramet.
- Sun-facing side carries a porous white alumina (aluminium oxide) coating; a hair-thin tungsten layer sits between carbon and coating to stop a reaction (JHU Hub).
- Sun-side temperature: ~2,500 °F (~1,377 °C) design rating ([NASA mission page](https://science.nasa.gov/mission/parker-solar-probe/)); NASA's 2024 article gives a design 2,600 °F and an expected ~1,800 °F (~980 °C) in the corona ([NASA](https://science.nasa.gov/science-research/heliophysics/nasas-parker-solar-probe-makes-history-with-closest-pass-to-Sun)). The sources disagree; I could not verify which applies at 9.86 Rs. Back side of shield about 600 °F; instruments about 85 °F (~30 °C) ([JHU Hub](https://hub.jhu.edu/2018/08/06/parker-solar-probe-heat-shield-explained/), via search).
- Attached to the truss at six points to minimise conduction.
- **Incident flux at 9.86 Rs: about 475 × Earth's** (CNRS page says 477), about 650 kW/m² (65 W/cm²) ([search summary of CNRS/APS sources](https://www.parkersolarprobe.cnrs.fr/en/mission/)). My check: (215.03/9.86)² = 476 × 1,361 W/m² ≈ 648 kW/m².

**Solar arrays and cooling.** Arrays retract behind the shield shadow with only a small strip exposed. A closed-loop water cooling system with a heated tank (to avoid freezing at launch), pumps, aluminium-finned radiators, about a gallon of water, loses no water to evaporation ([Interesting Engineering via search](https://interestingengineering.com/everything-you-need-to-know-about-nasas-cooling-systems-that-will-keep-parker-solar-probe-from-melting-in-the-sun)). Array operating temperature ~160 °C `(unverified)`.

**Autonomy / attitude.** Solar limb sensors, the umbra constraint and the fault-management scheme: not found in this pass `(unverified)`. Known operationally: PSP runs autonomously with no contact for about nine days around perihelion ([NASA Sep 2026](https://science.nasa.gov/blogs/parker-solar-probe/2026/09/10/after-latest-swing-past-sun-nasas-parker-solar-probe-checks-in/)), and a beacon tone returns after the pass.

**Communications.** Ka-band science downlink ([arXiv 2506.13949](https://arxiv.org/pdf/2506.13949)); pre-launch JPL analysis finds solar-scintillation degradation >8 dB at X-band but only a couple of tenths of a dB at Ka ([JPL TDA 42-129](https://tda.jpl.nasa.gov/progress_report/42-129/129A.pdf)). HGA size (0.6 m), data rates and conjunction blackout durations `(unverified)`.

**Exposed instruments.** The Solar Probe Cup sits outside the shield's shadow with its own shield ([APS Physics](https://physics.aps.org/articles/pdf/10.1103/Physics.14.176)); its refractory-metal construction (tungsten/niobium/molybdenum grids) and the FIELDS antenna material (niobium alloy, C-103) `(unverified)`.

**Dust.** WISPR saw the dust cleared by the 5 Sep 2022 CME out to ~6 million miles, refilled almost immediately by interplanetary dust ([JHUAPL](https://jhuapl.edu/news/news-releases/230914b-parker-sees-sun-sweep-up-interplanetary-dust)). Impact rates and damage on PSP `(unverified)`.

---

## 3. What PSP measured in the corona

- **First Alfvén-surface crossing: 28 Apr 2021, 09:33 UT**, encounter 8, at about 18.8 Rs (~8.1 million miles; the PRL paper text says "13 million km above the photosphere"), with Alfvén Mach number ~0.79 and magnetic pressure dominating ion and electron pressure. The boundary was crossed several times, for about five hours total, and appeared wrinkled ([Kasper et al. 2021, PRL 127, 255101](https://link.aps.org/doi/10.1103/PhysRevLett.127.255101); [QMUL](https://www.qmul.ac.uk/spcs/news-and-events/news/2021/parker-solar-probe-enters-the-magnetic-atmosphere-of-the-sun.html)). One press account says PSP dipped just below 15 Rs during a pseudostreamer pass; sources differ.
- **Deep sub-Alfvénic dives:** Only encounters 22 (24 Dec 2024) and 23 (22 Mar 2025), both at 9.86 Rs, went "deep below" the surface; the surface expanded ~30% of its median height over six years as activity rose ([Badman et al., arXiv 2509.17149](https://arxiv.org/abs/2509.17149)).
- **Switchbacks:** their origin remains without consensus; amplitude and abundance fall in sub-Alfvénic intervals and track Alfvén Mach number ([arXiv 2404.05557](https://arxiv.org/pdf/2404.05557); [arXiv 2602.03724](https://arxiv.org/abs/2602.03724), preprint).
- **Near-subsonic wind:** low density and very low speed intervals tied to a boundary layer ([arXiv 2404.05557](https://arxiv.org/pdf/2404.05557)).
- **CME transit:** 5 Sep 2022 passage and the dust effect (Section 2). December 2024 images show not all CME magnetic material escapes the Sun ([ApJ Lett, Dec 2025, via search](https://cpaess.ucar.edu/print/pdf/node/26758)). First images from inside the corona released July 2025 ([NASASpaceflight](https://www.nasaspaceflight.com/2025/07/psp-close-approach-images/)).
- **Numbers at the 9.86 Rs perihelia:** proton and electron temperatures, densities, wind speeds and field strengths: not obtained in this pass `(unverified)`. The Kasper paper is the place to start for the 2021 values.
- **Dust-free zone:** PSP/WISPR evidence for dust depletion near the Sun: not sourced in this pass `(unverified)`.

---

## 4. Solar atmosphere: temperature vs. altitude, and agreement

Height is above τ(500 nm)=1. Most rows are textbook values; rows without a link are recalled, not fetched `(unverified)`.

| Layer | Height | Temperature | Density / pressure | How measured | Agreement |
|---|---|---|---|---|---|
| Convection zone base | −200,000 km (~0.7 R☉) | ~2×10⁶ K ([search summary](https://arxiv.org/pdf/astro-ph/9505118)) | ~0.2 g/cm³ `(unverified)` | Helioseismology | Well constrained for the boundary radius; T/ρ are model-dependent |
| Just below surface | −few hundred km | rises to ~10⁴ K at ~−2,000 km `(unverified)` | rises steeply | Models + helioseismology | Model-dependent; near-surface layers poorly inverted |
| Photosphere, τ=1 | 0 | T_eff 5,772 K (IAU nominal; `unverified`); local ~5,800–6,000 K | ρ ~2×10⁻⁷ g/cm³ (~2×10⁻⁴ kg/m³) at the top of the photosphere (search summary); P ~10⁴ Pa `(unverified)` | Limb darkening, spectroscopy, total irradiance | Well constrained for T_eff; the relation of T_eff to local gas temperature is contested by Robitaille (Section 5) |
| Temperature minimum | ~500 km | ~4,400 K in the C7 model; models in the literature range 3,700–4,700 K ([search summary](https://www2.mps.mpg.de/homes/curdt/semi.pdf)) | falling | UV continua, mm/submm | Model-dependent; wide spread |
| Chromosphere (VAL/FAL) | ~500–2,000 km | rises ~4,400 → ~20,000 K ([arXiv 0704.1509](https://arxiv.org/pdf/0704.1509)) | falling steeply | Semi-empirical fits to line/continuum spectra | Contested: static semi-empirical vs. dynamic/ bifurcated pictures |
| "COmosphere" | ~350–1,000 km above temp. min. | CO lines give ~3,700 K; as low as ~3,500 K coexisting with ~7,000 K plasma ([Ayres](https://www.aanda.org/articles/aa/pdf/2005/30/aa2550-04.pdf)) | — | 4.7 µm CO bands, limb | Contested: 3D simulations show cool episodes <3,700 K about half the time, which may reconcile the two ([arXiv astro-ph/0311273](https://arxiv.org/pdf/astro-ph/0311273)) |
| Transition region | ~2,000–2,500 km | ~10⁴ → 10⁶ K, thin layer | ~10⁻¹¹–10⁻¹⁴ g/cm³ `(unverified)` | EUV/UV spectroscopy (SOHO, IRIS) | Temperatures well measured; thickness and structuring model-dependent |
| Low corona | >2,500 km | ~1–2×10⁶ K ([search summary](https://arxiv.org/pdf/1001.1770)) | ~10⁻¹⁵ g/cm³ (same) | EUV/X-ray spectroscopy, eclipse | Temperature well constrained; **heating mechanism contested** (wave dissipation vs. reconnection/nanoflares) |
| Sunspot umbra | at photosphere | ~3,000–4,500 K (sources differ; [perseus.gr](https://www.perseus.gr/Astro-Solar-Sunspots.htm)) | — | Spectro-polarimetry | Fairly well constrained; the range depends on spot size/cycle |
| Corona at PSP | 8.9 Rs altitude (9.86 Rs) | proton/electron T `(unverified)` | — | In situ (SWEAP, FIELDS) | First direct measurements: no competing data yet |

Why the disagreements matter for Suntan: the spread in chromospheric and sub-photospheric structure is where a descent would meet real ambiguity. Coronal temperature is not the hazard (very low density means little heat transfer); radiation and, below the photosphere, density are.

---

## 5. Is there a surface to land on? (entertained, not dismissed)

Labelled by status: **[mainstream]** or **[contested]**.

**(a) The standard picture [mainstream].** The Sun is a self-gravitating plasma ball; no solid or liquid interface exists. The photosphere is the layer where optical depth to outside observers reaches ~1, i.e. where light escapes, not a material boundary. A lander would meet a gas of about 2×10⁻⁴ kg/m³ and ~10⁴ Pa at τ=1 `(unverified)`, about 1/6,000 of the density of Earth's sea-level air (my arithmetic). Density and pressure then rise steeply inward (exact profile `(unverified)`), reaching the ~0.2 g/cm³ of the convection-zone base after ~200,000 km. There is no depth at which a "floor" appears in this model.

**(b) Condensed-matter proposals [contested; not accepted in mainstream solar physics].**
- *Robitaille — liquid metallic hydrogen (LMH).* Proposes the Sun is a condensed-matter object, with LMH as the building block of a liquid Sun and photosphere, with a roughly constant density nearly independent of radius, a true surface, and the argument that the accepted photospheric temperature violates Kirchhoff's law of thermal emission ([arXiv astro-ph/0410075](https://arxiv.org/abs/astro-ph/0410075); [APS poster, "The Sun on Trial"](https://archive.aps.org/mar/2014/h1/227)). He concedes metallic hydrogen has never been made in the lab.
- *Mozina — rigid iron/ferrite surface.* Co-authored a preprint (with O. Manuel and S. Kamat) arguing that running-difference images (satellite imagery) show rigid, iron-rich structures beneath the photosphere, persistent for days, with a conductive calcium-ferrite layer ([arXiv astro-ph/0510001](https://arxiv.org/abs/astro-ph/0510001)). He disputes the label "solid iron surface" in forum threads. Not seen in peer-reviewed astronomy journals per critics. I did not fetch thesurfaceofthesun.com `(unverified)`.

**(c) Observations each side must explain.**
- Standard side: the pattern of a sharp limb at τ=1 and limb darkening; helioseismic sound-speed profile through the interior (no discontinuity at the surface) `(unverified)`; neutrino and fusion output; the heating problem and the CO cool gas are open issues inside the standard picture.
- Condensed side: why the Sun's total spectrum and the helioseismic profile fit a gas; how temperatures of ~5,800 K coexist with iron persisting as a solid (critics note photospheric temperature is far above iron's melting point); how a condensed Sun gets thermal radiation out; and what lab evidence LMH at these conditions has.

**(d) What a descending probe could discriminate.** (i) Density and pressure vs. altitude: standard model predicts a smooth, steep rise through τ=1; a condensed surface predicts a discontinuity or near-constant density. (ii) Radar/laser or acoustic echo: an interface would return a reflection; a graded plasma would not. (iii) In-situ composition and spectral line formation across τ=1. (iv) Deceleration vs. depth. Ground truth for any of these requires reaching the photosphere, well beyond PSP.

---

## 6. Implications for Suntan

- **Gap in distance:** PSP's 9.86 Rs is 8.86 Rs (~6.2 Mkm) above the surface. Suntan needs 1 Rs, 9.86 times closer.
- **Flux:** Radiative flux scales as 1/r². At 9.86 Rs, 476 × Earth's constant (~650 kW/m²). At the photosphere, σT⁴ with T_eff = 5,772 K gives about **63 MW/m²** (6.3×10⁷ W/m², my calculation), roughly 46,000 × Earth's constant and ~97 × PSP's peak. For comparison, a hull at 4,100 °C (4,373 K) radiating as a blackbody rejects about 2×10⁷ W/m² (my calculation, ε=1), roughly a third of the photospheric flux, and only if every surface faces cold space; a lander sitting in the flux would still need the active cooling or ablative budget the concept proposes.
- **What does not scale:** PSP's carbon foam shield and ~1,400 °C face temperature (reached with a reflective coating at ~650 kW/m²); the Ka-band link design; the 9-day autonomy gap; the array shadow approach.
- **What might scale:** the layered sandwich concept; the active water loop (a closed loop wastes no water, but rejects only radiator-limited power); autonomy and beacon-tone discipline.
- **Open questions:** photospheric and sub-photospheric structure (Section 4); plasma conditions between 2 and 9.86 Rs; whether a magnetic standoff helps; mass of the ablator for a descent; relay geometry for a sun-synchronous orbit.

### Trajectory numbers (from the celestiary simulation)

Full tables and plots: [trajectory.md](trajectory.md). Model: `js/scene/suntan/mission.js`.

- **The simulation reproduces PSP.** Its legs, reconstructed from the perihelion times and distances in Section 1, meet Venus within 40,000 km at all seven flybys and conserve Venus-relative speed (about 23 km/s) through each. The solved launch arc needs C3 = 152 km²/s², against the 154 quoted above.
- **That settles the flyby-date disagreement noted under the Section 1 table.** The dates used here (11 Jul 2020, 16 Oct 2021, 21 Aug 2023) close on Venus; rebuilt with the other set (five days earlier for V3, V5 and V6), the same model misses Venus by 3–9 million km and no longer conserves Venus-relative speed.
- **Sun-synchronous radius: 35.5 Rs (0.165 AU)** for the 24.47-day equatorial rotation. PSP's first perihelion was 35.66 Rs.
- **Relay orbit from PSP's final orbit: 29.5 km/s** (9.2 km/s at aphelion, 20.3 km/s to circularize). Circularizing at perihelion 1 instead: 22.2 km/s.
- **Lander from the relay orbit: 56.2 km/s to deorbit, 4.5 days to fall, 609 km/s on arrival.** From the final orbit's aphelion instead: 8.1 km/s, arriving at 616 km/s.
- **The lander spends about 8 hours inside PSP's closest approach** on the way down, in sunlight rising from 0.65 to 63 MW/m².
- **A minimum-energy descent arrives level, not falling.** It crosses the last 2,000 km (the chromosphere, in the standard picture of Section 4) in about two minutes while skimming some 76,000 km round the Sun; a straight drop crosses it in about three seconds. [trajectory.md](trajectory.md) section 3 has the descent by altitude.
- **Passive hull limit.** By sunlight alone, a grey sphere reaches the concept's 4,100 °C hull limit about 44,000 km above the photosphere, ten minutes before arrival, and would settle near 4,850 K at the photosphere: about 480 K over the limit, not the 1,400 °C the concept doc works from, because half its sky is still cold space. This counts radiation only, not heating from moving through the gas at 600 km/s.

---

## Appendix: follow-up on the gaps

The research above could only open `science.nasa.gov`; the network allowlist blocked JHUAPL,
Wikipedia and the journals, so it left several engineering items unfound. This is a second pass
at those. Each line is either **sourced** from a web search, or **from memory**. For the sourced
lines I read the search result's summary, not the page itself, so open the link before relying on
a number.

- **Thrusters (sourced):** twelve hydrazine monopropellant thrusters of 4.4 N each
  ([SPASE observatory page](https://spase-group.github.io/spase-info/SMWG/Observatory/ParkerSolarProbe.html);
  [L3Harris](https://www.l3harris.com/newsroom/editorial/2024/12/l3harris-thrusters-position-nasa-probe-closest-approaches-sun)).
- **Propellant and Δv (sources disagree):** the SPASE page gives 685 kg at launch including 130 kg
  of propellant; a blog table gives 555 kg dry and 53–85 kg of hydrazine. The 2008 Solar Probe+
  engineering study budgeted 190 m/s
  ([archived PDF](https://webarchive.library.unt.edu/web/20130214082445/http:/solarprobe.gsfc.nasa.gov/SolarProbe+ME.pdf)).
  Even 130 kg of hydrazine on a 685 kg craft is under 0.5 km/s (my arithmetic, specific impulse
  near 220 s), against the 22–30 km/s the relay orbit needs (Section 6).
- **Heat shield (sourced):** 2.3 m wide and 11.4 cm thick
  ([ScienceABC](https://www.scienceabc.com/nature/universe/how-did-the-parker-solar-probe-touch-the-sun-without-melting.html)),
  attached to the truss at six points
  ([Interesting Engineering](https://interestingengineering.com/everything-you-need-to-know-about-nasas-cooling-systems-that-will-keep-parker-solar-probe-from-melting-in-the-sun)).
- **Solar arrays and cooling (sourced):** two arrays totalling 1.55 m² (Interesting Engineering,
  above). Water runs through mini-channels in the arrays and out to four radiators
  ([NASA](https://science.nasa.gov/blogs/parker-solar-probe/2018/09/14/parker-solar-probes-solar-array-cooling-system-fully-activated)),
  which are titanium tubes with thin aluminium fins. The coolant is about five litres of
  pressurized deionized water
  ([Electronic Specifier](https://www.electronicspecifier.com/?p=64629)).
- **Shadow keeping (sourced, count disputed):** solar limb sensors report any "umbra violation"
  and the craft corrects its attitude without the ground
  ([NASA blog](https://blogs.nasa.gov/parkersolarprobe/page/7/?ilink=1)). The supplier lists seven
  limb sensor heads plus two digital sun sensor heads
  ([Redwire](https://redwirespace.com/newsroom/redwire-technology-helps-guide-humanitys-first-visit-to-a-star));
  Wikipedia and a 2013 fault-management review say four.
- **Solar Probe Cup (sourced):** a Faraday cup outside the shield's shadow. Tungsten grids, a
  molybdenum-alloy (TZM) housing, niobium parts and sapphire insulators
  ([Case et al., arXiv 1912.02581](https://arxiv.org/pdf/1912.02581);
  [NASA](https://www.nasa.gov/science-research/heliophysics/traveling-to-the-sun-why-wont-parker-solar-probe-melt/)).
  The sources differ on which parts are niobium.
- **FIELDS antennas (sourced):** four 2 m whips of niobium alloy C-103 (V1–V4) outside the shield,
  at about 2,500 °F (1,370 °C), and a fifth sensor on the magnetometer boom
  ([Wikipedia](https://en.wikipedia.org/wiki/FIELDS);
  [Berkeley SSL](https://www.ssl.berkeley.edu/sun-heliophysics/psp-fields/)).
- **Dust (sourced):** WISPR saw the F-corona dim toward the Sun in the first two perihelia,
  "suggestive of the long-sought dust free zone"
  ([Howard et al. 2019, Nature 576, 232](https://dx.doi.org/10.1038/s41586-019-1807-x)). Press
  coverage puts the thinning from about 7 million miles in, with less still by 4 million
  ([ScienceDaily](https://www.sciencedaily.com/releases/2019/12/191204152831.htm)); that is
  roughly 16 and 9 solar radii (my conversion).
- **High-gain antenna (from memory):** 0.6 m, Ka-band for science data, X-band for commanding.
- **Plasma near perihelion (from memory):** proton temperatures of several 10⁵ to about 10⁶ K,
  electron densities of 10³–10⁴ per cm³, magnetic field of order 1,000 nT, in a wind still
  accelerating at 100–300 km/s.
