from pydantic import BaseModel, Field
from typing import Optional, Literal


class Action(BaseModel):
    type: Literal["COACH", "REDIRECT_GENERATE", "CLARIFY", "CHITCHAT", "ANCHOR_REF"]
    args: dict = {}


class GuideAsset(BaseModel):
    """'설명 자료 슬롯' — 제안을 *설명*하는 자료 한 개(참고작 슬롯과 별개). 코드가 후보 중에서 결정적으로 고름.

    type 으로 무엇을 보고 있는지 알린다: svg(결정적 도해) / backbone_3d(기하 참고) / ai_example(AI 일러스트).
    ref_id 가 'floor:<축>'이면 그 축의 항상-가능한 svg 도식 바닥이다(적재 자료가 없을 때의 폴백).
    """

    type: Literal["svg", "ai_example", "backbone_3d"]
    ref_id: str
    label: str  # 사용자 노출 배지: 도식 / AI 예시 / 3D 참고
    caption: str = ""


class GuideBlock(BaseModel):
    sub_problem: str
    observation: str
    effect: str = ""
    direction: str = ""
    reference_ids: list[str] = []
    confidence: float = Field(ge=0, le=1)
    guide_asset: Optional[GuideAsset] = (
        None  # 코드가 채움(가드레일 뒤, 결정적) — 제안 설명용 자료 1개
    )


class NextSteps(BaseModel):
    """'앞으로 할 것' — 로드맵에서 결정적으로 채우는 블록(LLM 아님). 완성작/연속성 응답의 근거."""

    focus: Optional[str] = None  # 지금 집중할 sub_problem
    focus_practice: Optional[str] = None  # 그 축의 연습 한 가지
    next_goal: Optional[str] = None  # 다음 목표 sub_problem
    next_goal_practice: Optional[str] = None
    recurring: list[str] = []  # 자주 막히는 부분
    why: Optional[str] = None  # 왜 지금 이걸/다음 저걸(구조 먼저 원칙)
    note: Optional[str] = (
        None  # 이력 반영한 자연스러운 한 줄(LLM 배열; 없으면 구조 필드로 폴백)
    )
    focus_asset: Optional["GuideAsset"] = (
        None  # 지금 집중 축의 설명 자료(코드가 결정적으로 채움)
    )


class RecurringStat(BaseModel):
    sub_problem: str
    window: int
    hits: int
    ratio: float
    # ⑦ 주별 요청 인사이트("'{축}' 요청이 주 N회→M회") — recurring 축의 초기 활동주 vs 최근주
    #   가이드 요청 횟수. 프론트가 축 라벨을 붙여 한 문장으로 조립(수치·로직 단일 소스는 백엔드).
    first_week_hits: int = 0
    last_week_hits: int = 0


class TrendPoint(BaseModel):
    index: int
    label: str  # ⑦ 주 라벨(그 주 월요일 MM.DD). (구: 업로드 순번)
    difficulty_count: int  # 하위호환 유지(구 지표=업로드당 어려움 수). ⑦부터 weekly_count 사용.
    weekly_count: int = 0  # ⑦ 그 주 가이드 요청 횟수(정본 114:15736 Y축). 추가 필드(파괴 없음).


class GrowthChips(BaseModel):
    current_stage_axes: list[str] = []
    improving_axes: list[str] = []


class Growth(BaseModel):
    """성장 흐름(§4). practice_log 집계의 표면화. 측정=사실로만 서술(점수 아님). _stage 비노출."""

    narration: str = ""
    recurring_stat: Optional[RecurringStat] = None
    trend: list[TrendPoint] = []
    delta_note: Optional[str] = None
    chips: GrowthChips = GrowthChips()


class PendingReference(BaseModel):
    """'이 축에 맞는 레퍼런스를 생성 중' 신호. 미스 + AI 적격 축일 때 코드가 채운다.
    프런트는 job_id 로 /guide/ref-job/{job_id} 를 폴링해 ready 되면 그 ref 를 추천 레퍼런스에 끼운다.
    """

    sub_problem: str
    job_id: str
    message: str = "이 부분에 맞는 레퍼런스를 만들고 있어요"


class GuideResponse(BaseModel):
    mode: Literal["coach", "redirect", "clarify", "refused"]
    guide_id: Optional[str] = None
    primary_focus: Optional[str] = None
    degraded: bool = False
    blocks: list[GuideBlock] = []
    synthesis: Optional[str] = None
    chat_feedback: Optional[str] = (
        None  # 채팅 한 줄 피드백 — 코드가 결정론적 조립(LLM/성장 없음). 현재 그림 진단(primary 관찰) +
        # 사용자 의도(from_user 축) 진입 프레이밍. 성장 흐름은 synthesis/growth 로 분리 유지.
    )
    one_thing: Optional[str] = None
    message: Optional[str] = None
    next_steps: Optional[NextSteps] = (
        None  # 코드가 채움(완성작/이력 있을 때) — 가드레일 뒤 결정적 설정
    )
    growth: Optional[Growth] = None  # §4 성장 흐름(코드가 채움; P2-b)
    pending_references: list[
        PendingReference
    ] = []  # 미스 축의 '생성 중' 레퍼런스(코드가 채움)
    reason: Optional[str] = None  # refused 사유(비-coach)
    next_steps_note: Optional[str] = (
        None  # LLM이 *배열*한 '앞으로 할 것' 자연 문장(가드레일 검증) — 코드가 next_steps.note 로 옮김
    )
