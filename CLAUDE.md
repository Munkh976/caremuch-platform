# CareMuch — Claude Code Project Instructions

## Mission
CareMuch is a multi-agent AI platform for home-care agencies. Add the AI layer around the existing React/TypeScript + Supabase/PostgreSQL application without unnecessary rewrites.

## Current target scope
- Multi-Agent Orchestrator
- Recruiting Screening Agent
- Training Agent
- Knowledge / RAG Agent
- Caregiver Retention Agent
- Shared controlled Tool Layer
- Agency-specific RAG using pgvector
- ML where appropriate, especially retention
- Phased AI boundary: Phase 1 shipped with NO external AI provider at all (Postgres full-text search only — see "AI provider strategy"); the provider decision (direct OpenAI/Google, or Azure/Microsoft Foundry as the PHI-capable target) is made in Phase 2, not yet decided

## Current reality (do not assume the target architecture exists yet)
- The "AI screening" chat is a DETERMINISTIC scripted flow engine
  (conversation_flows → flow_nodes → flow_options, weighted ScoreResult, versioned
  draft/publish). There is NO LLM in it.
- No LLM, RAG, embeddings/vector store, ML models, or agent/orchestrator layer exist yet.
- Edge Functions are admin/provisioning/data utilities only, not AI.

## Explicit exclusion — Smart Scheduling
**Smart Scheduling / Scheduling Agent is OUT OF SCOPE for this entire architecture version.**
Do not add a Scheduling Agent, scheduling ML, or scheduling optimization to the target architecture unless separately and explicitly approved. Build the multi-agent base (Orchestrator, Recruiting, Training, Knowledge, Retention) first.

Preserve ALL existing scheduling functionality exactly as-is — shifts, assignments, eligibility (`check_assignment_eligibility`), SmartAssign, trades, time-off. These are working operational features, not AI agents, and must not be refactored under this work.

## Mental model
This is a central router, not a sequential chain:

```text
User
  -> Conversation Gateway
  -> Multi-Agent Orchestrator
       -> Recruiting Agent
       -> Training Agent
       -> Knowledge Agent
       -> Retention Agent
       -> Controlled Tool Layer
            -> Supabase / PostgreSQL / RLS
            -> Agency RAG / pgvector
            -> ML services
       -> AI provider boundary
```

## Core principle
> LLMs reason; tools enforce; databases remain authoritative; RAG supplies evidence; ML supplies predictions; RLS enforces tenancy; the AI provider boundary controls protected-data processing.

## AI provider strategy (undecided — Phase 2 is where this gets decided)
**Phase 1 shipped with ZERO external AI providers.** The original plan (this section used to say "Lovable AI Gateway for Phase 1") was deliberately superseded mid-build: Lovable Cloud turned out to be disconnected from the live project (`LOVABLE_API_KEY` absent from the linked project's secrets — reconnecting it would have reintroduced a dependency right after removing the app's only other Lovable AI call, `match-caregiver`, for a PHI leak). Phase 1 was rebuilt as Postgres full-text search only (`tsvector`/`ts_rank`, no LLM, no embeddings) specifically to validate retrieval, isolation, and the confidence-gate architecture before taking on any provider/BAA/PHI decision at all. Full writeup: `docs/phase-1-fts-results.md`.

- The existing `match-caregiver` function matches on structured, coded fields only (`client_care_needs`/`caregiver_skills` via `care_types.code`, `service_zipcodes`, `caregiver_availability`, `reliability_score`/`caregiver_performance`) via a deterministic weighted scorer — no LLM call, no provider dependency of any kind, and it never reads `clients.medical_conditions`, `care_requirements`, or any client identity field.

**Phase 2 is where the provider decision actually gets made — it is NOT yet decided.** Candidates: a direct provider (OpenAI/Google) for continued PHI-free embeddings work, or Azure / Microsoft Foundry directly if the PHI timeline moves up. Whichever is chosen:
- Must go through the provider abstraction below (`LLMProvider`/`EmbeddingProvider`), never a hard-coded gateway call.
- A non-Azure provider is NOT BAA-covered. `phiAllowed` MUST be `false` for it, read from an explicit env var, defaulting to false, enforced in code — not convention.
- Azure/Microsoft Foundry remains the only PHI-capable path under consideration; provisioning it is still gated on an explicit PHI-flow decision (see the hard gate below), not something to front-load speculatively.

Do NOT claim the application is HIPAA compliant because a provider offers a BAA. Legal/compliance review remains required regardless of provider.

## HIPAA / PHI boundary hard gate
Before ANY of the following, STOP and re-decide the provider, and provision Azure + a signed BAA if the answer is "PHI may flow":
- Phase 1G (real agency document ingestion — the first time uncontrolled real content enters the pipeline)
- Any phase that sends client / family / elderly data to an LLM or embedding provider (Retention, and any future client-facing agent)
- Any production launch handling real PHI

Lovable cannot carry PHI. This gate is not optional and cannot be satisfied by "we already picked Lovable." Crossing it without Azure + BAA + compliance sign-off is a violation, not a shortcut.

## Phase 1 RAG = PHI-FREE
Phase 1 RAG may contain only agency knowledge:
- policies
- SOPs
- training
- caregiver handbook
- service catalog
- FAQs
- approved agency Q&A

Client/family/elderly records stay in structured operational data under Supabase RLS.

```text
Agency Documents
   -> PHI/PII Guard
      -> REJECT
      -> ALLOW
          -> Chunk
          -> Embeddings (provider TBD — Phase 2 provider decision, not yet made)
          -> pgvector
          -> Knowledge Agent
          -> Evidence / Grounding Gate
              -> PASS: grounded answer
              -> FAIL: refuse / escalate
```

The guardrail must be enforced in code and data flow, not only in documentation. There must be no structural path (no `client_id` parameter in the ingestion contract, no FK from knowledge tables to any person table) through which client PHI could enter.

## Three-layer agency isolation
1. Identity/tenant context: authenticated user + agency + role.
2. Database: Supabase RLS and existing agency helpers.
3. AI tools: explicit allowed tools, data domains, role checks, parameters, and PHI policy.

Never rely only on an LLM prompt for tenant isolation.

## Provider abstraction
All new AI work goes through provider interfaces, never a hard-coded gateway call:
- `LLMProvider` — chat/completion with forced tool-calling
- `EmbeddingProvider` — embeddings, returning the actual model + dimension

Rules:
- Provider is selected by env/config (`LLM_PROVIDER`, `EMBEDDING_PROVIDER`), so swapping providers later is a configuration change, not a code change.
- `match-caregiver` has no provider dependency of any kind — it was made fully deterministic (`886710f`) and imports nothing from any AI provider. The old `_shared/callLLM.ts` Lovable-Gateway shim it once used has been deleted as dead code (zero importers). The Phase 2 `LLMProvider`/`EmbeddingProvider` seam is being built fresh, not extended from any prior shim. New code calls the provider interface directly.
- Every provider carries an explicit `phiAllowed` flag (default false). An `assertPhiSafe(provider, context)` guard MUST be invoked — defined AND called, not just defined — in any code path that could route person-identifiable content through a provider. In Phase 1 it should never trip (RAG is PHI-free), but it must be wired in so it becomes load-bearing the moment a later phase attempts PHI.
- The chosen provider and any future replacement must be able to coexist during migration.

## Embedding model/dimension
Never guess the vector dimension.

Required sequence:
1. Configure the embedding endpoint (provider TBD — Phase 2 provider decision, not yet made).
2. Run a real smoke test.
3. Inspect returned vector length.
4. Record model/version/dimension.
5. Only then create `vector(N)` migration and index.

Note: switching embedding provider/model later changes the dimension and requires re-embedding the knowledge base — a data migration, not a schema redesign. Record the model+dimension explicitly so this is unambiguous.

## RAG confidence
`0.75` is only an initial hypothesis. Tune it with ~30–50 labeled questions covering answerable, ambiguous, out-of-domain, and misleading cases.

Use:
- retrieval relevance gate
- answerability/evidence gate

Do not enable general LLM fallback during the first RAG validation because fallback can hide retrieval failures.

## Agents
### Knowledge Agent
Agency-specific Q&A using RAG + structured agency data. Never invent agency policy.

### Recruiting Agent
Reuse the deterministic screening/flow engine as the source of truth. LLM adds clarification and extraction; it does not replace deterministic rules.

### Training Agent
Training, scenarios, assessment, progress, and agency training RAG.

### Retention Agent
Later combines approved caregiver operational signals and ML risk prediction with coaching/intervention. Do not make irreversible employment decisions solely from an ML score.

### Orchestrator
Routes and coordinates agents, tools, context, state, and escalation.

## Tool Layer
Agents use controlled tools, not arbitrary database access. Examples:
- `search_agency_knowledge()`
- `get_caregiver_profile()`
- `get_services()`
- `get_training_content()`
- `create_candidate_profile()`
- `save_screening_answer()`
- `record_training_result()`
- `predict_retention_risk()`
- `create_human_escalation()`

Every tool should validate:
authentication -> agency -> role/permission -> parameters -> action -> audit

## Conversation state
Reuse existing conversation infrastructure where practical. Important state may include:
- active_agent
- current_intent
- workflow_state
- entities
- status

Do not rely only on transient LLM context.

## Audit / observability
Reuse existing `events` / `log_event()` where practical. Capture sufficient metadata for:
agent type, intent, tool, source IDs, model, latency, errors, escalation. Avoid unnecessary sensitive payload storage.

## Existing CareMuch foundation
Preserve existing:
- operational Supabase schema
- authentication
- RLS
- caregiver/client workflows
- caregiver registration
- deterministic screening flow engine
- family intake
- Edge Functions
- audit/event system

The existing Lovable MCP development tooling is not the product Tool Layer. Keep those concepts separate.

## Development rules
Before changing code:
1. Inspect existing implementation.
2. Map it to target architecture.
3. Identify reusable components.
4. Identify gaps.
5. Explain proposed changes.
6. Make the smallest safe change.
7. Avoid duplicate systems.
8. Preserve existing behavior.
9. Test affected workflows.
10. Do not implement future phases prematurely.
11. Never bypass Supabase RLS for convenience.
12. Additive evolution, not a rewrite — do not remove working functionality without justification.

## Implementation order
**Phase 0: architecture preparation — DONE.** Completed and in git history: `ai_match_score` column dropped (was always NULL), `callLLM` provider seam added, `.env`/`config.toml` cleanup + `.env` untracked, Edge Functions deployed to the dev project, demo data seeded under agency 56fbfe38, caregiver-shifts RLS gap documented in `docs/known-issues.md` (deferred, pending a product decision).

**Phase 1: FTS-first knowledge base + unified public assistant — DONE.** Built and proven with zero external AI provider (see "AI provider strategy" above for why the original Lovable-embeddings plan was superseded):
- Schema: `knowledge_documents`/`knowledge_chunks`, bilingual (`en`/`es`) via a `language` column + composite FK making chunk/document language mismatch structurally impossible, staff-only RLS, `my_agency_id()` (wraps `current_agency_id()`, adds caregiver/client fallback, then an explicit `_agency_id` override for anonymous public callers).
- Retrieval: `search_agency_knowledge()` — OR-based `tsquery` (not `plainto_tsquery`'s AND), sanitized against `to_tsquery` syntax errors, explicit agency scoping for public/anonymous access.
- A unified public assistant on an agency's own page (`/a/:slug`): a router ("How can I help you today?") to caregiver screening, family intake, or a new knowledge Q&A surface, with a persistent "Start over."
- Proven live: correct retrieval and refusal in both languages, tenant isolation, and anonymous-visitor isolation (the `_agency_id` fix was required — `my_agency_id()` alone resolves to `NULL` for a logged-out visitor).
- **The FTS ceiling is now quantified, not just predicted** (`docs/phase-1-fts-results.md`): a live false positive ("How do I set up direct deposit?" matched a Medication Reminder chunk at rank 0.0405 — an English-stemmer collision, "directly" → "direct") sits *above* the highest safe threshold (0.04, the lowest confirmed genuine-hit rank), while real paraphrases ("call-off policy" vs. "can't make it to my shift"; "how much PTO" vs. "how many hours of PTO") false-refuse below it. No single τ resolves both — proof, not prediction, that closing this gap needs semantic (embedding) retrieval, not keyword threshold tuning.
- Also fixed along the way: a `family_intake` conversation flow and a `conversation_builder` menu entry lost in a project-reference switch (restored as migrations, not live-dashboard edits, so they survive the next move), a cross-agency reassignment gap in three provisioning Edge Functions, and a single-word-name crash in `flow_session_submit_intake`.

**Phase 2: make the AI provider / HIPAA decision — NOT YET DECIDED.** This is the actual, real decision Phase 1's FTS-first approach was built to defer safely:
- Choose the provider (direct OpenAI/Google for continued PHI-free work, or Azure/Microsoft Foundry if the PHI timeline moves up) and build it behind the provider abstraction below.
- Embedding smoke test against whichever provider is chosen — inspect actual vector length, record model/version/dimension. BLOCKER until done: dimension must not be assumed.
- Swap `search_agency_knowledge()`'s ranking internals to vector similarity on the same schema/isolation foundation (no schema redesign needed — this was designed in from the start).
- Run the formal 30–50 labeled-question eval (answerable / ambiguous / unanswerable, both languages) to validate a real τ — Phase 1's 0.04 is still probe-derived, not eval-validated.
- Known deferred items to fold in here, all logged in `docs/known-issues.md`: reconciling `FamilyIntakeSurface.tsx` with `ConversationSurface.tsx` (missing dynamic-catalog question support, and a free-text field that's silently discarded on a `single_select`-with-options node — both from the single-full-name-field design that also needed a workaround for `family_contacts.last_name`), a knowledge-document management UI for agency staff, and real file-upload ingestion (Phase 1G, still gated on the HIPAA/PHI re-decision below).
- Phase 3: Orchestrator.
- Phase 4: Recruiting + Training Agents.
- Phase 5: Retention Agent + retention ML.
- Phase 6: Agent Builder.

## Architecture readiness standard
Before implementation, confirm:
- existing architecture understood
- database mapped
- RLS understood
- PHI/non-PHI boundary defined
- AI provider boundary defined (Phase 2 decision — not yet made; Phase 1 used none)
- embedding dimension not assumed
- RAG schema/guardrails defined
- tool authorization defined
- conversation state defined
- audit approach defined
- Smart Scheduling explicitly excluded

When uncertain: inspect, do not guess; reuse, do not duplicate; change incrementally, do not rewrite.