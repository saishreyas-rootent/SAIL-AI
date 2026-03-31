import os
from dotenv import load_dotenv
from graph.graph import app_graph

load_dotenv()

def test_chat():
    config = {"configurable": {"thread_id": "test_thread"}}
    initial_input = {
        "user_query": "What is ISMB 300?",
        "category": "Structural Steel"
    }
    
    try:
        print("Starting stream...")
        for event in app_graph.stream(initial_input, config, stream_mode="values"):
            print(f"Event: {event.keys()}")
        print("Done.")
    except Exception as e:
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    test_chat()
