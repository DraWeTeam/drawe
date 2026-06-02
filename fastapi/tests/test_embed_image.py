"""Integration tests for POST /embed/image.

These tests import the live FastAPI app (which loads CLIP on import), so the
first run is slow. Subsequent runs reuse the Hugging Face cache.
"""

import io
import math

from fastapi.testclient import TestClient
from PIL import Image

from main import app, embed_text, TextEmbedRequest


client = TestClient(app)


def _png_bytes(color=(255, 0, 0), size=(64, 64)) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", size, color=color).save(buf, format="PNG")
    return buf.getvalue()


def _jpeg_bytes(color=(0, 128, 255), size=(64, 64)) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", size, color=color).save(buf, format="JPEG", quality=90)
    return buf.getvalue()


def _cosine(a, b):
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(x * x for x in b))
    return dot / (na * nb)


def test_embed_image_png_returns_normalized_768d():
    res = client.post(
        "/embed/image",
        files={"image": ("red.png", _png_bytes(), "image/png")},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["dimension"] == 768
    assert isinstance(body["embedding"], list)
    assert len(body["embedding"]) == 768
    norm = math.sqrt(sum(x * x for x in body["embedding"]))
    assert math.isclose(norm, 1.0, abs_tol=1e-4), f"expected L2 norm ~1.0, got {norm}"


def test_embed_image_jpeg_ok():
    res = client.post(
        "/embed/image",
        files={"image": ("blue.jpg", _jpeg_bytes(), "image/jpeg")},
    )
    assert res.status_code == 200, res.text
    assert res.json()["dimension"] == 768


def test_embed_image_rejects_non_image_content_type():
    res = client.post(
        "/embed/image",
        files={"image": ("note.txt", b"hello", "text/plain")},
    )
    assert res.status_code == 400


def test_embed_image_rejects_corrupt_bytes():
    res = client.post(
        "/embed/image",
        files={"image": ("broken.png", b"not a real png at all", "image/png")},
    )
    assert res.status_code == 400


def test_text_and_image_share_embedding_space():
    """Sanity check: text 'red color' should be closer to a red image than to a blue image."""
    red_resp = client.post(
        "/embed/image",
        files={"image": ("red.png", _png_bytes(color=(255, 0, 0)), "image/png")},
    )
    blue_resp = client.post(
        "/embed/image",
        files={"image": ("blue.png", _png_bytes(color=(0, 0, 255)), "image/png")},
    )
    assert red_resp.status_code == 200
    assert blue_resp.status_code == 200

    red_vec = red_resp.json()["embedding"]
    blue_vec = blue_resp.json()["embedding"]

    text_resp = embed_text(TextEmbedRequest(text="a red square"))
    text_vec = text_resp.embedding

    sim_red = _cosine(text_vec, red_vec)
    sim_blue = _cosine(text_vec, blue_vec)

    # Red text should match the red image more strongly than the blue image.
    assert sim_red > sim_blue, (
        f"expected cosine(text='a red square', red_img) > cosine(..., blue_img); "
        f"got red={sim_red:.4f} blue={sim_blue:.4f}"
    )
