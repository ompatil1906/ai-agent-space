from datetime import datetime
from sqlalchemy import Column, DateTime, Float, ForeignKey, Integer, String, Text, JSON
from sqlalchemy.orm import relationship
from app.core.database import Base


class AgentRating(Base):
    """Marketplace ratings for published agents."""
    __tablename__ = "agent_ratings"

    id = Column(Integer, primary_key=True, index=True)
    agent_id = Column(Integer, ForeignKey("agents.id"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    rating = Column(Integer, nullable=False)  # 1-5
    review = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    agent = relationship("Agent", back_populates="ratings")
    user = relationship("User", back_populates="ratings")


class AgentEvaluation(Base):
    """Persisted evaluation results (LLM-as-judge) for agents."""
    __tablename__ = "agent_evaluations"

    id = Column(Integer, primary_key=True, index=True)
    agent_id = Column(Integer, ForeignKey("agents.id"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    input = Column(Text, nullable=False)
    agent_output = Column(Text, nullable=True)
    score = Column(Float, nullable=False)  # 1-10
    explanation = Column(Text, nullable=True)
    criteria = Column(String, nullable=True)
    criteria_scores = Column(JSON, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    agent = relationship("Agent", back_populates="evaluations")
    user = relationship("User", back_populates="evaluations")


class CreditTransaction(Base):
    """Ledger of credit movements for users (purchases, sales, run metering, grants)."""
    __tablename__ = "credit_transactions"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    amount = Column(Integer, nullable=False)
    balance_after = Column(Integer, nullable=False)
    reason = Column(String, nullable=False)  # agent_sale | agent_purchase | run_meter | admin_grant
    counterparty_user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    agent_id = Column(Integer, ForeignKey("agents.id"), nullable=True)
    reference_id = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    user = relationship(
        "User", foreign_keys="CreditTransaction.user_id", back_populates="transactions"
    )
    agent = relationship(
        "Agent", foreign_keys="CreditTransaction.agent_id", back_populates="transactions", viewonly=True
    )
