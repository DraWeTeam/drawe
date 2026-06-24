# EKS 대시보드 ↔ 공유 RDS 'grafana' 스키마 — 롤백 가이드

## 무엇이 위험했나
prod EKS Grafana(`overlays/prod/observability/grafana.yaml`)와 ECS Grafana
(`terraform-prod/observability.tf`)는 **같은 RDS MySQL `drawe-prod-mysql` 의
`grafana` 스키마**를 백엔드 DB 로 공유한다. EKS Grafana 의 스토리지 볼륨은
`emptyDir` 이므로 파일 프로비저닝으로 등록한 대시보드 정의는 디스크가 아니라
이 **공유 DB** 에 들어간다.

Grafana 11.4.0(프로젝트 핀 버전)은 기동 시 프로비저닝 source 와 DB 를 reconcile
한다. 어떤 대시보드가 "프로비저닝됨"으로 DB 에 있는데 현재 프로비저닝 provider 에는
그 source 가 없으면 — `disableDeletion: true` 가 아닌 한 — **그 대시보드를 DB 에서
삭제한다.** (이 자동 삭제 동작은 Grafana 12.1+ 에서 완화되었지만 11.x 에는 해당된다.)

따라서 EKS 에서 대시보드를 프로비저닝한 뒤 **ECS 로 롤백**해 ECS Grafana(=`drawe-eks`
provider 가 없음)가 기동하면, 공유 DB 에 남은 EKS 대시보드를 고아로 보고 지울 수 있다.
이것이 "EKS→ECS 롤백 시 ECS 설정과 겹쳐 문제가 되는" 파일 그룹이었다.

## 어떻게 막았나 (이미 적용됨)
`dashboards-provider.yaml` 하드닝:
- `disableDeletion: true` — reconcile 가 이 대시보드를 **삭제하지 못하게 잠금**.
  ECS Grafana 가 떠도 `drawe-eks` 로 등록된 대시보드는 보존된다.
- `allowUiUpdates: false` — UI 에서 저장(→ provisioned→non-provisioned 고아화 →
  다음 reconcile 때 삭제) 되는 경로를 원천 차단. read-only.
- 고정 `folder: DraWe` / `folderUid: drawe-eks` — ECS 대시보드와 네임스페이스 격리.
- 대시보드 JSON 의 고정 `uid`(drawe-backend / drawe-fastapi) — 컷오버를 반복해도
  같은 객체로 **멱등 재생성**.

## 비상 ECS 롤백 절차
`runbooks/ecs_emergency_rollback.md` 의 트랩 #4(observability 는 안정화 후 켜도 됨)와
정합. 권장 순서:

1. **ECS 로 트래픽 롤백** (앱 서비스 우선 복구). 이 단계에서 ECS observability
   (`ecs_observability_enabled`)는 **꺼진 상태로 둔다.** ECS Grafana 가 뜨지 않으므로
   공유 DB reconcile 자체가 일어나지 않아 EKS 대시보드는 그대로 남는다.
2. 앱 안정화 확인 후, 필요하면 ECS observability 를 켠다. 이때 `disableDeletion: true`
   덕분에 EKS 대시보드는 삭제되지 않는다(다만 ECS Grafana 는 'DraWe' 폴더 대시보드를
   "프로비저닝 source 없음 + 삭제 금지" 상태로 인식 → 보존만 하고 갱신은 안 함).
3. 다시 EKS 로 컷오버하면 `drawe-eks` provider 가 ConfigMap 에서 대시보드를
   **재프로비저닝**(self-heal)한다. 고정 uid 라 중복 없이 같은 객체로 복원된다.

## 완전 제거가 필요할 때
EKS 대시보드를 의도적으로 영구 삭제하려면:
1. 먼저 `kustomization.yaml` 에서 dashboard configMapGenerator 2개와 Grafana 볼륨
   패치(③)를 제거해 프로비저닝을 내린 뒤,
2. Grafana UI/API 또는 DB 에서 'DraWe' 폴더 대시보드를 수동 삭제한다.
`disableDeletion: true` 때문에 source 제거만으로는 자동 삭제되지 않는다(의도된 안전장치).
