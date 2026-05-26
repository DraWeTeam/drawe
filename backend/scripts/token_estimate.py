#!/usr/bin/env python3
"""
사후 토큰 추정 배치 — llm_messages.content 로 과거 LLM 토큰 사용량을 추정한다.

왜 필요한가
-----------
`chat_success` payload의 실제 토큰(prompt_tokens/completion_tokens)은 "토큰 로깅"
배포 이후 발생분에만 있다. 그 이전(=베타 대부분)은 실측 토큰이 없으므로,
DB에 남은 메시지 본문으로 tokenizer 를 돌려 *추정*한다.

중요 — 이건 실측이 아니라 추정이다 (체계적으로 과소 추정될 수 있음):
  • 매 턴 주입되는 reference/RAG 컨텍스트는 본문으로 저장되지 않음 → 입력 누락
  • 이미지 입력(has_image=true)의 비전 토큰은 텍스트로 역산 불가 → 누락
  • provider(GROK/Claude/Gemini)별 tokenizer 가 다름 → tiktoken 은 proxy
  • history 누적/트리밍(max_history)을 정확히 재현하지 않음(턴 단위 근사)
따라서 "대략 얼마/모델별 상대비교/증가 추세" 용도로만 쓰고, 절대 청구액으로 쓰지 말 것.

보정(calibration)
------------------
토큰 로깅이 켜진 뒤 같은 기간에 (a) 이 추정과 (b) chat_success 실측이 둘 다 생기면,
provider 별 보정계수 = 실측합 / 추정합 을 구해 과거 추정에 곱하면 편향이 줄어든다.
끝부분 SQL 참고.

PII
---
content(사용자 원문/LLM 출력)를 읽어야 하므로 *권한 있는 사람의 일회성 실행*만 허용.
출력은 집계 수치(CSV/콘솔)만 — 원문은 절대 파일로 내보내지 않는다. 어드민 화면 기능으로
만들지 말 것(로그 정책: 원문은 length만).

사용법
------
    pip install mysql-connector-python tiktoken
    DB_HOST=... DB_PORT=3306 DB_NAME=drawe_db DB_USERNAME=... DB_PASSWORD=... \
        python token_estimate.py --since 2026-05-01 --out estimate.csv

옵션
    --since YYYY-MM-DD   이 날짜(KST) 이후 메시지만 (기본: 전체)
    --out PATH           집계 CSV 저장 경로 (기본: 콘솔만)
"""
import argparse
import csv
import os
import sys
from collections import defaultdict

try:
    import mysql.connector
except ImportError:
    sys.exit("pip install mysql-connector-python 필요")

try:
    import tiktoken
    _ENC = tiktoken.get_encoding("cl100k_base")  # OpenAI 계열 proxy. 타 provider는 근사치.
    def count_tokens(text: str) -> int:
        if not text:
            return 0
        return len(_ENC.encode(text))
except ImportError:
    # tiktoken 없으면 매우 거친 근사(영문 ~4자/토큰, 한글은 더 많음 → 보수적으로 3자/토큰)
    print("⚠️ tiktoken 미설치 — 글자수/3 근사 사용 (정확도 낮음). pip install tiktoken 권장.",
          file=sys.stderr)
    def count_tokens(text: str) -> int:
        return (len(text) + 2) // 3 if text else 0


def fetch_messages(conn, since):
    """세션·시간순으로 (session_id, role, content, provider, model, has_image, created_at)."""
    where = "WHERE created_at >= %s" if since else ""
    params = [since] if since else []
    sql = (
        "SELECT chat_session_id, role, content, provider, model, has_image, created_at "
        "FROM llm_messages " + where + " ORDER BY chat_session_id, created_at, id"
    )
    cur = conn.cursor()
    cur.execute(sql, params)
    for row in cur.fetchall():
        yield row
    cur.close()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--since", help="YYYY-MM-DD (KST)")
    ap.add_argument("--out", help="집계 CSV 경로")
    args = ap.parse_args()

    conn = mysql.connector.connect(
        host=os.environ.get("DB_HOST", "localhost"),
        port=int(os.environ.get("DB_PORT", "3306")),
        database=os.environ.get("DB_NAME", "drawe_db"),
        user=os.environ["DB_USERNAME"],
        password=os.environ["DB_PASSWORD"],
    )

    # (provider, model) -> {assistant_msgs, input_tokens_est, output_tokens_est, image_turns}
    agg = defaultdict(lambda: {"assistant_msgs": 0, "input_est": 0, "output_est": 0,
                               "image_turns": 0})
    # 세션별 누적 본문(대략적 입력 컨텍스트 근사). 실제 트리밍은 재현하지 않음.
    cur_session = None
    running_input = 0

    for sid, role, content, provider, model, has_image, _created in fetch_messages(conn, args.since):
        if sid != cur_session:
            cur_session = sid
            running_input = 0
        role = (role or "").upper()
        tok = count_tokens(content)
        if role == "ASSISTANT":
            key = (provider or "(unknown)", model or "(unknown)")
            a = agg[key]
            a["assistant_msgs"] += 1
            # 입력 근사 = 그 시점까지 누적된 user/system/assistant 본문 (트리밍 무시 → 과대/과소 혼재)
            a["input_est"] += running_input
            a["output_est"] += tok
            if has_image:
                a["image_turns"] += 1
            running_input += tok  # 이 응답도 다음 턴 입력에 누적
        else:
            running_input += tok  # USER / SYSTEM(persona 등)

    conn.close()

    rows = []
    for (provider, model), a in sorted(agg.items(), key=lambda kv: -kv[1]["assistant_msgs"]):
        rows.append({
            "provider": provider,
            "model": model,
            "assistant_msgs": a["assistant_msgs"],
            "input_tokens_est": a["input_est"],
            "output_tokens_est": a["output_est"],
            "total_tokens_est": a["input_est"] + a["output_est"],
            "image_turns(undercount)": a["image_turns"],
        })

    cols = ["provider", "model", "assistant_msgs", "input_tokens_est",
            "output_tokens_est", "total_tokens_est", "image_turns(undercount)"]
    print("\n=== 사후 토큰 추정 (추정치 — 실측 아님) ===")
    print("  ".join(c.ljust(18) for c in cols))
    for r in rows:
        print("  ".join(str(r[c]).ljust(18) for c in cols))
    print("\n※ image_turns 가 있으면 그만큼 비전 입력 토큰이 빠져 있음(추가 과소추정).")

    if args.out:
        with open(args.out, "w", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(f, fieldnames=cols)
            w.writeheader()
            w.writerows(rows)
        print(f"\n저장: {args.out}")


# ---------------------------------------------------------------------------
# 보정계수 산출 (토큰 로깅이 켜진 뒤, 같은 기간에 대해 별도로 실행할 SQL):
#
#   SELECT JSON_UNQUOTE(JSON_EXTRACT(payload,'$.provider')) AS provider,
#          SUM(CAST(JSON_EXTRACT(payload,'$.prompt_tokens')     AS SIGNED)) AS real_input,
#          SUM(CAST(JSON_EXTRACT(payload,'$.completion_tokens') AS SIGNED)) AS real_output
#   FROM analytics_events
#   WHERE event_type='chat_success'
#     AND JSON_EXTRACT(payload,'$.prompt_tokens') IS NOT NULL
#     AND created_at >= '<로깅 시작일>'
#   GROUP BY provider;
#
#   보정계수_input(provider)  = real_input  / input_tokens_est(provider)
#   보정계수_output(provider) = real_output / output_tokens_est(provider)
#   → 과거 추정치에 provider별로 곱해 편향 완화.
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    main()
