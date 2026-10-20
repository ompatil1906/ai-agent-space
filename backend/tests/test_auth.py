def test_register_and_login(client):
    # Register
    resp = client.post(
        "/api/v1/auth/register",
        json={"email": "new@example.com", "password": "secret123", "full_name": "New User"},
    )
    assert resp.status_code == 201
    data = resp.json()
    assert data["email"] == "new@example.com"
    assert "id" in data

    # Login
    resp = client.post(
        "/api/v1/auth/login",
        data={"username": "new@example.com", "password": "secret123"},
    )
    assert resp.status_code == 200
    assert "access_token" in resp.json()


def test_me_endpoint(client, auth_headers, test_user):
    resp = client.get("/api/v1/auth/me", headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json()["email"] == test_user.email


def test_case_insensitive_email_login(client):
    """Registered as Mixed@Case.COM, must be able to log in with any casing + spaces."""
    resp = client.post(
        "/api/v1/auth/register",
        json={"email": "MixedCase@Example.COM", "password": "secret123", "full_name": "Case User"},
    )
    assert resp.status_code == 201
    # Email is normalized on storage, never lowercased in the response for legacy users
    assert resp.json()["email"] == "mixedcase@example.com"

    resp = client.post(
        "/api/v1/auth/login",
        data={"username": " mixedcase@example.com ", "password": "secret123"},
    )
    assert resp.status_code == 200, resp.text
    assert "access_token" in resp.json()

    resp = client.post(
        "/api/v1/auth/login",
        data={"username": "mixedcase@example.com", "password": "wrongpass"},
    )
    assert resp.status_code == 401
