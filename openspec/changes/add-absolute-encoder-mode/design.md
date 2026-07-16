## Context

`EncoderMidiInProcessor` currently interprets every mapped encoder-turn CC through one of two relative decoders and emits `MessageIn::ParamIncDec`. That message routes through `MessageInBus`, `ParameterManager`, `BankSlot`, and `Bank` to `Parameter::HandleIncDec`. The parameter edit is not a simple scalar assignment: it preserves scene and gesture structure by distributing a delta across scene-center and gesture-value storage. At intermediate scene blends or gesture weights, the effective value intentionally moves by less than the supplied latent delta.

An absolute 7-bit encoder instead asserts that its hardware position represents exactly `value / 127`. Reusing `HandleIncDec(target - current)` would therefore leave hardware and software at different values. The new operation must retain the established scene and gesture semantics while solving for latent-value changes whose recomputed scene/gesture raw center before target-center slew is the requested target. A selected inactive gesture must be armed and included in that same message; swallowing the first message would also leave hardware and software inconsistent.

The in-progress `rework-controllers-block-editing` change establishes explicit Controllers-page edit sessions. This change depends on that model and only adds another config-level encoder-mode choice.

## Goals / Non-Goals

**Goals:**

- Decode mapped absolute encoder CCs as normalized targets and route them to the currently visible parameter.
- Preserve selected-gesture arming, active-gesture participation independent of selection, scene blending, range bounds, and modifier gating.
- Set the scene/gesture raw center before target-center slew to the requested target exactly in the real-arithmetic model and within `1e-5` in the floating-point implementation.
- Preserve existing relative encoder behavior and built-in relative controller defaults.
- Use accurate encoder-mode naming while continuing to load existing profile JSON.
- Specify and test the mathematical invariant independently of the implementation algorithm.

**Non-Goals:**

- Changing `HandleIncDec`, its Smart Grid distribution, or the first-turn behavior of relative encoders.
- Adding pickup/soft-takeover, hysteresis, acceleration, or suppression of repeated absolute values.
- Changing MIDI output feedback, parameter-value persistence, controller preset defaults, scene/gesture computation, or gesture-weight semantics.
- Adding an absolute mode for analog gesture or scene-blend mappings, which are already absolute inputs on separate paths.

## Decisions

### 1. Make absolute position a distinct message and routed edit

Rename `EncoderRelativeMode` to `EncoderMode`, rename `EncoderMidiInConfig::relativeMode` to `mode`, and add `EncoderMode::Absolute`. Signed-7-bit and direction-only modes continue to emit `ParamIncDec`; absolute mode emits `MessageIn::ParamSetAbsolute(timestamp, slotIx, position, value / 127.0f)`. `turnStep` remains stored and editable so switching away from absolute mode recovers the prior relative setting, but the absolute decoder ignores it.

Add `HandleSetAbsolute` in parallel at `ParameterManager`, `BankSlot`, `Bank`, and `Parameter`. `MessageInBus` applies `ParamSetAbsolute` only when the effective modifier is `None`, matching `ParamIncDec`. Invalid slot/position mappings remain harmless no-ops through the existing lookup boundaries.

Alternative considered: convert the CC to `target - cachedValue` in the MIDI processor. That gives the hardware layer knowledge of live parameter state, bypasses the parameter's authoritative scene/gesture structure, and is still inexact under the current distribution, so it is rejected.

### 2. Arm selected inactive gestures and apply the target in one call

`Parameter::HandleSetAbsolute(scene, normalizedTarget)` validates the scene, clamps the normalized input to `[0, 1]`, maps it linearly to the parameter's stored range, and runs the same selected-gesture arming pass as `HandleIncDec`. For every touched scene endpoint, arming sets the active bit and copies the parent scene center into the gesture value. Unlike relative editing, the absolute handler does not return after arming: it rebuilds the contribution set and solves the requested target immediately. Existing active gestures participate whether selected or not.

Alternative considered: preserve the relative path's swallowed first turn. That would allow an absolute encoder to report one position while the parameter remains at another until a later CC arrives, so it is rejected.

### 3. Reduce the effective value to a convex combination of latent storage

Let the clamped scene blend be `b`, with `s_L = 1 - b` and `s_R = b`. For every active gesture `j`, let `w_j` be the existing effective gesture weight and let `W = sum_j w_j`.

When `W = 0`, define one base component with coefficient `p_0 = 1`. When `W > 0`, rewrite the existing `ComputeRawCenter` equation using component coefficients

```text
p_0 = sum_j(w_j (1 - w_j)) / W
p_j = w_j^2 / W
```

for the base and each nonzero-weight active gesture. Each component's scene-blended value is

```text
q_k = s_L x_(k,L) + s_R x_(k,R).
```

Therefore the effective value is

```text
y = sum_k p_k q_k
  = sum_k sum_e p_k s_e x_(k,e)
  = sum_i a_i x_i.
```

Here each `x_i` is a distinct scene-center or gesture-value storage location and `a_i` is its accumulated coefficient. If both scene endpoints refer to the same storage location, their coefficients are combined before solving. Zero coefficients are omitted.

This decomposition is also the direction implicit in relative editing: away from clamping, the latent location `x_i` receives motion proportional to `a_i`. Absolute editing keeps that direction but solves its magnitude rather than accepting the attenuated effective motion.

### 4. Use a range-constrained weighted projection

Let the parameter range be the closed interval `I = [A, B]`, let the current latent vector be `x in I^n`, let the positive contribution vector be `a`, and let the mapped target be `t in I`. The handler computes the Euclidean projection

```text
minimize    (1/2) ||z - x||^2
subject to  a dot z = t
            z in I^n.
```

The solution has the clamped weighted form

```text
z_i(lambda) = clamp_I(x_i + lambda a_i).
```

An active-set solver finds `lambda`. Starting with every location free, it solves

```text
lambda = (t - sum_fixed(a_i z_i) - sum_free(a_i x_i))
         / sum_free(a_i^2).
```

It evaluates every free candidate `x_i + lambda a_i`. If the target is above the current effective value, candidates above `B` are fixed at `B`; if the target is below, candidates below `A` are fixed at `A`. It then recomputes `lambda` over the remaining free set. When no candidate violates the range, it writes the candidates. Endpoint targets may directly set all positive-weight locations to the corresponding endpoint. The production solver uses double-precision intermediates, stages the parameter's float storage values, and verifies the rounded weighted center within `1e-5` before committing those writes. Production tests independently verify the resulting `ComputeRawCenter(scene)` against the same tolerance. Both checks concern the raw center before `targetCenterAlpha` slew; one ordinary `Compute` call may move the smoothed target center only partway toward the newly exact raw center.

The routed handler is an audio-thread operation and therefore uses no dynamic allocation. Its stack-owned `AbsoluteEditWorkspace` has capacity

```text
2 + 2 * digits(GestureMask) = 2 + 2 * 64 = 130
```

distinct locations: one base plus one location per possible gesture at each of two scene endpoints. Storage aliasing can only reduce that count. The handler preflights scene indices, backing-storage sizes, finite/range invariants, and relevant gesture state before arming. It snapshots the touched gesture values and active masks before the arming mutation, stages the complete projection before writing latent storage, and restores the snapshot if any later invariant or projection check fails. Thus invalid internal state is a mutation-free no-op; the routed handler and its fixed-workspace builder/solver boundary are `noexcept`.

This projection is preferred to setting every contributing latent value directly to `t`: both are exact, but projection makes the smallest total latent change and preserves as much scene and gesture separation as the target and bounds allow.

### 5. Mathematical proof

#### Lemma 1: the contribution coefficients form a convex combination

All scene coefficients are nonnegative and `s_L + s_R = 1`. Gesture weights satisfy `0 <= w_j <= 1`. If `W = 0`, `p_0 = 1`. If `W > 0`, every `p_k` is nonnegative and

```text
p_0 + sum_j p_j
= [sum_j(w_j - w_j^2) + sum_j w_j^2] / W
= sum_j w_j / W
= 1.
```

Thus every accumulated latent coefficient `a_i` is positive after zero terms are omitted, and

```text
sum_i a_i = (sum_k p_k)(s_L + s_R) = 1.
```

Consequently `y = sum_i a_i x_i` is a convex combination of in-range latent values and is itself in `I`.

#### Arming changes topology before the solve

At a scene endpoint, a newly armed gesture value is copied from that endpoint's base scene center. At an intermediate blend, the arming pass touches both distinct endpoints and copies both parent values, so the new gesture's blended value initially equals the base blended value. Arming can nevertheless change the pre-solve effective value when another non-base gesture is already active: adding a new positive weight changes `W` and therefore rescales every component coefficient. For example, with base `0`, one active gesture of weight `0.5` and value `1`, the effective value is `0.5`; arming a second weight-`0.5` gesture at copied value `0` changes the component coefficients and the effective value to `0.25` before projection.

No exactness proof depends on arming preserving the old value. The handler finishes arming first, rebuilds `a` and `x` from the post-arming topology, and then solves against the incoming absolute target. Theorems 1–3 apply to that post-arming convex system.

#### Theorem 1: an in-range exact solution exists

Define

```text
F(lambda) = sum_i a_i clamp_I(x_i + lambda a_i).
```

Each summand is continuous and nondecreasing in `lambda`; therefore `F` is continuous and nondecreasing. Because every `a_i > 0`, as `lambda` tends to negative infinity every clamped term tends to `A`, and as `lambda` tends to positive infinity every term tends to `B`. By Lemma 1,

```text
lim_(lambda -> -infinity) F(lambda) = A sum_i a_i = A
lim_(lambda -> +infinity) F(lambda) = B sum_i a_i = B.
```

For every requested `t in [A, B]`, the intermediate value theorem therefore gives at least one `lambda` such that `F(lambda) = t`. The corresponding `z_i(lambda)` is in range by construction and satisfies `a dot z = t`.

#### Theorem 2: the active-set solver terminates and is exact

On an iteration with free set `S`, the solver fixes every already-saturated location and chooses `lambda` by algebraically solving

```text
sum_fixed(a_i z_i) + sum_(i in S) a_i (x_i + lambda a_i) = t.
```

The denominator `sum_(i in S) a_i^2` is positive whenever `S` is nonempty. If every free candidate is in range, substitution of the chosen `lambda` proves that the resulting effective value is exactly `t`.

Otherwise at least one free location violates the bound in the direction of the target. Consider an upward edit; the downward case is symmetric. Let `lambda_0` be the unconstrained value computed for the current free set. Replacing every overshooting candidate `x_i + lambda_0 a_i > B` by `B` strictly decreases the left side of the target equation, so the clamped sum at `lambda_0` is below `t`. Since `F` is nondecreasing, any root `lambda_*` of `F(lambda_*) = t` satisfies `lambda_* > lambda_0`. Every coordinate that already exceeded `B` at `lambda_0` therefore also exceeds `B` at `lambda_*` before clamping and must equal `B` in the constrained solution. Moving all such coordinates from `S` to the fixed set is consequently exact, not heuristic, and preserves feasibility.

Every nonterminal iteration fixes at least one member of `S`; therefore there are at most `n` such removals. If no free location remains, feasibility from Theorem 1 implies that the requested target is the reached range endpoint, already represented exactly by the fixed values. Hence the solver terminates and returns an in-range vector with `a dot z = t`.

#### Theorem 3: the returned vector is the minimum-change exact edit

The objective is strictly convex. The equality constraint is affine and the range box is convex, so the feasible problem has a unique minimizer. Its Karush-Kuhn-Tucker stationarity conditions give `z_i - x_i = lambda a_i` for free locations, with lower- or upper-bound complementary slackness for saturated locations. This is precisely `z_i = clamp_I(x_i + lambda a_i)`, the form returned by the active-set solver. Therefore the exact edit is also the unique minimum-Euclidean-change edit.

The theorems are statements over real arithmetic. Double intermediates followed by float storage introduce rounding; implementation and tests require the production scene/gesture raw center from `ComputeRawCenter(scene)`, before target-center slew, to differ from the mapped incoming target by at most `1e-5`.

### 6. Preserve and migrate encoder configuration explicitly

New JSON writes the encoder input mode as `"mode": "signed7Bit"`, `"directionOnly"`, or `"absolute"`. Loading first accepts `mode`; when absent it accepts the legacy `relativeMode` field with its existing relative strings. If both fields are present, `mode` is authoritative. Saving a successfully loaded legacy profile writes the new field. Message JSON naming gains `paramSetAbsolute` wherever `MessageIn` values are serialized.

The Controllers view model changes its two-entry relative-mode catalog into a declaration-order three-entry encoder-mode catalog and labels the config-level row `encoder mode`. The current edit session owns and flushes this value exactly like the prior relative-mode row. The `turnStep` row remains present and non-deletable in all modes; its stored value has no effect while the mode is absolute.

Alternative considered: retain the public `EncoderRelativeMode` name and legacy JSON key while adding `Absolute`. That avoids a source rename but makes the contract false and compounds future confusion, so it is rejected in favor of a source-level rename plus compatible loading.

### 7. Verify both exactness and non-regression

Deterministic unit tests cover endpoint and intermediate scene blends, no gestures, partial and multiple gesture weights, selected inactive arming, active deselected gestures, shared scene endpoints, upper/lower saturation, and modifier/routing behavior. Seeded model/property tests independently construct the convex coefficients and verify the exact-target and range invariants over randomized valid states. MIDI tests cover raw `0`, `64`, and `127`; persistence tests cover both new and legacy fields; Controllers tests cover selection and edit-session survival. Existing relative decode and `HandleIncDec` expectations remain unchanged.

## Risks / Trade-offs

- [The projection may move latent values substantially at weak intermediate contributions] -> This is unavoidable for an opinionated absolute target; minimum-change projection makes the smallest movement consistent with exactness, and the documented relative path remains available when attenuation is desired.
- [Saturation makes the solver more complex than scalar gain compensation] -> Keep the solver pure and independently test it against the defining convex equation, including randomized and boundary cases.
- [Floating-point storage cannot preserve the real-arithmetic equality bit-for-bit] -> Use double intermediates, validate the staged rounded weighted center before commit, independently test the production scene/gesture raw center before target-center slew, and enforce an explicit `1e-5` tolerance.
- [Renaming the C++ enum and field breaks downstream source code] -> Treat the rename as intentional and mechanical, update all repository consumers atomically, and retain JSON backward compatibility.
- [This change and `rework-controllers-block-editing` overlap in Controllers view-model files] -> Apply after that change or rebase onto it, preserve its edit-session abstraction, and add only the new config-level choice.
- [Absolute hardware can jump when its stored position differs from the current software value] -> This change intentionally provides hard absolute semantics; pickup/soft-takeover remains a separate future feature.

## Migration Plan

1. Complete or rebase onto `rework-controllers-block-editing` so the edit-session contract is stable.
2. Introduce `EncoderMode`, compatible JSON parsing, and repository-wide source renames while keeping relative behavior green.
3. Add `ParamSetAbsolute` and the parallel routing APIs.
4. Add the pure coefficient builder and active-set projection, then connect `HandleSetAbsolute` after same-call gesture arming.
5. Add absolute MIDI decoding and Controllers editor selection.
6. Run focused synth library, view-model, persistence, and randomized invariant tests, followed by the complete synth test target.

Rollback removes the absolute enum value, message, handler, and UI choice while retaining the JSON loader's ability to diagnose or reject profiles that explicitly use `"mode": "absolute"`. Existing legacy profiles require no data migration.

## Open Questions

None.
