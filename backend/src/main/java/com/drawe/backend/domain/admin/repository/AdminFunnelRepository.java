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

  /**
   * 저장(keep) = 사용자가 이미지를 간직한 모든 경로의 image_id 합집합(중복 제거). 능동 수집 세그먼트(생성/보드)의 "저장" 정의.
   *
   * <ul>
   *   <li>project_references — 프로젝트 보드 담기
   *   <li>collection_references — 아카이브(컬렉션) 저장
   *   <li>projects.pinned_image_ids — 핀(최대 3, 타임스탬프 없음 → 현재 멤버십으로 판정)
   * </ul>
   *
   * <p>핀에 시각이 없어 윈도우 필터를 걸 수 없으므로 keep 은 "현재 유지 상태"로 본다. 윈도우는 anchor(노출/생성)가 이미 잡아주며, 이렇게 하면 저장%가
   * 100% 를 넘던 윈도우 경계 왜곡도 사라진다.
   */
  String KEEP_UNION_IDS =
      "SELECT image_id FROM project_references "
          + "UNION SELECT image_id FROM collection_references "
          + "UNION SELECT jt.image_id FROM projects p, "
          + "       JSON_TABLE(p.pinned_image_ids, '$[*]' COLUMNS (image_id BIGINT PATH '$')) jt "
          + "WHERE p.pinned_image_ids IS NOT NULL";

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
              + "LEFT JOIN ( SELECT k.image_id AS image_id, 1 AS saves FROM ( "
              + KEEP_UNION_IDS
              + " ) k ) v ON v.image_id = s.image_id "
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

  /** 윈도우 내 생성된 AI 이미지 중 현재 유지(담기/아카이브/핀)된 것의 수. keep 정의는 {@link #KEEP_UNION_IDS}. */
  @Query(
      value =
          "SELECT COUNT(*) FROM images i "
              + "WHERE i.source = 'AI' AND i.created_at >= :since "
              + "  AND i.id IN ( "
              + KEEP_UNION_IDS
              + " )",
      nativeQuery = true)
  long countSavesGenerated(@Param("since") Instant since);

  // ─────────────────────────────────────────────────────────────────────────
  // 능동 수집 — ② 보드 검색 세그먼트.
  //
  // <p>anchor = reference_board_impressions(검색으로 실제 노출된 결과 카드). 노출=검색 결과만(기본 그리드 제외).
  // Unsplash·코퍼스·AI 구분 없이 노출된 image_id 전부가 shown 으로 잡히고, 좋아요/싫어요(image_feedback,
  // 윈도우) + 저장(KEEP_UNION_IDS 멤버십)을 조인한다.
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
              + "   SELECT image_id AS image_id, COUNT(*) AS shown "
              + "   FROM reference_board_impressions "
              + "   WHERE shown_at >= :since "
              + "   GROUP BY image_id "
              + ") s "
              + "LEFT JOIN ( "
              + "   SELECT image_id, COUNT(*) AS likes FROM image_feedback "
              + "   WHERE feedback = 'LIKE' AND created_at >= :since GROUP BY image_id "
              + ") l ON l.image_id = s.image_id "
              + "LEFT JOIN ( "
              + "   SELECT image_id, COUNT(*) AS dislikes FROM image_feedback "
              + "   WHERE feedback = 'DISLIKE' AND created_at >= :since GROUP BY image_id "
              + ") d ON d.image_id = s.image_id "
              + "LEFT JOIN ( SELECT k.image_id AS image_id, 1 AS saves FROM ( "
              + KEEP_UNION_IDS
              + " ) k ) v ON v.image_id = s.image_id "
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
  List<FunnelProjection> funnelBoard(
      @Param("since") Instant since,
      @Param("q") String q,
      @Param("size") int size,
      @Param("offset") int offset);

  /** 보드 세그먼트 — 필터(q) 적용 후 총 row 수(distinct 노출 image_id). 페이지네이션용. */
  @Query(
      value =
          "SELECT COUNT(*) FROM ( "
              + "   SELECT s.image_id "
              + "   FROM ( "
              + "      SELECT image_id AS image_id FROM reference_board_impressions "
              + "      WHERE shown_at >= :since GROUP BY image_id "
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
  long funnelBoardCount(@Param("since") Instant since, @Param("q") String q);

  /** 윈도우 내 보드 검색 노출 총합(= shown). 요약 카드용. */
  @Query(
      value = "SELECT COUNT(*) FROM reference_board_impressions WHERE shown_at >= :since",
      nativeQuery = true)
  long countBoardShown(@Param("since") Instant since);

  /** 윈도우 내 보드 노출 이미지에 달린 좋아요/싫어요 총합(노출 이미지로 한정). */
  @Query(
      value =
          "SELECT SUM(f.feedback = 'LIKE') AS likes, SUM(f.feedback = 'DISLIKE') AS dislikes "
              + "FROM image_feedback f "
              + "WHERE f.created_at >= :since "
              + "  AND f.image_id IN ( "
              + "     SELECT DISTINCT image_id FROM reference_board_impressions "
              + "     WHERE shown_at >= :since "
              + "  )",
      nativeQuery = true)
  FeedbackCounts feedbackCountsBoard(@Param("since") Instant since);

  /** 윈도우 내 보드 노출 이미지 중 현재 유지(담기/아카이브/핀)된 distinct 이미지 수. */
  @Query(
      value =
          "SELECT COUNT(*) FROM ( "
              + "   SELECT DISTINCT image_id FROM reference_board_impressions "
              + "   WHERE shown_at >= :since "
              + ") imp "
              + "WHERE imp.image_id IN ( "
              + KEEP_UNION_IDS
              + " )",
      nativeQuery = true)
  long countSavesBoard(@Param("since") Instant since);

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
