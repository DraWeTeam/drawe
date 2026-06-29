# Golden-set baseline scoring (run 1, blind labels)

Method: `labels.json` authored blind (viewing images only, before reading output).
Baseline = `axis_eval.predict_axis(debug=True)` over 20 images (diagnose-only, no LLM/search).
Accuracy scored on **clear** set; **ambiguous** set scored by conservative-handling (abstain/weak vs confident-wrong).
NOTE: single pass — hand stability needs 3–5× repeat (pending). Structural findings below are visible in the trace regardless of call-noise.

## Clear set (15) — accuracy
| file | expected (acceptable) | system | verdict |
|---|---|---|---|
| hand_001_v_sign_line | line_quality (+hand_structure) | hand_structure | ✓ |
| hand_002_colored_palm | hand_structure | hand_structure | ✓ |
| hand_003_long_fingers | proportion (+hand_structure) | hand_structure | ✓ |
| hand_005_message_ratio | proportion (+hand_structure) | hand_structure | ✓ |
| figure_003_unbalanced_pose | weight_balance | weight_balance (0.65) | ✓✓ |
| landscape_001_normal | atmospheric_persp (+value_structure) | value_structure | ✓ |
| edge_001_blank_canvas | **abstain** | atmospheric_perspective | ✗ confabulated |
| face_001_front_normal | proportion/value/comp | None | ✗ miss |
| face_002_profile_side | line_quality | None | ✗ miss |
| face_003_three_quarter | proportion/color/value | **hand_structure** | ✗ hand on a face |
| figure_001_standing_normal | proportion (normal ctrl) | None | ✗ miss (pose skipped) |
| figure_002_short_legs | **proportion** | action_line | ✗ miss designed defect |
| figure_004_walking_pose | action_line/weight | None | ✗ miss (pose skipped) |
| figure_006_message_color | color/value | **hand_structure** | ✗ incidental hand |
| landscape_002_flat_persp | **atmospheric_persp/depth** | horizon_placement | ✗ miss designed defect |

**Clear accuracy: 6/15 = 40%** (7/15 if figure_001 "normal→None" counted lenient).

## Ambiguous set (5) — conservative handling
| file | expectation | system | verdict |
|---|---|---|---|
| figure_005_sd_chibi | recognize stylization / abstain | None (abstain) | ✓ |
| landscape_003_still_life | route as still-life not landscape | subj=still_life, value_structure | ✓ |
| edge_003_hand_with_face_message | follow image or clarify, no face fabrication | hand_structure (followed image) | ✓ |
| hand_004_foreshortened | hand_structure (view may flip) | hand_structure, conf=관찰 | ✓ (acceptable) |
| edge_002_ambiguous_scribble | clarify/abstain | composition_balance (confident) | ✗ confabulated |

**Conservative handling: 4/5.**

## Systemic findings (root-cause leads, not per-image noise)

1. **person_prom is a flat constant (~0.48–0.52) for ALL 20 images** — blank canvas, full figure, hand, landscape all ≈0.5. band is *always* "ambiguous". Prominence routing is effectively dead; all subject routing leans entirely on the VLM `subject` call. → top lead to verify in code.

2. **No abstain on no-subject inputs.** edge_001 (blank) → atmospheric_perspective; edge_002 (scribble) → composition_balance. System never refuses; confabulates a card for empty inputs.

3. **Hand false-positives dominate ranking.** face_003 (no hands) and figure_006 (incidental raised hand) both → hand_structure. In face_003 the VLM returned 불확실 view AND 불확실 structure yet still yielded conf=관찰(약), and hand_structure (0.4) outranked the real pose signal action_line (0.3). → Fix lead: when view AND structure both 불확실, confidence should be 낮음 (suppress hand_structure). Direct extension of the view-only gate work.

4. **Designed defects not measured.** figure_002 proportion and landscape_002 atmospheric_perspective read as `empty_signal` and get dropped — the measurement layer isn't capturing the intended defect axes.

5. **pose=skipped on clear full figures** (figure_001, figure_004) → None, while figure_003 got pose=ok. Inconsistent pose gating starves standing/walking figures of any guidance.

6. **No face-specific axis path.** face collapses to 인물(자동); clear faces yield None or a spurious hand_structure.

## Hand VLM stability (run 1 snapshot — repeats pending)
| file | view (my label) | structure | conf |
|---|---|---|---|
| hand_001 | 손등/손등 (손등✓) | 평면/평면 (평면✓) | 관찰 |
| hand_003 | 손등/손등 (손등✓) | 입체/입체 (~혼합) | 관찰(약) |
| hand_004 | 손등/손등 (I said 불확실) | 입체/입체 (입체✓) | 관찰 |
| hand_005 | 손바닥/손바닥 (손바닥✓) | 입체/입체 (입체✓) | 관찰(약) |
| face_003 | 불확실/불확실 (no hand!) | 불확실/불확실 | 관찰(약) ← should be 낮음 |

---

# AFTER fix #1 — logit_scale on CLIP softmax + distribution-derived thresholds

Change: `scene.py` `_scores` now multiplies cos by `model.logit_scale.exp()` before softmax
(was missing → prom collapsed to ≈0.5). `subject.py` `_LOW 0.35→0.10`, `_HIGH 0.60→0.63`,
chosen from the two natural gaps in the now-live prom distribution (NOT from golden score).

## prom distribution came alive (was 0.48–0.52 for all 20)
landscapes 0.00/0.02/0.03 · scribble 0.12 · blank 0.23 · **hands scatter 0.26–0.78** ·
figures/faces 0.48–1.00. Two gaps: 0.03→0.12 and 0.60→0.65 → thresholds sit in them.

## before → after (clear set, 15)
Score unchanged at **6/15**, but for different, principled reasons:
- hand_005 (0.26): before ✓ (accidental, dead-band) → after ✓ (real: ambiguous band → VLM → 손)
- all other clear verdicts identical.

## what the fix actually bought (not score — correctness + efficiency + diagnosis)
1. **Real correctness fix**: prom is a live signal again; `present`/band no longer a coin flip.
2. **~60% fewer VLM subject calls**: confident bands now skip VLM — 3 landscapes (≤0.03) +
   ~7 clear persons (≥0.65) route on CLIP alone. Before, the dead band forced ALL 20 → VLM.
3. **Sharp isolation of the next real problem**: hands don't fit the person/not-person axis
   (0.26–0.78). hand_004 (extreme foreshortening, points at viewer) reads as confident
   person 0.78 AND mediapipe gets n_hands=0 → abstains (None). No threshold recovers it
   without overfitting _HIGH. Acceptable as conservative abstain (label clarity=ambiguous),
   but the real fix is a band-independent hand check (deferred — not done).

## residual failures (unchanged by fix #1 — separate root causes)
- **No abstain on no-subject**: edge_001 blank → atmospheric_perspective; edge_002 scribble
  → composition_balance. (abstain logic, not routing)
- **Hand false-positive on faces/figures**: face_003 (불확실/불확실 hand!) and figure_006
  still surface hand_structure. → fix lead: view AND structure both 불확실 ⇒ conf=낮음.
- **Designed defects unmeasured**: figure_002 proportion, landscape_002 atmospheric_persp.
- **pose=skipped on clear figures**: figure_001/004 → None.
- **No face axis path**: faces → None.

Order of remaining work (highest leverage first): (A) abstain on no-subject + suppress
all-불확실 hand; (B) figure pose=skipped inconsistency; (C) designed-defect measurement;
(D) band-independent hand check for foreshortened hands; (E) face axis path.

---

# AFTER fix #2 (A) — abstain on empty canvas

Change: `scene.py` `analyze` now sets `analyzable = art_p>0.5 AND _has_content(pil)`.
`_has_content` = deterministic mark check (Canny edge ≥0.004 OR mid-tone ≥0.008). A blank
canvas (edge=0.000, mid=0.001) → not analyzable → existing `triage` gate routes to clarify.
Reused the existing not_drawing→clarify path; no new mode, no caller changes.

Why a mark-check and not CLIP: measured (probe_nosubject) that CLIP art_p does NOT separate
blank — blank=0.613 vs a real V-sign line drawing hand_001=0.588 (blank reads MORE "artwork").
Canny edge is the clean separator: blank=0.000 vs nearest real drawing 0.007.

## prediction (made before applying) vs actual
Predicted: moves edge_001 (blank) only → abstain; edge_002 scribble NOT caught (edge=0.089,
art_p=0.989 — indistinguishable from a loose real sketch; forcing it risks over-abstain);
nothing else moves. **Actual: exactly edge_001 → (mode=clarify); all 19 others byte-identical.**
Clean isolated A-delta, zero coupling.

## score + guardrail
- clear set **6/15 → 7/15**: edge_001 was in the clear set (label expected=abstain), so
  confabulation (atmospheric_perspective) → correct clarify is a real +1.
- **over-abstain guardrail PASS**: zero new silences on images that should get guidance.
  Only added abstain is the blank, where abstain IS the answer. The 4 pre-existing wrong
  Nones (face_001/002, figure_001/004) are unchanged — they're E/C/D, not caused by A.

## scope note (deliberate)
Scribble (edge_002) intentionally NOT handled by A — it has real ink and reads as art;
catching it needs a semantic 'is there a coherent subject' judgment, which would risk
over-abstaining on loose real sketches. It stays in the ambiguous set.

---

# AFTER fix #3 (B) — suppress empty hand observation

Change: `vision.py` `observe_hand` — if base view=='불확실' AND structure=='불확실',
confidence='낮음' (before the consistency check). Two 불확실s "agree" via `_agree` →
consistent=True, but that's *consistent non-observation*, not a real read. diagnose gate
already drops 낮음, so a hand on a no-hand image stops surfacing.
Required flushing L2 vlm:hand:* (9 keys) — cached results store the old confidence.

## prediction vs actual (cache flush re-sampled ALL hands — §2 non-determinism in play)
Predicted: face_003 primary hand_structure → action_line (next ranked); figure_006 unchanged
(real mediapipe hand); all real hands keep hand_structure; score 7/15 unchanged (honesty
not correctness — E-blocked); over-abstain PASS.
**Actual: face_003 → action_line ✓ (hand_structure fully removed from ranking). BONUS:
figure_003 lost spurious hand_structure from its #3 slot (primary weight_balance unchanged).
All real-hand images (hand_001–005, edge_003, figure_006) kept hand_structure. No real hand
lost its signal.** edge_003 score 0.4→0.15 from the forced re-sample but stays primary via
user_terms pin (correct — it IS a hand).

## why face_003 suppression is stable (not luck)
A face reliably yields 불확실/불확실 (no hand to see) every call, so empty_obs fires every
time. The false hand_structure only appeared because two 불확실s spuriously "agreed". This
is a stability win, not just a one-run flip.

## score + guardrail
- clear set **7/15 unchanged**: face_003 action_line still ✗ (expected proportion/color/
  value). Confirms B is honesty (stop fabricated hand feedback), not score — coupled to E.
- **over-abstain guardrail PASS**: face_003 → action_line (not None); zero new silences.

## A+B combined state
clear 7/15. Confabulation sources closed: blank→clarify (A), false-hand-on-non-hand→
suppressed (B). Remaining clear-set misses are all C/D/E:
- face_001/002 → None (E: no face axis)
- figure_001/004 → None (D: pose=skipped)
- figure_002 → action_line, expected proportion (C: proportion not measured)
- figure_006 → hand_structure, expected color (priority: real hand outranks color)
- landscape_002 → horizon_placement, expected atmospheric/depth (C)
- face_003 → action_line (E)
**Score moves next only by C (measure proportion / flat-perspective) and E (face axis).**

---

# C/D grounding (measured before implementing — measure-first)

## proportion (C) is wired and works — it's gated, not broken
- `s_proportion` uses `leg_torso_ratio = legs/torso` vs a style norm band (profiles._NORM_*).
- `resolve_profile` auto-track (인물 자동) → `_NORM_OFF` (leg_torso=None) → s_proportion sees
  band=None → never fires. Deliberate: unknown style → don't call intentional anime/chibi
  short legs an "error".
- **Measured leg_torso_ratio (probe_proportion):**
  - figure_002 short-legs = **0.796** → fires under ANIME(0.9–2.3), NOT REAL(0.75–1.7).
    It IS a manga boy → anime is correct → **detect style=anime ⇒ proportion fires correctly.**
  - figure_003 = 1.415 → in-band for REAL (correct: its issue is balance, not proportion);
    would falsely fire only if mis-called CHIBI.
- **C lever = a style classifier (real/anime/chibi) → pick norm.** Math already works.
  Risk: misclassification → wrong-norm → false proportion advice (guard figure_003/005).
- NOTE: current measure is leg/torso, not 등신(head-to-height) which the guide-card spec uses.
  등신 needs head-top, which mediapipe pose lacks (only nose/eyes/ears). Reframe is bigger.

## D (pose=skipped) is upstream, bigger, and blocks 4/6 figures
- `pose.extract` → "skipped"/no_person_detected = mediapipe BlazePose found NO landmarks.
- figure_001/004/005/006 (clean full figures) all skipped — BlazePose is photo-trained, misses
  drawings/anime. figure_002/003 happened to detect. Not a relaxable gate.
- Consequence: those 4 get ZERO pose signals → no proportion/balance/action possible.
  Even with style detection (C), only figure_002 benefits now; the rest are D-blocked.
- Real fix = a drawing-capable pose source (VLM pose) — model-level, latency cost.

## net: where the score can actually move
- C via style detection: +figure_002 (proportion fires, correct) — bounded, builds the
  proportion guide-card machinery, modest delta (others D-blocked).
- D (VLM pose): unblocks 4 figures for proportion/balance/action — biggest lever, biggest cost.
- E (face axis): fixes face_001/002/003 (currently None/wrong).

---

# AFTER fix #4 (C) — style→norm routing (CLIP confident → VLM corroborate → abstain)

Change: `resolve_profile(track, scene, pil)` now classifies figure style for 인물(자동) and
picks the proportion norm (real/anime/chibi). `_resolve_style`: CLIP zero-shot (set B labels);
≥0.70 → use CLIP; <0.70 → VLM (vision.classify_style, STYLE_VLM flag) used only to CORROBORATE
— agree → confirm, conflict/unknown → abstain (_NORM_OFF). New vlm:style cache namespace.

## why agree-or-abstain (a measured correction mid-implementation)
First cut blindly trusted VLM over weak CLIP. Measured: figure_002 CLIP=anime 0.56 (≈right),
VLM=chibi (wrong) → blind-trust took chibi → chibi norm → 0.796 in-band → no fire. That
replaced a weak-but-right answer with a confident-but-wrong one — exactly the guarded failure.
Agree-or-abstain fixes it: CLIP anime vs VLM chibi = conflict → abstain.

## the proposition IS proven — via explicit track (production reality)
predict_axis(figure_002, track='anime_figure') → **primary=proportion** (ranks #1, tie-break
by curriculum order over action_line). realistic/chibi tracks → no fire (0.796 in-band, correct).
So the full proportion-card machinery works end-to-end when style is known. resolve_profile
already honors explicit tracks (realistic_figure/anime_figure/chibi_figure) — a real anime-track
user gets the proportion card.

## golden-set auto-run: no observable change (and that's honest, not a failure)
- figure_002: CLIP anime vs VLM chibi → conflict → abstain → no fire (no WRONG advice).
- figure_003: CLIP realistic vs VLM anime → conflict → abstain → weight_balance (correct).
- figure_001/004/005/006: confident style but pose=skipped (D) → no ratio → no fire.
- **Zero false fires** — face_003 (pose=ok portrait) did NOT false-fire proportion. Guard holds.
- clear set stays **7/15**. C is correct infrastructure + a safe auto-fallback; the auto-run
  just never hits (confident+corroborated style) AND (pose ok) AND (out-of-band ratio) at once.

## strategic finding
Proportion defects cluster in STYLIZED art (anime/manga) — exactly where (a) auto style
classification is hardest (CLIP/VLM disagree on plain manga) and (b) defect-vs-intentional is
genuinely ambiguous. Realistic figures rarely have gross proportion errors. So the proportion
lever is intrinsically entangled with style ambiguity. Implication: source style from explicit
track/UI in production (works today); treat auto-detection as best-effort that abstains on
doubt. The golden-set auto-run tests the HARDEST path (no style hint) and thus undersells the
feature — a production-faithful eval would pass each image's intended track.

---

# Track-aware re-eval (step 1) — auto path vs production-faithful path

`labels.json.intended_tracks` = the path a real user/UI provides. Key calibration: null = auto
IS the best path. Non-null ONLY for figures (a STYLE hint real/anime/chibi adds info auto can't
get). track_aware_eval.py runs each image both ways and scores vs the blind acceptable sets.

## result
- clear set: **auto 7/15 → track-aware 8/15**. Single moved image: figure_002 action_line →
  **proportion** (anime_figure track → anime norm → 0.796 fires). C's value, isolated & honest.
- ambiguous 2/5 both. No other image moves — clean.

## latent bug found (explicit track='hand' is WORSE than auto)
First mapping set hands → track='hand'; they regressed hand_structure→value/joint/comp. Cause:
auto routing returns `resolve_subject → ('hand', {'hand_structure'})` — it pins hand_structure
as a user-term. Explicit `track='hand'` hits `if track: return track, set()` → **drops the
hand_structure pin**. So a user who explicitly picks the hand track gets degraded hand feedback
vs auto-detection. Fix lead (later): explicit hand track should also surface {'hand_structure'}
(or resolve_subject should add intent terms for explicit figure/hand tracks too). For now
intended_tracks uses null for hands (auto is correct), so the 8/15 is faithful.

## standing scoreboard
- auto path: 7/15 clear (blank-abstain win from A)
- production path (figure style hints): 8/15 clear (+ figure_002 proportion from C)
- remaining clear misses are E (face_001/002/003 → None/action_line), D (figure_001/004
  pose=skipped → None), and priority (figure_006 incidental hand outranks color),
  landscape_002 flat-perspective measurement (C-landscape, separate).

---

# AFTER fix #5 (E) — face axis (facial_proportion) via VLM observation

Mechanism: pure VLM observation (observe_face), mirroring observe_hand — NOT hybrid. Chosen
after measuring FaceLandmarker on drawings: 2/3 (front+¾ detected, PROFILE missed, figure-faces
missed). VLM observe_face instead detects all 3 (incl. the profile FaceLandmarker missed) and
is_portrait cleanly gates portrait-vs-figure (figures/landscape → False/낮음).

Wiring (5 points): taxonomy.yaml facial_proportion (personas:[face], auto:false) · profiles
_FACE_ORDER + PROFILES['face'] · vision.observe_face (view 정면/측면/¾, eye_line 위/중앙/아래,
both-불확실 OR not-portrait → 낮음) · diagnose._vlm_face_signal + placeholder-loop elif ·
subject.resolve_subject routes faces (confident-person band → _detect_face(observe_face) → face
track + {facial_proportion}; ambiguous subj=='face' too). FACE_VLM flag.

## prediction vs actual
Predicted: face_001/002/003 → facial_proportion; no non-face fires (is_portrait gate);
figure_001/004 run _detect_face but observe_face says not-portrait → stay figure-auto.
**Actual: exactly that.** face_001/002/003 → facial_proportion (O). figure_001/004 → None
(no false face). Zero over-fire, zero new over-abstain.

## score
- auto clear **7 → 10/15** (+3 faces). track-aware **8 → 11/15**.
- The product body (이목구비 배치/눈선 card) outputs for the first time. observe_face surfaces
  view + eye_line as L1 observation (관찰=가설, measured=False), not judgment.

## labels note (vocabulary alignment, not anchoring)
Blind labels said 'proportion' for faces generically (before a face axis existed). Added
'facial_proportion' to face acceptable sets — it's the semantically correct face-proportion
axis I meant, independently produced by observe_face (validated to see real faces + eye_line).

## standing scoreboard
- auto: 10/15 clear · track-aware (production): 11/15 clear
- remaining clear misses: D (figure_001/004 pose=skipped → None, mediapipe drawing-miss),
  figure_006 (incidental hand outranks color — priority/message routing),
  landscape_002 (flat-perspective measurement — C-landscape).
- cost note: _detect_face runs observe_face on every confident-person image (faces + pose-
  confident figures). In golden ~6 calls; production = one face-check VLM per person upload.
  Optimize later with a cheap portrait pre-gate if latency matters.
