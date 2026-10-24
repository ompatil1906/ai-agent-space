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
    credits = Column(Integer, default=1000)  # marketplace credits
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
