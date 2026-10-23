"""
Long-term semantic memory service using ChromaDB + OpenAI embeddings.

Stores per-agent / per-user memories and retrieves relevant ones for injection
into agent context. Supports optional shared team/workflow namespaces for
multi-agent collaboration. Gracefully degrades if embeddings or Chroma are unavailable.
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

            from app.core.llm_keys import resolve_embeddings

            emb = resolve_embeddings()
            self.embeddings = OpenAIEmbeddings(
                model=emb["model"],
                api_key=emb["api_key"],
                base_url=emb["base_url"],
            )
            self._available = True
            logger.info("LongTermMemoryService initialized with Chroma at %s", persist_dir)
        except Exception as e:
            logger.warning("LongTermMemoryService unavailable (%s). Long-term memory disabled.", e)
            self._available = False

    @property
    def available(self) -> bool:
        return self._available

    def _namespace_key(self, agent_id: int, user_id: int, shared_namespace: Optional[str] = None) -> Dict[str, Any]:
        """Build the metadata filter for a memory namespace."""
        base = {"user_id": int(user_id)}
        if shared_namespace:
            base["shared_namespace"] = shared_namespace
        else:
            base["agent_id"] = int(agent_id)
        return base

    def add_memory(
        self,
        agent_id: int,
        user_id: int,
        text: str,
        metadata: Optional[Dict[str, Any]] = None,
        shared_namespace: Optional[str] = None,
    ) -> Optional[str]:
        """Store a memory snippet. Returns the memory id or None if unavailable.

        If shared_namespace is provided, the memory is stored under that team/workflow
        key and is retrievable by any agent in the same namespace (multi-agent sharing).
        """
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
            if shared_namespace:
                meta["shared_namespace"] = shared_namespace
            # Chroma prefers primitive metadata values
            safe_meta = {
                k: str(v) if not isinstance(v, (int, float, bool)) else v
                for k, v in meta.items()
            }
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
        shared_namespace: Optional[str] = None,
        memory_type: Optional[str] = None,
    ) -> List[str]:
        """Retrieve the top-k most relevant memory documents for the query.

        When shared_namespace is set, searches the shared team memory instead of
        the individual agent memory.
        """
        if not self._available or not query or not query.strip():
            return []
        try:
            emb = self.embeddings.embed_query(query)
            where = self._namespace_key(agent_id, user_id, shared_namespace)
            if memory_type:
                where["type"] = memory_type
            results = self.collection.query(
                query_embeddings=[emb],
                n_results=k,
                where=where,
            )
            docs = results.get("documents") or [[]]
            return docs[0] if docs else []
        except Exception as e:
            logger.warning("Failed to retrieve memories: %s", e)
            return []

    def list_memories(
        self,
        agent_id: int,
        user_id: int,
        limit: int = 50,
        shared_namespace: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """List stored memories for an agent+user (or shared namespace) with metadata."""
        if not self._available:
            return []
        try:
            where = self._namespace_key(agent_id, user_id, shared_namespace)
            results = self.collection.get(where=where, limit=limit)
            memories = []
            ids = results.get("ids") or []
            docs = results.get("documents") or []
            metas = results.get("metadatas") or []
            for i, mid in enumerate(ids):
                memories.append({
                    "id": mid,
                    "text": docs[i] if i < len(docs) else "",
                    "metadata": metas[i] if i < len(metas) else {},
                })
            return memories
        except Exception as e:
            logger.warning("Failed to list memories: %s", e)
            return []

    def clear_for_agent_user(self, agent_id: int, user_id: int, shared_namespace: Optional[str] = None) -> int:
        """Delete all memories for an agent+user (or shared namespace). Returns count deleted."""
        if not self._available:
            return 0
        try:
            where = self._namespace_key(agent_id, user_id, shared_namespace)
            # Chroma delete by where
            existing = self.collection.get(where=where)
            ids = existing.get("ids") or []
            if ids:
                self.collection.delete(ids=ids)
            return len(ids)
        except Exception as e:
            logger.warning("Failed to clear memories: %s", e)
            return 0

    def summarize_and_store(
        self,
        agent_id: int,
        user_id: int,
        interaction_text: str,
        llm: Any = None,
        shared_namespace: Optional[str] = None,
    ) -> Optional[str]:
        """Optionally summarize a long interaction before storing to keep memories dense."""
        if not self._available or not interaction_text or len(interaction_text) < 400:
            return self.add_memory(
                agent_id, user_id, interaction_text, shared_namespace=shared_namespace
            )

        try:
            from langchain_openai import ChatOpenAI

            if llm is None:
                from app.core.llm_keys import resolve_llm

                r = resolve_llm("gpt-4o-mini")
                llm = ChatOpenAI(
                    model=r["model"],
                    temperature=0.0,
                    api_key=r["api_key"],
                    base_url=r["compat_base_url"] or settings.OPENAI_BASE_URL or None,
                )
            summary_prompt = (
                "Summarize the following agent interaction into 2-4 concise bullet points "
                "capturing key facts, decisions, and outcomes. Be factual and dense.\n\n"
                + interaction_text[:4000]
            )
            resp = llm.invoke(summary_prompt)
            summary = getattr(resp, "content", str(resp)) or interaction_text[:500]
            return self.add_memory(
                agent_id,
                user_id,
                summary,
                metadata={"type": "summary"},
                shared_namespace=shared_namespace,
            )
        except Exception as e:
            logger.warning("Summarization failed, storing raw: %s", e)
            return self.add_memory(
                agent_id,
                user_id,
                interaction_text[:1000],
                shared_namespace=shared_namespace,
            )


    def delete_memory(self, memory_id: str) -> bool:
        """Delete a single memory by its Chroma ID."""
        if not self._available or not memory_id:
            return False
        try:
            self.collection.delete(ids=[memory_id])
            logger.info("Deleted memory %s", memory_id)
            return True
        except Exception as e:
            logger.warning("Failed to delete memory %s: %s", memory_id, e)
            return False



    def consolidate(
        self,
        agent_id: int,
        user_id: int,
        shared_namespace: Optional[str] = None,
        llm: Any = None,
    ) -> Dict[str, Any]:
        """Summarize older memories into denser consolidated memories and optionally prune raw ones.

        Returns counts of processed / created memories.
        """
        if not self._available:
            return {"processed": 0, "created": 0, "available": False}
        try:
            where = self._namespace_key(agent_id, user_id, shared_namespace)
            existing = self.collection.get(where=where, include=["documents", "metadatas"])
            docs = existing.get("documents") or []
            metas = existing.get("metadatas") or []
            ids = existing.get("ids") or []
            if len(docs) < 3:
                return {"processed": len(docs), "created": 0, "available": True, "note": "not enough memories"}

            # Group raw (non-summary) memories
            raw_texts = []
            for doc, meta in zip(docs, metas):
                if not meta or meta.get("type") != "summary":
                    raw_texts.append(doc)

            if len(raw_texts) < 2:
                return {"processed": len(docs), "created": 0, "available": True, "note": "few raw memories"}

            combined = "\n---\n".join(raw_texts[:20])[:6000]
            from langchain_openai import ChatOpenAI

            if llm is None:
                from app.core.llm_keys import resolve_llm

                r = resolve_llm("gpt-4o-mini")
                llm = ChatOpenAI(
                    model=r["model"],
                    temperature=0.0,
                    api_key=r["api_key"],
                    base_url=r["compat_base_url"] or settings.OPENAI_BASE_URL or None,
                )
            prompt = (
                "Consolidate the following agent memories into 3-6 dense, non-redundant bullet points. "
                "Preserve important facts, preferences, decisions, and outcomes. Be concise.\n\n"
                + combined
            )
            resp = llm.invoke(prompt)
            summary = getattr(resp, "content", str(resp)) or ""
            new_id = self.add_memory(
                agent_id,
                user_id,
                summary,
                metadata={"type": "consolidated", "source_count": len(raw_texts)},
                shared_namespace=shared_namespace,
            )
            return {
                "processed": len(docs),
                "created": 1 if new_id else 0,
                "available": True,
                "summary_id": new_id,
            }
        except Exception as e:
            logger.warning("Memory consolidation failed: %s", e)
            return {"processed": 0, "created": 0, "available": True, "error": str(e)}



    def add_knowledge_document(
        self,
        agent_id: int,
        user_id: int,
        text: str,
        source_name: str = "document",
        shared_namespace: Optional[str] = None,
        chunk_size: int = 800,
        chunk_overlap: int = 100,
    ) -> List[str]:
        """Chunk a document and store each chunk as long-term knowledge memory.
        
        Metadata type='knowledge' distinguishes it from interaction memories.
        Returns list of created memory IDs.
        """
        if not self._available or not text or not text.strip():
            return []
        try:
            from langchain_text_splitters import RecursiveCharacterTextSplitter
            splitter = RecursiveCharacterTextSplitter(
                chunk_size=chunk_size,
                chunk_overlap=chunk_overlap,
                separators=["\n\n", "\n", ". ", " ", ""],
            )
            chunks = splitter.split_text(text.strip())
            ids = []
            for i, chunk in enumerate(chunks):
                if not chunk.strip():
                    continue
                mid = self.add_memory(
                    agent_id=agent_id,
                    user_id=user_id,
                    text=chunk,
                    metadata={
                        "type": "knowledge",
                        "source": source_name,
                        "chunk_index": i,
                        "total_chunks": len(chunks),
                    },
                    shared_namespace=shared_namespace,
                )
                if mid:
                    ids.append(mid)
            logger.info("Added knowledge document '%s' as %d chunks for agent %s", source_name, len(ids), agent_id)
            return ids
        except Exception as e:
            logger.warning("Failed to add knowledge document: %s", e)
            return []

    def list_knowledge(
        self,
        agent_id: int,
        user_id: int,
        shared_namespace: Optional[str] = None,
        limit: int = 100,
    ) -> List[Dict[str, Any]]:
        """List knowledge-base entries (type=knowledge) for an agent+user."""
        if not self._available:
            return []
        try:
            where = self._namespace_key(agent_id, user_id, shared_namespace)
            # Chroma where filters are limited; we filter in Python after get
            results = self.collection.get(where=where, limit=limit * 2, include=["documents", "metadatas"])
            items = []
            docs = results.get("documents") or []
            metas = results.get("metadatas") or []
            ids = results.get("ids") or []
            for mid, doc, meta in zip(ids, docs, metas):
                if meta and str(meta.get("type")) == "knowledge":
                    items.append({
                        "id": mid,
                        "text": doc,
                        "source": meta.get("source"),
                        "chunk_index": meta.get("chunk_index"),
                        "metadata": meta,
                    })
                    if len(items) >= limit:
                        break
            return items
        except Exception as e:
            logger.warning("Failed to list knowledge: %s", e)
            return []

    def delete_knowledge_source(
        self,
        agent_id: int,
        user_id: int,
        source_name: str,
        shared_namespace: Optional[str] = None,
    ) -> int:
        """Delete all knowledge chunks belonging to a given source name."""
        if not self._available:
            return 0
        try:
            where = self._namespace_key(agent_id, user_id, shared_namespace)
            results = self.collection.get(where=where, include=["metadatas"])
            ids_to_del = []
            metas = results.get("metadatas") or []
            ids = results.get("ids") or []
            for mid, meta in zip(ids, metas):
                if meta and str(meta.get("type")) == "knowledge" and str(meta.get("source")) == source_name:
                    ids_to_del.append(mid)
            if ids_to_del:
                self.collection.delete(ids=ids_to_del)
            logger.info("Deleted %d knowledge chunks for source '%s'", len(ids_to_del), source_name)
            return len(ids_to_del)
        except Exception as e:
            logger.warning("Failed to delete knowledge source: %s", e)
            return 0


def get_memory_service() -> LongTermMemoryService:
    global _memory_service
    if _memory_service is None:
        _memory_service = LongTermMemoryService()
    return _memory_service
