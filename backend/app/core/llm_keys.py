"""
LLM provider & credential resolution.

Priority order for every agent run / feature:
  1. Per-user BYOK key (ProviderKey table) — passed in by callers as `api_key`
  2. Platform setting for the provider (OPENAI_API_KEY / ANTHROPIC_API_KEY)
  3. Platform Gemini default key — ANY model works out of the box: Gemini's
     OpenAI-compatible endpoint serves gemini-* models, and OpenAI/Anthropic
     model names are mapped to an equivalent Gemini model when no other
     provider key exists.
"""
import os
import logging
from typing import Any, Dict, Optional

from app.core.config import settings

logger = logging.getLogger(__name__)

GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai/"

PROVIDERS = ("gemini", "openai", "anthropic", "custom")

# OpenAI/Anthropic model names -> equivalent Gemini tier when no key for the
# named provider exists (keeps every pre-existing agent runnable).
_MODEL_MAP_STRONG = ("gpt-4o", "gpt-4.1", "gpt-5", "o1", "o3", "claude-3-5-sonnet",
                     "claude-sonnet", "claude-3-opus", "claude-opus")
_MODEL_MAP_FAST = ("gpt-4o-mini", "gpt-4.1-mini", "gpt-4.1-nano", "gpt-3.5",
                   "claude-3-5-haiku", "claude-haiku", "claude-3-haiku")

GEMINI_STRONG = "gemini-3.5-flash"
GEMINI_FAST = "gemini-3.5-flash-lite"
GEMINI_EMBEDDING = "gemini-embedding-001"


def detect_provider(model_name: str) -> str:
    name = (model_name or "").lower()
    if name.startswith("claude"):
        return "anthropic"
    if name.startswith("gemini") or name.startswith("gemma"):
        return "gemini"
    return "openai"


def map_to_gemini(model_name: str) -> str:
    """Map an OpenAI/Anthropic-style model name to an equivalent Gemini model."""
    name = (model_name or "").lower()
    if name.startswith("gemini") or name.startswith("gemma"):
        return model_name
    # FAST patterns first — they are more specific (gpt-4o-mini vs gpt-4o)
    if any(name.startswith(p) for p in _MODEL_MAP_FAST):
        return GEMINI_FAST
    if any(name.startswith(p) for p in _MODEL_MAP_STRONG):
        return GEMINI_STRONG
    return GEMINI_FAST


def resolve_llm(
    model_name: Optional[str],
    provider: Optional[str] = None,
    api_key: Optional[str] = None,
) -> Dict[str, Any]:
    """Resolve (provider, api_key, model, compat_base_url) for a chat model.

    Precedence (platform directive: the Gemini key runs EVERY model):
      1. BYOK (`api_key`) — a user's saved key always wins for their agents
      2. Platform Gemini default key — used for ALL model families via the
         OpenAI-compatible endpoint; OpenAI/Anthropic names map to the closest
         Gemini tier
      3. Provider settings (OPENAI_API_KEY / ANTHROPIC_API_KEY) — only if no
         Gemini key exists at all
    """
    name = model_name or ""
    p = provider or detect_provider(name)

    def gemini_default() -> Dict[str, Any]:
        key = settings.GEMINI_API_KEY
        if not key:
            # No Gemini key at all → fall back to the named provider's settings
            if p == "anthropic":
                key = os.environ.get("ANTHROPIC_API_KEY")
            else:
                key = settings.OPENAI_API_KEY
        if not key:
            return {"provider": "openai", "api_key": "sk-local", "model": name,
                    "compat_base_url": None}
        return {"provider": "gemini", "api_key": key, "model": map_to_gemini(name),
                "compat_base_url": GEMINI_BASE_URL}

    if p == "gemini":
        key = api_key or settings.GEMINI_API_KEY
        if not key:
            return {"provider": "openai", "api_key": "sk-local", "model": name,
                    "compat_base_url": None}
        return {"provider": "gemini", "api_key": key, "model": name,
                "compat_base_url": GEMINI_BASE_URL}

    if p == "anthropic" and api_key:
        return {"provider": "anthropic", "api_key": api_key, "model": name,
                "compat_base_url": None}

    if api_key:
        return {"provider": "openai", "api_key": api_key, "model": name,
                "compat_base_url": None}

    # Platform default: run everything on Gemini
    return gemini_default()


def resolve_embeddings(model: str = "text-embedding-3-small") -> Dict[str, Any]:
    """Resolve embedding vendor: platform Gemini first, OpenAI settings as fallback."""
    if settings.GEMINI_API_KEY:
        return {"api_key": settings.GEMINI_API_KEY, "model": GEMINI_EMBEDDING,
                "base_url": GEMINI_BASE_URL}
    return {"api_key": settings.OPENAI_API_KEY, "model": model,
            "base_url": settings.OPENAI_BASE_URL or None}
