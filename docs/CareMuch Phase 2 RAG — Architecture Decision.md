# CareMuch Phase 2 RAG — Architecture Decision
## Public vs. Private Knowledge Access and `search-knowledge` Boundary

### Decision

CareMuch will use **Option B: an Edge Function owns the complete knowledge-retrieval pipeline**.

`KnowledgeQaSurface.tsx` will call a `search-knowledge` Edge Function rather than calling the vector-search RPC directly.

The RPC remains responsible for **database/vector similarity search**. The Edge Function becomes the secure application boundary responsible for query embedding, access scope, PHI safety, retrieval filtering, and the confidence/answerability pipeline.

---

## 1. Public `/a/:agencySlug` Does NOT Mean "Marketing Only"

The public agency page is intentionally accessible to anonymous users.

Anonymous users may be:

- prospective caregivers
- job applicants
- family/client prospects
- general visitors

Therefore, the public Knowledge Agent may answer questions from the agency's **explicitly public knowledge scope**, including:

- home-care services
- service areas
- agency introduction
- caregiver career opportunities
- caregiver qualifications
- recruiting requirements
- application process
- public training/career information
- other agency information explicitly designated as public

Example:

> "What qualifications do I need to become a caregiver?"

→ **Answer if contained in public agency knowledge.**

Example:

> "What home-care services does this agency provide?"

→ **Answer if contained in public agency knowledge.**

However:

> "How many PTO hours do caregivers receive?"

If PTO is private caregiver knowledge:

→ **MUST REFUSE for an anonymous visitor.**

Anonymous status does not mean "marketing only." It means the user is restricted to the **PUBLIC knowledge scope**.

---

## 2. Authenticated Caregiver Gets a Different Knowledge Scope

After registration/hiring and authentication, the caregiver may access the agency's authorized private caregiver knowledge, such as:

- PTO policies
- call-off procedures
- attendance rules
- caregiver procedures
- training/SOPs
- medication-reminder procedures
- agency rules and regulations
- other caregiver-authorized policies

Therefore:

```text
Anonymous visitor
    → PUBLIC knowledge

Authenticated caregiver
    → PUBLIC + CAREGIVER knowledge

Agency staff/admin
    → PUBLIC + their authorized internal knowledge
```

The exact role/scope must be enforced server-side, not by the frontend.

---

## 3. Agency Isolation and Knowledge Access Are Separate Controls

These are two different security questions:

**Agency isolation:**

> Which agency's knowledge may this request access?

Example:

```text
agency_id = Agency A
```

The request must NEVER retrieve Agency B's knowledge.

**Knowledge authorization:**

> Which knowledge within Agency A may this user access?

Example:

```text
Anonymous → PUBLIC
Caregiver → PUBLIC + CAREGIVER
Admin → authorized ADMIN scopes
```

Both controls must be enforced server-side.

Do not rely on `KnowledgeQaSurface.tsx` to enforce these security boundaries.

---

## 4. Recommended Retrieval Architecture

```text
KnowledgeQaSurface.tsx
        │
        │ question + agency context
        ▼
search-knowledge Edge Function
        │
        ├── identify authentication/role
        ├── determine allowed knowledge scope
        ├── validate agency isolation
        ├── assertPhiSafe()
        ├── getEmbeddingProvider()
        ├── embed user query
        │
        ▼
Postgres / pgvector RPC
        │
        ├── agency isolation
        ├── permitted knowledge scope
        └── vector similarity ranking
        │
        ▼
Semantic relevance / τ gate
        │
        ▼
Future: LLM Answerability Gate
        │
        ├── ANSWERABLE → grounded answer
        └── NOT ANSWERABLE → REFUSE
```

---

## 5. τ Is NOT the Final Answerability Gate

Phase 2 evaluation demonstrated that semantic retrieval ranking is strong, but a single cosine-similarity threshold cannot reliably distinguish all answerable questions from misleading/unanswerable questions.

Therefore:

**τ is only a retrieval/relevance gate.**

It should reject obviously weak candidates but must NOT be treated as proof that an answer exists.

The future Knowledge Agent should use an **LLM answerability gate**:

> "Does the retrieved agency knowledge actually answer the user's question?"

If not:

**MUST REFUSE.**

This is especially important for semantically adjacent questions such as PTO vs. call-off/pay questions.

---

## 6. Public Knowledge Must Be Explicitly Classified

Do not infer that a document is public simply because the user is anonymous.

Agency knowledge should have an explicit access classification, conceptually:

```text
PUBLIC
CAREGIVER
STAFF / ADMIN
```

Only documents/chunks within the caller's authorized scope may participate in retrieval.

This prevents a private document from becoming visible merely because its embedding is semantically similar to an anonymous user's question.

---

## Final Implementation Principle

CareMuch should treat the Edge Function as the **secure Knowledge Retrieval Boundary**:

> **Authentication/role → agency isolation → knowledge authorization → PHI safety → query embedding → vector retrieval → τ relevance gate → future LLM answerability gate → grounded answer/refusal.**

The frontend should remain a presentation/client layer and should not own security, embedding credentials, knowledge authorization, or answerability decisions.

Do not implement "anonymous = marketing only."

Implement:

> **anonymous = PUBLIC knowledge scope**

and:

> **authenticated caregiver = expanded CAREGIVER knowledge scope according to authorization.**

If the answer is not contained in the user's authorized knowledge scope, the Knowledge Agent **MUST REFUSE rather than infer, invent, or retrieve unauthorized knowledge.**