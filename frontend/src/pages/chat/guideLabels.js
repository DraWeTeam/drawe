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
