package com.drawe.backend.domain.gallery.service;

import com.drawe.backend.domain.Guide;
import com.drawe.backend.domain.Image;
import com.drawe.backend.domain.Project;
import com.drawe.backend.domain.ProjectReference;
import com.drawe.backend.domain.User;
import com.drawe.backend.domain.enums.ProjectStatus;
import com.drawe.backend.domain.gallery.dto.GalleryDetailResponse;
import com.drawe.backend.domain.gallery.dto.GalleryDetailResponse.Overview;
import com.drawe.backend.domain.gallery.dto.GalleryDetailResponse.Point;
import com.drawe.backend.domain.gallery.dto.GalleryDetailResponse.ProcessShot;
import com.drawe.backend.domain.gallery.dto.GalleryDetailResponse.QuestionPhase;
import com.drawe.backend.domain.gallery.dto.GalleryDetailResponse.Summary;
import com.drawe.backend.domain.gallery.dto.GalleryDetailResponse.TimelineEvent;
import com.drawe.backend.domain.gallery.dto.GalleryDetailResponse.TopReference;
import com.drawe.backend.domain.gallery.dto.GalleryDetailResponse.TrendGroup;
import com.drawe.backend.domain.gallery.dto.GalleryItem;
import com.drawe.backend.domain.gallery.dto.GalleryResponse;
import com.drawe.backend.domain.gallery.dto.ReferenceArchiveResponse;
import com.drawe.backend.domain.gallery.dto.ReferenceArchiveResponse.ProjectSection;
import com.drawe.backend.domain.gallery.dto.ReferenceArchiveResponse.ReferenceImageItem;
import com.drawe.backend.domain.guide.repository.GuideRepository;
import com.drawe.backend.domain.project.repository.ProjectReferenceRepository;
import com.drawe.backend.domain.project.repository.ProjectRepository;
import com.drawe.backend.global.client.dto.GuideResponse;
import com.drawe.backend.global.error.CustomException;
import com.drawe.backend.global.error.ErrorCode;
import java.time.DayOfWeek;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeSet;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** 완성작 갤러리 + 레퍼런스 아카이브 + 완성작 상세(회고) — 로그인 유저의 AI 완성작·프로젝트 레퍼런스·가이드 히스토리를 조회한다. */
@Service
public class GalleryService {

  private static final DateTimeFormatter DATE = DateTimeFormatter.ofPattern("yyyy-MM-dd");
  private static final DateTimeFormatter MONTH_DAY = DateTimeFormatter.ofPattern("MM.dd");
  private static final List<String> GROUP_LABELS = List.of("전체", "형태", "구조", "표현", "연출");
  private static final int MAX_WEEKS = 8;

  private final ProjectRepository projectRepository;
  private final ProjectReferenceRepository projectReferenceRepository;
  private final GuideRepository guideRepository;

  /**
   * 완성작 상세(회고) 이전에 만들어진 2-인자 생성자 호환 — 기존 단위 테스트(getReferenceArchive 검증)가 이 시그니처를 직접 호출한다.
   * getCompletedDetail 을 쓰지 않는 경로에서만 유효(guideRepository=null).
   */
  public GalleryService(
      ProjectRepository projectRepository, ProjectReferenceRepository projectReferenceRepository) {
    this(projectRepository, projectReferenceRepository, null);
  }

  @Autowired
  public GalleryService(
      ProjectRepository projectRepository,
      ProjectReferenceRepository projectReferenceRepository,
      GuideRepository guideRepository) {
    this.projectRepository = projectRepository;
    this.projectReferenceRepository = projectReferenceRepository;
    this.guideRepository = guideRepository;
  }

  @Transactional(readOnly = true)
  public GalleryResponse getCompleted(User user, int page, int size) {
    Page<Project> result =
        projectRepository.findCompletedWithDrawing(
            user, ProjectStatus.COMPLETED, PageRequest.of(page, size));

    var items = result.getContent().stream().map(GalleryItem::of).toList();
    boolean hasMore = result.hasNext();
    return new GalleryResponse(items, result.getTotalElements(), hasMore);
  }

  /** 레퍼런스 아카이브 — 유저의 모든 프로젝트 레퍼런스를 프로젝트별 섹션으로 묶는다. */
  @Transactional(readOnly = true)
  public ReferenceArchiveResponse getReferenceArchive(User user) {
    List<ProjectReference> refs = projectReferenceRepository.findAllByUserWithImage(user);

    // 쿼리가 (project.id DESC, addedAt DESC) 로 정렬돼 오므로 LinkedHashMap 으로 그 순서를 보존한다.
    Map<Long, ProjectSection> sections = new LinkedHashMap<>();
    for (ProjectReference ref : refs) {
      Project project = ref.getProject();
      ProjectSection section =
          sections.computeIfAbsent(
              project.getId(), id -> new ProjectSection(id, project.getName(), new ArrayList<>()));
      Image image = ref.getImage();
      section.references().add(new ReferenceImageItem(image.getId(), image.getUrl()));
    }
    return new ReferenceArchiveResponse(new ArrayList<>(sections.values()));
  }

  /**
   * 완성작 상세(회고) — 한 완성 프로젝트의 가이드 히스토리를 집계한다. 가이드 0개여도 500 없이 빈 리스트/0 으로 200 반환.
   *
   * <p>소유 확인: findById 후 project.getUser().getId().equals(user.getId()) (기존 서비스와 동일 패턴).
   */
  @Transactional(readOnly = true)
  public GalleryDetailResponse getCompletedDetail(User user, Long projectId) {
    Project project =
        projectRepository
            .findById(projectId)
            .orElseThrow(() -> new CustomException(ErrorCode.NOT_FOUND));
    if (!project.getUser().getId().equals(user.getId())) {
      throw new CustomException(ErrorCode.FORBIDDEN);
    }

    // 최신→과거로 오지만, 집계는 과거→최신(오름차순)이 편해 뒤집는다.
    List<Guide> guides =
        new ArrayList<>(
            guideRepository.findByUser_IdAndProject_IdOrderByCreatedAtDesc(
                user.getId(), projectId));
    Collections.reverse(guides); // 이제 오름차순(과거→최신)

    Overview overview = buildOverview(project, guides);
    List<TrendGroup> weeklyTrend = buildWeeklyTrend(guides);
    List<String> recurringTop = buildRecurringTop(guides);
    List<String> improvedItems = buildImprovedItems(guides);
    List<TimelineEvent> timeline = buildTimeline(project, guides);
    List<ProcessShot> processGallery = buildProcessGallery(guides);
    List<TopReference> topReferences = buildTopReferences(guides);
    List<QuestionPhase> questionGrowth = buildQuestionGrowth(guides);
    Summary summary = buildSummary(guides, recurringTop);

    return new GalleryDetailResponse(
        overview,
        weeklyTrend,
        recurringTop,
        improvedItems,
        timeline,
        processGallery,
        topReferences,
        questionGrowth,
        summary);
  }

  // ── 집계 헬퍼 ───────────────────────────────────────────────

  private Overview buildOverview(Project project, List<Guide> guides) {
    Instant createdAt = project.getCreatedAt();
    Instant completedAt = project.getUpdatedAt();
    int workDays = 0;
    if (createdAt != null && completedAt != null) {
      long days = ChronoUnit.DAYS.between(createdAt, completedAt) + 1;
      workDays = days < 0 ? 0 : (int) days;
    }
    int drawingCount = 0;
    for (Guide g : guides) {
      if (g.getUpload() != null) {
        drawingCount++;
      }
    }
    return new Overview(
        project.getName(),
        project.getDrawingUrl(),
        createdAt,
        completedAt,
        workDays,
        guides.size(),
        (int) projectReferenceRepository.countByProject(project),
        drawingCount);
  }

  /** guide.getCreatedAt() 을 UTC LocalDate 로 본 뒤, 그 주 월요일을 주 버킷 키로 삼는다. */
  private LocalDate weekMonday(Instant createdAt) {
    LocalDate d = createdAt.atZone(ZoneOffset.UTC).toLocalDate();
    return d.with(DayOfWeek.MONDAY);
  }

  private List<TrendGroup> buildWeeklyTrend(List<Guide> guides) {
    // 데이터가 있는 주(월요일)만, 오름차순, 최대 8주(초과 시 최근 8주).
    TreeSet<LocalDate> weekSet = new TreeSet<>();
    for (Guide g : guides) {
      if (g.getCreatedAt() != null) {
        weekSet.add(weekMonday(g.getCreatedAt()));
      }
    }
    List<LocalDate> weeks = new ArrayList<>(weekSet);
    if (weeks.size() > MAX_WEEKS) {
      weeks = new ArrayList<>(weeks.subList(weeks.size() - MAX_WEEKS, weeks.size()));
    }
    // 주축 위치 인덱스
    Map<LocalDate, Integer> weekIndex = new LinkedHashMap<>();
    for (int i = 0; i < weeks.size(); i++) {
      weekIndex.put(weeks.get(i), i);
    }

    // group("전체" 항상; 나머지 그룹은 해당 guide 만) × 주 count 매트릭스
    Map<String, int[]> counts = new LinkedHashMap<>();
    for (String label : GROUP_LABELS) {
      counts.put(label, new int[weeks.size()]);
    }
    for (Guide g : guides) {
      if (g.getCreatedAt() == null) {
        continue;
      }
      Integer idx = weekIndex.get(weekMonday(g.getCreatedAt()));
      if (idx == null) {
        continue; // 최근 8주 밖으로 잘린 주
      }
      counts.get("전체")[idx]++;
      String group = trackGroup(g);
      if (group != null && counts.containsKey(group)) {
        counts.get(group)[idx]++;
      }
    }

    List<TrendGroup> out = new ArrayList<>();
    for (String label : GROUP_LABELS) {
      int[] c = counts.get(label);
      List<Point> points = new ArrayList<>();
      for (int i = 0; i < weeks.size(); i++) {
        points.add(new Point(weeks.get(i).format(MONTH_DAY), c[i]));
      }
      out.add(new TrendGroup(label, points));
    }
    return out;
  }

  /** payload.nextSteps()!=null && .track()!=null ? .track().group() : null. */
  private String trackGroup(Guide g) {
    GuideResponse p = g.getPayload();
    if (p == null || p.nextSteps() == null || p.nextSteps().track() == null) {
      return null;
    }
    return p.nextSteps().track().group();
  }

  private List<String> buildRecurringTop(List<Guide> guides) {
    Map<String, Integer> freq = new LinkedHashMap<>();
    for (Guide g : guides) {
      String pf = g.getPrimaryFocus();
      if (pf != null) {
        freq.merge(pf, 1, Integer::sum);
      }
    }
    return freq.entrySet().stream()
        .sorted(Map.Entry.<String, Integer>comparingByValue().reversed())
        .limit(3)
        .map(Map.Entry::getKey)
        .toList();
  }

  /** 오름차순 guide 를 전/후반으로 나눠, 전반 primaryFocus 중 후반에 없어진 것 = 개선됨. 최대 3. */
  private List<String> buildImprovedItems(List<Guide> guides) {
    if (guides.size() < 2) {
      return List.of();
    }
    int half = guides.size() / 2;
    java.util.LinkedHashSet<String> firstHalf = new java.util.LinkedHashSet<>();
    java.util.HashSet<String> secondHalf = new java.util.HashSet<>();
    for (int i = 0; i < guides.size(); i++) {
      String pf = guides.get(i).getPrimaryFocus();
      if (pf == null) {
        continue;
      }
      if (i < half) {
        firstHalf.add(pf);
      } else {
        secondHalf.add(pf);
      }
    }
    List<String> improved = new ArrayList<>();
    for (String axis : firstHalf) {
      if (!secondHalf.contains(axis)) {
        improved.add(axis);
        if (improved.size() == 3) {
          break;
        }
      }
    }
    return improved;
  }

  private List<TimelineEvent> buildTimeline(Project project, List<Guide> guides) {
    List<TimelineEvent> events = new ArrayList<>();
    for (Guide g : guides) {
      if (g.getCreatedAt() == null) {
        continue;
      }
      String label = g.getPrimaryFocus() != null ? g.getPrimaryFocus() : "가이드";
      String thumb = g.getUpload() != null ? "/images/" + g.getUpload().getId() : null;
      events.add(new TimelineEvent(dateStr(g.getCreatedAt()), label, thumb, "guide"));
    }
    // 정본 성장 타임라인 = 드로잉 진행 마일스톤(가이드·완료)만. 레퍼런스 저장(아카이브 액션)은 진행
    //   단계가 아니라 타임라인에서 제외한다.
    // 완료 이벤트.
    if (project.getUpdatedAt() != null) {
      events.add(
          new TimelineEvent(
              dateStr(project.getUpdatedAt()), "완료", project.getDrawingUrl(), "complete"));
    }
    events.sort(Comparator.comparing(TimelineEvent::date));
    return events;
  }

  private List<ProcessShot> buildProcessGallery(List<Guide> guides) {
    List<ProcessShot> shots = new ArrayList<>();
    int n = 0;
    for (Guide g : guides) {
      if (g.getUpload() == null || g.getCreatedAt() == null) {
        continue;
      }
      n++;
      shots.add(
          new ProcessShot(dateStr(g.getCreatedAt()), "/images/" + g.getUpload().getId(), n + "차"));
    }
    return shots;
  }

  private List<TopReference> buildTopReferences(List<Guide> guides) {
    Map<String, Integer> freq = new LinkedHashMap<>();
    for (Guide g : guides) {
      GuideResponse p = g.getPayload();
      if (p == null || p.blocks() == null) {
        continue;
      }
      for (GuideResponse.GuideBlock block : p.blocks()) {
        if (block == null || block.referenceIds() == null) {
          continue;
        }
        for (String refId : block.referenceIds()) {
          if (refId != null) {
            freq.merge(refId, 1, Integer::sum);
          }
        }
      }
    }
    return freq.entrySet().stream()
        .sorted(Map.Entry.<String, Integer>comparingByValue().reversed())
        .limit(3)
        .map(e -> new TopReference(e.getKey(), "/image/" + e.getKey(), e.getValue()))
        .toList();
  }

  /** requestText!=null 인 guide 오름차순 리스트를 위치로 3등분 — 각 구간 첫 항목만 대표로. 최대 3. */
  private List<QuestionPhase> buildQuestionGrowth(List<Guide> guides) {
    List<Guide> withText = new ArrayList<>();
    for (Guide g : guides) {
      if (g.getRequestText() != null && g.getCreatedAt() != null) {
        withText.add(g);
      }
    }
    List<QuestionPhase> out = new ArrayList<>();
    String[] phases = {"초기", "중기", "후기"};
    int total = withText.size();
    if (total == 0) {
      return out;
    }
    int buckets = Math.min(3, total);
    for (int b = 0; b < buckets; b++) {
      // 구간 시작 위치(위치 3등분) — 각 구간 첫 항목을 대표로.
      int start = (int) Math.round((double) b * total / buckets);
      if (start >= total) {
        start = total - 1;
      }
      Guide g = withText.get(start);
      out.add(new QuestionPhase(phases[b], dateStr(g.getCreatedAt()), g.getRequestText()));
    }
    return out;
  }

  /** recurringTop[0] axis 를 primaryFocus 로 갖는 guide 들의 주별 개수에서 first/last 주 개수. */
  private Summary buildSummary(List<Guide> guides, List<String> recurringTop) {
    if (recurringTop.isEmpty()) {
      return null;
    }
    String axisId = recurringTop.get(0);
    // 주(월요일) → 그 축 요청 수
    Map<LocalDate, Integer> perWeek = new java.util.TreeMap<>();
    for (Guide g : guides) {
      if (axisId.equals(g.getPrimaryFocus()) && g.getCreatedAt() != null) {
        perWeek.merge(weekMonday(g.getCreatedAt()), 1, Integer::sum);
      }
    }
    if (perWeek.isEmpty()) {
      return null;
    }
    List<Integer> vals = new ArrayList<>(perWeek.values());
    int firstWeekHits = vals.get(0);
    int lastWeekHits = vals.get(vals.size() - 1);
    return new Summary(axisId, firstWeekHits, lastWeekHits);
  }

  private String dateStr(Instant instant) {
    return instant.atZone(ZoneOffset.UTC).toLocalDate().format(DATE);
  }
}
