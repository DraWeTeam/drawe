-- 컬렉션 레퍼런스 사용자 태그 — SCR-ARCH-05 카드 ⋮ '정보 수정'에서 이미지 단위로 직접 다는 태그.
-- 컬렉션 자체 태그(collections.tags, 자동분류)와 별개인 레퍼런스(이미지)별 사용자 태그.
ALTER TABLE `collection_references`
  ADD COLUMN `user_tags` json DEFAULT NULL AFTER `pinned`;
