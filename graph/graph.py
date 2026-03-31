from langgraph.graph import StateGraph, END
from langgraph.checkpoint.memory import MemorySaver
from graph.state import MECONState
from graph.nodes import (
    role_assignment_node,
    answer_draft_node,
    hitl_review_node,
    output_generation_node,
)
from graph.edges import should_continue, should_route_to_hitl

workflow = StateGraph(MECONState)

# POC mode: retrieval node removed — LLM answers from its own SAIL knowledge
workflow.add_node("role_assignment",   role_assignment_node)
workflow.add_node("answer_draft",      answer_draft_node)
workflow.add_node("hitl_review",       hitl_review_node)
workflow.add_node("output_generation", output_generation_node)

workflow.set_entry_point("role_assignment")

# role_assignment → answer_draft directly (no retrieval step)
workflow.add_edge("role_assignment", "answer_draft")

workflow.add_conditional_edges(
    "answer_draft",
    should_route_to_hitl,
    {
        "hitl_review":      "hitl_review",
        "output_generation": "output_generation",
    },
)

workflow.add_conditional_edges(
    "hitl_review",
    should_continue,
    {
        "answer_draft":     "answer_draft",
        "output_generation": "output_generation",
    },
)

workflow.add_edge("output_generation", END)

memory = MemorySaver()

app_graph = workflow.compile(
    checkpointer=memory,
    interrupt_before=["hitl_review"],
)