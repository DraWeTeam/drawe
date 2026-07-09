package com.drawe.backend.domain.admin.repository;

import com.drawe.backend.domain.Guide;
import java.time.Instant;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/**
 * 가이딩 품질 집계 (읽기 전용, 네이티브). 전부 어드민 DB({@code drawe_db})의 {@code guides} / {@code guide_feedback} 만
 * 본다 — 계측 추가 없음. FastAPI DB(adoption_log/practice_log)는 범위 밖.
 *
 * <p>{@code guides} 는 coach 가이드 1건=1행(refused/clarify/redirect 미저장). 일자 그룹핑은 KST 기준 —
 * created_at(UTC)에 {@code +09:00} offset 을 적용한다(다른 어드민 집계와 동일, CONVERT_TZ 의 tz 테이블 의존 회피).
 */
public interface AdminGuideRepository extends JpaRepository<Guide, Long> {

  /** 윈도우 내 가이드 생성 수 + degraded 수. */
  @Query(
      value =
          "SELECT COUNT(*) AS total, "
              + "  COALESCE(SUM(CASE WHEN degraded = 1 THEN 1 ELSE 0 END),0) AS degraded "
              + "FROM guides WHERE created_at >= :since",
      nativeQuery = true)
  GuideCountRow countKpi(@Param("since") Instant since);

  /** 윈도우 내 가이드 전체 피드백 좋아요/싫어요 수(guide_feedback.created_at 기준). */
  @Query(
      value =
          "SELECT COALESCE(SUM(CASE WHEN feedback = 'LIKE' THEN 1 ELSE 0 END),0) AS likes, "
              + "  COALESCE(SUM(CASE WHEN feedback = 'DISLIKE' THEN 1 ELSE 0 END),0) AS dislikes "
              + "FROM guide_feedback WHERE created_at >= :since",
      nativeQuery = true)
  FeedbackRow feedbackKpi(@Param("since") Instant since);

  /** 축(primary_focus)별 가이드 수 (윈도우). null 은 '(미분류)' 로. 정렬은 서비스(순수 함수)에서. */
  @Query(
      value =
          "SELECT COALESCE(primary_focus,'(미분류)') AS focus, COUNT(*) AS cnt "
              + "FROM guides WHERE created_at >= :since "
              + "GROUP BY focus",
      nativeQuery = true)
  List<FocusProj> focusDistribution(@Param("since") Instant since);

  /** 일별 가이드 생성 수 (KST). */
  @Query(
      value =
          "SELECT DATE_FORMAT(DATE_ADD(created_at, INTERVAL 9 HOUR),'%Y-%m-%d') AS day, "
              + "       COUNT(*) AS cnt "
              + "FROM guides WHERE created_at >= :since "
              + "GROUP BY day ORDER BY day",
      nativeQuery = true)
  List<DailyProj> dailyGuides(@Param("since") Instant since);

  /** 가이드당 과제(블록) 수 분포 (윈도우). payload.blocks 배열 길이. */
  @Query(
      value =
          "SELECT COALESCE(JSON_LENGTH(payload, '$.blocks'),0) AS tasks, COUNT(*) AS cnt "
              + "FROM guides WHERE created_at >= :since "
              + "GROUP BY tasks ORDER BY tasks",
      nativeQuery = true)
  List<TaskProj> taskCountDistribution(@Param("since") Instant since);

  /**
   * 생성 결과 mode 분포 — {@code guide_result} 이벤트(WP8-b 계측)의 payload.mode 별 수. coach/(전체)로 생성 성공률 산출.
   *
   * <p>{@code guides} 테이블과 달리 refused/clarify/redirect 도 잡힌다. 계측 시작 이후 발생분만 존재.
   */
  @Query(
      value =
          "SELECT COALESCE(JSON_UNQUOTE(JSON_EXTRACT(payload,'$.mode')),'(unknown)') AS mode, "
              + "       COUNT(*) AS cnt "
              + "FROM analytics_events "
              + "WHERE event_type = 'guide_result' AND created_at >= :since "
              + "GROUP BY mode",
      nativeQuery = true)
  List<ModeProj> modeDistribution(@Param("since") Instant since);

  /** 레퍼런스 재추천(불만족) 요청 수 — {@code guide_reroll} 이벤트(WP8-b 계측), 윈도우. */
  @Query(
      value =
          "SELECT COUNT(*) FROM analytics_events "
              + "WHERE event_type = 'guide_reroll' AND created_at >= :since",
      nativeQuery = true)
  long rerollCount(@Param("since") Instant since);

  interface GuideCountRow {
    Number getTotal();

    Number getDegraded();
  }

  interface FeedbackRow {
    Number getLikes();

    Number getDislikes();
  }

  interface FocusProj {
    String getFocus();

    Number getCnt();
  }

  interface DailyProj {
    String getDay();

    Number getCnt();
  }

  interface TaskProj {
    Number getTasks();

    Number getCnt();
  }

  interface ModeProj {
    String getMode();

    Number getCnt();
  }
}
