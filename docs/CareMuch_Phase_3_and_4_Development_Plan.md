# CareMuch — Phase 3 & Phase 4 Development Plan

## Overall Roadmap

### Phase 2 — Complete
Semantic RAG mechanism proven:
- Embeddings
- pgvector + HNSW
- EmbeddingProvider
- assertPhiSafe()
- search-knowledge Edge Function (Option B)
- Semantic retrieval
- τ = 0.40 provisional relevance floor
- Evaluation proved Gate 3 is required

### Phase 3 — Production Knowledge Foundation
- Real document ingestion
- PHI/PII protection
- Public corpus
- Caregiver corpus
- Provider / BAA decision
- Real agency content
- Re-evaluate RAG

### Phase 4 — Caregiver Knowledge Coach
- Authentication
- Gate 1 authorization
- Caregiver knowledge retrieval
- Gate 2 relevance
- Gate 3 answerability
- Grounded responses
- Refusal behavior
- Conversation context

---

# Phase 3 — Production Knowledge Foundation

## Objective

Move CareMuch from:

> “We proved semantic RAG works.”

to:

> “A real agency can safely provide knowledge to CareMuch, and CareMuch can create the correct authorized knowledge corpus.”

This phase should not yet attempt to build the full caregiver AI coach.

## Tranche 3A — Production Knowledge Model

### Goal
Establish the data model for agency knowledge before building the upload pipeline.

Determine how CareMuch represents:
- agencies
- knowledge documents
- chunks
- embeddings
- document metadata
- languages
- source documents
- ingestion status

Define the minimum production model for:

```text
Agency
│
├── PUBLIC knowledge corpus
│
└── CAREGIVER knowledge corpus
```

### Critical architectural decision

Do not introduce per-chunk authorization tags unless the architecture requires them.

The current decision is:

> Corpus/surface separation, not per-chunk scope authorization.

The same RAG infrastructure can serve separate corpora/surfaces.

### Acceptance Criteria
- Existing Phase 2 retrieval remains functional.
- Agency isolation remains intact.
- PUBLIC and CAREGIVER surfaces are clearly distinguished.
- No unnecessary authorization mechanism is introduced.

### Do NOT build yet
- LLM answerability
- agent memory
- multi-agent orchestration
- autonomous actions

---

## Tranche 3B — Multi-Format Document Ingestion

### Goal
Allow agencies to provide real knowledge documents.

Initial formats:
- PDF
- DOCX
- TXT

Pipeline:

```text
Upload
  ↓
Validate file
  ↓
Extract text
  ↓
Normalize
  ↓
Chunk
  ↓
Validate
  ↓
Assign corpus/surface
  ↓
Embed
  ↓
Store chunks + vectors
```

Uploading a document must not automatically make it public.

### Acceptance Criteria

A test agency can upload a supported document and produce:

```text
document
   ↓
clean text
   ↓
chunks
   ↓
1536-dimensional embeddings
   ↓
correct corpus
   ↓
retrievable knowledge
```

---

## Tranche 3C — PHI/PII Guard

### Goal
Create the safety boundary between uploaded agency knowledge and sensitive information.

Pipeline:

```text
Document
   ↓
Extraction
   ↓
PHI/PII inspection
   ↓
Safe?
   ├── YES → Continue
   └── NO  → Block / quarantine
```

Reuse Phase 2 infrastructure:

```text
getEmbeddingProvider()
assertPhiSafe()
```

The guard must cover uploaded content, not merely the embedding request.

Define behavior for:
- detected PHI
- detected PII
- uncertain detection
- processing failure

### Acceptance Criteria
A document containing prohibited sensitive information cannot silently enter the RAG corpus.

---

## Tranche 3D — Provider / BAA Production Gate

### Goal
Resolve the provider architecture before production use of potentially sensitive agency content.

Current Phase 2 position:

```text
OpenAI-direct
phiAllowed: false

Azure
deferred
```

Determine:
- production provider
- BAA status
- allowed data types
- embedding provider
- LLM provider
- PHI policy
- environment configuration
- failure behavior

Do not simply change `phiAllowed: false` to `true` because the pipeline needs it.

### Acceptance Criteria
There is a documented production provider decision and code configuration reflects that decision.

---

## Tranche 3E — Public Corpus

Create the first real public agency knowledge corpus.

```text
PUBLIC
│
├── Agency information
├── Home-care services
├── Service areas
├── Caregiver careers
├── Qualifications
├── Recruiting
├── Application process
└── Public FAQs
```

**PUBLIC does not mean marketing-only.**

It means information intentionally available to anonymous users.

---

## Tranche 3F — Public `/a/:slug` RAG

```text
Anonymous visitor
       ↓
/a/:agencySlug
       ↓
Public Knowledge Agent
       ↓
PUBLIC corpus only
       ↓
Semantic retrieval
       ↓
τ relevance gate
       ↓
Answer / refusal
```

Examples:
- “How do I apply to become a caregiver?” → answer if contained in public knowledge.
- “What services do you provide?” → answer if contained in public knowledge.
- “How much PTO do caregivers get?” → do not retrieve private caregiver policy.

If the answer is not in public knowledge:

> **REFUSE.**

---

## Tranche 3G — Re-Evaluate Semantic RAG Against Real Content

Phase 2:

```text
placeholder corpus
       ↓
semantic evaluation
       ↓
τ = 0.40 provisional
```

Phase 3:

```text
REAL PUBLIC CORPUS
       ↓
same evaluation harness
       ↓
new measurements
       ↓
re-evaluate τ
```

The existing 0.40 is not automatically a permanent production constant.

Measure:
- correct document rank
- answerable retrieval
- OOD retrieval
- misleading retrieval
- multilingual behavior
- score distributions
- false retrievals
- τ sensitivity

### Acceptance Criteria
Evaluation is rerun against real public content and τ is retained or recalibrated based on evidence.

---

# Phase 3 Exit Criteria

Phase 3 is complete when:

### Content
- Real agency documents can be uploaded.
- PDF/DOCX/TXT ingestion works.
- Documents are chunked and embedded.

### Safety
- PHI/PII guard exists.
- Provider/BAA decision is resolved for the production path.
- Sensitive content cannot silently enter the wrong pipeline.

### Scope

```text
PUBLIC corpus
    ≠
CAREGIVER corpus
```

The public agent only sees PUBLIC content.

### RAG
- Real public content retrieves correctly.
- Evaluation has been rerun.
- τ has been recalibrated if necessary.

At this point CareMuch has a production-ready knowledge foundation.

---

# Phase 4 — Caregiver Knowledge Coach

Now build the private caregiver experience.

## Tranche 4A — Caregiver Authentication & Agency Context

```text
Caregiver
    ↓
authenticated
    ↓
belongs to Agency A
    ↓
Caregiver Knowledge Coach
```

The system must know:

```text
user
agency
role
authorized surface
```

This establishes Gate 1.

### Acceptance Criteria
A caregiver from Agency A cannot retrieve Agency B's caregiver knowledge.

---

## Tranche 4B — Caregiver Corpus Retrieval

Connect the authenticated caregiver experience to the CAREGIVER corpus.

Examples:
- “What is our call-off procedure?”
- “What is the attendance policy?”
- “What do I do if I am sick?”
- “What training do I need?”

Reuse the Phase 2 semantic retrieval architecture.

---

## Tranche 4C — Gate 1 Authorization

Authorization happens before private knowledge can become a retrieval candidate.

```text
                    Request
                       ↓
                 Who is user?
                       ↓
                ┌──────┴──────┐
                ▼             ▼
           Anonymous       Caregiver
                │             │
                ▼             ▼
             PUBLIC       CAREGIVER
```

Gate 1 is separate from τ.

---

## Tranche 4D — Gate 3 Answerability

```text
Question
   ↓
Gate 1 — authorization
   ↓
Gate 2 — semantic retrieval + τ
   ↓
candidate knowledge
   ↓
Gate 3 — LLM answerability
   ↓
 ┌─────────────┴────────────┐
 ▼                          ▼
ANSWERABLE             NOT ANSWERABLE
 ▼                          ▼
Grounded answer             REFUSE
```

The LLM determines whether the authorized retrieved content actually answers the question.

This solves the limitation proven by the Phase 2 evaluation.

---

## Tranche 4E — Grounded Answer Generation

```text
Question
+
Authorized retrieved knowledge
        ↓
LLM
        ↓
Grounded answer
```

The LLM must not introduce unsupported agency policy information.

Future responses can include source/citation references such as:

> “According to the agency’s Attendance Policy…”

---

## Tranche 4F — Refusal Behavior

### Case 1 — Not authorized

Private information + anonymous user → **REFUSE**

### Case 2 — No relevant knowledge

Authorized user + no sufficiently relevant knowledge → **REFUSE**

### Case 3 — Relevant but does not answer

Retrieved policy + Gate 3 says not answerable → **REFUSE**

### Case 4 — Answerable

Authorized + relevant + answerable → **ANSWER**

Core rule:

> **CareMuch never fills a knowledge gap with an invented agency policy.**

---

## Tranche 4G — Conversation Context

Only after single-turn Q&A works reliably.

Example:

```text
Caregiver:
“What is the call-off policy?”

Bot:
[answer]

Caregiver:
“What if I'm sick?”

Bot:
[understands relationship to call-off policy]
```

Add:
- conversation state
- recent question context
- entities
- current topic
- caregiver context where appropriate

Keep conversation context separate from retrieval authorization.

---

## Tranche 4H — Caregiver Agent Actions

Eventually:

```text
Caregiver
   ↓
Knowledge Coach
   │
   ├── Answer policy question
   ├── Explain procedure
   ├── Ask clarification
   ├── Refuse unsupported question
   │
   └── Controlled CareMuch action
```

Potential future actions:
- training status
- training enrollment
- HR request
- availability update
- time-off request
- contact supervisor
- other CareMuch workflows

Build these only after knowledge retrieval and authorization are reliable.

---

# What NOT to Build in Phase 3

Do not build:
- multi-agent orchestration
- autonomous scheduling
- caregiver retention agent
- complex agent memory
- broad workflow automation
- public cross-agency job marketplace
- unrestricted chatbot
- LLM answerability before the real corpus exists

Phase 3 is fundamentally:

> **Safe knowledge entering CareMuch.**

---

# What NOT to Build Early in Phase 4

Do not immediately build:
- complicated long-term memory
- autonomous actions
- multiple specialized agents
- scheduling decisions
- predictive caregiver models

First prove:

```text
Authorization
     +
Retrieval
     +
Answerability
     +
Grounding
     +
Refusal
```

---

# Target Architecture at the End of Phase 4

```text
                         CAREMUCH
                            │
                 ┌──────────┴──────────┐
                 │                     │
           PUBLIC SURFACE        CAREGIVER SURFACE
                 │                     │
          /a/:agencySlug          Authenticated
                 │                     │
            Anonymous               Caregiver
                 │                     │
          PUBLIC CORPUS          CAREGIVER CORPUS
                 │                     │
                 └──────────┬──────────┘
                            │
                     Shared RAG Engine
                            │
                 ┌──────────┴──────────┐
                 │                     │
              GATE 2                GATE 3
           Retrieval/τ          Answerability
                 │                     │
                 └──────────┬──────────┘
                            ↓
                    Grounded Response
                            │
                       OR REFUSE
```

**Gate 1 sits before retrieval**, determining which surface/corpus the user is allowed to access.

---

# Recommended Development Order

| Phase | Tranche | Main Outcome |
|---|---|---|
| **3** | 3A | Production knowledge model |
| | 3B | PDF/DOCX/TXT ingestion |
| | 3C | PHI/PII guard |
| | 3D | Provider/BAA production decision |
| | 3E | Real public corpus |
| | 3F | Public `/a/:slug` RAG |
| | 3G | Real-corpus evaluation + τ recalibration |
| **4** | 4A | Caregiver authentication/context |
| | 4B | Caregiver corpus retrieval |
| | 4C | Gate 1 authorization |
| | 4D | Gate 3 LLM answerability |
| | 4E | Grounded answer generation |
| | 4F | Refusal behavior |
| | 4G | Conversation context |
| | 4H | Controlled agent actions |

## Strategic Progression

**Phase 2:** Prove retrieval. ✅

**Phase 3:** Make knowledge safe, real, and correctly scoped.

**Phase 4:** Make the knowledge useful to authenticated caregivers with authorization + answerability.

**Phase 5:** Turn the Knowledge Coach into a broader caregiver/training/retention agent.

The guiding principle is:

> **Do not add an LLM just because we can. Introduce each capability only after the preceding layer has been empirically validated and secured.**
