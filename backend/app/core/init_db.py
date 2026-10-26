import logging
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.security import get_password_hash, verify_password
from app.models import User

logger = logging.getLogger(__name__)


def init_db(db: Session) -> None:
    """Initialize database state and ensure the default admin user exists."""
    admin_email = (settings.FIRST_SUPERUSER_EMAIL or "").strip()
    admin_password = settings.FIRST_SUPERUSER_PASSWORD

    if not admin_email:
        return

    try:
        user = db.query(User).filter(User.email == admin_email).first()
        if not user:
            user = User(
                email=admin_email,
                hashed_password=get_password_hash(admin_password),
                full_name="Admin",
                is_active=True,
                is_superuser=True,
                role="admin",
            )
            db.add(user)
            db.commit()
            logger.info("Created default admin user: %s", admin_email)
        else:
            updated = False
            if not user.is_superuser:
                user.is_superuser = True
                updated = True
            if getattr(user, "role", None) != "admin":
                user.role = "admin"
                updated = True
            if not user.is_active:
                user.is_active = True
                updated = True
            if admin_password and not verify_password(admin_password, user.hashed_password):
                user.hashed_password = get_password_hash(admin_password)
                updated = True
            if updated:
                db.commit()
                logger.info("Updated default admin user: %s (role=admin, is_superuser=True)", admin_email)
    except Exception as e:
        logger.error("Error ensuring default admin user: %s", e)
        db.rollback()
