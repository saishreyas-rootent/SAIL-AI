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


def _sanitize_chart_data(parsed: dict) -> dict:
    """
    Coerce chart dataset values to numbers.
    LLM sometimes returns '65,000' or '₹65,000/ton' strings instead of plain numbers.
    """
    for chart in parsed.get("charts", []):
        for ds in chart.get("datasets", []):
            clean = []
            for v in ds.get("data", []):
                try:
                    numeric_str = re.sub(r'[^\d.\-]', '', str(v).replace(",", ""))
                    clean.append(float(numeric_str) if numeric_str else 0)
                except (ValueError, TypeError):
                    clean.append(0)
            ds["data"] = clean
    return parsed


def _extract_json(text: str) -> dict:
    """
    Robustly extract and parse JSON from Agent 1's response.
    Handles markdown fences, leading/trailing text, and common escape issues.
    """
    text = re.sub(r'^```json\s*', '', text.strip(), flags=re.IGNORECASE)
    text = re.sub(r'^```\s*', '', text.strip(), flags=re.IGNORECASE)
    text = re.sub(r'```\s*$', '', text.strip())
    text = text.strip()

    try:
        return _sanitize_chart_data(json.loads(text))
    except json.JSONDecodeError:
        pass

    start = text.find('{')
    end = text.rfind('}')
    if start != -1 and end != -1 and end > start:
        candidate = text[start:end + 1]
        try:
            return _sanitize_chart_data(json.loads(candidate))
        except json.JSONDecodeError:
            pass

    return _sanitize_chart_data({
        "summary": "",
        "answer_text": text,
        "tables": [],
        "charts": [],
        "sources": [],
        "needs_clarification": False,
        "clarification_questions": [],
        "needs_review": False
    })


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
    has_feedback = bool(state.get("human_feedback"))

    system_content = state["agent_role"]
    if has_feedback:
        system_content += (
            "\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n"
            "🚨 CRITICAL SYSTEM OVERRIDE: USER FEEDBACK RECEIVED 🚨\n"
            "The user has provided the missing details. YOU ARE NOW STRICTLY FORBIDDEN FROM ASKING FOR MORE INFORMATION.\n"
            "You MUST generate a final answer with concrete estimates, tables, and charts.\n"
            "If exact current data is unavailable, provide REALISTIC HYPOTHETICAL ESTIMATES based on recent trends.\n"
            "Do NOT output phrases like 'I need more details' or 'Please provide'.\n"
            "Set `needs_clarification`: false.\n"
            "Set `clarification_questions`: [].\n"
            "CRITICAL FOR CHARTS: All values in datasets[].data MUST be plain numbers with NO commas, "
            "NO currency symbols, NO units. E.g., use 65000 NOT '65,000' or '₹65,000/ton'. "
            "Put units only in the chart title, xLabel, or yLabel.\n"
            "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        )
        feedback_section = (
            f"\n\nUSER CLARIFICATION ANSWERS:\n"
            f"{state['human_feedback']}\n\n"
            f"Based strictly on these answers, provide the final structured response."
        )

    messages = [
        {"role": "system", "content": system_content},
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

    # DEBUG — print raw LLM output to terminal
    print("\n" + "="*60)
    print("DEBUG RAW LLM OUTPUT:")
    print(raw)
    print("="*60 + "\n")

    # Parse the JSON response
    parsed = _extract_json(raw)

    # DEBUG — print parsed result to terminal
    print("\n" + "="*60)
    print("DEBUG PARSED JSON:")
    print(json.dumps(parsed, indent=2, ensure_ascii=False))
    print("="*60 + "\n")

    # --- BULLETPROOF FIX V3 ---
    if has_feedback:
        org_needs_clarification = parsed.get("needs_clarification", False)
        ans_text = parsed.get("answer_text", "").lower()

        parsed["needs_clarification"] = False
        parsed["clarification_questions"] = []

        is_evading = (
            org_needs_clarification
            or "need more information" in ans_text
            or "please specify" in ans_text
            or "provide more" in ans_text
            or "i need" in ans_text
        )
        if is_evading:
            parsed["summary"] = "Estimated Data (Based on Provided Context)"
            parsed["answer_text"] = "Here is an estimated analysis based on your parameters. Please note that exact figures are subject to market variability and these are industry approximations."
            parsed["tables"] = [{
                "title": "Estimated Data Overview",
                "headers": ["Parameter", "Estimated Value"],
                "rows": [
                    ["Details", state.get("human_feedback", "Provided Info")],
                    ["Typical Range", "Approximation aligned with industry norms"]
                ]
            }]

    # Extract fields with safe defaults
    needs_clarification = bool(parsed.get("needs_clarification", False))
    clarification_questions = parsed.get("clarification_questions", [])
    needs_review = bool(parsed.get("needs_review", False))

    # Visual/tabular queries never go to HITL
    has_visuals = bool(parsed.get("tables")) or bool(parsed.get("charts"))
    if has_visuals:
        needs_review = False

    # DEBUG — print tables specifically
    print("\n" + "="*60)
    print("DEBUG TABLES IN PARSED:")
    print(json.dumps(parsed.get("tables", []), indent=2, ensure_ascii=False))
    print("DEBUG IS_DATASHEET:", parsed.get("is_datasheet", False))
    print("="*60 + "\n")

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
    """
    draft = state["current_draft"]

    # DEBUG — print what reaches the output node
    print("\n" + "="*60)
    print("DEBUG OUTPUT NODE — DRAFT RECEIVED:")
    print(draft)
    print("="*60 + "\n")

    try:
        parsed = json.loads(draft)
        parsed = _sanitize_chart_data(parsed)

        # DEBUG — confirm tables survive to final answer
        print("DEBUG OUTPUT NODE — TABLES:", json.dumps(parsed.get("tables", []), indent=2))
        print("DEBUG OUTPUT NODE — IS_DATASHEET:", parsed.get("is_datasheet", False))

        state["final_answer"] = json.dumps(parsed, ensure_ascii=False)
    except (json.JSONDecodeError, TypeError):
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