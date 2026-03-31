from graph.state import MECONState

def should_route_to_hitl(state: MECONState) -> str:
    """
    Decides whether Agent 1's draft goes to human review or straight to output.
    """
    if not state.get("needs_human_review", True):
        return "output_generation"
    
    if state.get("iteration_count", 0) >= state.get("max_iterations", 4):
        return "output_generation"
        
    return "hitl_review"

def should_continue(state: MECONState) -> str:
    """
    Determines whether the graph should loop back for another draft 
    or proceed to final output generation from HITL.
    """
    if state.get("human_approved"):
        return "output_generation"
    
    if state.get("iteration_count", 0) >= state.get("max_iterations", 4):
        return "output_generation"
    
    # If not approved and iteration limit not reached, loop back
    return "answer_draft"
