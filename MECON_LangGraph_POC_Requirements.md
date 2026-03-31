# MECON-AI: LangGraph Chatbot — Technical Requirements Document (v2 — POC)

> **Project:** AI-based Chatbot for Data Retrieval — MECON  
> **Framework:** RAG-based AI Framework for fetching Technical Specifications, Datasheets, Price Estimates, BOQ, etc.  
> **Architecture:** LangGraph Multi-Agent + Human-in-the-Loop (HITL)  
> **POC Mode:** ✅ Mock RAG (real RAG to be plugged in at production stage)

---

## 1. Project Overview

MECON-AI is a conversational assistant built on **LangGraph** with a **Human-in-the-Loop (HITL)** refinement loop. The chatbot retrieves (or in POC: simulates retrieval of) technical data from MECON's steel project knowledge base and iteratively refines its answers — capping at **4 iterations**.

### POC vs Production Strategy

| Aspect | POC (Now) | Production (Later) |
|---|---|---|
| Data Retrieval | **Mock RAG** — hardcoded JSON fixtures | **Real RAG** — ChromaDB / Pinecone vector store |
| Embeddings | ❌ Not needed | OpenAI / HuggingFace embeddings |
| Documents | ❌ Not needed | Ingested PDFs, datasheets, price schedules |
| Retriever Interface | `mock_retriever(query, category)` | `vector_store.similarity_search(query, ...)` |
| **Swap effort** | **1 file change** — only `rag/retriever.py` | Drop-in replacement, zero graph changes |

> 🔑 **Key Design Principle:** The LangGraph graph, state, nodes, and all HITL logic are **identical** in both POC and production. Only the retriever function is swapped. The graph never knows whether retrieval is real or mocked.

### Core Goals
- Assign a defined **role/persona** to the LLM before every query
- Simulate data retrieval with **realistic mock data** per category
- Allow a **human reviewer** to refine answers between iterations (max 4)
- Render the final polished answer via a **dedicated Output Agent (Agent 2)**
- Maintain full **LangGraph state** with checkpointing across iterations

---

## 2. System Architecture

```
User Prompt
    │
    ▼
┌─────────────────────────────────────────────────┐
│              LangGraph State Machine             │
│                                                  │
│  ┌──────────────────────┐                       │
│  │  Role Assignment Node │                       │
│  │  (System Prompt Setup)│                       │
│  └──────────────────────┘                       │
│        │                                         │
│        ▼                                         │
│  ┌──────────────────────────────────────────┐   │
│  │  Mock RAG Retrieval Node                  │   │
│  │  POC:  mock_retriever(query, category)    │   │
│  │  PROD: vector_store.similarity_search()  │   │
│  │  ── swap this one function only ──        │   │
│  └──────────────────────────────────────────┘   │
│        │                                         │
│        ▼                                         │
│  ┌───────────────────────┐                      │
│  │  Answer Draft Node     │  ◀─── loops         │
│  │  Agent 1 (LLM)         │       up to 4x      │
│  └───────────────────────┘                      │
│        │                                         │
│        ▼                                         │
│  ┌─────────────────────────────────────────┐    │
│  │   HUMAN-IN-THE-LOOP (HITL) Node         │    │
│  │   interrupt_before=["hitl_review"]      │    │
│  │   Human reviews + approves / refines    │    │
│  └─────────────────────────────────────────┘    │
│        │                                         │
│        ▼  (iteration < 4 AND not approved)       │
│   Loop back to Answer Draft Node                │
│        │                                         │
│        ▼  (approved OR iteration == 4)           │
│  ┌───────────────────────┐                      │
│  │  Output Generation    │                      │
│  │  Agent 2 (Formatter)  │                      │
│  └───────────────────────┘                      │
└─────────────────────────────────────────────────┘
    │
    ▼
Final Answer Displayed to User
```

---

## 3. LangGraph Graph State

```python
from typing import TypedDict, List, Optional

class MECONState(TypedDict):
    # Input
    user_query: str
    category: str                      # e.g., "Structural Steel", "Piping & Valves"

    # Role / System Prompt
    agent_role: str                    # Assigned role for Agent 1

    # Retrieved Context (mock or real — same shape either way)
    retrieved_chunks: List[dict]       # [{"source": str, "content": str}]

    # Iteration Control
    iteration_count: int               # Starts at 0, max 4
    max_iterations: int                # Always 4

    # Answer Drafts
    current_draft: str                 # Latest draft from Agent 1
    draft_history: List[str]           # All drafts across iterations

    # HITL
    human_feedback: Optional[str]      # Human reviewer's text feedback
    human_approved: bool               # True = exit loop immediately

    # Output
    final_answer: str                  # Rendered by Agent 2
    sources: List[dict]                # Shown in Sources panel
    agent_trace: List[str]             # Shown in Agent Trace panel
```

> ⚠️ `retrieved_chunks` has the **same shape** whether populated by mock or real RAG.  
> This is what allows a zero-change swap later.

---

## 4. Mock RAG — POC Retriever

### 4.1 Design Philosophy

The mock retriever lives in **one file: `rag/retriever.py`**. It exposes a single function:

```python
def retrieve(query: str, category: str) -> List[dict]:
    ...
```

In POC, this returns hardcoded fixture data. In production, this exact function signature is kept but the body is replaced with a real vector store call. **Nothing else in the codebase changes.**

---

### 4.2 Mock Data Fixtures (`rag/mock_data.py`)

```python
# Realistic mock chunks per MECON category
# Each entry mirrors what a real RAG chunk would look like:
# {"source": "filename.pdf — Page N", "content": "..."}

MOCK_DATA = {
    "piping_valves": [
        {
            "source": "MECON_Piping_Spec_IS1239.pdf — Page 12",
            "content": (
                "6 inch NB CS Pipe, SCH 40 as per IS 1239 Part 1. "
                "Wall thickness: 7.11 mm. OD: 168.3 mm. Weight: 28.26 kg/m. "
                "Material: IS 1239 Grade 1 (ERW). Hydrostatic test pressure: 50 bar."
            )
        },
        {
            "source": "MECON_Valve_Datasheet_GateValves.pdf — Page 5",
            "content": (
                "Gate Valve, 4 inch, Class 150, Flanged End, CS Body (ASTM A216 WCB). "
                "Face to face as per ASME B16.10. Trim: SS 410. "
                "Test pressure (shell): 30 bar. Test pressure (seat): 22 bar."
            )
        },
        {
            "source": "MECON_Piping_Spec_IS1239.pdf — Page 8",
            "content": (
                "4 inch NB CS Pipe, SCH 40 as per IS 1239 Part 1. "
                "Wall thickness: 6.02 mm. OD: 114.3 mm. Weight: 16.07 kg/m."
            )
        },
    ],

    "structural_steel": [
        {
            "source": "MECON_Structural_Steel_Schedule.pdf — Page 3",
            "content": (
                "ISMB 300 — Indian Standard Medium Weight Beam. "
                "Weight: 44.2 kg/m. Flange width: 140 mm. Web thickness: 7.5 mm. "
                "Flange thickness: 12.4 mm. Grade: IS 2062 E250 (Fe 410W). "
                "Moment of Inertia Ixx: 8603 cm⁴."
            )
        },
        {
            "source": "MECON_BOQ_Template_SteelStructure.pdf — Page 2",
            "content": (
                "Structural steel fabrication rate: INR 72,000 per MT (ex-works). "
                "Erection rate: INR 8,500 per MT. Primer painting (1 coat): INR 4,200 per MT. "
                "All rates exclusive of GST @18%."
            )
        },
        {
            "source": "MECON_Structural_Steel_Schedule.pdf — Page 7",
            "content": (
                "ISMC 200 — Indian Standard Medium Weight Channel. "
                "Weight: 22.1 kg/m. Flange width: 75 mm. Web thickness: 6.1 mm. "
                "Grade: IS 2062 E250."
            )
        },
    ],

    "equipment": [
        {
            "source": "MECON_Equipment_Datasheet_Pumps.pdf — Page 14",
            "content": (
                "Centrifugal Pump — Cooling Water Service. Capacity: 500 m³/hr. "
                "Head: 40 m. Speed: 1480 RPM. Driver: 75 kW TEFC Motor, 415V/3Ph/50Hz. "
                "Casing: CI IS 210 Gr FG 260. Impeller: SS 316."
            )
        },
        {
            "source": "MECON_Equipment_Datasheet_Blowers.pdf — Page 6",
            "content": (
                "Roots Blower — BF Gas Service. Capacity: 1200 Nm³/hr. "
                "Pressure: 0.5 kg/cm². Motor: 30 kW. Casing: CI."
            )
        },
    ],

    "bf_process": [
        {
            "source": "MECON_BF_Process_Design_Basis.pdf — Page 22",
            "content": (
                "Blast Furnace — 350 m³ Working Volume. "
                "Hot Metal Production: 750 TPD. Coke Rate: 520 kg/THM. "
                "Hot Metal Composition: C: 4.0–4.5%, Si: 0.3–0.8%, Mn: 0.2–0.5%, "
                "P: max 0.12%, S: max 0.05%. Blast Temperature: 1050°C."
            )
        },
        {
            "source": "MECON_BF_Stove_Spec.pdf — Page 3",
            "content": (
                "Hot Blast Stove — Internal Combustion Type. "
                "Dome temperature: 1300°C max. Shell diameter: 7.5 m. "
                "Checker volume: 2200 m³. Blast volume: 1050 Nm³/min."
            )
        },
    ],

    "price_schedules": [
        {
            "source": "MECON_Price_Schedule_2024_Q3.pdf — Page 4",
            "content": (
                "ISMB 300 — Landed Rate (ex-Bhilai): INR 68,500/MT excl. GST. "
                "GST @18%: INR 12,330/MT. Landed Rate incl. GST: INR 80,830/MT. "
                "Valid: July–September 2024."
            )
        },
        {
            "source": "MECON_Price_Schedule_2024_Q3.pdf — Page 9",
            "content": (
                "4 inch CS Pipe SCH 40 — Landed Rate: INR 92,000/MT excl. GST. "
                "GST @18%: INR 16,560/MT. Landed Rate incl. GST: INR 1,08,560/MT."
            )
        },
        {
            "source": "MECON_Price_Schedule_2024_Q3.pdf — Page 11",
            "content": (
                "Gate Valve 4 inch Class 150 — Unit Rate: INR 14,200 excl. GST. "
                "GST @18%: INR 2,556. Unit Rate incl. GST: INR 16,756."
            )
        },
    ],

    "ei_civil": [
        {
            "source": "MECON_Cable_Schedule_BF_Area.pdf — Page 7",
            "content": (
                "Power Cable: 3.5C x 95 sq.mm XLPE/SWA/PVC, 1.1 kV grade. "
                "Conductor: Aluminium. Standard: IS 7098 Part 1. "
                "Current rating (ground): 205 A."
            )
        },
        {
            "source": "MECON_Civil_Foundation_Spec.pdf — Page 3",
            "content": (
                "Equipment Foundation — Grade M25 concrete (IS 456). "
                "Reinforcement: Fe 500 TMT bars. Bearing capacity assumed: 15 T/m². "
                "Foundation depth: 1.5 m below FGL."
            )
        },
    ],
}

# Fallback for "All Categories" — returns a sample from each
ALL_CATEGORIES_SAMPLE = [
    MOCK_DATA["piping_valves"][0],
    MOCK_DATA["structural_steel"][0],
    MOCK_DATA["bf_process"][0],
    MOCK_DATA["price_schedules"][0],
    MOCK_DATA["ei_civil"][0],
]
```

---

### 4.3 Mock Retriever Function (`rag/retriever.py`)

This is the **only file that changes** when switching from POC to production.

```python
# rag/retriever.py

from typing import List
from rag.mock_data import MOCK_DATA, ALL_CATEGORIES_SAMPLE

# ─────────────────────────────────────────────
# CATEGORY KEY MAP  (UI label → fixture key)
# ─────────────────────────────────────────────
CATEGORY_KEY_MAP = {
    "All Categories":    None,
    "Piping & Valves":   "piping_valves",
    "Structural Steel":  "structural_steel",
    "Equipment":         "equipment",
    "BF & Process":      "bf_process",
    "Price Schedules":   "price_schedules",
    "E&I / Civil":       "ei_civil",
}


def retrieve(query: str, category: str, k: int = 3) -> List[dict]:
    """
    POC: Returns mock chunks matching the selected category.
    
    PRODUCTION SWAP — replace this body with:
    ──────────────────────────────────────────
    results = vector_store.similarity_search(
        query=query,
        k=k,
        filter={"category": CATEGORY_KEY_MAP.get(category)} 
                if category != "All Categories" else None
    )
    return [
        {"source": doc.metadata["source"], "content": doc.page_content}
        for doc in results
    ]
    ──────────────────────────────────────────
    """
    key = CATEGORY_KEY_MAP.get(category)

    if key is None:
        chunks = ALL_CATEGORIES_SAMPLE
    else:
        chunks = MOCK_DATA.get(key, [])

    # Simulate keyword relevance
    query_words = set(query.lower().split())
    def relevance_score(chunk):
        return sum(1 for w in query_words if w in chunk["content"].lower())

    ranked = sorted(chunks, key=relevance_score, reverse=True)
    return ranked[:k]
```

---

## 5. Node Definitions

### 5.1 Node 1: Role Assignment Node

```python
# prompts/agent1_role.py

AGENT_1_ROLE = """
You are MECON-AI, an expert technical data assistant for MECON Limited —
a premier engineering consultancy specializing in steel plant projects.

Your responsibilities:
1. Answer queries using ONLY the context provided to you — do not fabricate data.
2. Always reference the source document for each data point.
3. Structure your answers clearly: use tables for specs/prices, bullets for lists.
4. Never guess specifications — if data is absent from context, say: 
   "This information was not found in the retrieved documents."
5. Maintain engineering precision: always include units (mm, kg/m, INR, bar, etc.)
"""
```

```python
# graph/nodes.py

def role_assignment_node(state: MECONState) -> MECONState:
    state["agent_role"] = AGENT_1_ROLE
    state["iteration_count"] = 0
    state["draft_history"] = []
    state["agent_trace"].append("✅ Role assigned to Agent 1")
    return state
```

---

### 5.2 Node 2: Mock RAG Retrieval Node

```python
def retrieval_node(state: MECONState) -> MECONState:
    from rag.retriever import retrieve

    chunks = retrieve(
        query=state["user_query"],
        category=state["category"],
        k=3
    )

    state["retrieved_chunks"] = chunks
    state["sources"] = chunks

    state["agent_trace"].append(
        f"📄 [MOCK] Retrieved {len(chunks)} chunks "
        f"[category: {state['category']}]"
    )
    return state
```

---

### 5.3 Node 3: Answer Draft Node (Agent 1)

```python
def answer_draft_node(state: MECONState) -> MECONState:
    context = "\n\n".join([
        f"[Source: {c['source']}]\n{c['content']}"
        for c in state["retrieved_chunks"]
    ])

    feedback_section = ""
    if state.get("human_feedback"):
        feedback_section = f"""---
A human expert reviewed the previous answer and gave this feedback:
{state['human_feedback']}
Please revise accordingly.
---"""

    messages = [
        {"role": "system", "content": state["agent_role"]},
        {"role": "user",   "content": f"Query: {state['user_query']}\nContext:\n{context}\n{feedback_section}"}
    ]

    response = llm.invoke(messages)
    draft = response.content

    state["current_draft"] = draft
    state["draft_history"].append(draft)
    state["iteration_count"] += 1
    state["human_feedback"] = None

    state["agent_trace"].append(
        f"🤖 Agent 1 drafted answer (iteration {state['iteration_count']}/{state['max_iterations']})"
    )
    return state
```

---

### 5.4 Node 4: HITL Review Node

```python
def hitl_review_node(state: MECONState) -> MECONState:
    if state.get("human_approved"):
        state["agent_trace"].append(
            f"👤 HITL: Human approved answer at iteration {state['iteration_count']}"
        )
    elif state.get("human_feedback"):
        state["agent_trace"].append(
            f"🔁 HITL: Human feedback received — '{state['human_feedback'][:60]}...'"
        )
    return state
```

---

### 5.5 Conditional Edge: Loop or Proceed

```python
# graph/edges.py

def should_continue(state: MECONState) -> str:
    if state["human_approved"]:
        return "output_generation"
    if state["iteration_count"] >= state["max_iterations"]:
        return "output_generation"
    return "answer_draft"
```

---

### 5.6 Node 5: Output Generation Node (Agent 2)

```python
AGENT_2_ROLE = """
You are the Output Formatter for MECON-AI.
Take a technically verified answer and render it as clean, structured output.

Rules:
- Add a one-line Summary at the top
- Use markdown tables for specs, prices, and BOQ items
- List sources at the bottom under a "## Sources" heading
"""

def output_generation_node(state: MECONState) -> MECONState:
    source_list = "\n".join([f"- {c['source']}" for c in state["retrieved_chunks"]])

    messages = [
        {"role": "system", "content": AGENT_2_ROLE},
        {"role": "user", "content": f"Verified answer:\n{state['current_draft']}\n\nSources used:\n{source_list}"}
    ]

    response = llm.invoke(messages)
    state["final_answer"] = response.content
    state["agent_trace"].append("✅ Agent 2 formatted final output")
    return state
```

---

## 6. Full Graph Construction

```python
# graph/graph.py

from langgraph.graph import StateGraph, END
from langgraph.checkpoint.memory import MemorySaver
from graph.state import MECONState
from graph.nodes import (
    role_assignment_node, retrieval_node,
    answer_draft_node, hitl_review_node,
    output_generation_node
)
from graph.edges import should_continue

workflow = StateGraph(MECONState)

workflow.add_node("role_assignment",    role_assignment_node)
workflow.add_node("retrieval",          retrieval_node)
workflow.add_node("answer_draft",       answer_draft_node)
workflow.add_node("hitl_review",        hitl_review_node)
workflow.add_node("output_generation",  output_generation_node)

workflow.set_entry_point("role_assignment")
workflow.add_edge("role_assignment",  "retrieval")
workflow.add_edge("retrieval",        "answer_draft")
workflow.add_edge("answer_draft",     "hitl_review")
workflow.add_conditional_edges("hitl_review", should_continue, {"answer_draft": "answer_draft", "output_generation": "output_generation"})
workflow.add_edge("output_generation", END)

memory = MemorySaver()
app_graph = workflow.compile(
    checkpointer=memory,
    interrupt_before=["hitl_review"]
)
```
