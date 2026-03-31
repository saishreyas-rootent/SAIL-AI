import uuid
from typing import Dict, Any
from graph.graph import app_graph

def run_mecan_ai_chatbot():
    """
    Demonstrates the MECON-AI POC with HITL refinement.
    """
    # Unique thread for this session
    thread_id = str(uuid.uuid4())
    config = {"configurable": {"thread_id": thread_id}}

    print("=========================================")
    print("        MECON-AI LANGGRAPH POC           ")
    print("=========================================")

    # 1. Inputs
    query = input("\n[USER] Enter your technical query: ")
    print("\nCategories: Piping & Valves, Structural Steel, Equipment, BF & Process, Price Schedules, E&I / Civil")
    category = input("[USER] Enter category: ").strip()

    # 2. Initial state
    initial_state = {
        "user_query": query,
        "category": category
    }

    # 3. First run (until HITL interrupt)
    print("\n[SYSTEM] Agent 1 is retrieving data and drafting answer...")
    for event in app_graph.stream(initial_state, config, stream_mode="values"):
        # You could add trace logging here
        pass

    # 4. HITL Loop
    while True:
        # Get current state from checkpointer
        state = app_graph.get_state(config)
        
        current_draft = state.values.get("current_draft", "No draft yet.")
        iteration = state.values.get("iteration_count", 0)
        trace = state.values.get("agent_trace", [])

        print(f"\n-----------------------------------------")
        print(f" INTERATION: {iteration} / 4")
        print(f"-----------------------------------------")
        print(f"\n[AGENT 1 DRAFT]:\n\n{current_draft}")
        print(f"\n[TRACE]: {trace[-1] if trace else ''}")

        # Check if we finished
        if "final_answer" in state.values:
            print(f"\n=========================================")
            print(f"          FINAL FORMATTED ANSWER         ")
            print(f"=========================================")
            print(state.values["final_answer"])
            break

        # Human Review
        feedback = input("\n[HUMAN REVIEW] (A)pprove or provide feedback (text): ")

        if feedback.lower() == 'a':
            app_graph.update_state(config, {"human_approved": True, "human_feedback": None})
            print("\n[SYSTEM] Approved! Agent 2 is formatting the final output...")
        else:
            app_graph.update_state(config, {"human_approved": False, "human_feedback": feedback})
            print(f"\n[SYSTEM] Feedback received. Looping back to Agent 1 (Iteration {iteration + 1})...")

        # Resume graph execution (input=None to continue from checkpoint)
        for event in app_graph.stream(None, config, stream_mode="values"):
            pass

if __name__ == "__main__":
    try:
        run_mecan_ai_chatbot()
    except KeyboardInterrupt:
        print("\nExiting...")
    except Exception as e:
        print(f"\n[ERROR] {str(e)}")
