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
- Phased AI boundary: Lovable AI Gateway for the Phase 1 PHI-free prototype; Azure / Microsoft Foundry with Azure-hosted OpenAI models as the production/PHI-capable target (see "AI provider strategy")

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

## AI provider strategy (Lovable now, Azure target)
CareMuch uses a phased provider approach. These are not in conflict — they are sequenced, and the provider abstraction is what makes the transition a config + re-embed rather than a rewrite.

**Phase 1 prototype — Lovable AI Gateway (current):**
- The Phase 1 Knowledge Agent / RAG prototype uses the Lovable AI Gateway (`ai.gateway.lovable.dev`) for both chat completion and embeddings.
- This is acceptable ONLY because Phase 1 RAG is PHI-free by architecture (see "Phase 1 RAG = PHI-FREE") and uses controlled seed content, not real agency uploads.
- The existing `match-caregiver` function matches on structured, coded fields only (`client_care_needs`/`caregiver_skills` via `care_types.code`, `service_zipcodes`, `caregiver_availability`, `reliability_score`/`caregiver_performance`) via a deterministic weighted scorer — no LLM call, no Lovable dependency, and it never reads `clients.medical_conditions`, `care_requirements`, or any client identity field.
- Lovable is NOT BAA-covered. `phiAllowed` MUST be `false` for all Lovable providers, read from an explicit env var, defaulting to false. Enforced in code, not convention.

**Production target — Azure / Microsoft Foundry (not yet provisioned):**
- Azure-hosted OpenAI models are the intended production AI boundary and the PHI-capable path.
- Azure is NOT set up yet. Until it is, any task requiring a BAA-covered provider (real document ingestion, any PHI, production launch) is BLOCKED, not worked around.
- Do NOT provision Azure or migrate the AI boundary as part of Phase 1 unless explicitly approved — it front-loads procurement/BAA work that Phase 1's PHI-free content does not require.

Do NOT claim the application is HIPAA compliant because a provider offers a BAA. Legal/compliance review remains required regardless of provider. Keep Lovable as the application-development platform.

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
          -> Embeddings (Phase 1: Lovable; target: Azure)
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
- Provider is selected by env/config (`LLM_PROVIDER`, `EMBEDDING_PROVIDER`), so swapping Lovable → Azure later is a configuration change, not a code change.
- The existing `_shared/callLLM.ts` remains a backward-compatible shim over the Lovable provider so `match-caregiver` needs zero changes. New code calls the provider interface directly.
- Every provider carries an explicit `phiAllowed` flag (default false). An `assertPhiSafe(provider, context)` guard MUST be invoked — defined AND called, not just defined — in any code path that could route person-identifiable content through a provider. In Phase 1 it should never trip (RAG is PHI-free), but it must be wired in so it becomes load-bearing the moment a later phase attempts PHI.
- Lovable and Azure providers must be able to coexist during migration.

## Embedding model/dimension
Never guess the vector dimension.

Required sequence:
1. Configure the embedding endpoint (Phase 1: Lovable; target: Azure).
2. Run a real smoke test.
3. Inspect returned vector length.
4. Record model/version/dimension.
5. Only then create `vector(N)` migration and index.

Note: switching embedding provider/model later (Lovable → Azure) changes the dimension and requires re-embedding the knowledge base — a data migration, not a schema redesign. Record the model+dimension explicitly so this is unambiguous.

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

Upcoming:
- Phase 1A: compliance / data boundary (PHI-free guardrail enforced in code + schema).
- Phase 1B: AI provider foundation (Lovable providers behind the abstraction; Azure deferred until a PHI phase requires it).
- Phase 1C: embedding smoke test against the real (Lovable) endpoint — inspect actual vector length, record model/version/dimension. BLOCKER until done: dimension must not be assumed.
- Phase 1D: minimal seeded RAG (`knowledge_documents`, `knowledge_chunks`, pgvector, `vector(N)` with N from 1C).
- Phase 1E: RAG evaluation (30–50 labeled questions; tune the gate empirically).
- Phase 1F: Knowledge Agent (retrieval → evidence gate → grounded answer OR refuse; NO general-LLM fallback during first validation).
- Phase 1G: real document ingestion — GATED on the HIPAA/PHI re-decision above.
- Phase 2: Orchestrator.
- Phase 3: Recruiting + Training Agents.
- Phase 4: Retention Agent + retention ML.
- Phase 5: Agent Builder.

## Architecture readiness standard
Before implementation, confirm:
- existing architecture understood
- database mapped
- RLS understood
- PHI/non-PHI boundary defined
- AI provider boundary defined (Lovable now / Azure target)
- embedding dimension not assumed
- RAG schema/guardrails defined
- tool authorization defined
- conversation state defined
- audit approach defined
- Smart Scheduling explicitly excluded

When uncertain: inspect, do not guess; reuse, do not duplicate; change incrementally, do not rewrite.