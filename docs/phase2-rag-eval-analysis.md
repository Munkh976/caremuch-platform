# Phase 2 Tranche C Part 3d — RAG Eval Analysis (Stage 3)

**Status:** Analysis of the committed raw run (`docs/phase2-rag-eval-results.json`, 38
questions, agency `56fbfe38`). All figures below are computed directly from that file —
none are estimated or asserted from memory.

**Framing, per the CareMuch Phase 2 RAG Architecture Decision doc:** retrieval is governed
by three separate gates — **Gate 1** (authorization: agency/scope), **Gate 2** (retrieval
relevance — cosine similarity + τ), **Gate 3** (answerability — does the retrieved
knowledge actually answer the question — LLM-based, not yet built). This analysis treats
τ strictly as a Gate 2 relevance floor. It does not attempt to make τ do Gate 3's job, and
the central finding below is empirical proof that it structurally cannot.

## 1. Answerable (18 questions) — success criterion: correct document at semantic rank 1

| Result | Count |
|---|---|
| Correct document at semantic rank 1 | **17 / 18** |
| Miss | q01 only |

**q01** ("What's the call-off policy?") — the correct document (Attendance and Call-Off
Policy) scores **0.4355** but ranks **#2**, behind Paid Time Off (PTO) Policy at
**0.4549** — a near-tie (gap 0.019) on what should be the easiest, most direct-phrase
question in the set. Notably, **FTS gets this one right** (rank 1, `search_agency_knowledge`
score 0.0276) — the one case in the whole eval where FTS outranks semantic. This is the
mirror image of q19 below, where semantic corrects an FTS miss.

Full per-question detail (score = the labeled correct document's own semantic score,
regardless of its rank):

| id | question (lang) | doc | rank | score |
|---|---|---|---|---|
| q01 | What's the call-off policy? (en) | Call-Off | **2** | 0.4355 |
| q02 | How far in advance... (en) | Call-Off | 1 | 0.5968 |
| q03 | ¿Cuál es la política de ausencias? (es) | Call-Off | 1 | 0.4521 |
| q04 | ¿A quién llamo si estoy enfermo... (es) | Call-Off | 1 | 0.6230 |
| q05 | How much PTO do I get? (en) | PTO | 1 | 0.6101 |
| q06 | How many hours of PTO do I earn? (en) | PTO | 1 | 0.6231 |
| q07 | ¿Cuántas horas de PTO...? (es) | PTO | 1 | 0.7275 |
| q08 | ¿Puedo cobrar mi PTO...? (es) | PTO | 1 | 0.6548 |
| q09 | How should I respond... confused about day (en) | Dementia | 1 | 0.5913 |
| q10 | What should I do if my client tries to wander (en) | Dementia | 1 | 0.7167 |
| q11 | ¿Cómo debo reaccionar... (es) | Dementia | 1 | 0.7132 |
| q12 | ¿Qué debo anotar...? (es) | Dementia | 1 | 0.5727 |
| q13 | Can I open my client's pill organizer...? (en) | Medication | 1 | 0.6806 |
| q14 | What should I do if a client refuses...? (en) | Medication | 1 | 0.7282 |
| q15 | ¿Puedo administrar una inyección...? (es) | Medication | 1 | 0.5884 |
| q16 | ¿Qué hago si las pastillas...? (es) | Medication | 1 | 0.6960 |
| q17 | I can't make my shift, what do I do? (en) | Call-Off | 1 | 0.4842 |
| q19 | No puedo terminar mi turno...? (es) | PTO | 1 | 0.4909 |

**Answerable correct-doc score distribution: 0.4355 – 0.7282** (min = q01, max = q14).

## 2. Ambiguous (6 questions) — success criterion: BOTH expected documents score high

**6/6 — both labeled documents land at semantic ranks #1 and #2** (out of 4 possible
documents), every single time. This is a clean, consistent result, in sharp contrast to
the near-miss questions below.

| id | question (lang) | doc1 (rank, score) | doc2 (rank, score) | gap |
|---|---|---|---|---|
| q18 | ...call off or use my time off? (en) | Call-Off (1, 0.5487) | PTO (2, 0.5241) | 0.0246 |
| q20 | ...avisar o...tiempo libre? (es) | Call-Off (2, 0.5755) | PTO (1, 0.6535) | 0.0780 |
| q21 | adjust medication...confused? (en) | Dementia (1, 0.6831) | Medication (2, 0.6112) | 0.0719 |
| q22 | dementia...refuses their pills (en) | Dementia (2, 0.5196) | Medication (1, 0.6344) | 0.1148 |
| q23 | cambiar la dosis...agitado? (es) | Dementia (1, 0.6904) | Medication (2, 0.5842) | 0.1062 |
| q24 | no quiere tomar sus pastillas (es) | Dementia (1, 0.6323) | Medication (2, 0.6262) | 0.0061 |

FTS shows the identical top-2 clustering on all 6 — not a semantic-specific effect, a
property of the corpus's actual overlapping vocabulary (these pairs were chosen because
the source documents genuinely cross-reference each other; see the corpus's own text).

**Gap range: 0.0061 – 0.1148.** This range matters directly for §4.

## 3. Out-of-domain + misleading (14 questions) — the "noise ceiling"

Top semantic score per question (the highest-scoring of the 4 documents, none of which
should be correct):

| id | question (lang) | category | top doc | top score |
|---|---|---|---|---|
| q33 | How do I set up direct deposit? (en) | misleading | Call-Off | **0.2147** |
| q28 | annual background check renewal (en) | out_of_domain | Call-Off | 0.2560 |
| q36 | ¿Cómo configuro el depósito directo? (es) | misleading | Medication | 0.2637 |
| q25 | health insurance benefits (en) | out_of_domain | Call-Off | 0.3147 |
| q27 | mileage reimbursement (en) | out_of_domain | Dementia | 0.3160 |
| q32 | ¿Cómo renuevo...antecedentes? (es) | out_of_domain | Call-Off | 0.3375 |
| q26 | clock in/out app (en) | out_of_domain | Call-Off | 0.3640 |
| q31 | ¿Me reembolsan el kilometraje? (es) | out_of_domain | Call-Off | 0.3784 |
| q34 | overtime pay rate, holiday shift (en) | misleading | PTO | 0.3885 |
| q29 | ¿Cómo me inscribo...seguro médico? (es) | out_of_domain | Call-Off | 0.4299 |
| q37 | ¿tarifa de horas extra...? (es) | misleading | PTO | 0.4298 |
| q35 | call-off pay if sent home early (en) | misleading | PTO | **0.4993** |
| q30 | ¿Qué aplicación...marcar entrada? (es) | out_of_domain | PTO | **0.5102** |
| q38 | ¿pago por ausencia...temprano? (es) | misleading | Call-Off | **0.5122** |

**Noise-ceiling distribution: 0.2147 – 0.5122.**

## 4. The overlap — why no clean single τ exists

- Answerable correct-doc scores: **0.4355 – 0.7282**
- OOD/misleading top scores: **0.2147 – 0.5122**
- **Overlap region: [0.4355, 0.5122], width = 0.0767** — q38 and q30 (both misleading/OOD,
  Spanish) score *higher* than q01's real answer. No threshold value admits every real
  answer while excluding every noise case; any τ that admits q01 (0.4355) also admits
  q38 (0.5122) and q30 (0.5102).

Per-language (doesn't rescue it):
- **EN:** answerable 0.4355–0.7282, noise ceiling up to 0.4993 (q35) → gap = 0.4355 − 0.4993 = **−0.0638**
- **ES:** answerable 0.4521–0.7275, noise ceiling up to 0.5122 (q38) → gap = 0.4521 − 0.5122 = **−0.0601**

Spanish scores run systematically higher on both sides (real answers *and* noise) — a
real, defensible basis for a per-language τ offset later, but it doesn't close the
overlap in either language.

**The overlap is driven by the deliberately-misleading questions** (q35/q38 "call-off
pay," q30 "clock-in app," q29/q37 benefits/overtime) — semantically adjacent to real
content *by construction*. This is the empirical core of this analysis: **cosine
similarity alone cannot distinguish "topically adjacent but unanswerable" from "genuinely
answerable."** That distinction requires actual judgment about whether the retrieved text
answers the question — Gate 3, not Gate 2.

## 5. FTS vs. semantic head-to-head

**Rank-1 accuracy is tied, but not on the same questions:** FTS gets **17/18** correct
documents at rank 1 (misses q19 — PTO ranks #2, Call-Off Policy incorrectly ranks #1 at
0.0287). Semantic also gets **17/18** (misses q01, as above). Rank-1 accuracy alone is
*not* where semantic's advantage lies on this corpus — the real differentiator is score
separability:

- **FTS correct-answer score band: 0.0122 – 0.0695**
- **FTS noise-ceiling (OOD/misleading top scores): 0.0087 – 0.0405**

These **overlap almost entirely**, and worse: **FTS's single highest noise score (0.0405,
q33 direct-deposit) exceeds one of its own real answers (q03, 0.0122).** No FTS threshold
can separate them — any τ_fts high enough to keep q03's real answer excludes nothing of
the noise; any τ_fts that excludes q33's false positive also excludes q03's real answer.
This is the FTS ceiling, now proven numerically rather than from a single anecdote.

**The direct-deposit collision, specifically:** FTS's top hit for "How do I set up direct
deposit?" is **Medication Reminder Guidelines at 0.0405** — the exact "directly"→"direct"
stem collision documented in `docs/phase-1-fts-results.md`. Semantic's top hit for the
same question is Call-Off Policy at a noise-level **0.2147**, with Medication Reminder
Guidelines ranked *last* of the 4 documents (0.1873) — the false-positive document isn't
just outscored, it's actively deprioritized. Semantic doesn't confidently answer this
question at all; FTS did, wrongly, at a rank indistinguishable from a real hit.

**Net finding:** semantic's advantage over FTS on this corpus isn't "picks the right
top-1 document more often" (they're tied) — it's that semantic's score band for real
answers (0.44–0.73) is wide and well above its own noise ceiling for the *clearest*
off-topic cases, while FTS has no usable band at all. Semantic still shares FTS's
harder problem (§4) for questions designed to be semantically adjacent.

## 6. Near-miss (q17, q19) — confirmed too noisy for a score-gap heuristic

| id | expected (rank, score) | near-miss (rank, score) | semantic gap | fts gap |
|---|---|---|---|---|
| q17 | Call-Off (1, 0.4842) | PTO (**3**, 0.4506) | 0.0336 | 0.0034 |
| q19 | PTO (1, 0.4909) | Call-Off (2, 0.3950) | 0.0959 | (FTS gets q19 wrong entirely, see §5) |

q17's labeled near-miss (PTO) doesn't even land at rank 2 — Dementia SOP outranks it,
landing at semantic rank 3. This alone would sink a "top-2, different documents" trigger
design.

**Stronger finding, not previously stated:** q17's semantic gap (**0.0336**) falls
*inside* the genuine-ambiguity gap range from §2 (**0.0061–0.1148**) — specifically
between q18's 0.0246 and q21's 0.0719. **A pure score-gap heuristic cannot distinguish
q17 (not actually ambiguous — one clear intended answer) from q18/q21 (genuinely
ambiguous — two legitimate answers) because their gap distributions overlap.** This is
the same structural problem as §4, one level down: gap size alone conflates "the model is
uncertain between two topics" with "the model is confident but a related document also
scores respectably." Disambiguation is **deferred to the LLM phase**, not built as a
cosine-gap heuristic, on this evidence.

## 7. Conclusion

- **τ is set below as a Gate 2 relevance floor only.** Its job is "is this even in the
  right topical neighborhood," not "does this actually answer the question."
- **Clean refusal on adjacent-but-wrong content requires Gate 3 (LLM answerability),
  which does not exist yet.** §4 and §6 are independent, converging proofs of this: the
  answerable/noise score distributions overlap, and so do the genuine-ambiguity/near-miss
  gap distributions. Neither problem is solvable by moving a number on the same axis.
- Per-language τ (EN vs. ES) is defensible from the data (§4) but is *not* proposed here
  — it would add complexity without closing the actual gap, and should wait for a reason
  more concrete than "the numbers run a bit higher."

## 8. Proof-of-concept caveat — read before reusing this number

**This entire eval ran against the private caregiver-policy seed corpus** (Attendance/
Call-Off, PTO, Dementia SOP, Medication Guidelines) — hand-authored placeholder content
built to prove the retrieval *mechanism*, not real agency knowledge. Per the ingestion-
scope architecture (Gate 1 supplement: scope enforced by separate corpora per surface,
not per-chunk tags), **this is not the public `/a/:slug` agent's real corpus** — the
public agent's real corpus will be FAQ/services/careers content, seeded separately, later.

**The τ value set in this stage is a proof-of-concept relevance floor for this placeholder
corpus, not a production value for the public agent.** `rag-eval-harness` is kept in the
repo specifically so this eval can be re-run, and τ re-derived, against the real public
corpus once it exists — the numbers above should not be assumed to transfer.
