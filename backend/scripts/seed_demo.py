#!/usr/bin/env python3
"""
Seed script for AI Agent Space demo data.
Creates a demo user and a few sample agents for quick start / testing.

Usage:
  cd backend && python scripts/seed_demo.py
"""
import os
import sys

# Allow running from repo root or backend/
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from sqlalchemy.orm import Session

from app.core.database import SessionLocal
from app.core.security import get_password_hash
from app.models import User, Agent


def seed():
    db: Session = SessionLocal()
    try:
        # Demo user
        email = "demo@aiagentspace.dev"
        user = db.query(User).filter(User.email == email).first()
        if not user:
            user = User(
                email=email,
                hashed_password=get_password_hash("demo1234"),
                full_name="Demo User",
                is_active=True,
            )
            db.add(user)
            db.commit()
            db.refresh(user)
            print(f"Created demo user: {email} / demo1234")
        else:
            print(f"Demo user already exists: {email}")

        # Sample agents
        samples = [
            {
                "name": "Code Assistant",
                "description": "Expert software engineer agent for writing, debugging, and reviewing code.",
                "system_prompt": "You are an elite AI software engineer. Write clean, production-quality code, explain your reasoning, and always consider edge cases and tests.",
                "model_name": "gemini-3.5-flash-lite",
                "temperature": 0.2,
                "is_public": True,
            },
            {
                "name": "Research Analyst",
                "description": "Long-horizon research agent that plans, searches, and synthesizes information.",
                "system_prompt": "You are a meticulous research analyst. Break down complex questions, gather evidence, cross-check facts, and deliver structured, well-cited reports.",
                "model_name": "gemini-3.5-flash-lite",
                "temperature": 0.4,
                "is_public": True,
            },
            {
                "name": "Task Automator",
                "description": "General-purpose autonomous agent for multi-step workflows and tool use.",
                "system_prompt": "You are a highly autonomous AI agent. Plan carefully, use tools effectively, reflect on results, and complete the user's goal with minimal intervention.",
                "model_name": "gemini-3.5-flash-lite",
                "temperature": 0.3,
                "is_public": False,
            },
        ]

        for sample in samples:
            existing = db.query(Agent).filter(Agent.name == sample["name"], Agent.owner_id == user.id).first()
            if not existing:
                agent = Agent(
                    owner_id=user.id,
                    name=sample["name"],
                    description=sample["description"],
                    system_prompt=sample["system_prompt"],
                    model_name=sample["model_name"],
                    temperature=sample["temperature"],
                    is_public=sample["is_public"],
                    status="published" if sample["is_public"] else "draft",
                )
                db.add(agent)
                print(f"Created sample agent: {sample['name']}")
            else:
                print(f"Sample agent already exists: {sample['name']}")

        db.commit()
        print("Seeding complete.")
    except Exception as e:
        db.rollback()
        print(f"Seeding failed: {e}")
        raise
    finally:
        db.close()


if __name__ == "__main__":
    seed()
