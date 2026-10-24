from datetime import datetime
from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, String, Text, JSON
from sqlalchemy.orm import relationship
from app.core.database import Base


class ApiKey(Base):
    """API keys for programmatic / external access to agents."""
    __tablename__ = "api_keys"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    name = Column(String, nullable=False)
    key_prefix = Column(String, nullable=False, index=True)
    key_hash = Column(String, nullable=False, unique=True, index=True)
    agent_id = Column(Integer, ForeignKey("agents.id"), nullable=True, index=True)
    scopes = Column(JSON, default=list)
    is_active = Column(Boolean, default=True)
    expires_at = Column(DateTime, nullable=True)
    last_used_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    user = relationship("User", back_populates="api_keys")
    agent = relationship("Agent")


class ProviderKey(Base):
    """Bring-your-own-key LLM provider credentials."""
    __tablename__ = "provider_keys"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    provider = Column(String, nullable=False)  # gemini | openai | anthropic | custom
    label = Column(String, nullable=True)
    api_key = Column(String, nullable=False)
    base_url = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class MCPServer(Base):
    """User-owned reusable MCP server configuration."""
    __tablename__ = "mcp_servers"

    id = Column(Integer, primary_key=True, index=True)
    owner_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    name = Column(String, nullable=False, index=True)
    description = Column(Text, nullable=True)
    config = Column(JSON, nullable=False)
    logo_slug = Column(String, nullable=True)
    category = Column(String, nullable=True)
    is_public = Column(Boolean, default=False)
    last_status = Column(String, nullable=True)
    last_checked_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    owner = relationship("User", backref="mcp_servers")
