"""
Long-term semantic memory service using ChromaDB + OpenAI embeddings.

Stores per-agent / per-user memories and retrieves relevant ones for injection
into agent context. Gracefully degrades if embeddings or Chroma are unavailable.
"""
from __future__ import annotations

import logging
import os
import uuid
from typing import Any, Dict, List, Optional

from app.core.config import settings

logger = logging.getLogger(__name__)

_memory_service: Optional["LongTermMemoryService"] = None


class LongTermMemoryService:
    def __init__(self) -> None:
        self._available = False
        self.client = None
        self.collection = None
        self.embeddings = None

        try:
            import chromadb
            from langchain_openai import OpenAIEmbeddings

            persist_dir = os.path.abspath(
                os.path.join(os.path.dirname(__file__), "../../chroma_memory")
            )
            os.makedirs(persist_dir, exist_ok=True)

            self.client = chromadb.PersistentClient(path=persist_dir)
            self.collection = self.client.get_or_create_collection(
                name="agent_longterm_memories",
                metadata={"hnsw:space": "cosine"},
            )

            self.embeddings = OpenAIEmbeddings(
                model="text-embedding-3-small",
                api_key=settings.OPENAI_API_KEY or "sk-local",
                base_url=settings.OPENAI_BASE_URL or None,
            )
            self._available = True
            logger.info("LongTermMemoryService initialized with Chroma at %s", persist_dir)
        except Exception as e:
            logger.warning("LongTermMemoryService unavailable (%s). Long-term memory disabled.", e)
            self._available = False

    @property
    def available(self) -> bool:
        return self._available

    def add_memory(
        self,
        agent_id: int,
        user_id: int,
        text: str,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> Optional[str]:
        """Store a memory snippet. Returns the memory id or None if unavailable."""
        if not self._available or not text or not text.strip():
            return None
        try:
            emb = self.embeddings.embed_query(text)
            mid = str(uuid.uuid4())
            meta: Dict[str, Any] = {
                "agent_id": int(agent_id),
                "user_id": int(user_id),
                **(metadata or {}),
            }
            # Chroma requires string values in metadata for some versions; convert
            safe_meta = {k: str(v) if not isinstance(v, (int, float, bool)) else v for k, v in meta.items()}
            self.collection.add(
                ids=[mid],
                embeddings=[emb],
                documents=[text],
                metadatas=[safe_meta],
            )
            return mid
        except Exception as e:
            logger.warning("Failed to add memory: %s", e)
            return None

    def retrieve(
        self,
        agent_id: int,
        user_id: int,
        query: str,
        k: int = 5,
    ) -> List[str]:
        """Retrieve the top-k most relevant memory documents for the query."""
        if not self._available or not query or not query.strip():
            return []
        try:
            emb = self.embeddings.embed_query(query)
            results = self.collection.query(
                query_embeddings=[emb],
                n_results=k,
                where={
                    "$and": [
                        {"agent_id": int(agent_id)},
                        {"user_id": int(user_id)},
                    ]
                },
            )
            docs = results.get("documents") or [[]]
            return docs[0] if docs else []
        except Exception as e:
            logger.warning("Failed to retrieve memories: %s", e)
            return []

    def clear_for_agent_user(self, agent_id: int, user_id: int) -> int:
        """Delete all memories for a given agent+user. Returns count deleted (best-effort)."""
        if not self._available:
            return 0
        try:
            # Chroma doesn't have a direct count-delete easily; fetch ids then delete
            results = self.collection.get(
                where={
                    "$and": [
                        {"agent_id": int(agent_id)},
                        {"user_id": int(user_id)},
                    ]
                }
            )
            ids = results.get("ids") or []
            if ids:
                self.collection.delete(ids=ids)
            return len(ids)
        except Exception as e:
            logger.warning("Failed to clear memories: %s", e)
            return 0


def get_memory_service() -> LongTermMemoryService:
    global _memory_service
    if _memory_service is None:
        _memory_service = LongTermMemoryService()
    return _memory_service
