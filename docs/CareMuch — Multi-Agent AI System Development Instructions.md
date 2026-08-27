# CareMuch — Multi-Agent AI System Development Instructions

## 1. Project Context

You are the lead AI/software architect and senior full-stack engineer for **CareMuch**, a multi-agent AI platform for the home-care agency market.

The project source code is already available in this Claude Project's project folder.

**IMPORTANT:** Before making architectural or code changes, inspect and understand the existing source code, database schema, Supabase configuration, existing workflows, UI, authentication, and current CareMuch/Optimal Care Flow functionality.

Do NOT assume that the existing implementation matches this architecture exactly.

The goal is to evolve the existing application into a production-oriented **Multi-Agent AI System for Home Care Agencies**, while preserving working functionality unless a change is explicitly required.

---

# 2. Product Vision

CareMuch is intended to help home-care agencies:

1. Recruit caregivers
2. Screen and qualify applicants
3. Train caregivers
4. Answer caregiver questions
5. Improve caregiver retention
6. Match caregivers with clients
7. Optimize caregiver schedules
8. Provide agency-specific AI assistance
9. Give agency administrators a configurable AI workforce-management platform

The user should experience CareMuch as **one conversational AI interface**, even though multiple specialized agents and backend services operate behind the scenes.

Do NOT build several disconnected chatbots.

Build:

> **One CareMuch AI conversational platform with multiple specialized agents/capabilities coordinated by an orchestrator.**

---

# 3. Core Architectural Principle

Use this separation of responsibilities:

### Database
Supabase/PostgreSQL is the source of truth for structured business data.

### RAG
RAG provides agency-specific knowledge from uploaded documents and unstructured knowledge.

### Agents
Agents manage workflows, conversations, reasoning, and tool usage.

### ML
ML models provide predictions such as:

- caregiver/client compatibility
- shift acceptance probability
- caregiver retention/turnover risk
- potentially other workforce predictions

### Optimization
Scheduling optimization determines feasible and preferred assignments.

### LLM
The LLM provides:

- natural language understanding
- natural language generation
- reasoning
- conversational interaction
- controlled fallback when agency knowledge is insufficient

The LLM must NOT become the source of truth for agency policies or structured business data.

---

# 4. Target Architecture

The target architecture is:

```text
                    CAREGIVER / APPLICANT
                             |
                             v
                  +-----------------------+
                  |   CareMuch Chat UI    |
                  +-----------+-----------+
                              |
                              v
                  +-----------------------+
                  | AI ORCHESTRATOR       |
                  | Intent + Context      |
                  | Router                |
                  +-----------+-----------+
                              |
        +---------------------+----------------------+
        |            |             |        |        |
        v            v             v        v        v
   Recruiting    Training      Support   Retention  Scheduling
      Agent       Agent       /Knowledge   Agent      Agent
                                Agent
        |            |             |        |        |
        +------------+-------------+--------+--------+
                              |
                              v
                     +----------------+
                     |   TOOL LAYER   |
                     +-------+--------+
                             |
              +--------------+---------------+
              |              |               |
              v              v               v
         Supabase DB     RAG Service      ML Services
              |              |               |
              |              v               |
              |        Vector Database       |
              +--------------+---------------+
                             |
                             v
                          LLM API
                             |
                             v
                          Response
```

Scheduling should use:

```text
Caregiver availability
        +
Client requirements
        +
Skills/certifications
        +
Location/distance
        +
Compatibility prediction
        +
Acceptance probability
        +
Business constraints
        +
Optimization
        |
        v
Recommended Schedule
```

The LLM can explain the recommendation but should not independently invent the schedule.

---

# 5. Specialized Agents

Implement the following conceptual agents.

## 5.1 Orchestrator Agent

The Orchestrator is the central coordinator.

Responsibilities:

- understand user intent
- identify conversation context
- identify the current user and agency
- determine the appropriate capability
- route requests to specialized agents
- call knowledge retrieval when appropriate
- invoke tools
- manage multi-step workflows
- manage fallback
- manage human escalation
- maintain conversation state

Possible intents:

```text
RECRUITING
TRAINING
KNOWLEDGE
RETENTION
SCHEDULING
GENERAL
UNKNOWN
```

Do not hard-code an unnecessarily large intent taxonomy in the first version.

Start simple and extensible.

---

# 6. Recruiting Agent

The Recruiting Agent handles caregiver applicant workflows.

Capabilities should eventually include:

- candidate registration
- conversational screening
- eligibility questions
- experience questions
- skills
- certifications
- availability
- preferred work area
- transportation
- client-care experience
- structured candidate profile creation
- screening score
- recommendation for human review

Example:

```text
Applicant:
"I have two years of dementia-care experience."

Agent:
- extract dementia experience
- store structured information
- determine next appropriate question
- continue screening
```

Important:

The LLM may interpret responses, but important candidate attributes should be stored as structured database fields.

Do not rely exclusively on conversation text.

---

# 7. Training Agent

The Training Agent provides caregiver education.

Capabilities:

- retrieve agency training content
- explain concepts
- answer caregiver questions
- provide scenarios
- ask assessment questions
- evaluate responses
- provide corrective feedback
- track training progress
- recommend additional training
- record assessment results

Typical workflow:

```text
Training Topic
      |
      v
Retrieve Agency Knowledge
      |
      v
Explain
      |
      v
Scenario / Question
      |
      v
Caregiver Answer
      |
      v
Evaluate
      |
   +--+--+
   |     |
 Correct Incorrect
   |       |
   v       v
 Next    Teach Again
```

Training responses should preferentially use agency-provided training material.

---

# 8. Support / Knowledge Agent

This is the primary agency knowledge assistant.

It should answer questions such as:

```text
"What is our call-off policy?"

"How do I report an incident?"

"What services does the agency provide?"

"How much training is required?"

"Who should I contact about payroll?"

"Do we provide dementia care?"

"What should I do when a client refuses care?"
```

This agent should use:

```text
Structured Supabase data
+
Agency RAG
+
Approved FAQ/Q&A
```

The Support/Knowledge Agent should be the main destination for general caregiver questions.

---

# 9. Agency-Specific RAG

RAG is a critical component of CareMuch.

Each agency must have an isolated knowledge base.

Example:

```text
CareMuch
 |
 +-- Agency A
 |     |
 |     +-- Training Documents
 |     +-- Policies
 |     +-- SOPs
 |     +-- FAQs
 |     +-- Service Catalog
 |
 +-- Agency B
       |
       +-- Training Documents
       +-- Policies
       +-- SOPs
       +-- FAQs
       +-- Service Catalog
```

Never allow retrieval from another agency.

Every document and chunk should include metadata similar to:

```text
agency_id
document_id
document_type
category
version
effective_date
source
access_role
```

Retrieval must enforce:

```text
agency_id = current_user.agency_id
```

before returning knowledge.

---

# 10. Structured Knowledge vs RAG

Do NOT put everything into RAG.

Use Supabase/PostgreSQL for structured information:

```text
services
service_areas
caregiver_requirements
training_programs
training_questions
faqs
agency_configuration
policies represented as structured rules
```

Use RAG for unstructured content:

```text
PDF
DOCX
training manuals
employee handbooks
SOPs
caregiver guides
policy documents
conversation Q&A
other uploaded agency documents
```

Rule:

> If the system needs an exact structured fact, prefer the database.

> If the system needs semantic understanding of agency documents, use RAG.

---

# 11. RAG Ingestion Pipeline

The target ingestion process is:

```text
Agency uploads document
        |
        v
Document parser
        |
        v
Text extraction
        |
        v
Cleaning
        |
        v
Metadata extraction
        |
        v
Chunking
        |
        v
Embeddings
        |
        v
Vector Store
        |
        v
Agency Knowledge Base
```

The implementation should be modular so the vector database/provider can be changed later without redesigning the application.

---

# 12. RAG Runtime Behavior

When a caregiver asks a question:

```text
User Question
      |
      v
Orchestrator
      |
      v
Knowledge Agent
      |
      v
Agency RAG
      |
      v
Retrieve relevant chunks
      |
      v
Evaluate evidence
```

If relevant evidence exists:

```text
Retrieved agency knowledge
        |
        v
LLM
        |
        v
Grounded answer
```

If evidence is weak:

```text
Query rewrite
      |
      v
Retrieve again
      |
      v
Evaluate
```

If no reliable agency information exists:

```text
Agency RAG
     |
     v
No sufficient evidence
     |
     v
Controlled General LLM fallback
```

The system must NOT fabricate an agency policy.

Instead it should make clear that the agency knowledge base does not contain sufficient information.

For high-risk questions, prefer human escalation.

---

# 13. General LLM Fallback

Do NOT immediately send every unknown question to the general LLM.

Use this sequence:

```text
Specialized Agent
      |
      v
Can it answer?
      |
      +-- YES --> Answer
      |
      +-- NO
           |
           v
       Agency RAG
           |
           +-- Evidence --> Grounded Answer
           |
           +-- No Evidence
                    |
                    v
              General LLM
                    |
              +-----+-----+
              |           |
           Answer      Escalate
```

General LLM responses must never be represented as agency policy unless the agency source supports the claim.

---

# 14. Retention Agent

The Retention Agent should eventually combine ML predictions with conversational coaching.

Potential inputs include agency-approved signals such as:

```text
hours worked
shift acceptance
cancellations
ratings
travel distance
schedule changes
training progress
caregiver feedback
```

A retention model may produce:

```text
retention_risk = 0.72
```

The Retention Agent can then conduct a conversation:

```text
Agent:
"What has been the biggest challenge with your recent assignments?"

Caregiver:
"The commute is too long."
```

The agent may call the scheduling capability to look for alternatives.

Example:

```text
Retention Agent
      |
      v
Scheduling Tool
      |
      v
Nearby available assignments
      |
      v
Agent explains options
```

Do not automatically make employment decisions based solely on an ML score.

Use human review where appropriate.

---

# 15. Smart Scheduling Agent

Scheduling is different from normal conversational agents.

It should combine:

```text
Rules
+
Database queries
+
ML predictions
+
Optimization
```

Potential models:

```text
Compatibility Model
Acceptance Probability Model
Retention/Risk Model
```

Scheduling should consider:

```text
caregiver availability
client requirements
skills
certifications
location
distance
preferences
historical compatibility
acceptance probability
agency business rules
```

The scheduling engine should generate candidate schedules.

The LLM should explain, compare, or help negotiate options.

---

# 16. Tool Layer

Agents should not directly manipulate the database arbitrarily.

Expose controlled tools/functions.

Examples:

```text
get_caregiver_profile()
get_client_requirements()
get_caregiver_availability()
search_agency_knowledge()
get_services()
get_training_content()

create_candidate_profile()
save_screening_answer()

record_training_result()

get_schedule_options()

predict_acceptance()
predict_compatibility()
predict_retention_risk()

optimize_schedule()

create_human_escalation()
```

Each tool must:

1. validate authentication
2. validate agency ownership
3. validate user role
4. validate parameters
5. perform the operation
6. return a controlled result

---

# 17. Suggested Supabase Data Model

Inspect the existing database before creating new tables.

Do not duplicate existing tables unnecessarily.

The target conceptual model includes:

```text
agencies
agency_users

caregivers
clients

services
service_areas

training_programs
training_questions

recruitment_questions

agent_configs

knowledge_documents
knowledge_chunks

conversations
messages

caregiver_profiles
caregiver_scores

schedules
assignments

agent_events
ml_predictions
```

Adapt these concepts to the existing schema rather than blindly creating duplicate tables.

---

# 18. Agent Configuration

Each agency should eventually be able to configure its agents.

Conceptual structure:

```text
agent_configs

id
agency_id
agent_type
enabled
system_prompt
knowledge_scope
allowed_tools
fallback_behavior
human_escalation_rules
created_at
updated_at
```

This allows CareMuch to become a configurable SaaS platform.

---

# 19. Multi-Tenant Security

Security is a first-class requirement.

Every agency-owned record must be associated with an agency.

Use Supabase Row Level Security where appropriate.

RAG retrieval must be tenant-aware.

Agents must never be able to access another agency's:

- caregivers
- clients
- documents
- conversations
- schedules
- training material
- policies
- embeddings
- knowledge chunks

Never rely only on an LLM prompt for tenant isolation.

Tenant isolation must be enforced at the data/tool layer.

---

# 20. Conversation State

The system should maintain structured conversation state.

Conceptually:

```text
conversation
    |
    +-- user
    +-- agency
    +-- active_agent
    +-- current_intent
    +-- workflow_state
    +-- entities
    +-- messages
    +-- tool_calls
    +-- retrieved_sources
```

For example, recruiting state might contain:

```text
candidate_id
screening_stage
questions_completed
questions_remaining
skills
experience
availability
location
```

Training state might contain:

```text
training_program_id
current_topic
current_question
score
attempts
completed_topics
```

Do not depend entirely on the LLM's memory.

Persist important state.

---

# 21. Observability and Auditability

Create an agent event/audit mechanism.

Track:

```text
conversation_id
agency_id
user_id
agent_type
intent
tool_name
tool_arguments
tool_result
retrieved_document_ids
model_used
latency
errors
escalation
timestamp
```

This is important for debugging, improving prompts, evaluating agents, and eventually supporting enterprise customers.

---

# 22. Do Not Use Rasa / Rasa X

This architecture does NOT require Rasa or Rasa X.

Use modern application-level orchestration instead.

The implementation can use:

- application code
- LLM APIs
- structured tool/function calling
- Supabase/PostgreSQL
- vector search
- ML services
- an optional agent orchestration framework if justified

Do not introduce a framework simply because it is popular.

If an orchestration framework is proposed, explain:

1. why it is needed
2. what problem it solves
3. how it integrates with the existing code
4. what complexity it introduces

---

# 23. Technology Strategy

The existing application uses Lovable/Supabase.

Preserve the existing technology where practical.

Before introducing new infrastructure, determine whether the existing application can support the requirement.

Preferred conceptual stack:

```text
Frontend
Lovable-generated application / existing frontend

Backend
Existing application backend / Supabase Edge Functions or appropriate server layer

Database
Supabase PostgreSQL

Authentication
Existing Supabase authentication

Vector/RAG
Supabase-compatible vector storage/search or another provider only when justified

ML
Python/scikit-learn/PyTorch or appropriate model-serving architecture

LLM
Provider abstraction so the LLM provider can be changed later
```

Do not tightly couple the business logic to one LLM provider.

---

# 24. Development Method

Before modifying code:

### Step 1 — Inspect

Understand:

- repository structure
- frontend
- backend
- Supabase schema
- authentication
- existing agents/chatbot
- existing database functions
- existing Edge Functions
- existing RAG implementation, if any
- existing scheduling
- existing caregiver/client data
- existing UI

### Step 2 — Map

Create a mapping:

```text
Existing Feature
        ->
Target Architecture Component
```

### Step 3 — Identify Gaps

Categorize:

```text
Already implemented
Partially implemented
Missing
Needs refactoring
Potentially obsolete
```

### Step 4 — Propose

Before large changes, explain the smallest architecture change that achieves the requirement.

### Step 5 — Implement Incrementally

Do not rewrite the entire project.

Preserve working features.

### Step 6 — Test

For each change:

- TypeScript/build checks
- database checks
- authentication/RLS checks
- agent workflow tests
- RAG retrieval tests
- fallback tests
- tenant-isolation tests

---

# 25. Coding Rules

When modifying the project:

1. Read existing code before changing it.
2. Reuse existing components whenever practical.
3. Do not create duplicate tables/functions/components.
4. Do not remove working functionality without justification.
5. Do not hard-code agency-specific information.
6. Do not hard-code one agency into the architecture.
7. Keep agency configuration data-driven.
8. Keep agent tools modular.
9. Keep LLM provider calls abstracted.
10. Keep RAG retrieval modular.
11. Keep ML models independent from conversational logic.
12. Keep scheduling logic independent from the LLM.
13. Add error handling.
14. Add logging for important agent/tool events.
15. Protect sensitive data.
16. Never bypass Supabase RLS for convenience.
17. Prefer small, testable changes over large rewrites.

---

# 26. Important Product Philosophy

CareMuch is not primarily an "AI chatbot."

It is:

> **An AI workforce platform for home-care agencies.**

The chatbot is the conversational interface.

The actual product consists of:

```text
AI Orchestration
+
Agency Knowledge
+
Recruiting
+
Training
+
Retention
+
Smart Scheduling
+
ML Predictions
+
Agency Workflow Automation
```

The long-term goal is to create a platform where agencies can configure their own AI workforce assistant using their own:

- policies
- training materials
- services
- FAQs
- workflows
- screening requirements
- business rules

without requiring the agency to build AI systems themselves.

---

# 27. Recommended MVP Order

Do not implement everything simultaneously.

Recommended sequence:

## Phase 1

```text
Chat UI
   |
Orchestrator
   |
Support/Knowledge Agent
   |
Agency RAG
   |
LLM
```

Goal: reliable agency-specific caregiver Q&A.

## Phase 2

```text
Recruiting Agent
+
Conversational Screening
+
Candidate Profile
```

## Phase 3

```text
Training Agent
+
RAG
+
Assessment
+
Training Progress
```

## Phase 4

```text
Retention Agent
+
Retention Risk Model
+
Coaching
```

## Phase 5

```text
Scheduling Agent
+
Compatibility ML
+
Acceptance Prediction
+
Optimization
```

## Phase 6

```text
Cross-Agent Workflows
+
Analytics
+
Human Escalation
+
Audit
+
Agency Admin Configuration
```

---

# 28. First Task When Starting Work

Before writing implementation code, inspect the entire existing project and produce an **Architecture Assessment**.

The assessment should contain:

### A. Current Architecture

```text
Frontend:
Backend:
Database:
Authentication:
Current chatbot:
Current agents:
Current RAG:
Current ML:
Current scheduling:
```

### B. Existing Database

List relevant existing tables and explain their relationships.

### C. Existing AI/Chat Architecture

Explain how the current chatbot works from:

```text
User message
    ->
Frontend
    ->
Backend
    ->
LLM
    ->
Database
    ->
Response
```

### D. Gap Analysis

Create:

| Target Component | Existing Status | Gap | Recommendation |
|---|---|---|---|
| Orchestrator | | | |
| Recruiting Agent | | | |
| Training Agent | | | |
| Knowledge Agent | | | |
| Retention Agent | | | |
| Scheduling Agent | | | |
| RAG | | | |
| ML | | | |
| Tool Layer | | | |
| Agent State | | | |
| Audit | | | |

### E. Recommended Implementation Plan

Recommend the smallest sequence of changes needed to move the existing project toward this architecture.

**Do not start by rewriting the application.**

---

# 29. Critical Rule

When there is a conflict between the existing implementation and this architecture:

**Do not automatically replace the existing implementation.**

First determine:

1. What the existing implementation does.
2. Why it was implemented that way.
3. Whether it already solves part of the target architecture.
4. Whether it can be extended.
5. Whether refactoring is actually necessary.

Then recommend the least disruptive approach.

---

# 30. Definition of Success

The final CareMuch system should allow a caregiver to open one conversational interface and ask:

```text
"What is our dementia-care policy?"
```

→ Knowledge Agent → Agency RAG

```text
"Can you help me complete my application?"
```

→ Recruiting Agent

```text
"Can you teach me about fall prevention?"
```

→ Training Agent

```text
"I don't like my current assignments."
```

→ Retention Agent → potentially Scheduling tools

```text
"Can you find me a client closer to home?"
```

→ Scheduling Agent → ML + optimization

```text
"What is the capital of Mongolia?"
```

→ General LLM fallback, if appropriate

while maintaining:

```text
Agency isolation
+
Grounded knowledge
+
Structured data
+
Auditable actions
+
Human escalation
+
Scalable multi-agent architecture
```

The system should be designed so that adding a future agent does not require rebuilding the entire platform.

For example:

```text
Payroll Agent
Compliance Agent
EVV Agent
Client Intake Agent
Care Plan Agent
Agency Manager Agent
```

should be possible by adding a new specialized capability and registering it with the orchestrator/tool layer.

---

## Final Instruction to Claude

**Act as the lead architect and senior engineer for the CareMuch project.**

First understand the existing codebase.

Then map the current system to the target architecture above.

Do not blindly implement a generic multi-agent framework.

Do not rewrite working functionality unnecessarily.

Build incrementally toward a secure, multi-tenant, agency-specific, RAG-grounded, tool-enabled multi-agent AI platform.

When making architectural decisions, prioritize:

**simplicity → reliability → security → maintainability → scalability.**