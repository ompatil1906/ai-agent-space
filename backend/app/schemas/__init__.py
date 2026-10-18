from datetime import datetime
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, EmailStr, Field


# User schemas
class UserBase(BaseModel):
    email: EmailStr
    full_name: Optional[str] = None


class UserCreate(UserBase):
    password: str = Field(min_length=8)


class UserUpdate(BaseModel):
    full_name: Optional[str] = None
    password: Optional[str] = None


class UserInDB(UserBase):
    id: int
    is_active: bool
    is_superuser: bool
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class UserPublic(UserInDB):
    pass


# Auth schemas
class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"


class TokenPayload(BaseModel):
    sub: Optional[int] = None


# Agent schemas
class AgentBase(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    description: Optional[str] = None
    system_prompt: str = "You are a helpful AI assistant."
    model_name: str = "gpt-4o-mini"
    temperature: float = Field(default=0.7, ge=0.0, le=2.0)
    tools_config: List[Dict[str, Any]] = Field(default_factory=list)
    memory_config: Dict[str, Any] = Field(default_factory=dict)
    is_public: bool = False
    is_published: bool = False
    price: int = Field(default=0, ge=0)


class AgentCreate(AgentBase):
    pass


class AgentUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    system_prompt: Optional[str] = None
    model_name: Optional[str] = None
    temperature: Optional[float] = None
    tools_config: Optional[List[Dict[str, Any]]] = None
    memory_config: Optional[Dict[str, Any]] = None
    is_public: Optional[bool] = None
    is_published: Optional[bool] = None
    price: Optional[int] = None


class AgentInDB(AgentBase):
    id: int
    owner_id: int
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class AgentPublic(AgentInDB):
    owner_email: Optional[str] = None  # optional enrichment
