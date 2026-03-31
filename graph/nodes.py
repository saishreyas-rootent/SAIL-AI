import os
import json
import re
from dotenv import load_dotenv
from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_google_genai.chat_models import ChatGoogleGenerativeAIError
from graph.state import MECONState
from prompts.agent1_role import AGENT_1_ROLE

load_dotenv()

llm = ChatGoogleGenerativeAI(model="gemini-2.0-flash", temperature=0)


def _extract_json(text: str) -> dict:
    """
    Robustly extract and parse JSON from Agent 1's response.
    Handles markdown fences, leading/trailing text, and common escape issues.
    """
    # Strip markdown fences if present
    text = re.sub(r'^```json\s*', '', text.strip(), flags=re.IGNORECASE)
    text = re.sub(r'^```\s*', '', text.strip(), flags=re.IGNORECASE)
    text = re.sub(r'```\s*$', '', text.strip())
    text = text.strip()

    # Try direct parse first
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

    # Try to find JSON object boundaries
    start = text.find('{')
    end = text.rfind('}')
    if start != -1 and end != -1 and end > start:
        candidate = text[start:end + 1]
        try:
            return json.loads(candidate)
        except json.JSONDecodeError:
            pass

    # Return a safe fallback so the app never crashes
    return {
        "summary": "",
        "answer_text": text,
        "tables": [],
        "charts": [],
        "sources": [],
        "needs_clarification": False,
        "clarification_questions": [],
        "needs_review": False
    }


def get_mock_response() -> dict:
    """Fallback when API quota is exceeded."""
    return {
        "summary": "API quota exceeded",
        "answer_text": "**API Quota Exceeded**\n\nPlease retry after quota resets or upgrade your Gemini API plan.",
        "tables": [],
        "charts": [],
        "sources": [],
        "needs_clarification": False,
        "clarification_questions": [],
        "needs_review": False
    }


def role_assignment_node(state: MECONState) -> MECONState:
    """Sets the initial role and state parameters."""
    state["agent_role"] = AGENT_1_ROLE
    state["iteration_count"] = 0
    state["draft_history"] = []
    state["agent_trace"] = ["✅ Role assigned to MECON-AI Agent 1"]
    state["max_iterations"] = 4
    state["needs_human_review"] = False
    state["needs_clarification"] = False
    state["clarification_questions"] = []
    state["awaiting_clarification"] = False
    state["current_draft"] = ""
    state["final_answer"] = ""
    state["human_approved"] = False
    state["human_feedback"] = None
    state["retrieved_chunks"] = []
    state["sources"] = []
    return state


def retrieval_node(state: MECONState) -> MECONState:
    """POC mode: no document retrieval."""
    state["retrieved_chunks"] = []
    state["sources"] = []
    state["agent_trace"].append(
        "🧠 POC mode: answering from LLM knowledge (no document retrieval)"
    )
    return state


def answer_draft_node(state: MECONState) -> MECONState:
    """
    Agent 1 generates a structured JSON response directly.
    Handles clarification flow and human feedback loop.
    """
    feedback_section = ""
    if state.get("human_feedback"):
        feedback_section = (
            f"\n---\n"
            f"The user provided these answers to your clarification questions:\n"
            f"{state['human_feedback']}\n"
            f"Now provide the full answer using this information.\n"
            f"---\n"
        )

    messages = [
        {"role": "system", "content": state["agent_role"]},
        {
            "role": "user",
            "content": (
                f"User query: {state['user_query']}\n"
                f"{feedback_section}"
            ),
        },
    ]

    try:
        response = llm.invoke(messages)
        raw = str(response.content)
    except ChatGoogleGenerativeAIError as e:
        if "RESOURCE_EXHAUSTED" in str(e) or "429" in str(e):
            print("⚠️  API Quota Exceeded — using mock response")
            raw = json.dumps(get_mock_response())
        else:
            raise

    # Parse the JSON response
    parsed = _extract_json(raw)

    # Extract fields with safe defaults
    needs_clarification = bool(parsed.get("needs_clarification", False))
    clarification_questions = parsed.get("clarification_questions", [])
    needs_review = bool(parsed.get("needs_review", False))

    # Visual/tabular queries never go to HITL
    has_visuals = bool(parsed.get("tables")) or bool(parsed.get("charts"))
    if has_visuals:
        needs_review = False

    # Store parsed JSON as the draft (serialized back to string for state)
    draft = json.dumps(parsed, ensure_ascii=False)

    state["needs_clarification"] = needs_clarification
    state["clarification_questions"] = clarification_questions if needs_clarification else []
    state["awaiting_clarification"] = needs_clarification
    state["needs_human_review"] = needs_review and not needs_clarification
    state["current_draft"] = draft
    state["draft_history"].append(draft)
    state["iteration_count"] += 1
    state["human_feedback"] = None

    if needs_clarification:
        state["agent_trace"].append(
            f"❓ Agent 1 needs clarification ({len(clarification_questions)} question(s))"
        )
    else:
        state["agent_trace"].append(
            f"🤖 Agent 1 drafted answer (Review needed: {needs_review}, Visuals: {has_visuals})"
        )

    return state


def hitl_review_node(state: MECONState) -> MECONState:
    """Bridge node for HITL — runs after the interrupt is resumed."""
    if state.get("human_approved"):
        state["agent_trace"].append(
            f"👤 HITL: Human approved at iteration {state['iteration_count']}"
        )
    elif state.get("human_feedback"):
        state["agent_trace"].append(
            f"🔁 HITL: Feedback/answers received — looping back to Agent 1"
        )
    return state


def output_generation_node(state: MECONState) -> MECONState:
    """
    Agent 2 is bypassed — Agent 1's JSON is passed straight through as final answer.
    For conversational responses, just pass through as-is.
    """
    draft = state["current_draft"]

    # Validate it's proper JSON, fix if not
    try:
        parsed = json.loads(draft)
        state["final_answer"] = json.dumps(parsed, ensure_ascii=False)
    except (json.JSONDecodeError, TypeError):
        # Wrap plain text in our JSON schema
        fallback = {
            "summary": "",
            "answer_text": draft,
            "tables": [],
            "charts": [],
            "sources": [],
            "needs_clarification": False,
            "clarification_questions": [],
            "needs_review": False
        }
        state["final_answer"] = json.dumps(fallback, ensure_ascii=False)

    state["agent_trace"].append("✅ Output ready — passed through directly")
    return state