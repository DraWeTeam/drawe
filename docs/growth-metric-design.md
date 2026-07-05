# 성장 흐름(⑦) 지표 설계 note

## 현재 지표: 주별 가이드 요청 횟수 (정본 114:15736 정합)
- 그래프: X=주(최근 8주, 활동 있는 주만), Y=그 주의 가이드 요청 횟수(서로 다른 guide 수).
- 인사이트: recurring 축의 "'{축}' 요청이 주 N회 → M회로 줄었어요" — 그 축의 **초기 활동주 vs 최근 활동주** 요청 수.
- 단일 소스: 백엔드(`roadmap._weekly` → `growth_view.weekly` → `contract.growth_from_raw`). 프론트는 축 라벨만 붙여 조립(수치·축 선정은 백엔드). `guideLabels.growthMessage` / `GuideModal.GrowthChart`.
- 게이트(graceful 불변): `_GROWTH_MIN_TREND`(주≥N → 곡선), `_GROWTH_MIN_DELTA`(주≥M → N→M 문구). 임계 미만이면 trend=[] → 차트·인사이트 미발화, 첫 사용 안내.

## ★설계 변경 이력 (정본 정합 위한 변경, 재논의 여지)
- **구 지표**: "그림 한 장당 어려움을 느낀 횟수"(_history.timeline, 최근 RECENT_N=5 업로드당 flagged 약점 수).
- **구 지표 채택 이유**: 요청 '횟수'는 주제·난이도·기분에 흔들려 노이즈가 크다 — 약점 '수'가 학습 신호로 더 안정적이라는 판단(의도적 설계).
- **변경 이유**: Figma 정본(114:15736)이 "X=주 / Y=주별 요청 횟수 / 첫 주→이번 주 변화"를 명시 → 제품-화면 일관성 우선으로 주별 요청 지표에 정합(⑥ 커리큘럼 정합과 동일 원칙).
- **재논의 트리거**: 요청 횟수의 노이즈가 실사용에서 문제되면(예: 사용자가 하루 몰아 요청 → 특정 주 스파이크) 지표를 재검토. 구 timeline(_history)은 제거하지 않고 하위호환·다른 소비처용으로 보존해 뒀으므로 롤백/병행 용이.
- **하위호환**: TrendPoint.weekly_count / RecurringStat.first_week_hits·last_week_hits 는 **추가** 필드. difficulty_count 는 구 값 대신 주 요청 수로 채워 파괴 없이 통과(구 소비처는 여전히 int 를 받음).
