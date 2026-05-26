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
 * <p>노출(shown)은 {@code llm_messages.reference_ids}(JSON 배열)을 {@code JSON_TABLE}로 풀어 image_id별로 센다.
 * 좋아요/싫어요는 {@code image_feedback}, 저장은 {@code project_references}. 노출 기준 anchor(LEFT JOIN).
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
              + "        JSON_TABLE(m.reference_ids, '$[*]' "
              + "                   COLUMNS (image_id BIGINT PATH '$')) jt "
              + "   WHERE m.reference_ids IS NOT NULL "
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
              + "ORDER BY s.shown DESC, saves DESC "
              + "LIMIT 100",
      nativeQuery = true)
  List<FunnelProjection> funnel(@Param("since") Instant since);

  /** 윈도우 내 ref 노출 총합 (모든 reference_ids 항목 수). */
  @Query(
      value =
          "SELECT COUNT(*) "
              + "FROM llm_messages m, "
              + "     JSON_TABLE(m.reference_ids, '$[*]' COLUMNS (image_id BIGINT PATH '$')) jt "
              + "WHERE m.reference_ids IS NOT NULL AND m.role = 'ASSISTANT' "
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
