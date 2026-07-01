// 아카이브(레퍼런스/완성작) 변경 시 사이드바 카운트 등 다른 화면을 갱신하기 위한 전역 이벤트.
export const ARCHIVE_CHANGED_EVENT = "drawe:archive-changed";

// 레퍼런스 저장/삭제 등 아카이브 개수가 바뀌는 동작 직후 호출.
export function notifyArchiveChanged() {
  window.dispatchEvent(new Event(ARCHIVE_CHANGED_EVENT));
}
