package com.drawe.backend.domain.admin.repository;

import com.drawe.backend.domain.LlmMessage;
import java.time.Instant;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/**
 * 태그별 관심도 집계용 — engagement 있는 이미지별로 shown/likes/pins + 태그(technique/subject/mood)를 한 번에 뽑는다. (읽기
 * 전용, 네이티브)
 *
 * <p>축별 롤업은 서비스(Java)에서 한다. 한 이미지가 3개 축 값을 동시에 갖기 때문에 SQL GROUP BY 한 번으론 깔끔히 안 나와서, 이미지 단위로 받아
 * Java에서 (axis,value) 버킷으로 합산한다.
 *
 * <p>shown/likes/pins 모두 {@code :since} 윈도우 적용. shown=references_json, likes=image_feedback,
 * pins(프로젝트 저장)=project_references(added_at). clicks는 DB에 없으므로 여기서 안 다룬다 — GA4 Data API에서
 * reference_id별로 받아 서비스에서 병합.
 *
 * <p>AdminFunnelRepository 의 references_json unnest 패턴을 그대로 따른다.
 */
public interface AdminTagEngagementRepository extends JpaRepository<LlmMessage, Long> {

  @Query(
      value =
          "SELECT e.image_id   AS imageId, "
              + "       t.technique  AS technique, "
              + "       t.subject    AS subject, "
              + "       t.mood       AS mood, "
              + "       e.shown      AS shown, "
              + "       e.likes      AS likes, "
              + "       e.pins       AS pins "
              + "FROM ( "
              + "   SELECT image_id, "
              + "          SUM(shown) AS shown, SUM(likes) AS likes, SUM(pins) AS pins "
              + "   FROM ( "
              // ── 노출: references_json unnest (ASSISTANT 메시지, 윈도우) ──
              + "      SELECT jt.image_id AS image_id, COUNT(*) AS shown, 0 AS likes, 0 AS pins "
              + "      FROM llm_messages m, "
              + "           JSON_TABLE(m.references_json, '$[*]' "
              + "                      COLUMNS (image_id BIGINT PATH '$.id')) jt "
              + "      WHERE m.references_json IS NOT NULL AND m.role = 'ASSISTANT' "
              + "        AND m.created_at >= :since "
              + "      GROUP BY jt.image_id "
              + "      UNION ALL "
              // ── 좋아요: image_feedback (윈도우) ──
              + "      SELECT image_id, 0, COUNT(*), 0 "
              + "      FROM image_feedback "
              + "      WHERE feedback = 'LIKE' AND created_at >= :since "
              + "      GROUP BY image_id "
              + "      UNION ALL "
              // ── 핀(프로젝트에 저장): project_references (added_at 윈도우) ──
              + "      SELECT image_id, 0, 0, COUNT(*) "
              + "      FROM project_references "
              + "      WHERE added_at >= :since "
              + "      GROUP BY image_id "
              + "   ) u "
              + "   GROUP BY image_id "
              + ") e "
              + "LEFT JOIN image_drawe_tags t ON t.image_id = e.image_id",
      nativeQuery = true)
  List<PerImageRow> perImageEngagement(@Param("since") Instant since);

  /** native projection — alias 와 getter 이름 매칭. */
  interface PerImageRow {
    long getImageId();

    String getTechnique();

    String getSubject();

    String getMood();

    Number getShown();

    Number getLikes();

    Number getPins();
  }
}
