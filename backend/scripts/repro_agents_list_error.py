"""Reproduce the /api/v1/agents/ 500 with an authenticated token."""
import sys
import warnings
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

warnings.filterwarnings("ignore")

from fastapi.testclient import TestClient  # noqa: E402

from app.core.database import SessionLocal  # noqa: E402
from app.core.security import create_access_token  # noqa: E402
from app.main import app  # noqa: E402
from app.models import Agent, User  # noqa: E402

email = sys.argv[1] if len(sys.argv) > 1 else "patilom1906@gmail.com"
db = SessionLocal()
user = db.query(User).filter(User.email == email).first()
db.close()
print("as:", email)

client = TestClient(app, raise_server_exceptions=True)


def attempt(label: str, url: str) -> None:
    try:
        resp = client.get(
            url, headers={"Authorization": f"Bearer {create_access_token(str(user.id))}"}
        )
        print(resp.status_code, label, resp.text[:80].replace("\n", " "))
    except Exception:
        import traceback

        print("TRACEBACK for", label)
        traceback.print_exc()


attempt("agents list", "/api/v1/agents/")
attempt("agents full list", "/api/v1/agents/?limit=100&include_full=true")

db = SessionLocal()
first_agent = db.query(Agent).filter(Agent.owner_id == user.id).first()
agent_id = first_agent.id
db.close()

attempt("agent detail", f"/api/v1/agents/{agent_id}")
attempt("agent versions", f"/api/v1/agents/{agent_id}/versions")
