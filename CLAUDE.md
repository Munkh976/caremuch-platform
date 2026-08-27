# CareMuch — Project Guide for Claude Code

## What this project is
CareMuch is a multi-tenant AI workforce platform for home-care agencies — NOT
primarily a chatbot. The conversational UI is one interface over specialized
capabilities (recruiting, training, knowledge, retention, scheduling) coordinated
by an orchestrator. The target architecture and build instructions live in:
- docs/caremuch-architecture.md
- docs/caremuch-dev-instructions.md

Read both before any architectural work. They are the source of truth for the
target state; the code below is the current state.

## Stack
- Frontend: React + TypeScript (Vite/Lovable), React Router, shadcn/ui + Tailwind, Zod
- Backend: Supabase only — PostgREST, Postgres RPCs, Edge Functions. No separate API server.
- Data access: browser calls Supabase directly (supabase.from / .rpc / .functions.invoke)
- Auth: Supabase Auth (email/password); roles via the get_user_role RPC
- Tenancy: agency_id is the isolation boundary; virtual_office is a sub-concept of agency

## Current reality (do not assume the target architecture exists yet)
- The "AI screening" chat is a DETERMINISTIC scripted flow engine
  (conversation_flows → flow_nodes → flow_options, weighted ScoreResult, versioned
  draft/publish). There is NO LLM in it.
- No LLM, RAG, embeddings/vector store, ML models, or agent/orchestrator layer exist yet.
- ai_match_score on shifts is a stored heuristic value; confirm where it's computed
  before treating it as ML.
- Edge Functions are admin/provisioning/data utilities only, not AI.

## Hard rules
1. Read existing code before changing it. Verify against real files — do not infer
   what you can read (migrations, RLS, Edge Function source).
2. This is additive evolution, NOT a rewrite. Preserve working features unless a
   change is explicitly required and justified.
3. Do not create duplicate tables, functions, or components. Extend what exists
   (e.g. extend conversation_sessions for agent state; don't make a parallel table).
4. Never bypass Supabase RLS. Tenant isolation must be enforced at the data/tool
   layer, never by an LLM prompt alone. Every agency-owned row is scoped by agency_id.
5. Keep it modular: LLM provider calls abstracted, RAG retrieval modular, ML
   independent of conversational logic, scheduling logic independent of the LLM.
   The LLM must never be the source of truth for agency policy or structured data.
6. Reuse the Edge Function pattern for the Tool Layer: every tool validates
   auth → agency → role → params before acting, and returns a controlled result.
7. Log important agent/tool events (agent_events) once agent work begins.
8. Prefer small, testable changes over large ones. Propose the smallest change that
   meets the requirement before implementing.

## Before you edit
For any assessment or investigation task, treat it as READ-ONLY unless I explicitly
ask you to change files. When you do change things, explain the smallest viable
change first, then implement incrementally.

## Priorities, in order
simplicity → reliability → security → maintainability → scalability