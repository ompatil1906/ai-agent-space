#!/usr/bin/env python3
"""
CLI script to create or promote an admin user in AI Agent Space.

Usage:
  cd backend && python scripts/create_admin.py
  cd backend && python scripts/create_admin.py --email custom@example.com --password SecurePass123
"""
import argparse
import os
import sys

# Allow running from repo root or backend/
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from app.core.config import settings
from app.core.database import SessionLocal
from app.core.security import get_password_hash
from app.models import User


def create_or_update_admin(email: str, password: str, full_name: str = "Admin") -> None:
    db = SessionLocal()
    try:
        user = db.query(User).filter(User.email == email).first()
        if not user:
            user = User(
                email=email,
                hashed_password=get_password_hash(password),
                full_name=full_name,
                is_active=True,
                is_superuser=True,
                role="admin",
            )
            db.add(user)
            db.commit()
            print(f"✓ Created new admin user: {email}")
        else:
            user.role = "admin"
            user.is_superuser = True
            user.is_active = True
            if password:
                user.hashed_password = get_password_hash(password)
            db.commit()
            print(f"✓ Updated user to admin: {email} (role=admin, is_superuser=True)")
    finally:
        db.close()


def main():
    parser = argparse.ArgumentParser(description="Create or promote an admin user")
    parser.add_argument(
        "--email",
        default=settings.FIRST_SUPERUSER_EMAIL or "patilom1906@gmail.com",
        help="Admin email address",
    )
    parser.add_argument(
        "--password",
        default=settings.FIRST_SUPERUSER_PASSWORD or "Ompatil@1906",
        help="Admin password",
    )
    parser.add_argument(
        "--name",
        default="Admin",
        help="Full name",
    )
    args = parser.parse_args()
    create_or_update_admin(args.email.strip(), args.password, args.name)


if __name__ == "__main__":
    main()
