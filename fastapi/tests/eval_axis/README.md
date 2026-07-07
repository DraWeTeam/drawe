# 축 정확도 평가셋 (axis eval)

진단이 **1차 축(sub_problem)** 을 맞게 고르는지 회귀 테스트하는 라벨셋입니다.
("손 스케치인데 명암 가이딩" 같은 오분류를 scene/profile/diagnose 변경 전후로 측정)

## 배치 방법

폴더 이름 = **기대하는 1차 sub_problem**, 그 안에 이미지를 넣습니다:

```
tests/eval_axis/
  hand_structure/        손 스케치들 (hand_structure 가 1차여야 함)
  proportion/            전신 비율 문제
  weight_balance/        무게중심
  atmospheric_perspective/  풍경(대기원근)
  value_structure/       실제 명암 문제(이건 value 가 맞는 케이스)
  composition_balance/   구도
```

처음엔 **지금 틀리는 케이스**(손/발/얼굴 클로즈업 스케치, 선 스케치)부터 5~10장 넣으면 충분합니다.

## 실행

```bash
cd fastapi
python -m guide.eval.axis_eval                      # tests/eval_axis 평가
python -m guide.eval.axis_eval tests/eval_axis "손"   # "손" 칩/문구를 함께 줬을 때
```

출력: 케이스별 expected vs predicted (OK/X) + 폴더별·전체 정확도.

## 주의
- torch / open_clip / mediapipe 등 **실제 모델이 필요**합니다(가이드 서비스와 같은 환경에서 실행).
- 이미지 파일은 깃에 커밋하지 않습니다(`.gitignore` 처리). 라벨 구조(폴더)만 공유.
