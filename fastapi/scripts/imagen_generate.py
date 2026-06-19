"""imagen_generate.py — Vertex AI Imagen 생성 'seam'. plan → 이미지 폴더 + manifest.jsonl.

gemini_generate.py(AI Studio)와 **동일한 plan·manifest 규약**을 공유한다. 차이는 호출부(_imagen_image)뿐.
ingest_ai_examples.py 가 먹는 폴더 규약(이미지 + manifest.jsonl)을 Vertex Imagen 으로 채운다.

왜 이 경로인가:
  · GCP $300 무료 체험 크레딧은 **Vertex AI 의 Imagen 에 적용**된다(AI Studio Gemini API 에는 적용 안 됨).
  · Vertex Imagen 생성물은 Google 약관상 상업 사용 가능 + (Vertex/엔터프라이즈) **IP 면책** 대상이다.
    → 코퍼스 메타에는 "100% 라이선스 데이터"가 아니라 "Google IP-면책"으로 적되, 최종 약관은 직접 확인할 것.
  · 출력에는 SynthID 워터마크가 들어간다(레퍼런스 용도엔 무해).

인증(ADC) — 둘 중 하나:
  gcloud auth application-default login                 # 로컬 개발
  export GOOGLE_APPLICATION_CREDENTIALS=/path/sa.json   # 서비스 계정(잡/CI)
환경:
  export GOOGLE_CLOUD_PROJECT=<your-project>
  export GOOGLE_CLOUD_LOCATION=us-central1              # 사용 리전
  export IMAGEN_MODEL=imagen-3.0-generate-002           # 현재 사용 모델명으로 확인/수정
설치:
  pip install google-cloud-aiplatform pillow

실행:
  python scripts/imagen_generate.py gen_plans/coverage_fill_imagen.json --out /tmp/gen_out
  # 그다음(QC+적재, license 를 Imagen 출처로):
  python scripts/ingest_ai_examples.py /tmp/gen_out \
      --state /tmp/gen_out/_ingest_state.txt \
      --license "Vertex-Imagen (Google IP-indemnified)" \
      --attribution "AI example — Vertex AI Imagen, QC-gated"

보안: GOOGLE_APPLICATION_CREDENTIALS / 프로젝트 자격은 **백엔드 전용**. 프론트(VITE_)로 절대 노출 금지.
멱등성: 파일명은 'img_' 접두(gemini 의 'gen_' 와 충돌 안 함). 같은 폴더에 누적해도 ingest 가 파일명 기준으로
        스킵한다 — 단 ingest 의 --state 는 영속 경로로! (BACKFILL.md '멱등성' 참고)
"""

import os
import sys
import json
import argparse
import io


def _model():
    """Vertex Imagen 모델 핸들. 프로젝트/리전/모델은 env. SDK·자격 없으면 명확히 안내하고 종료."""
    proj = os.environ.get("GOOGLE_CLOUD_PROJECT")
    loc = os.environ.get("GOOGLE_CLOUD_LOCATION", "us-central1")
    name = os.environ.get("IMAGEN_MODEL", "imagen-3.0-generate-002")
    if not proj:
        print("GOOGLE_CLOUD_PROJECT 미설정(백엔드 환경에만 설정).")
        sys.exit(2)
    try:
        import vertexai
        from vertexai.preview.vision_models import ImageGenerationModel
    except Exception as e:
        print(f"vertexai SDK 로드 실패: {type(e).__name__}: {e}")
        print("설치: pip install google-cloud-aiplatform")
        sys.exit(2)
    try:
        vertexai.init(project=proj, location=loc)
        return ImageGenerationModel.from_pretrained(name), name
    except Exception as e:
        print(f"Vertex 초기화/모델 로드 실패: {type(e).__name__}: {e}")
        print(
            "ADC 인증(gcloud auth application-default login) 또는 "
            "GOOGLE_APPLICATION_CREDENTIALS, 그리고 Vertex AI API 활성화를 확인하세요."
        )
        sys.exit(2)


def _imagen_image(model, prompt):
    """프롬프트 → PIL.Image(첫 결과 1장). 실패/차단 시 None.

    ⚠️ generate_images 의 인자·응답 구조는 SDK/모델 버전마다 다를 수 있다. 현재 모델 문서로 *이 함수만*
       확인/수정하면 된다(나머지 파이프라인은 그대로). 아래는 방어적 구현이다.
    """
    from PIL import Image

    try:
        resp = model.generate_images(
            prompt=prompt,
            number_of_images=1,
            aspect_ratio="1:1",
            # 필요 시: safety_filter_level="block_some", add_watermark=True 등 모델 정책에 맞게 추가
        )
    except Exception as e:
        print(f"    생성 실패: {type(e).__name__}: {e}")
        return None
    try:
        imgs = list(resp) if resp is not None else []
        if not imgs:
            print("    이미지 0장(안전필터 차단 가능) — 프롬프트를 조정하세요.")
            return None
        gi = imgs[0]
        pil = getattr(gi, "_pil_image", None)  # vertexai GeneratedImage 내부 PIL
        if pil is not None:
            return pil.convert("RGB")
        data = getattr(gi, "_image_bytes", None)  # 폴백: 원시 바이트
        if data:
            return Image.open(io.BytesIO(data)).convert("RGB")
    except Exception as e:
        print(f"    응답 파싱 실패: {type(e).__name__}: {e}")
    print(
        "    이미지 추출 실패 — _imagen_image() 를 현재 SDK 응답 구조에 맞게 수정하세요."
    )
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("plan", help="계획 JSON(plan.json 또는 coverage_fill_imagen.json)")
    ap.add_argument(
        "--out",
        default="gen_out",
        help="출력 폴더(컨테이너 /repo 읽기전용이면 /tmp/gen_out)",
    )
    args = ap.parse_args()

    plan = json.load(open(args.plan, encoding="utf-8-sig"))
    os.makedirs(args.out, exist_ok=True)
    model, name = _model()
    print(f"Vertex Imagen 준비: model={name}")
    man = open(os.path.join(args.out, "manifest.jsonl"), "a", encoding="utf-8")

    made = skipped = 0
    for i, item in enumerate(plan):
        if item.get("gen") == "procedural":  # 절차적 항목은 이 스크립트 대상 아님
            skipped += 1
            continue
        concept = item["concept"]
        axes = item.get("axes")
        caption = item.get("caption")
        n = int(item.get("n", 1))
        for j in range(n):
            img = _imagen_image(model, concept)
            if img is None:
                continue
            fn = f"img_{i:03d}_{j:02d}.png"  # 'img_' 접두 — gemini 'gen_' 와 충돌 방지
            img.save(os.path.join(args.out, fn))
            rec = {"file": fn, "concept": concept}
            if axes is not None:
                rec["axes"] = axes
            if caption:
                rec["caption"] = caption
            man.write(json.dumps(rec, ensure_ascii=False) + "\n")
            man.flush()
            made += 1
            print(f"  생성  {fn}  ← {concept[:48]}")

    print(
        f"\n생성 {made}장 → {args.out}/  (manifest.jsonl 포함)"
        + (f"  · 절차적 {skipped}항목 건너뜀" if skipped else "")
    )
    print(
        f"다음: python scripts/ingest_ai_examples.py {args.out} "
        f"--state {args.out}/_ingest_state.txt "
        f'--license "Vertex-Imagen (Google IP-indemnified)"'
    )


if __name__ == "__main__":
    main()
