# CareMuch Multi-Agent AI Platform
## System Architecture & Technical Design

### Purpose
CareMuch is a multi-agent AI platform for home-care agencies combining conversational agents, agency-specific RAG, recruiting/screening, caregiver training and retention, and ML-powered smart scheduling.

## Architecture Principles
- One conversational interface; multiple specialized capabilities behind an orchestrator.
- RAG provides agency-specific knowledge; agents provide behavior/actions; ML provides predictions and matching.
- Agency knowledge is isolated by `agency_id`.
- Structured facts remain in PostgreSQL/Supabase.
- LLMs should not directly make authoritative scheduling decisions.
- General LLM fallback occurs only after agency knowledge retrieval fails or is insufficient.
- Agent actions, tool calls, sources, and outcomes should be auditable.

## High-Level Architecture

```text
Caregiver / Applicant
        |
        v
Conversational UI
        |
        v
CareMuch Orchestrator / Router
        |
  +-----+--------+---------+-----------+
  |              |         |           |
  v              v         v           v
Recruiting    Training   Support   Retention
Agent         Agent      /Knowledge Agent
  |              |         |           |
  +--------------+---------+-----------+
                 |
                 v
              Tool Layer
                 |
       +---------+----------+
       |         |          |
       v         v          v
   Supabase    RAG       ML Services
   Database   Service
       |         |          |
       |      Vector Store  |
       +---------+----------+
                 |
                 v
                LLM
                 |
                 v
              Response
```

Scheduling uses the tool/ML layer:

```text
Availability + Skills + Client Needs + Distance
+ Compatibility + Acceptance Probability
+ Business Rules + Optimization
                    |
                    v
             Recommended Schedule
```

## Components

| Component | Responsibility |
|---|---|
| Conversational UI | Single caregiver/applicant interface |
| Orchestrator | Intent, context, routing, fallback |
| Recruiting Agent | Screening and applicant workflow |
| Training Agent | Teaching, Q&A, assessments |
| Support/Knowledge Agent | Agency policy, FAQ and service questions |
| Retention Agent | Coaching and retention interventions |
| Scheduling Agent | Scheduling workflow and ML/optimization integration |
| Agency RAG | Retrieval from agency documents |
| LLM | Natural language, reasoning and controlled fallback |
| Supabase/PostgreSQL | System of record |

## Agency Knowledge

### Structured Knowledge
Store in Supabase:
- Services
- Service areas
- Caregiver requirements
- Training programs
- Training questions
- FAQs
- Structured policies
- Agency configuration

### Unstructured Knowledge
Use RAG for:
- PDF/DOCX training manuals
- Employee handbooks
- SOPs
- Caregiver guides
- Policies
- Conversation examples
- Q&A documents

Every document/chunk should include metadata such as:

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

Retrieval must be filtered by `agency_id`.

## RAG Ingestion

```text
Agency uploads document
        |
Document parser
        |
Cleaning + metadata
        |
Chunking
        |
Embeddings
        |
Vector store
        |
Agency Knowledge Base
```

## Runtime Question Flow

```text
Caregiver message
      |
      v
Orchestrator
      |
      +--> Recruiting  --> Recruiting Agent
      +--> Training    --> Training Agent
      +--> Retention   --> Retention Agent
      +--> Scheduling --> Scheduling / ML Engine
      +--> General    --> Support / Knowledge Agent
                              |
                              v
                         Agency RAG
                              |
                   +----------+----------+
                   |                     |
             Good evidence        Insufficient
                   |                     |
                   v                     v
          Agency-grounded answer     General LLM
                                         |
                                  +------+------+
                                  |             |
                               Answer        Escalate
```

## RAG Confidence Gate
1. Retrieve top-k chunks using agency and category filters.
2. Evaluate relevance.
3. Strong evidence → answer from agency knowledge.
4. Weak evidence → rewrite and retrieve again.
5. Still insufficient → do not invent agency policy.
6. Optionally use general LLM.
7. Escalate high-risk or policy-sensitive questions to humans.

## Recruiting Agent
- Candidate profile
- Eligibility screening
- Conversational interview
- Skills and experience
- Availability
- Structured answer storage
- Human review when required

## Training Agent
```text
Training topic
    |
Retrieve agency training material
    |
Explain
    |
Scenario / quiz
    |
Evaluate answer
    |
Correct -> teach again
    |
Pass -> next topic
```

## Retention Agent
Potential signals:
- Hours
- Shift acceptance
- Cancellations
- Ratings
- Travel distance
- Schedule changes
- Other agency-approved indicators

Workflow:
1. ML estimates retention risk.
2. Agent starts coaching conversation.
3. Agent identifies possible cause.
4. Agent retrieves agency resources.
5. Agent can invoke scheduling tools.
6. Escalate to agency staff when needed.

## Smart Scheduling

```text
Scheduling Agent
      |
      +--> Caregiver availability
      +--> Client requirements
      +--> Skills/certifications
      +--> Distance
      +--> Compatibility prediction
      +--> Acceptance prediction
      +--> Business constraints
      +--> Optimization
      |
      v
Recommended schedule
      |
      v
LLM explains recommendation
```

The LLM should explain recommendations, not invent the schedule.

## Suggested Supabase Tables

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

## Agent Configuration

```text
agent_configs
-------------
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

## Tool Layer

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

## Multi-Tenant Security
- Associate agency-owned records with `agency_id`.
- Use Supabase RLS.
- Enforce agency filtering in RAG.
- Validate agency and role before tool execution.
- Never allow the LLM to bypass access controls.
- Log agent decisions, tool calls, sources and escalations.

## MVP Sequence

| Phase | Scope |
|---|---|
| 1 | UI + Orchestrator + Knowledge Agent + Supabase + basic RAG |
| 2 | Recruiting/screening |
| 3 | Training + assessments |
| 4 | Retention + risk model |
| 5 | Scheduling + compatibility/acceptance ML + optimization |
| 6 | Cross-agent workflows, analytics, escalation, audit |

## Key Design Decision

Do not build four independent chatbots. Build one CareMuch conversational interface backed by specialized capabilities.

**Database = structured facts**

**RAG = agency documents**

**Agents = workflows/actions**

**ML = predictions**

**Optimization = scheduling**

**LLM = language/reasoning + controlled fallback**
