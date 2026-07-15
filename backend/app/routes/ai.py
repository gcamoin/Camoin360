import json
import os
from pathlib import Path
from typing import Any, Literal

import httpx
from dotenv import load_dotenv
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from .auth import require_user

REPO_ROOT = Path(__file__).resolve().parents[3]
BACKEND_ROOT = Path(__file__).resolve().parents[2]

load_dotenv(REPO_ROOT / ".env")
load_dotenv(BACKEND_ROOT / ".env")

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
OPENAI_API_BASE = os.getenv("OPENAI_API_BASE", "https://api.openai.com/v1").rstrip("/")
OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-5.5")

router = APIRouter(prefix="/ai", tags=["ai"])


class ChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=4000)


class ChatRequest(BaseModel):
    section: str = Field(min_length=1, max_length=120)
    messages: list[ChatMessage] = Field(min_length=1, max_length=12)
    context: dict[str, Any] = Field(default_factory=dict)


def _extract_response_text(response_data: dict[str, Any]) -> str:
    if isinstance(response_data.get("output_text"), str):
        return response_data["output_text"].strip()

    text_parts: list[str] = []
    for output_item in response_data.get("output", []):
        for content_item in output_item.get("content", []):
            text = content_item.get("text")
            if isinstance(text, str):
                text_parts.append(text)

    return "\n".join(text_parts).strip()


def _compact_context(context: dict[str, Any]) -> str:
    try:
        context_json = json.dumps(context, default=str)
    except TypeError:
        context_json = "{}"

    return context_json[:12000]


@router.post("/chat")
async def chat_with_dashboard_context(request: ChatRequest, _user=Depends(require_user)):
    if not OPENAI_API_KEY:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="OPENAI_API_KEY is not configured on the backend.",
        )

    input_messages: list[dict[str, Any]] = [
        {
            "role": "developer",
            "content": [
                {
                    "type": "input_text",
                    "text": (
                        "You are an analyst inside a management dashboard. Answer using the provided "
                        "dashboard context when it is relevant. Be concise, identify uncertainty, and do "
                        "not invent data that is not in the context."
                    ),
                }
            ],
        },
        {
            "role": "user",
            "content": [
                {
                    "type": "input_text",
                    "text": f"Dashboard section: {request.section}\nContext JSON: {_compact_context(request.context)}",
                }
            ],
        },
    ]

    input_messages.extend(
        {
            "role": message.role,
            "content": [{"type": "input_text", "text": message.content}],
        }
        for message in request.messages[-10:]
    )

    try:
        async with httpx.AsyncClient(timeout=45) as client:
            response = await client.post(
                f"{OPENAI_API_BASE}/responses",
                headers={
                    "Authorization": f"Bearer {OPENAI_API_KEY}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": OPENAI_MODEL,
                    "input": input_messages,
                    "max_output_tokens": 700,
                },
            )
            response.raise_for_status()
    except httpx.HTTPStatusError as exc:
        detail = exc.response.text or "OpenAI request failed."
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"OpenAI request failed: {detail}",
        ) from exc
    except httpx.HTTPError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Unable to reach OpenAI: {exc}",
        ) from exc

    answer = _extract_response_text(response.json())
    if not answer:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="OpenAI returned an empty response.",
        )

    return {"answer": answer, "model": OPENAI_MODEL}
