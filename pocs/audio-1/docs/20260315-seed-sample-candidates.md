# Seed Sample Candidates for Commuted Synthesis / Excitation Models

Candidate samples from freesound.org, selected for use as excitation signals and body impulse responses in the generative audio engine described in `20260315-generative-sound-landscape.md`. Selection criteria: short duration (ideally under 2s), clean recordings, isolated events, Creative Commons licensed.

---

## 1. Impacts and Collisions

For modal synthesis excitation via Hertzian contact force models. Need clean single strikes with clear attack transients and natural decay.

| # | Sample | URL | Duration | Fit |
|---|--------|-----|----------|-----|
| 1a | **Large Anvil & Steel Hammer 2** by Benboncan | https://freesound.org/people/Benboncan/sounds/103630/ | ~1s (single strike) | Stereo recording of a single steel hammer strike on hot steel on a large anvil. Clean transient, rich harmonic decay. Ideal hard-on-hard metal excitation. |
| 1b | **Metal hit_1 (sword, hammer, blacksmith)** by o_ciz | https://freesound.org/people/o_ciz/sounds/475416/ | Short | Clean single metallic impact with bright attack. Good for hard contact excitation signal extraction. |
| 1c | **Basic Metal Impact** by Speedenza | https://freesound.org/people/Speedenza/sounds/222580/ | Short | Slightly bright metallic impact -- useful as a cage/gate bar strike excitation. Simple, clean. |
| 1d | **Hammer hitting metal** by 150237_Matthys | https://freesound.org/s/323795/ | Short | Metal hammer on iron rod -- different contact hardness than anvil strikes. Good for parametric variation of contact_hardness. |
| 1e | **Hammering Nails, Close, A** by InspectorJ | https://freesound.org/people/InspectorJ/sounds/406048/ | Multi-strike | Metal-into-wood contact. Useful for hard-excitation-into-soft-body commuted pairs. Different spectral character from metal-on-metal. |

---

## 2. Gears and Ratchets

For stochastic impulse sequences at gear-mesh frequency with timing jitter. Need isolated click/tooth events that can be sequenced programmatically.

| # | Sample | URL | Duration | Fit |
|---|--------|-----|----------|-----|
| 2a | **toy ratchet.wav** by monotraum | https://freesound.org/people/monotraum/sounds/376195/ | Short | Small toy ratchet -- isolated mechanical tooth-click events. Simple waveform, easy to extract single clicks for sequencing. |
| 2b | **Tools Ratchet.wav** by CapsLok | https://freesound.org/people/CapsLok/sounds/181634/ | Short | Ratchet wrench with close mic and some room ambience. Real gear-tooth engagement clicks. |
| 2c | **Relay click** by smokeyvw | https://freesound.org/people/smokeyvw/sounds/85304/ | Very short | Electric relay click -- extremely short, clean transient. Perfect as a single "tooth engagement" excitation event. |
| 2d | **Relay** by MrAuralization | https://freesound.org/people/MrAuralization/sounds/203600/ | Short | Electrically operated switch recorded with Zoom H1. Clean mechanical click, good for gear-tooth synthesis seed. |
| 2e | **Mechanical clicks, mechanism, press, gear** by julianmateo_ | https://freesound.org/people/julianmateo_/sounds/636821/ | Longer (extractable) | Mechanical transformation clicks and gear sounds. Contains multiple isolated click events suitable for extraction. |

---

## 3. Friction and Scraping

For surface texture profile wavetables read at velocity-proportional rate, fed into modal resonators (Van den Doel FoleyAutomatic approach).

| # | Sample | URL | Duration | Fit |
|---|--------|-----|----------|-----|
| 3a | **Metal Scraping** by Doctor_Jekyll | https://freesound.org/people/Doctor_Jekyll/sounds/254064/ | ~3.2s | Metal tin box sliding on metal railing. Clean friction event with clear contact dynamics. Short enough for texture extraction. |
| 3b | **metal grind.wav** by Daphne_in_Wonderland | https://freesound.org/people/Daphne_in_Wonderland/sounds/127151/ | ~0.75s | Very short metal grind. Tagged "short" by author. Ideal duration for a surface texture wavetable seed. |
| 3c | **Metal Grinding-Sharpening** by sentryx86 | https://freesound.org/people/sentryx86/sounds/52198/ | Short | Blade-on-stone grinding. Different surface pair (metal/stone vs metal/metal) gives distinct texture profile. |
| 3d | **Metal scraping noise** by Marissrar | https://freesound.org/people/Marissrar/sounds/366911/ | Short | Metal brush against steel surface. High-density micro-contact events -- good for rough/gritty texture extraction. |
| 3e | **Angle Grinder Cutting** by Benboncan | https://freesound.org/people/Benboncan/sounds/82932/ | Longer (loopable segment) | Mono field recording of angle grinder on steel weldmesh. Continuous friction source with rich spectral content. Extract short loops for powered-tool texture profiles. |

---

## 4. Fluid / Liquid Sounds

For Minnaert bubble oscillator calibration and Poisson-distributed stochastic event modeling. Need isolated drips, single bubbles, and short pours.

| # | Sample | URL | Duration | Fit |
|---|--------|-----|----------|-----|
| 4a | **Slow Single Water Drop Splash** by qubodup | https://freesound.org/people/qubodup/sounds/792932/ | ~0.33s | Mono, extremely short single water drop. Perfect isolated Minnaert-scale event for bubble oscillator calibration. |
| 4b | **Water Drop** by Aiwha | https://freesound.org/people/Aiwha/sounds/415484/ | ~0.88s | Mono single water drop with natural decay/ripple. Good for analyzing the full drip-splash-settle envelope. |
| 4c | **Bubble Pop - High Pitched Short** by elmasmalo1 | https://freesound.org/people/elmasmalo1/sounds/377018/ | Very short | Short bubble pop. Single event, easy to use as Minnaert oscillator target for parameter fitting. |
| 4d | **Single Water Bubbles** by Kinoton | https://freesound.org/s/395556/ | Short (multiple events) | Deep water bubbles from a decanter with variations. Multiple isolated bubble events at different radii -- useful for calibrating the R parameter in Minnaert's equation. |
| 4e | **Bubbles In Water** by calebrankin | https://freesound.org/people/calebrankin/sounds/529383/ | Short | Underwater bubble stream. Good reference for Poisson-distributed event density modeling. |

---

## 5. Springs

For dispersive waveguide models with allpass filters (Parker/Valimaki parametric spring reverb). Need real spring impulse responses and physical spring hits.

| # | Sample | URL | Duration | Fit |
|---|--------|-----|----------|-----|
| 5a | **Roland RE-301 Spring Reverb Impulse** by 0e0 | https://freesound.org/people/0e0/sounds/131034/ | Short IR | Impulse response of the spring reverb in a 1977 Roland RE-301 Chorus Echo. Captures real dispersive spring characteristics for waveguide parameter fitting. |
| 5b | **Fostex 3180 Spring Reverb IR** by KenMix | https://freesound.org/people/KenMix/packs/35785/ | Short IR | 1980s studio spring reverb IR. Different spring geometry from the Roland -- useful for parametric variation. Includes a recording of hitting the springs directly. |
| 5c | **0001 Spring Hit.aif** by andreas | https://freesound.org/people/andreas/sounds/194507/ | Short | Direct physical spring hit. Raw spring excitation without electronics -- the dispersive chirp is exposed cleanly. |
| 5d | **Door Stop Twang** by KeyKrusher | https://freesound.org/people/KeyKrusher/sounds/148452/ | ~1s | Springy door stop plucked and released. Real coil vibration with characteristic frequency-dependent dispersion. Mechanical spring, not electronic. |
| 5e | **Peavey Blazer 158 Spring Reverb and Cabinet stereo IR** by unfa | https://freesound.org/people/unfa/sounds/205622/ | Short IR | Spring reverb + cabinet IR in FLAC. Third distinct spring geometry for fitting allpass dispersion parameters. |

---

## 6. Body Impulse Responses

For commuted synthesis: pre-convolve body IR with excitation to collapse the expensive resonator into a single triggered wavetable. Need very short IRs (<1s) of distinct material bodies.

| # | Sample | URL | Duration | Fit |
|---|--------|-----|----------|-----|
| 6a | **Metal hit with metal bar resonance** by jorickhoofd | https://freesound.org/people/jorickhoofd/sounds/160045/ | Short | Metal bar struck and left to resonate. The resonant tail IS the body IR. Deconvolve the excitation to extract the metallic body response. |
| 6b | **Metal Tube - Clear** by Speedenza | https://freesound.org/people/Speedenza/sounds/222581/ | Short | Impacts on a large metal tube/pipe. Tubular metallic body resonance -- distinct modal pattern from flat plates or solid bars. |
| 6c | **glass resonance.wav** by Widowaker | https://freesound.org/people/Widowaker/sounds/459110/ | Short | Wine glass resonance. Glass body IR with characteristic high-Q, widely-spaced modes. Essential material class for commuted synthesis. |
| 6d | **Wine Glass Ring** by cloe.king | https://freesound.org/people/cloe.king/sounds/444166/ | Short | Wine glass ring with clean decay. Alternative glass body for parametric interpolation between glass specimens. |
| 6e | **TUBULAR BELL STRIKE 003** by sandyrb | https://freesound.org/people/sandyrb/sounds/85797/ | ~2s | Orchestral tubular bell single strike. Large metallic resonator body -- high modal density, long decay. Represents the "large metal casing" body class. |

---

## 7. Excitation Transients

Short (50-500ms) signals for direct use as commuted synthesis excitation -- pre-convolved with body IRs at runtime. Need variety across the attack-type spectrum: impulsive, noisy, scrapy, hissy.

| # | Sample | URL | Duration | Fit |
|---|--------|-----|----------|-----|
| 7a | **hammer-anvil-hit-1** by SoundEffectsPodcast_com | https://freesound.org/people/SoundEffectsPodcast_com/sounds/260626/ | Short | Clean hammer strike from a sound design podcast. Professional recording, isolated transient. Impulsive excitation class. |
| 7b | **Steam Hiss** by jesabat | https://freesound.org/people/jesabat/sounds/119741/ | Short | Steam hiss -- broadband noise excitation with natural spectral envelope. Noisy excitation class for friction/air-driven mechanisms. |
| 7c | **Air Hiss** by Jofae | https://freesound.org/people/Jofae/sounds/367125/ | Short | Pressurized air leak hiss. Narrower bandwidth than steam. Useful for pneumatic mechanism excitation. |
| 7d | **Air (or steam) pressure release** by brunoboselli | https://freesound.org/people/brunoboselli/sounds/457294/ | Short | Pressure release burst with sharp onset and exponential decay. Burst-noise excitation class -- good for valve/vent mechanisms. |
| 7e | **Switches pack** by joedeshon | https://freesound.org/people/joedeshon/packs/7491/ | Very short per event | Collection of real electrical switch clicks, pops, and snaps. Ultra-short impulsive excitations (~5-50ms). Click excitation class. |

---

## Usage Notes

**For commuted synthesis**, the workflow is:
1. Extract/deconvolve body IRs from category 6 samples
2. Select excitation transients from category 7 (and categories 1-3 for specialized excitations)
3. Pre-convolve excitation x body at load time
4. Feed the result into a delay-line waveguide model at runtime (5-10 multiplies/sample)

**For modal synthesis calibration**, use categories 1-3 to:
- Analyze modal frequencies and decay rates via FFT
- Fit biquad resonator parameters to match real recordings
- Validate that synthesized outputs match seed samples perceptually

**For stochastic event models** (gears, fluids), use categories 2 and 4 to:
- Extract single-event waveforms for Poisson-scheduled playback
- Calibrate timing distributions against real recordings
- Fit Minnaert bubble radius parameters to real bubble spectra

**Licensing**: All freesound.org samples are Creative Commons licensed. Check individual sample pages for specific license variants (CC0, CC-BY, CC-BY-NC). Prefer CC0 or CC-BY for maximum flexibility.
