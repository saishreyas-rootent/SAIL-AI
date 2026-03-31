from typing import List

def retrieve(query: str, category: str, k: int = 3) -> List[dict]:
    """
    POC mode: No document retrieval.
    The LLM answers directly from its own trained knowledge about SAIL.
    Returns empty list — nodes.py handles this gracefully.
    """
    return []
    