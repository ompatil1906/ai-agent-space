"""One-off runtime smoke of authenticated page endpoints (safe read-only calls)."""
import sys
import warnings
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

warnings.filterwarnings("ignore")

from fastapi.testclient import TestClient  # noqa: E402

from app.core.database import SessionLocal  # noqa: E402
from app.core.security import create_access_token  # noqa: E402
from app.main import app  # noqa: E402
from app.models import User  # noqa: E402

db = SessionLocal()
admin = db.query(User).filter(User.email == "patilom1906@gmail.com").first()
seller = db.query(User).filter(User.email == "mk_seller@demo.dev").first()
db.close()

client = TestClient(app)
admin_headers = {"Authorization": f"Bearer {create_access_token(str(admin.id))}"}
seller_headers = {"Authorization": f"Bearer {create_access_token(str(seller.id))}"}

CHECKS = [
    ("admin stats", "/api/v1/admin/stats", admin_headers),
    ("admin orders", "/api/v1/admin/orders", admin_headers),
    ("admin payouts", "/api/v1/admin/payouts", admin_headers),
    ("admin reports", "/api/v1/admin/reports", admin_headers),
    ("admin audit", "/api/v1/admin/audit", admin_headers),
    ("admin refunds", "/api/v1/admin/refunds", admin_headers),
    ("admin settings", "/api/v1/admin/settings", admin_headers),
    ("admin agents", "/api/v1/admin/agents", admin_headers),
    ("purchases subscriptions", "/api/v1/purchases/subscriptions", admin_headers),
    ("purchases history", "/api/v1/purchases/history", admin_headers),
    ("purchases list", "/api/v1/purchases", admin_headers),
    ("users me", "/api/v1/users/me", admin_headers),
    ("creator overview", "/api/v1/creator/overview", seller_headers),
    ("creator earnings", "/api/v1/creator/earnings", seller_headers),
    ("creator payouts", "/api/v1/creator/payouts", seller_headers),
    ("creator profile", "/api/v1/creator/profile", seller_headers),
]

for label, url, headers in CHECKS:
    resp = client.get(url, headers=headers)
    detail = "" if resp.status_code == 200 else resp.text[:100]
    print(resp.status_code, label, detail)
