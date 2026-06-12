// sub_problem(축) id → 한글 라벨. woz(roadmap.py LABELS)와 동일.
// 가이드/로드맵 응답의 축 id를 사람이 읽는 이름으로 바꾼다.
export const SUB_LABELS = {
  weight_balance: "무게중심",
  foreshortening: "단축(투시)",
  proportion: "비율",
  action_line: "동세",
  joint_articulation: "관절",
  hand_structure: "손 구조",
  value_structure: "명암",
  composition_balance: "구도",
  color_harmony: "색 조화",
  light_direction: "빛 방향",
  linear_perspective: "선원근",
  atmospheric_perspective: "대기원근",
  depth_layering: "공간 깊이",
  horizon_placement: "지평선 배치",
};

export const labelOf = (id) => SUB_LABELS[id] || id || "";
