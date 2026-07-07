package com.drawe.backend.domain.image.repository;

import com.drawe.backend.domain.Image;
import com.drawe.backend.domain.User;
import com.drawe.backend.domain.enums.ImageSource;
import java.util.List;
import java.util.Optional;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface ImageRepository extends JpaRepository<Image, Long> {

  // 여러 source_id 이미지를 한번에 조회
  List<Image> findBySourceIdIn(List<String> sourceIds);

  /** 코퍼스 레퍼런스 인제스트 멱등 조회 — (source=GUIDE_REF, sourceId=코퍼스 refId)로 기존 Image 재사용. */
  Optional<Image> findFirstBySourceAndSourceId(ImageSource source, String sourceId);

  List<Image> findByIsOnboardingTrue();

  /**
   * 태그 IDF 색인 빌드용 — 모든 이미지의 raw_tags(JSON 텍스트)만 스캔한다. 네이티브로 JSON 컬럼을 문자열 그대로 받아(파싱 불필요, 토큰화가 구두점을
   * 구분자로 흡수) 전체 엔티티 로드를 피한다.
   */
  @Query(value = "SELECT raw_tags FROM images WHERE raw_tags IS NOT NULL", nativeQuery = true)
  List<String> findAllRawTagsJson();

  /**
   * 태그 IDF 색인 빌드용 — AI 이미지의 영문 생성 프롬프트만 스캔한다(raw_tags 가 없는 AI 의 내용 신호 원천). 토큰화가 불용어를 IDF≈0 으로 자연
   * 약화하므로 별도 키워드 추출 없이 프롬프트 원문을 그대로 쓴다.
   */
  @Query(
      value = "SELECT prompt FROM images WHERE prompt IS NOT NULL AND prompt <> ''",
      nativeQuery = true)
  List<String> findAllPrompts();

  /**
   * 완성작 갤러리 — 특정 유저가 만든 AI 이미지를 최신순 페이징 조회 (source=AI AND created_by_user_id=user). 정렬은 {@code
   * createdAt DESC, id DESC} — V12 이전 적재분은 createdAt 이 NULL 이라 id 순으로 흐른다.
   */
  @Query(
      "SELECT i FROM Image i WHERE i.source = :source AND i.createdBy = :createdBy "
          + "ORDER BY i.createdAt DESC, i.id DESC")
  Page<Image> findCompletedGallery(
      @Param("source") ImageSource source, @Param("createdBy") User createdBy, Pageable pageable);
}
