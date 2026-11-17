# backend/tests/test_profiles.py
# Purpose: provider description, category (and the category filter), and the photo / logo upload.

import struct
import zlib

import pytest

from tests.helpers import auth_headers


def tiny_png() -> bytes:
    def chunk(kind: bytes, data: bytes) -> bytes:
        body = kind + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body))

    raw = b"\x00\xff\x00\x00"  # one red pixel
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(raw))
        + chunk(b"IEND", b"")
    )


def make_provider(client, email, **fields):
    h = auth_headers(client, email, email.split("@")[0])
    body = {"service_name": "S", "appointment_duration_minutes": 30, **fields}
    r = client.post("/providers", json=body, headers=h)
    assert r.status_code == 201, r.text
    return {"h": h, "id": r.json()["id"], "json": r.json()}


# ---------------------------------------------------------------- description + category
def test_new_provider_defaults(client):
    p = make_provider(client, "a@test.com")
    assert p["json"]["category"] == "other"
    assert p["json"]["description"] is None
    assert p["json"]["photo_url"] is None
    assert p["json"]["rating_avg"] is None and p["json"]["review_count"] == 0


def test_create_with_description_and_category(client):
    p = make_provider(client, "a@test.com", description="  Gentle family dentistry.  ", category="Dentist")
    assert p["json"]["category"] == "dentist"  # normalised
    assert p["json"]["description"] == "Gentle family dentistry."  # trimmed


def test_unknown_category_is_rejected(client):
    h = auth_headers(client, "a@test.com")
    r = client.post("/providers", json={"service_name": "S", "category": "wizard"}, headers=h)
    assert r.status_code == 422


def test_description_length_is_limited(client):
    h = auth_headers(client, "a@test.com")
    r = client.post("/providers", json={"service_name": "S", "description": "x" * 501}, headers=h)
    assert r.status_code == 422


def test_update_description_and_category_and_clear_description(client):
    p = make_provider(client, "a@test.com")
    r = client.patch("/providers/me", json={"description": "Hello", "category": "tutor"}, headers=p["h"])
    assert r.status_code == 200 and r.json()["description"] == "Hello" and r.json()["category"] == "tutor"

    # fields that are not sent stay as they are
    r = client.patch("/providers/me", json={"service_name": "Maths"}, headers=p["h"])
    assert r.json()["description"] == "Hello" and r.json()["category"] == "tutor"

    r = client.patch("/providers/me", json={"description": ""}, headers=p["h"])
    assert r.json()["description"] is None


def test_filter_by_category(client):
    make_provider(client, "d@test.com", service_name="Smile", category="dentist")
    make_provider(client, "t@test.com", service_name="Maths", category="tutor")
    make_provider(client, "o@test.com", service_name="Misc")

    names = lambda r: sorted(p["service_name"] for p in r.json())  # noqa: E731
    assert names(client.get("/providers?category=dentist")) == ["Smile"]
    assert names(client.get("/providers?category=tutor")) == ["Maths"]
    assert names(client.get("/providers")) == ["Maths", "Misc", "Smile"]
    assert client.get("/providers?category=wizard").status_code == 422


def test_search_also_matches_the_description(client):
    make_provider(client, "d@test.com", service_name="Smile", description="Braces and whitening")
    make_provider(client, "t@test.com", service_name="Maths")
    r = client.get("/providers?search=whitening")
    assert [p["service_name"] for p in r.json()] == ["Smile"]


def test_category_and_search_combine(client):
    make_provider(client, "d@test.com", service_name="Smile", category="dentist")
    make_provider(client, "e@test.com", service_name="Smile coaching", category="consultant")
    r = client.get("/providers?search=smile&category=dentist")
    assert [p["service_name"] for p in r.json()] == ["Smile"]


# ---------------------------------------------------------------- photo
def upload(client, who, content=None, name="p.png", content_type="image/png"):
    return client.post(
        "/providers/me/photo",
        files={"file": (name, tiny_png() if content is None else content, content_type)},
        headers=who["h"],
    )


def test_upload_serve_and_remove_photo(client):
    p = make_provider(client, "a@test.com")
    r = upload(client, p)
    assert r.status_code == 200, r.text
    url = r.json()["photo_url"]
    assert url.startswith(f"/providers/{p['id']}/photo?v=")

    img = client.get(url)
    assert img.status_code == 200
    assert img.headers["content-type"] == "image/png"
    assert "max-age" in img.headers["cache-control"]
    assert img.content == tiny_png()

    # visible on the public profile and the list
    assert client.get(f"/providers/{p['id']}").json()["photo_url"] == url
    assert client.get("/providers").json()[0]["photo_url"] == url

    r = client.delete("/providers/me/photo", headers=p["h"])
    assert r.status_code == 200 and r.json()["photo_url"] is None
    assert client.get(f"/providers/{p['id']}/photo").status_code == 404


def test_photo_404_when_none(client):
    p = make_provider(client, "a@test.com")
    assert client.get(f"/providers/{p['id']}/photo").status_code == 404
    assert client.get("/providers/9999/photo").status_code == 404


def test_photo_rejects_non_images_even_with_an_image_content_type(client):
    p = make_provider(client, "a@test.com")
    r = upload(client, p, content=b"<script>alert(1)</script>", name="x.png", content_type="image/png")
    assert r.status_code == 422


def test_photo_rejects_empty_and_oversized(client):
    p = make_provider(client, "a@test.com")
    assert upload(client, p, content=b"").status_code == 422
    big = tiny_png() + b"0" * (512 * 1024)
    assert upload(client, p, content=big).status_code == 413


def test_photo_detects_type_from_content_not_from_the_header(client):
    p = make_provider(client, "a@test.com")
    upload(client, p, content_type="application/octet-stream")  # a PNG, labelled wrongly
    r = client.get(f"/providers/{p['id']}/photo")
    assert r.headers["content-type"] == "image/png"


def test_changing_photo_changes_the_url(client):
    import time

    p = make_provider(client, "a@test.com")
    first = upload(client, p).json()["photo_url"]
    time.sleep(0.01)
    second = upload(client, p).json()["photo_url"]
    assert first != second  # new ?v= so browser caches never show the old picture


@pytest.mark.parametrize("method", ["post", "delete"])
def test_only_providers_manage_their_photo(client, method):
    customer = auth_headers(client, "c@test.com", "Cust")
    if method == "post":
        r = client.post("/providers/me/photo", files={"file": ("p.png", tiny_png(), "image/png")}, headers=customer)
    else:
        r = client.delete("/providers/me/photo", headers=customer)
    assert r.status_code == 403
    anon = client.delete("/providers/me/photo")
    assert anon.status_code == 401
