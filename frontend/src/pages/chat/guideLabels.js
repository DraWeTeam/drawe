// 축 id → 사용자 노출 한글 라벨. 시안 표기에 맞춤(명암 대비/무게중심/구도·균형 등).
// taxonomy 에는 짧은 라벨이 없어 여기서 큐레이션해 들고 간다.
const AXIS_LABELS = {
  weight_balance: "무게중심",
  foreshortening: "단축",
  proportion: "비율",
  action_line: "동세선",
  joint_articulation: "관절",
  hand_structure: "손 구조",
  value_structure: "명암 대비",
  composition_balance: "구도·균형",
  color_harmony: "색 조화",
  light_direction: "광원 방향",
  linear_perspective: "선원근",
  atmospheric_perspective: "대기원근",
  depth_layering: "깊이층",
  horizon_placement: "지평선",
};

export const axisLabel = (id) =>
  AXIS_LABELS[id] || (id ? id.replace(/_/g, " ") : "");

// 성장 흐름 메시지(화면·PDF 공용). 백엔드 growth 구조 필드만 소비 — 프론트에서 %·수치 재계산 없음.
//   ⑦ 정본(114:15736) 인사이트: recurring 축의 '주 N회→M회' 감소. 수치는 백엔드 rstat
//   (first_week_hits/last_week_hits), 축 라벨만 프론트가 붙인다(라벨 단일 소스=프론트). 없으면
//   백엔드 narration(note 자유문장) 폴백 → 그것도 없고 차트도 없으면 첫 사용 안내.
export const growthMessage = (growth, hasChart) => {
  if (!growth) return "";
  const rs = growth.recurring_stat;
  const label = rs ? axisLabel(rs.sub_problem) : "";
  if (rs && rs.first_week_hits > rs.last_week_hits) {
    return `'${label}' 요청이 주 ${rs.first_week_hits}회 → ${rs.last_week_hits}회로 줄었어요.`;
  }
  if (growth.narration) return growth.narration;
  return hasChart
    ? ""
    : "처음으로 한 끗 가이드를 사용하셨어요! 가이드를 더 받을수록 어떤 어려움을 자주 겪는지 흐름으로 보여드려요.";
};
