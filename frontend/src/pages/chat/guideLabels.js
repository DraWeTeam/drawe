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

// 한글 받침(종성) 유무로 조사(이/가) 선택. 라벨 마지막 글자가 한글 음절이 아니면 '가'.
const josaIGa = (word) => {
  if (!word) return "가";
  const c = word.charCodeAt(word.length - 1);
  if (c < 0xac00 || c > 0xd7a3) return "가";
  return (c - 0xac00) % 28 ? "이" : "가";
};

// 성장 흐름 메시지(화면·PDF 공용). 백엔드 growth 구조 필드만 소비 — 프론트에서 %·수치 재계산 없음.
//   rstat: recurring_stat(축·window·hits)으로 한 문장 조립(축 이름은 axisLabel, 조사는 종성 검사).
//   delta: delta_note 는 백엔드 완성문 그대로, 앞에 '그 사이 ' 접속어만 붙여 rstat 뒤에 잇는다.
//   둘 다 없으면 백엔드 narration(그 안에 note 자유문장 포함) 폴백 — note 경로 보존.
export const growthMessage = (growth, hasChart) => {
  if (!growth) return "";
  const rs = growth.recurring_stat;
  const label = rs ? axisLabel(rs.sub_problem) : "";
  const rstatLine =
    rs && rs.hits > 0
      ? `최근 ${rs.window}장에서 ${label}${josaIGa(label)} ${rs.hits}번 반복해 짚였어요.`
      : "";
  if (growth.delta_note) {
    return rstatLine
      ? `${rstatLine} 그 사이 ${growth.delta_note}`
      : growth.delta_note;
  }
  return (
    growth.narration ||
    (hasChart
      ? ""
      : "처음으로 한 끗 가이드를 사용하셨어요! 가이드를 더 받을수록 어떤 어려움을 자주 겪는지 흐름으로 보여드려요.")
  );
};
