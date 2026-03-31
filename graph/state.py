from typing import TypedDict, List, Optional


class MECONState(TypedDict):
    # Input
    user_query: str
    category: str

    # Role / System Prompt
    agent_role: str

    # Retrieved Context (empty in POC mode)
    retrieved_chunks: List[dict]

    # Iteration Control
    iteration_count: int
    max_iterations: int

    # Answer Drafts
    current_draft: str
    draft_history: List[str]

    # HITL
    human_feedback: Optional[str]
    human_approved: bool
    needs_human_review: bool

    # Clarification Flow
    needs_clarification: bool
    clarification_questions: List[str]
    awaiting_clarification: bool

    # Output
    final_answer: str
    sources: List[dict]
    agent_trace: List[str]