import os
import uuid
import uvicorn
import traceback
import warnings
from typing import Optional
from fastapi import FastAPI, HTTPException, Response
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv

# Suppress Pydantic/LangChain deprecation warnings from showing in terminal
warnings.filterwarnings("ignore", category=UserWarning, module="langchain_core")
warnings.filterwarnings("ignore", category=UserWarning, module="pydantic")

from graph.graph import app_graph
from graph.state import MECONState

load_dotenv()

app = FastAPI(title="MECON-AI API")

# Fix favicon 404 error in terminal
@app.get("/favicon.ico", include_in_schema=False)
async def favicon():
    return Response(status_code=204)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class ChatRequest(BaseModel):
    query: str
    category: str
    thread_id: str
    chat_history: list = []


class ReviewRequest(BaseModel):
    action: str                   # "approve", "refine", or "clarify"
    feedback: Optional[str] = None
    thread_id: str


@app.get("/api/health")
def health_check():
    return {"status": "ok", "message": "MECON-AI API is running"}


@app.post("/api/chat")
async def chat(req: ChatRequest):
    """
    Starts a fresh thread per message.
    Returns clarification questions if Agent 1 needs more info,
    or the final structured JSON answer if complete.
    """
    fresh_thread_id = "th_" + uuid.uuid4().hex[:12]
    config = {"configurable": {"thread_id": fresh_thread_id}}

    # Build conversation context from history
    history_text = ""
    if req.chat_history:
        history_text = "\n\nPREVIOUS CONVERSATION:\n"
        for msg in req.chat_history:
            role = "User" if msg.get("role") == "user" else "Assistant"
            history_text += f"{role}: {msg.get('content', '')}\n"
        history_text += "\nCurrent query (answer this based on the above context):"

    initial_input = {
        "user_query": history_text + "\n" + req.query if history_text else req.query,
        "category": req.category,
    }

    try:
        final_values = {}
        for event in app_graph.stream(initial_input, config, stream_mode="values"):
            final_values = event

        snapshot = app_graph.get_state(config)
        is_waiting_for_review = bool(snapshot.next and "hitl_review" in snapshot.next)

        # Check if agent needs clarification from user
        awaiting_clarification = final_values.get("awaiting_clarification", False)
        clarification_questions = final_values.get("clarification_questions", [])

        # Auto-approve if agent is confident (needs_human_review=False)
        # FIX: Ensure we do NOT auto-approve if we are waiting for clarification answers
        if is_waiting_for_review and not final_values.get("needs_human_review", False) and not final_values.get("awaiting_clarification", False):
            app_graph.update_state(
                config,
                {"human_approved": True, "human_feedback": None},
            )
            for event in app_graph.stream(None, config, stream_mode="values"):
                final_values = event
            is_waiting_for_review = False

        return {
            "status": "success",
            "state": final_values,
            "is_waiting_for_review": is_waiting_for_review,
            "awaiting_clarification": awaiting_clarification,
            "clarification_questions": clarification_questions,
            "thread_id": fresh_thread_id,
        }

    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/review")
async def review(req: ReviewRequest):
    """
    Handles three actions:
    - "approve"  : expert approves the draft
    - "refine"   : expert requests a revision with feedback
    - "clarify"  : user answered clarification questions; re-run with answers
    """
    config = {"configurable": {"thread_id": req.thread_id}}

    try:
        if req.action == "approve":
            app_graph.update_state(
                config,
                {"human_approved": True, "human_feedback": None},
            )
        elif req.action in ("refine", "clarify"):
            # For clarify: feedback contains user's answers to the questions
            app_graph.update_state(
                config,
                {
                    "human_approved": False,
                    "human_feedback": req.feedback,
                    "awaiting_clarification": False,
                    "needs_clarification": False,
                },
            )
        else:
            app_graph.update_state(
                config,
                {"human_approved": False, "human_feedback": req.feedback},
            )

        final_values = {}
        for event in app_graph.stream(None, config, stream_mode="values"):
            final_values = event

        snapshot = app_graph.get_state(config)
        is_waiting_for_review = bool(snapshot.next and "hitl_review" in snapshot.next)
        awaiting_clarification = final_values.get("awaiting_clarification", False)
        clarification_questions = final_values.get("clarification_questions", [])

        return {
            "status": "success",
            "state": final_values,
            "is_waiting_for_review": is_waiting_for_review,
            "awaiting_clarification": awaiting_clarification,
            "clarification_questions": clarification_questions,
            "thread_id": req.thread_id,
        }

    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


if os.path.exists("static"):
    app.mount("/", StaticFiles(directory="static", html=True), name="static")

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8001))
    uvicorn.run(app, host="0.0.0.0", port=port, reload=False)