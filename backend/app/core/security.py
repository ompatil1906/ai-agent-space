from datetime import datetime, timedelta
from typing import Any, Optional, Union

import bcrypt
from jose import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import get_db
from app.models import User

oauth2_scheme = OAuth2PasswordBearer(tokenUrl=f"{settings.API_V1_STR}/auth/login")


def verify_password(plain_password: str, hashed_password: str) -> bool:
    try:
        if isinstance(hashed_password, str):
            hashed_password = hashed_password.encode("utf-8")
        return bcrypt.checkpw(plain_password.encode("utf-8")[:72], hashed_password)
    except Exception:
        return False


def get_password_hash(password: str) -> str:
    pwd_bytes = password.encode("utf-8")[:72]
    return bcrypt.hashpw(pwd_bytes, bcrypt.gensalt()).decode("utf-8")


def create_access_token(subject: Union[str, Any], expires_delta: Optional[timedelta] = None) -> str:
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode = {"exp": expire, "sub": str(subject)}
    encoded_jwt = jwt.encode(to_encode, settings.SECRET_KEY, algorithm=settings.ALGORITHM)
    return encoded_jwt


def get_current_user(
    db: Session = Depends(get_db),
    token: str = Depends(oauth2_scheme),
) -> User:
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
        user_id: str = payload.get("sub")
        if user_id is None:
            raise credentials_exception
    except jwt.JWTError:
        raise credentials_exception
    user = db.query(User).filter(User.id == int(user_id)).first()
    if user is None:
        raise credentials_exception
    return user


def get_current_active_user(
    current_user: User = Depends(get_current_user),
) -> User:
    if not current_user.is_active:
        raise HTTPException(status_code=400, detail="Inactive user")
    return current_user




# ---------------------------------------------------------------------------
# API Key authentication (programmatic access)
# ---------------------------------------------------------------------------
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
import hashlib
from app.models import ApiKey

# Optional bearer that does not auto-error
optional_oauth2_scheme = OAuth2PasswordBearer(
    tokenUrl=f"{settings.API_V1_STR}/auth/login",
    auto_error=False,
)
api_key_bearer = HTTPBearer(auto_error=False)


def _hash_api_key(raw: str) -> str:
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def get_user_from_api_key(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(api_key_bearer),
    db: Session = Depends(get_db),
) -> Optional[User]:
    """Resolve user from an API key presented as Bearer token. Returns None if not an API key."""
    if credentials is None or not credentials.credentials:
        return None
    token = credentials.credentials
    if not token.startswith("ask_"):
        return None
    key_hash = _hash_api_key(token)
    api_key = (
        db.query(ApiKey)
        .filter(ApiKey.key_hash == key_hash, ApiKey.is_active.is_(True))
        .first()
    )
    if api_key is None:
        return None
    if api_key.expires_at and api_key.expires_at < datetime.utcnow():
        return None
    # Touch last_used
    api_key.last_used_at = datetime.utcnow()
    db.commit()
    return db.query(User).filter(User.id == api_key.user_id).first()


def get_current_user_flexible(
    db: Session = Depends(get_db),
    jwt_token: Optional[str] = Depends(optional_oauth2_scheme),
    api_user: Optional[User] = Depends(get_user_from_api_key),
) -> User:
    """Accept either a JWT access token or an API key (Bearer ask_...)."""
    if api_user is not None:
        if not api_user.is_active:
            raise HTTPException(status_code=400, detail="Inactive user")
        return api_user
    if jwt_token:
        user = get_current_user(db=db, token=jwt_token)
        if not user.is_active:
            raise HTTPException(status_code=400, detail="Inactive user")
        return user
    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Not authenticated. Provide a Bearer JWT or API key.",
        headers={"WWW-Authenticate": "Bearer"},
    )
