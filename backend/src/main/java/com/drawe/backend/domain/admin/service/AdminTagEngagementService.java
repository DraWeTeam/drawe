package com.drawe.backend.domain.admin.service;

import com.drawe.backend.domain.admin.dto.TagEngagementModel.AxisRollup;
import com.drawe.backend.domain.admin.dto.TagEngagementModel.TagRow;
import com.drawe.backend.domain.admin.dto.TagEngagementModel.View;
import com.drawe.backend.domain.admin.repository.AdminTagEngagementRepository;
import com.drawe.backend.domain.admin.repository.AdminTagEngagementRepository.PerImageRow;
import com.drawe.backend.global.client.Ga4ClickSource;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 태그별 레퍼런스 관심도 조립.
 *
 * <p>흐름: (1) DB에서 engagement 있는 이미지별 shown/likes/pins + 태그를 받고 → (2) GA4에서 reference_id별 클릭을 받아
 * 이미지에 병합 → (3) technique/subject/mood 세 축으로 각각 롤업.
 *
 * <p>클릭(GA4)이 비어 있어도(자격증명 미설정) 나머지는 그대로 나온다.
 */
@Service
@RequiredArgsConstructor
public class AdminTagEngagementService {

  private static final ZoneId KST = ZoneId.of("Asia/Seoul");
  private static final DateTimeFormatter TS =
      DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm 'KST'").withZone(KST);

  private final AdminTagEngagementRepository repo;
  private final Ga4ClickSource ga4;

  @Transactional(readOnly = true)
  public View build(int windowHours) {
    Instant since = Instant.now().minus(Duration.ofHours(windowHours));

    List<PerImageRow> rows = repo.perImageEngagement(since);
    Map<Long, Long> clicks = ga4.clicksByImageId(since);

    // 축별 누산기: axis -> (tagValue -> Acc)
    Map<String, Acc> technique = new LinkedHashMap<>();
    Map<String, Acc> subject = new LinkedHashMap<>();
    Map<String, Acc> mood = new LinkedHashMap<>();

    for (PerImageRow r : rows) {
      long shown = num(r.getShown());
      long likes = num(r.getLikes());
      long pins = num(r.getPins());
      long click = clicks.getOrDefault(r.getImageId(), 0L);

      add(technique, r.getTechnique(), shown, click, likes, pins);
      add(subject, r.getSubject(), shown, click, likes, pins);
      add(mood, r.getMood(), shown, click, likes, pins);
    }

    List<AxisRollup> axes =
        List.of(
            new AxisRollup("technique", toRows(technique)),
            new AxisRollup("subject", toRows(subject)),
            new AxisRollup("mood", toRows(mood)));

    return new View(TS.format(Instant.now()), ga4.isAvailable(), axes);
  }

  /** 태그 값 null/blank 는 무시(태그 안 달린 이미지). */
  private void add(
      Map<String, Acc> bucket, String value, long shown, long click, long like, long pin) {
    if (value == null || value.isBlank()) {
      return;
    }
    Acc a = bucket.computeIfAbsent(value, k -> new Acc());
    a.images++;
    a.shown += shown;
    a.clicks += click;
    a.likes += like;
    a.pins += pin;
  }

  /** 관심도 정렬: 노출 대비 행동(클릭+좋아요+핀)이 큰 순. 노출 0이면 뒤로. */
  private List<TagRow> toRows(Map<String, Acc> bucket) {
    List<TagRow> out = new ArrayList<>(bucket.size());
    for (Map.Entry<String, Acc> e : bucket.entrySet()) {
      Acc a = e.getValue();
      Double ctr = a.shown > 0 ? (double) a.clicks / a.shown : null;
      out.add(new TagRow(e.getKey(), a.images, a.shown, a.clicks, a.likes, a.pins, ctr));
    }
    out.sort(
        Comparator.comparingDouble((TagRow t) -> engagementScore(t))
            .reversed()
            .thenComparingLong(t -> -t.shown()));
    return out;
  }

  /** 단순 관심도 점수 — 필요에 맞게 가중치 조정. */
  private double engagementScore(TagRow t) {
    return t.clicks() * 2 + t.likes() * 3 + t.pins() * 4;
  }

  private static long num(Number n) {
    return n == null ? 0L : n.longValue();
  }

  /** 가변 누산기(내부용). */
  private static final class Acc {
    long images;
    long shown;
    long clicks;
    long likes;
    long pins;
  }
}
