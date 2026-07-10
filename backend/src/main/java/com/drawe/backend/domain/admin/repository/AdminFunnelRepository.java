package com.drawe.backend.domain.admin.repository;

import com.drawe.backend.domain.LlmMessage;
import java.time.Instant;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/**
 * Engagement Funnel 집계. (읽기 전용)
 *
 * <p>노출(shown)은 {@code llm_messages.references_json}(ReferenceItem 배열)의 각 {@code id}를 {@code
 * JSON_TABLE}로 풀어 image_id별로 센다. 좋아요/싫어요는 {@code image_feedback}, 저장은 {@code project_references}.
 * 노출 기준 anchor(LEFT JOIN).
 *
 * <p>검색({@code q})은 image_id 정확일치, 작가명/태그(technique/subject/mood) LIKE 부분일치 OR. 빈 문자열이면 모두 통과.
 * 페이지네이션: {@code LIMIT :size OFFSET :offset} (page는 1-based, 서비스에서 변환).
 */
public interface AdminFunnelRepository extends JpaRepository<LlmMessage, Long> {

  @Query(
      value =
          "SELECT s.image_id                AS imageId, "
              + "       s.shown                 AS shown, "
              + "       COALESCE(l.likes, 0)    AS likes, "
              + "       COALESCE(d.dislikes, 0) AS dislikes, "
              + "       COALESCE(v.saves, 0)    AS saves, "
              + "       i.url                   AS url, "
              + "       i.source                AS source, "
              + "       i.photographer_name     AS photographer, "
              + "       t.technique             AS technique, "
              + "       t.subject               AS subject, "
              + "       t.mood                  AS mood "
              + "FROM ( "
              + "   SELECT jt.image_id AS image_id, COUNT(*) AS shown "
              + "   FROM llm_messages m, "
              + "        JSON_TABLE(m.references_json, '$[*]' "
              + "                   COLUMNS (image_id BIGINT PATH '$.id')) jt "
              + "   WHERE m.references_json IS NOT NULL "
              + "     AND m.role = 'ASSISTANT' "
              + "     AND m.created_at >= :since "
              + "   GROUP BY jt.image_id "
              + ") s "
              + "LEFT JOIN ( "
              + "   SELECT image_id, COUNT(*) AS likes FROM image_feedback "
              + "   WHERE feedback = 'LIKE' AND created_at >= :since GROUP BY image_id "
              + ") l ON l.image_id = s.image_id "
              + "LEFT JOIN ( "
              + "   SELECT image_id, COUNT(*) AS dislikes FROM image_feedback "
              + "   WHERE feedback = 'DISLIKE' AND created_at >= :since GROUP BY image_id "
              + ") d ON d.image_id = s.image_id "
              + "LEFT JOIN ( "
              + "   SELECT image_id, COUNT(*) AS saves FROM project_references "
              + "   WHERE added_at >= :since GROUP BY image_id "
              + ") v ON v.image_id = s.image_id "
              + "LEFT JOIN images i           ON i.id = s.image_id "
              + "LEFT JOIN image_drawe_tags t ON t.image_id = s.image_id "
              + "WHERE (:q = '' "
              + "       OR CAST(s.image_id AS CHAR) = :q "
              + "       OR i.photographer_name LIKE CONCAT('%', :q, '%') "
              + "       OR t.technique         LIKE CONCAT('%', :q, '%') "
              + "       OR t.subject           LIKE CONCAT('%', :q, '%') "
              + "       OR t.mood              LIKE CONCAT('%', :q, '%')) "
              + "ORDER BY s.shown DESC, saves DESC "
              + "LIMIT :size OFFSET :offset",
      nativeQuery = true)
  List<FunnelProjection> funnel(
      @Param("since") Instant since,
      @Param("q") String q,
      @Param("size") int size,
      @Param("offset") int offset);

  /** 필터(q) 적용 후 총 row 수 (distinct image_id 기준). 페이지네이션용. */
  @Query(
      value =
          "SELECT COUNT(*) FROM ( "
              + "   SELECT s.image_id "
              + "   FROM ( "
              + "      SELECT jt.image_id AS image_id "
              + "      FROM llm_messages m, "
              + "           JSON_TABLE(m.references_json, '$[*]' "
              + "                      COLUMNS (image_id BIGINT PATH '$.id')) jt "
              + "      WHERE m.references_json IS NOT NULL "
              + "        AND m.role = 'ASSISTANT' "
              + "        AND m.created_at >= :since "
              + "      GROUP BY jt.image_id "
              + "   ) s "
              + "   LEFT JOIN images i           ON i.id = s.image_id "
              + "   LEFT JOIN image_drawe_tags t ON t.image_id = s.image_id "
              + "   WHERE (:q = '' "
              + "          OR CAST(s.image_id AS CHAR) = :q "
              + "          OR i.photographer_name LIKE CONCAT('%', :q, '%') "
              + "          OR t.technique         LIKE CONCAT('%', :q, '%') "
              + "          OR t.subject           LIKE CONCAT('%', :q, '%') "
              + "          OR t.mood              LIKE CONCAT('%', :q, '%')) "
              + ") c",
      nativeQuery = true)
  long funnelCount(@Param("since") Instant since, @Param("q") String q);

  /** 윈도우 내 ref 노출 총합 (모든 references_json 항목 수). 요약 카드용. */
  @Query(
      value =
          "SELECT COUNT(*) "
              + "FROM llm_messages m, "
              + "     JSON_TABLE(m.references_json, '$[*]' "
              + "                COLUMNS (image_id BIGINT PATH '$.id')) jt "
              + "WHERE m.references_json IS NOT NULL AND m.role = 'ASSISTANT' "
              + "AND m.created_at >= :since",
      nativeQuery = true)
  long countShown(@Param("since") Instant since);

  /** 윈도우 내 좋아요/싫어요 총합. */
  @Query(
      value =
          "SELECT SUM(feedback = 'LIKE') AS likes, SUM(feedback = 'DISLIKE') AS dislikes "
              + "FROM image_feedback WHERE created_at >= :since",
      nativeQuery = true)
  FeedbackCounts feedbackCounts(@Param("since") Instant since);

  /** 윈도우 내 저장 총합. */
  @Query(
      value = "SELECT COUNT(*) FROM project_references WHERE added_at >= :since",
      nativeQuery = true)
  long countSaves(@Param("since") Instant since);

  // ─────────────────────────────────────────────────────────────────────────
  // 능동 수집(active curation) — ③ 생성 AI 세그먼트.
  //
  // <p>anchor는 채팅 추천(references_json)이 아니라 사용자가 직접 생성한 이미지({@code images.source =
  // 'AI'}). 생성은 채팅·보드 어느 경로든 ImageGenerationService.generate 를 거쳐 source=AI 가 되므로 이 한 조건이
  // 두 경로를 모두 포괄한다. "노출(shown)"은 생성 1회 = 1로, 각 이미지가 한 번 만들어져 한 번 사용자에게 보여진 것.
  // 좋아요/싫어요는 image_feedback, 저장은 project_references (image_id 조인, AI 이미지로 한정).
  // ─────────────────────────────────────────────────────────────────────────

  @Query(
      value =
          "SELECT s.image_id                AS imageId, "
              + "       s.shown                 AS shown, "
              + "       COALESCE(l.likes, 0)    AS likes, "
              + "       COALESCE(d.dislikes, 0) AS dislikes, "
              + "       COALESCE(v.saves, 0)    AS saves, "
              + "       i.url                   AS url, "
              + "       i.source                AS source, "
              + "       i.photographer_name     AS photographer, "
              + "       t.technique             AS technique, "
              + "       t.subject               AS subject, "
              + "       t.mood                  AS mood "
              + "FROM ( "
              + "   SELECT i2.id AS image_id, COUNT(*) AS shown "
              + "   FROM images i2 "
              + "   WHERE i2.source = 'AI' AND i2.created_at >= :since "
              + "   GROUP BY i2.id "
              + ") s "
              + "LEFT JOIN ( "
              + "   SELECT image_id, COUNT(*) AS likes FROM image_feedback "
              + "   WHERE feedback = 'LIKE' AND created_at >= :since GROUP BY image_id "
              + ") l ON l.image_id = s.image_id "
              + "LEFT JOIN ( "
              + "   SELECT image_id, COUNT(*) AS dislikes FROM image_feedback "
              + "   WHERE feedback = 'DISLIKE' AND created_at >= :since GROUP BY image_id "
              + ") d ON d.image_id = s.image_id "
              + "LEFT JOIN ( "
              + "   SELECT image_id, COUNT(*) AS saves FROM project_references "
              + "   WHERE added_at >= :since GROUP BY image_id "
              + ") v ON v.image_id = s.image_id "
              + "LEFT JOIN images i           ON i.id = s.image_id "
              + "LEFT JOIN image_drawe_tags t ON t.image_id = s.image_id "
              + "WHERE (:q = '' "
              + "       OR CAST(s.image_id AS CHAR) = :q "
              + "       OR i.photographer_name LIKE CONCAT('%', :q, '%') "
              + "       OR t.technique         LIKE CONCAT('%', :q, '%') "
              + "       OR t.subject           LIKE CONCAT('%', :q, '%') "
              + "       OR t.mood              LIKE CONCAT('%', :q, '%')) "
              + "ORDER BY saves DESC, s.image_id DESC "
              + "LIMIT :size OFFSET :offset",
      nativeQuery = true)
  List<FunnelProjection> funnelGenerated(
      @Param("since") Instant since,
      @Param("q") String q,
      @Param("size") int size,
      @Param("offset") int offset);

  /** 생성 AI 세그먼트 — 필터(q) 적용 후 총 row 수. 페이지네이션용. */
  @Query(
      value =
          "SELECT COUNT(*) FROM ( "
              + "   SELECT i2.id AS image_id "
              + "   FROM images i2 "
              + "   LEFT JOIN image_drawe_tags t ON t.image_id = i2.id "
              + "   WHERE i2.source = 'AI' AND i2.created_at >= :since "
              + "     AND (:q = '' "
              + "          OR CAST(i2.id AS CHAR) = :q "
              + "          OR i2.photographer_name LIKE CONCAT('%', :q, '%') "
              + "          OR t.technique          LIKE CONCAT('%', :q, '%') "
              + "          OR t.subject            LIKE CONCAT('%', :q, '%') "
              + "          OR t.mood               LIKE CONCAT('%', :q, '%')) "
              + "   GROUP BY i2.id "
              + ") c",
      nativeQuery = true)
  long funnelGeneratedCount(@Param("since") Instant since, @Param("q") String q);

  /** 윈도우 내 생성 수(=노출). 요약 카드용. */
  @Query(
      value = "SELECT COUNT(*) FROM images WHERE source = 'AI' AND created_at >= :since",
      nativeQuery = true)
  long countGenerated(@Param("since") Instant since);

  /** 윈도우 내 생성 AI 이미지에 달린 좋아요/싫어요 총합. */
  @Query(
      value =
          "SELECT SUM(f.feedback = 'LIKE') AS likes, SUM(f.feedback = 'DISLIKE') AS dislikes "
              + "FROM image_feedback f JOIN images i ON i.id = f.image_id "
              + "WHERE i.source = 'AI' AND f.created_at >= :since",
      nativeQuery = true)
  FeedbackCounts feedbackCountsGenerated(@Param("since") Instant since);

  /** 윈도우 내 생성 AI 이미지의 저장 총합. */
  @Query(
      value =
          "SELECT COUNT(*) FROM project_references pr JOIN images i ON i.id = pr.image_id "
              + "WHERE i.source = 'AI' AND pr.added_at >= :since",
      nativeQuery = true)
  long countSavesGenerated(@Param("since") Instant since);

  interface FunnelProjection {
    long getImageId();

    long getShown();

    long getLikes();

    long getDislikes();

    long getSaves();

    String getUrl();

    String getSource();

    String getPhotographer();

    String getTechnique();

    String getSubject();

    String getMood();
  }

  interface FeedbackCounts {
    Number getLikes();

    Number getDislikes();
  }
}
