from datetime import datetime
from sqlalchemy import Column, DateTime, Float, ForeignKey, Integer, String, Text, JSON
from sqlalchemy.orm import relationship
from app.core.database import Base


class AgentRun(Base):
    __tablename__ = "agent_runs"

    id = Column(Integer, primary_key=True, index=True)
    agent_id = Column(Integer, ForeignKey("agents.id"), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    input = Column(Text, nullable=False)
    output = Column(Text, nullable=True)
    messages = Column(JSON, default=list)
    status = Column(String, default="completed")  # pending, running, completed, error
    error = Column(Text, nullable=True)
    latency_ms = Column(Integer, nullable=True)
    steps_count = Column(Integer, nullable=True)
    input_tokens = Column(Integer, nullable=True, default=0)
    output_tokens = Column(Integer, nullable=True, default=0)
    total_tokens = Column(Integer, nullable=True, default=0)
    estimated_cost_usd = Column(Float, nullable=True, default=0.0)
    thread_id = Column(String, index=True, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    agent = relationship("Agent", back_populates="runs")
    user = relationship("User", back_populates="runs")


class ToolApproval(Base):
    """Persistent human-in-the-loop tool approval requests."""
    __tablename__ = "tool_approvals"

    id = Column(Integer, primary_key=True, index=True)
    request_id = Column(String, unique=True, index=True, nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    agent_id = Column(Integer, ForeignKey("agents.id"), nullable=False, index=True)
    thread_id = Column(String, nullable=True, index=True)
    tool_name = Column(String, nullable=False)
    tool_args = Column(JSON, nullable=True)
    status = Column(String, default="pending", nullable=False)  # pending | approved | denied | expired
    created_at = Column(DateTime, default=datetime.utcnow)
    resolved_at = Column(DateTime, nullable=True)

    user = relationship("User")
    agent = relationship("Agent")
