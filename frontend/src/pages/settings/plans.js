// 요금제 정의 — 표시용 상수. 실제 과금/결제 연동 전까지 프론트에서 관리한다.
// plan code 는 백엔드 UserPlan.code (free / paid) 와 일치해야 현재 플랜 매칭이 된다.
//
// 플랜 차별점은 아래 3개 축으로 정리한다(아직 plan별 분기는 미구현, 계획 단계):
//   1) 대화/가이딩 AI 모델   — Free: Grok / Pro: Claude
//   2) AI 레퍼런스 이미지 생성(Bria) — Free: 제한 / Pro: 더 많이
//   3) 이미지 가이딩 심화      — Free: 기본 / Pro: 심화
export const PLANS = [
  {
    code: "free",
    name: "Free",
    price: "₩0",
    period: "무료",
    features: [
      "대화·가이딩 AI · Grok 기반",
      "AI 레퍼런스 이미지 생성 · 제한 사용",
      "이미지 가이딩 · 기본 분석",
    ],
  },
  {
    code: "paid",
    name: "Pro",
    price: "₩9,900",
    period: "월",
    features: [
      "대화·가이딩 AI · Claude 기반 (더 정교한 피드백)",
      "AI 레퍼런스 이미지 생성 · 넉넉하게",
      "이미지 가이딩 · 심화 분석 (더 깊은 단계별 코칭)",
    ],
    highlight: true,
  },
];
