from datetime import datetime
from sqlalchemy import Boolean, Column, DateTime, Float, ForeignKey, Integer, String, Text, JSON
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

    max_steps = Column(Integer, default=25)
    autonomy_level = Column(String, default="supervised")  # supervised | semi_autonomous | autonomous
    sandbox_enabled = Column(Boolean, default=False)
    advanced_config = Column(JSON, default=dict)

    is_public = Column(Boolean, default=False)
    is_published = Column(Boolean, default=False)
    price = Column(Integer, default=0)
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
