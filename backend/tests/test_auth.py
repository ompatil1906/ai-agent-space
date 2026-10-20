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
