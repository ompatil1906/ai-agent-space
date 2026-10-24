from datetime import datetime
from sqlalchemy import Boolean, Column, DateTime, Integer, String
from sqlalchemy.orm import relationship
from app.core.database import Base


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, unique=True, index=True, nullable=False)
    hashed_password = Column(String, nullable=False)
    full_name = Column(String, nullable=True)
    is_active = Column(Boolean, default=True)
    is_superuser = Column(Boolean, default=False)
    credits = Column(Integer, default=1000)  # legacy in-app credits (deprecated, kept for data preservation)
    # Marketplace role: customer (default) | creator | admin. Admins also have is_superuser.
    role = Column(String, default="customer", nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    agents = relationship("Agent", back_populates="owner", cascade="all, delete-orphan")
    runs = relationship("AgentRun", back_populates="user", cascade="all, delete-orphan")
    ratings = relationship("AgentRating", back_populates="user", cascade="all, delete-orphan")
    evaluations = relationship("AgentEvaluation", back_populates="user", cascade="all, delete-orphan")
    transactions = relationship(
        "CreditTransaction", foreign_keys="CreditTransaction.user_id", back_populates="user"
    )
    api_keys = relationship("ApiKey", back_populates="user", cascade="all, delete-orphan")

    @property
    def is_admin(self) -> bool:
        return bool(self.is_superuser) or (self.role or "") == "admin"


# Backward-compatibility re-exports for code/migrations importing from app.models.user
from app.models.agent import Agent, AgentVersion  # noqa: F401, E402
from app.models.run import AgentRun, ToolApproval  # noqa: F401, E402
from app.models.marketplace import (  # noqa: F401, E402
    AgentRating,
    AgentEvaluation,
    CreditTransaction,
    CreatorProfile,
    AgentCategory,
    AgentPricingPlan,
    Purchase,
    Entitlement,
    Subscription,
    PaymentTransaction,
    RefundDispute,
    EarningsLedgerEntry,
    Payout,
    WebhookEvent,
    AuditLog,
    ModerationReport,
    PlatformSetting,
)
from app.models.mcp import ApiKey, ProviderKey, MCPServer  # noqa: F401, E402
