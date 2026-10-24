from datetime import datetime
import re
import uuid

import sqlalchemy as sa
from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    JSON,
    event,
)
from sqlalchemy.orm import relationship
from app.core.database import Base


class Agent(Base):
    __tablename__ = "agents"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, index=True, nullable=False)
    description = Column(Text, nullable=True)
    system_prompt = Column(Text, nullable=False, default="You are a helpful AI assistant.")
    model_name = Column(String, default="gemini-2.0-flash")
    temperature = Column(Float, default=0.7)
    tools_config = Column(JSON, default=list)
    memory_config = Column(JSON, default=dict)
    workflow_config = Column(JSON, default=dict)

    # --- Execution / autonomy (Devin-inspired runtime controls) ---
    max_steps = Column(Integer, default=25)
    autonomy_level = Column(String, default="supervised")  # supervised | semi_autonomous | autonomous
    sandbox_enabled = Column(Boolean, default=False)
    advanced_config = Column(JSON, default=dict)

    is_public = Column(Boolean, default=False)
    is_published = Column(Boolean, default=False)
    # --- Public listing (marketplace) ---
    # `price` is the legacy credit price, preserved for data back-compat. Real
    # pricing lives in AgentPricingPlan rows.
    price = Column(Integer, default=0)
    slug = Column(String, unique=True, index=True, nullable=False)
    tagline = Column(String, nullable=True)                      # one-line value proposition
    avatar_url = Column(String, nullable=True)
    cover_image_url = Column(String, nullable=True)
    category_id = Column(Integer, ForeignKey("agent_categories.id"), nullable=True, index=True)
    tags = Column(JSON, default=list)                             # ["excel", "finance", ...]
    problem_statement = Column(Text, nullable=True)               # the problem this agent solves
    features = Column(JSON, default=list)                          # ["...", ...]
    use_cases = Column(JSON, default=list)                         # ["...", ...]
    target_audience = Column(Text, nullable=True)
    example_prompts = Column(JSON, default=list)                   # [{"title":, "prompt":, "sample_output":}]
    faqs = Column(JSON, default=list)                              # [{"question":, "answer":}]
    usage_instructions = Column(Text, nullable=True)
    refund_window_days = Column(Integer, nullable=True)            # refund terms for buyers
    status = Column(String, default="draft", index=True)           # draft|pending_review|published|rejected|suspended
    published_at = Column(DateTime, nullable=True)
    view_count = Column(Integer, default=0, nullable=False)
    is_featured = Column(Boolean, default=False)
    featured_at = Column(DateTime, nullable=True)
    moderation_note = Column(Text, nullable=True)                  # admin review notes / rejection reason

    owner_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    owner = relationship("User", back_populates="agents")
    runs = relationship("AgentRun", back_populates="agent", cascade="all, delete-orphan")
    versions = relationship(
        "AgentVersion",
        back_populates="agent",
        cascade="all, delete-orphan",
        order_by="AgentVersion.version_number.desc()",
    )
    ratings = relationship("AgentRating", back_populates="agent", cascade="all, delete-orphan")
    evaluations = relationship("AgentEvaluation", back_populates="agent", cascade="all, delete-orphan")
    transactions = relationship(
        "CreditTransaction", foreign_keys="CreditTransaction.agent_id", back_populates="agent", viewonly=True
    )
    categories = relationship("AgentCategory")
    pricing_plans = relationship(
        "AgentPricingPlan", back_populates="agent", cascade="all, delete-orphan"
    )
    purchases = relationship("Purchase", back_populates="agent")


def _slugify_raw(text: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", (text or "").lower()).strip("-")
    slug = re.sub(r"-{2,}", "-", slug)
    return slug[:60] or "agent"


@event.listens_for(Agent, "before_insert")
def agent_default_slug(mapper, connection, target: "Agent") -> None:
    """Safety net: every agent needs a unique slug even when created via direct
    ORM construction (tests/scripts). The API path assigns human-friendly slugs
    via services.execution_auth.ensure_unique_slug before this runs."""
    if getattr(target, "slug", None):
        return
    existing = {
        row[0]
        for row in connection.execute(sa.select(Agent.slug)).fetchall()
    }
    base = _slugify_raw(target.name or "agent")
    candidate = base
    while candidate in existing:
        candidate = f"{base}-{uuid.uuid4().hex[:6]}"
    target.slug = candidate


class AgentVersion(Base):
    __tablename__ = "agent_versions"

    id = Column(Integer, primary_key=True, index=True)
    agent_id = Column(Integer, ForeignKey("agents.id"), nullable=False, index=True)
    version_number = Column(Integer, nullable=False)
    name = Column(String, nullable=False)
    description = Column(Text, nullable=True)
    system_prompt = Column(Text, nullable=False)
    model_name = Column(String)
    temperature = Column(Float)
    tools_config = Column(JSON, default=list)
    memory_config = Column(JSON, default=dict)
    workflow_config = Column(JSON, default=dict)
    snapshot = Column(JSON)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    change_note = Column(String, nullable=True)

    agent = relationship("Agent", back_populates="versions")
