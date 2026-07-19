**PASS**

Task 5 Canvas/JUCE `AlphaRaster` rendering satisfies the sprs-9 rendering scenarios, the design's cross-backend compositing contract, and the plan's Task 5 requirements. Evidence:

**Identical 2×2 semantics / tint-alpha multiplication (matched formulas)**
- Shared fixture in both suites: background `(20,40,60,255)`, tint `(220,100,40,128)`, mask `{0,64,128,255}`, 2×2 — `ui-backend.spec.ts:5-7` vs `PortableJuceBackendTests.cpp:21-22` + `mask{0,64,128,255}`.
- Nearest rounded multiply `(mask*tintAlpha+127)/255` identical: browser `ui.ts:357` (`Math.floor(...)`), JUCE `PortableJuceBackend.hpp:207-208` (integer div). Reference formulas agree: `densityAlpha` (`spec.ts:9-10`) ≡ `DensityAlpha` (`Tests.cpp:23-26`).

**Straight-alpha / offscreen-only ImageData; destination source-over drawImage, no destination putImageData**
- Straight RGBA written to offscreen `ImageData` (`ui.ts:353-357`), `putImageData` only on the offscreen context (`ui.ts:359`). Destination path sets `globalCompositeOperation="source-over"`, `imageSmoothingEnabled=false`, `drawImage(rasterCanvas, bounds…)` (`ui.ts:364-366`). Test asserts `destinationPuts=0`, `offscreenPuts=2`, `drawStates=[[1,"source-over",false]×2]` (`spec.ts` offscreen test).

**Nearest-neighbor scaling / bounds / overlap**
- Browser smoothing disabled (`ui.ts:365`); JUCE `lowResamplingQuality` (`PortableJuceBackend.hpp:221`). Overlap verified as composite-of-composite: `compositeDensity(255, compositeDensity(255))` (`spec.ts`) and `CompositeDensity(255, CompositeDensity(255))` (`Tests.cpp:8,8` probe).

**State restoration / offscreen reuse / validated direct-frame access**
- Canvas `save`/`restore` in `try/finally` (`ui.ts:361,368`); test confirms fillStyle/strokeStyle/lineWidth/globalAlpha/operation/smoothing all restored and `sameSource` (single reused canvas). `validateAlphaRasterCommand(command)` runs first (`ui.ts:336`); malformed direct frame rejected with `"alpha raster byte count does not match dimensions"`.
- JUCE `ScopedSaveState` + `setOpacity(1.0f)` (`PortableJuceBackend.hpp:219-221`); `ValidatedRaster()` revalidates before indexing (`:188`). JUCE test confirms opacity(0.5) and highResamplingQuality survive across the paint.

**JUCE premultiplication / equivalence within one**
- Written via `BitmapData::setPixelColour` on an `Image::ARGB` (`:209`), which premultiplies through `Colour::getPixelARGB`, preserving the invariant. `RequireColourNear` tolerance = 1 integer channel (`Tests.cpp:44-52`) matches "within integer rounding."

**Nonpositive target no-op; no per-cell draws / host caching**
- Browser `if (bounds.width<=0 || bounds.height<=0) return` after validation (`ui.ts:337`); JUCE `if (target.getWidth()<=0 || getHeight()<=0) break` (`PortableJuceBackend.hpp:190`). JUCE no-op test asserts unchanged pixel.
- Single image + single `drawImage`/`drawImage` per command — no per-cell rectangles; offscreen surface owned by the backend, not `DrawCommand`/AutoScope (payload stores only width/height/alpha, `PortableUI.hpp:105-119`).

Concurrent `DspAutoScope.hpp`/`autoscope_tests.cpp` and untracked `miniapp/` were excluded from review as instructed.