"""imagen_rest_gen.py — Vertex Imagen 생성 'seam', REST 경로(vertexai SDK 불필요).

왜 이게 따로 있나(2026-06-30 발견): scripts/imagen_generate.py 는 vertexai SDK(ImageGenerationModel)를
쓰는데 **guide 컨테이너엔 vertexai SDK 가 없다**(VLM vertex 백엔드는 REST 로 호출하므로 SDK 미설치).
그래서 컨테이너에서 imagen_generate.py 는 안 돈다. 이 파일은 guide/ml/vision.py 의 `_vertex_token`
패턴(google.auth ADC → OAuth 토큰 → REST POST)을 그대로 재사용해 **컨테이너 안에서** Imagen 을 호출한다.

핵심 함정:
  · GOOGLE_CLOUD_LOCATION 은 컨테이너 기본이 `global`인데 **Imagen 은 global 미지원** → us-central1 강제
    (IMAGEN_LOCATION). 토큰은 리전 무관.
  · 모델 IMAGEN_MODEL=imagen-4.0-generate-001(골든 손셋도 imagen-4.0). predict 엔드포인트.
  · personGeneration=allow_adult(전신 인물), Imagen 레이턴시 스파이크 잦음 → timeout 240 + 재시도 3.

실행(guide 컨테이너 — ADC /secrets/adc.json + 프로젝트가 이미 있음):
  docker cp scripts/imagen_rest_gen.py drawe-guide:/tmp/imagen_rest_gen.py
  docker exec -e GOOGLE_CLOUD_PROJECT=<proj> -e GOOGLE_APPLICATION_CREDENTIALS=/secrets/adc.json \
      drawe-guide python /tmp/imagen_rest_gen.py --out /tmp/gen --n 5 --cells contrapposto,imbalance
  # smoke(1장만, 모델/엔드포인트/인증 검증): --smoke
  docker cp drawe-guide:/tmp/gen ./gen   # 이미지+manifest.jsonl 회수

산출: <out>/<cell>_<j>.png + manifest.jsonl({file,intent,model,prompt}). 이후 승격은 골든셋 3겹 게이트
(expansion_matrix.md '3겹 프로세스'·'운영') — _staging → 1겹 적합성 → 2겹 블라인드 → golden_images.sha256
+ labels.json + expansion_meta.json. (ai_example 레퍼런스 코퍼스는 별개: ingest_ai_examples.py.)

CELLS 는 이 파일의 '주문서'다 — 새 칸은 여기 프롬프트만 추가(expansion_matrix 매트릭스와 동기).
"""
import os, sys, json, base64, argparse
import requests
from google.auth import default as adc_default
from google.auth.transport.requests import Request

PROJECT = os.environ["GOOGLE_CLOUD_PROJECT"]
LOCATION = os.environ.get("IMAGEN_LOCATION", "us-central1")  # Imagen 은 global 미지원
MODEL = os.environ.get("IMAGEN_MODEL", "imagen-4.0-generate-001")

_creds = None
def token():
    global _creds
    if _creds is None:
        _creds, _ = adc_default(scopes=["https://www.googleapis.com/auth/cloud-platform"])
    if not _creds.valid:
        _creds.refresh(Request())
    return _creds.token

def url():
    host = LOCATION + "-aiplatform.googleapis.com"
    return (f"https://{host}/v1/projects/{PROJECT}/locations/{LOCATION}"
            f"/publishers/google/models/{MODEL}:predict")

def gen_one(prompt, tries=3):
    body = {"instances": [{"prompt": prompt}],
            "parameters": {"sampleCount": 1, "aspectRatio": "3:4",
                           "personGeneration": "allow_adult"}}
    r = None
    for t in range(tries):
        try:
            r = requests.post(url(), headers={"Content-Type": "application/json",
                              "Authorization": "Bearer " + token()},
                              json=body, timeout=240)
            break
        except requests.exceptions.RequestException as e:
            if t == tries - 1:
                return None, f"request exc after {tries}: {type(e).__name__}"
    if r is None or r.status_code != 200:
        return None, f"HTTP {getattr(r,'status_code','?')}: {getattr(r,'text','')[:300]}"
    preds = r.json().get("predictions", [])
    if not preds:
        return None, f"no predictions (filtered?): {json.dumps(r.json())[:300]}"
    b64 = preds[0].get("bytesBase64Encoded")
    if not b64:
        return None, f"no bytes: {json.dumps(preds[0])[:200]}"
    return base64.b64decode(b64), None

# 칸(cell) = 생성 의도. expansion_matrix.md 매트릭스와 동기화. 새 칸은 여기 추가.
CELLS = {
    "contrapposto": ("Full-body standing human figure in a clear contrapposto pose: weight clearly "
        "on one leg, the hip raised on the weight-bearing side and the shoulders tilted the opposite "
        "way, a gentle S-curve through the spine — BUT the center of gravity stays balanced over the "
        "supporting foot so the figure is stable and NOT falling. Anatomically correct proportions, "
        "single full-body figure, plain white background, hand-drawn, no text, NOT photorealistic, NOT 3D render."),
    "imbalance": ("Full-body standing human figure that is genuinely off-balance: the center of "
        "gravity has shifted well outside the base of the feet so the person looks about to tip over "
        "and fall, unstable toppling stance. Single full-body figure, plain white background, "
        "hand-drawn, no text, NOT photorealistic, NOT 3D render."),
}

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--n", type=int, default=5)
    ap.add_argument("--cells", default="contrapposto,imbalance")
    ap.add_argument("--plan", help="JSON list of {name, prompt, n?} — 외부 주문서(CELLS 대신)")
    ap.add_argument("--smoke", action="store_true", help="1 image only, print status")
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    man = open(os.path.join(a.out, "manifest.jsonl"), "a", encoding="utf-8")
    print(f"model={MODEL} loc={LOCATION} proj={PROJECT}")
    # plan(외부 JSON) 우선, 없으면 내장 CELLS + --cells.
    # 메타(supports/medium/track)는 plan 항목에서 통과시켜 manifest 에 기록한다.
    META_KEYS = ("supports", "medium", "track")
    if a.plan:
        items = json.load(open(a.plan, encoding="utf-8-sig"))
        plan = [(it["name"], it["prompt"], int(it.get("n", a.n)),
                 {k: it[k] for k in META_KEYS if k in it}) for it in items]
    else:
        plan = [(c, CELLS[c], a.n, {}) for c in a.cells.split(",")]
    made = 0
    for cell, prompt, cell_n, meta in plan:
        n = 1 if a.smoke else cell_n
        for j in range(n):
            data, err = gen_one(prompt)
            if err:
                print(f"  FAIL {cell}[{j}]: {err}")
                if a.smoke:
                    return
                continue
            fn = f"{cell}_{j:02d}.png"
            with open(os.path.join(a.out, fn), "wb") as f:
                f.write(data)
            man.write(json.dumps({"file": fn, "intent": cell, "model": MODEL,
                      **meta, "prompt": prompt}, ensure_ascii=False) + "\n")
            man.flush()
            made += 1
            print(f"  OK {fn} ({len(data)} bytes)")
        if a.smoke:
            break
    print(f"made {made} -> {a.out}")

if __name__ == "__main__":
    main()
