package com.drawe.backend.domain.collection.service;

import com.drawe.backend.domain.Collection;
import com.drawe.backend.domain.CollectionReference;
import com.drawe.backend.domain.Image;
import com.drawe.backend.domain.ImageDraweTag;
import com.drawe.backend.domain.User;
import com.drawe.backend.domain.collection.dto.ArchiveTargetsResponse;
import com.drawe.backend.domain.collection.dto.CollectionCreateRequest;
import com.drawe.backend.domain.collection.dto.CollectionDetailResponse;
import com.drawe.backend.domain.collection.dto.CollectionDetailResponse.ReferenceItem;
import com.drawe.backend.domain.collection.dto.CollectionSummaryResponse;
import com.drawe.backend.domain.collection.dto.CollectionSummaryResponse.CollectionCard;
import com.drawe.backend.domain.collection.dto.CollectionUpdateRequest;
import com.drawe.backend.domain.collection.dto.ReferenceDetailResponse;
import com.drawe.backend.domain.collection.repository.CollectionReferenceRepository;
import com.drawe.backend.domain.collection.repository.CollectionRepository;
import com.drawe.backend.domain.feedback.dto.FeedbackResponse;
import com.drawe.backend.domain.feedback.service.ImageFeedbackService;
import com.drawe.backend.domain.image.repository.ImageDraweTagRepository;
import com.drawe.backend.domain.image.repository.ImageRepository;
import com.drawe.backend.domain.image.service.ImageUrlSigner;
import com.drawe.backend.domain.project.repository.ProjectReferenceRepository;
import com.drawe.backend.global.error.CustomException;
import com.drawe.backend.global.error.ErrorCode;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** 아카이브 레퍼런스 컬렉션 — 조회(목록/상세) + CRUD + 레퍼런스 저장/제거/고정(SCR-ARCH-01~06). */
@Slf4j
@Service
@RequiredArgsConstructor
public class CollectionService {

  /** 카드 4분할 썸네일 개수. */
  private static final int THUMB_COUNT = 4;

  /** 레퍼런스 상세(SCR-ARCH-05)의 출처 링크 — 스펙상 DraWe 도메인 고정 표기. */
  private static final String SOURCE_URL = "https://www.drawe.com";

  private final CollectionRepository collectionRepository;
  private final CollectionReferenceRepository collectionReferenceRepository;
  private final ImageRepository imageRepository;
  private final ImageDraweTagRepository imageDraweTagRepository;
  private final ImageFeedbackService imageFeedbackService;
  private final ImageUrlSigner imageUrlSigner;
  private final ProjectReferenceRepository projectReferenceRepository;

  /** 카드 밑 대표 태그 후보 개수 — 프론트가 한국어 매핑 후 앞 3개를 노출한다(SCR-ARCH-05). 매핑에서 빠지는 태그를 감안해 넉넉히 보낸다. */
  private static final int CARD_KEYWORDS = 8;

  /**
   * 아카이브 목록(SCR-ARCH-02) — 유저의 모든 컬렉션을 카드로. 컬렉션 자체는 최신순, 각 카드의 썸네일은 컬렉션 내 (고정 우선, 최신순) 앞 4개. 레퍼런스를
   * 한 번에 로드해 컬렉션별로 그룹핑(N+1 방지). 레퍼런스 0개인 컬렉션도 빈 카드로 노출한다(막 만든 컬렉션 등).
   */
  @Transactional(readOnly = true)
  public CollectionSummaryResponse getCollections(User user) {
    List<Collection> collections = collectionRepository.findByUserOrderByCreatedAtDesc(user);

    // 컬렉션 id → 썸네일 url(앞 4개) + 총 개수. 쿼리는 (컬렉션 최신순, 고정 우선, 추가 최신순)로 온다.
    Map<Long, List<String>> thumbsByColl = new LinkedHashMap<>();
    Map<Long, Integer> countByColl = new LinkedHashMap<>();
    for (CollectionReference ref : collectionReferenceRepository.findAllByUserWithImage(user)) {
      Long cid = ref.getCollection().getId();
      countByColl.merge(cid, 1, Integer::sum);
      List<String> thumbs = thumbsByColl.computeIfAbsent(cid, id -> new ArrayList<>());
      if (thumbs.size() < THUMB_COUNT) {
        thumbs.add(imageUrlSigner.sign(ref.getImage().getUrl()));
      }
    }

    List<CollectionCard> cards = new ArrayList<>();
    for (Collection c : collections) {
      cards.add(
          new CollectionCard(
              c.getId(),
              c.getName(),
              c.getTags() == null ? List.of() : c.getTags(),
              countByColl.getOrDefault(c.getId(), 0),
              thumbsByColl.getOrDefault(c.getId(), List.of())));
    }
    return new CollectionSummaryResponse(cards);
  }

  /** 컬렉션 상세(SCR-ARCH-04) — 헤더 + 레퍼런스 그리드(고정 우선, 최신순). 소유자만. */
  @Transactional(readOnly = true)
  public CollectionDetailResponse getCollection(User user, Long collectionId) {
    Collection collection = loadAuthorized(user, collectionId);

    List<CollectionReference> collRefs =
        collectionReferenceRepository.findByCollectionWithImage(collection);

    // 카드 밑 대표 태그(3개)용 — 이미지 태그(ImageDraweTag)를 한 번에 배치 로드(N+1 방지).
    List<Long> imageIds = collRefs.stream().map(cr -> cr.getImage().getId()).toList();
    Map<Long, ImageDraweTag> tagByImage = new LinkedHashMap<>();
    if (!imageIds.isEmpty()) {
      for (ImageDraweTag t : imageDraweTagRepository.findByImageIdIn(imageIds)) {
        tagByImage.putIfAbsent(t.getImage().getId(), t);
      }
    }

    List<ReferenceItem> refs =
        collRefs.stream()
            .map(
                cr ->
                    new ReferenceItem(
                        cr.getImage().getId(),
                        imageUrlSigner.sign(cr.getImage().getUrl()),
                        cr.getImage().getSource().name(),
                        Boolean.TRUE.equals(cr.getPinned()),
                        cr.getAddedAt(),
                        deriveKeywords(cr.getImage(), tagByImage.get(cr.getImage().getId())),
                        cr.getUserTags() == null ? List.of() : cr.getUserTags()))
            .toList();

    return new CollectionDetailResponse(
        collection.getId(),
        collection.getName(),
        collection.getDescription(),
        collection.getTags() == null ? List.of() : collection.getTags(),
        refs);
  }

  /** 카드 ⋮ '아카이브' 서브메뉴 — 유저의 모든 컬렉션(최신순)과 이 이미지가 이미 담겼는지 여부. 담긴 컬렉션은 프론트에서 체크·비활성화한다. */
  @Transactional(readOnly = true)
  public ArchiveTargetsResponse getArchiveTargets(User user, Long imageId) {
    List<Collection> collections = collectionRepository.findByUserOrderByCreatedAtDesc(user);
    Set<Long> containedIds =
        new HashSet<>(collectionReferenceRepository.findCollectionIdsByUserAndImage(user, imageId));

    Map<Long, Integer> countByColl = new LinkedHashMap<>();
    for (Object[] row : collectionReferenceRepository.countByUserGroupedByCollection(user)) {
      countByColl.put((Long) row[0], ((Long) row[1]).intValue());
    }

    List<ArchiveTargetsResponse.Target> targets =
        collections.stream()
            .map(
                c ->
                    new ArchiveTargetsResponse.Target(
                        c.getId(),
                        c.getName(),
                        countByColl.getOrDefault(c.getId(), 0),
                        containedIds.contains(c.getId())))
            .toList();
    return new ArchiveTargetsResponse(targets);
  }

  /**
   * 레퍼런스 상세(SCR-ARCH-05 전체화면) — 원본 이미지 + 이름 + 출처 + 키워드 + 내 반응. 이미지 단위 조회라 컬렉션 소속을 요구하지 않는다(보드에서도
   * 진입). 키워드는 {@code rawTags}(인제스트 GUIDE_REF 에만 존재), 이름은 캡션/프롬프트에서 유도.
   */
  @Transactional(readOnly = true)
  public ReferenceDetailResponse getReferenceDetail(User user, Long imageId) {
    Image image =
        imageRepository
            .findById(imageId)
            .orElseThrow(() -> new CustomException(ErrorCode.NOT_FOUND));

    FeedbackResponse feedback = imageFeedbackService.getFeedback(user, imageId);
    String myReaction = feedback.type() == null ? null : feedback.type().name();

    ImageDraweTag tag =
        imageDraweTagRepository.findByImageIdIn(List.of(imageId)).stream().findFirst().orElse(null);

    // 출처 표기(SCR-ARCH-05) — 이 이미지가 온 프로젝트명(공개 자료라 소유자 무관). 없으면 DraWe 도메인 폴백.
    List<String> projectNames = projectReferenceRepository.findProjectNamesByImage(imageId);
    String sourceLabel = projectNames.isEmpty() ? SOURCE_URL : projectNames.get(0);

    return new ReferenceDetailResponse(
        image.getId(),
        imageUrlSigner.sign(image.getUrl()),
        image.getSource().name(),
        deriveName(image, tag),
        sourceLabel,
        image.getRawTags() == null ? List.of() : image.getRawTags(),
        myReaction);
  }

  /**
   * 카드 밑 대표 키워드(SCR-ARCH-05) — 최대 3개. rawTags(UNSPLASH 인제스트)가 있으면 앞 3개, 없으면(AI 등) ImageDraweTag 의
   * subject/technique/mood 를 쓴다. 둘 다 없으면 빈 리스트(프론트가 source 배지로 폴백).
   */
  private List<String> deriveKeywords(Image image, ImageDraweTag tag) {
    List<String> raw = image.getRawTags();
    if (raw != null && !raw.isEmpty()) {
      return raw.stream().filter(s -> s != null && !s.isBlank()).limit(CARD_KEYWORDS).toList();
    }
    if (tag != null) {
      // subject 는 프로젝트 주제(예 "완전 맛있는 햄버거 그리기")라 카드 태그에서 제외한다.
      // 그림의 성격을 나타내는 technique/mood/freeTags 만 대표 태그로 쓴다.
      List<String> out = new ArrayList<>();
      addIfPresent(out, tag.getTechnique());
      addIfPresent(out, tag.getMood());
      if (out.size() < CARD_KEYWORDS && tag.getFreeTags() != null) {
        for (String f : tag.getFreeTags()) {
          if (out.size() >= CARD_KEYWORDS) break;
          addIfPresent(out, f);
        }
      }
      return out.stream().limit(CARD_KEYWORDS).toList();
    }
    return List.of();
  }

  private void addIfPresent(List<String> list, String v) {
    if (v != null && !v.isBlank() && !list.contains(v)) {
      list.add(v.strip());
    }
  }

  /**
   * 레퍼런스 표시 이름 — 고유명이 없는 스톡/AI 는 유도한다. AI 는 프롬프트가 영어라, 한글로 뽑힌 태그 subject(프로젝트 주제, 예 "완전 맛있는 햄버거
   * 그리기")를 우선 이름으로 쓴다. 없으면 Unsplash 캡션 → 프롬프트 → 폴백 순.
   */
  private String deriveName(Image image, ImageDraweTag tag) {
    if (tag != null && tag.getSubject() != null && !tag.getSubject().isBlank()) {
      return truncate(tag.getSubject(), 60);
    }
    String caption = image.getAiDescription();
    if (caption != null && !caption.isBlank()) {
      return truncate(caption, 60);
    }
    String prompt = image.getPrompt();
    if (prompt != null && !prompt.isBlank()) {
      return truncate(prompt, 60);
    }
    return "레퍼런스";
  }

  private String truncate(String s, int max) {
    String t = s.strip();
    return t.length() <= max ? t : t.substring(0, max).strip() + "…";
  }

  /** 컬렉션 수정(SCR-ARCH-06) — 이름/설명/태그. tags 는 null 이면 미변경, 배열이면 통째 교체. */
  @Transactional
  public void updateCollection(User user, Long collectionId, CollectionUpdateRequest req) {
    Collection collection = loadAuthorized(user, collectionId);
    collection.setName(req.name());
    collection.setDescription(req.description());
    if (req.tags() != null) {
      collection.setTags(req.tags());
    }
    // dirty checking — 트랜잭션 커밋 시 UPDATE.
  }

  /** 컬렉션 삭제(SCR-ARCH-06) — 담긴 레퍼런스(collection_references)도 FK CASCADE 로 함께 삭제. */
  @Transactional
  public void deleteCollection(User user, Long collectionId) {
    Collection collection = loadAuthorized(user, collectionId);
    collectionRepository.delete(collection);
  }

  /**
   * 새 컬렉션 생성 — SCR-ARCH-05 '아카이브 추가(+)' 또는 SCR-ARCH-02 '직접 추가하기'. imageIds 가 있으면 함께 담는다(멱등). 생성된
   * 컬렉션 id 반환.
   */
  @Transactional
  public Long createCollection(User user, CollectionCreateRequest req) {
    Collection collection = new Collection();
    collection.setUser(user);
    collection.setName(req.name());
    if (req.tags() != null && !req.tags().isEmpty()) {
      collection.setTags(new ArrayList<>(req.tags()));
    }
    collection = collectionRepository.save(collection);

    if (req.imageIds() != null) {
      for (Long imageId : req.imageIds()) {
        attachImage(collection, imageId);
      }
    }
    log.info("컬렉션 생성: userId={}, collectionId={}", user.getId(), collection.getId());
    return collection.getId();
  }

  /** 레퍼런스를 컬렉션에 저장(SCR-ARCH-05 아카이브). (collection,image) 유니크로 멱등. */
  @Transactional
  public void addReference(User user, Long collectionId, Long imageId) {
    Collection collection = loadAuthorized(user, collectionId);
    attachImage(collection, imageId);
    log.info(
        "레퍼런스 컬렉션 저장: userId={}, collectionId={}, imageId={}", user.getId(), collectionId, imageId);
  }

  /** 아카이브 취소(SCR-ARCH-05 카드 ⋮) — 컬렉션에서 레퍼런스 제거. 없으면 조용히 무시. */
  @Transactional
  public void removeReference(User user, Long collectionId, Long imageId) {
    Collection collection = loadAuthorized(user, collectionId);
    Image image =
        imageRepository
            .findById(imageId)
            .orElseThrow(() -> new CustomException(ErrorCode.NOT_FOUND));
    collectionReferenceRepository
        .findByCollectionAndImage(collection, image)
        .ifPresent(collectionReferenceRepository::delete);
  }

  /**
   * 정보 수정(SCR-ARCH-05 카드 ⋮) — 레퍼런스의 사용자 태그를 수정하고(선택), 다른 컬렉션으로 이동(선택). 원본/대상 모두 소유자 검증.
   *
   * <p>{@code userTags} 가 null 이 아니면 이 레퍼런스의 사용자 태그를 통째로 교체한다. {@code targetCollectionId} 가 있고 현재
   * 컬렉션과 다르면 이동한다(대상에 이미 있으면 원본에서만 제거하는 멱등). 이동 시 편집한 태그·고정 상태를 승계한다.
   */
  @Transactional
  public void moveReference(
      User user, Long collectionId, Long imageId, Long targetCollectionId, List<String> userTags) {
    Collection source = loadAuthorized(user, collectionId);
    Image image =
        imageRepository
            .findById(imageId)
            .orElseThrow(() -> new CustomException(ErrorCode.NOT_FOUND));
    CollectionReference ref =
        collectionReferenceRepository
            .findByCollectionAndImage(source, image)
            .orElseThrow(() -> new CustomException(ErrorCode.NOT_FOUND));

    // 태그 수정(선택) — null 이면 미변경, 배열이면 통째 교체.
    if (userTags != null) {
      ref.setUserTags(sanitizeTags(userTags));
    }

    // 이동(선택) — 대상 미지정/동일 컬렉션이면 태그만 저장하고 끝.
    if (targetCollectionId == null || targetCollectionId.equals(collectionId)) {
      return; // dirty checking 으로 태그 UPDATE.
    }
    Collection target = loadAuthorized(user, targetCollectionId);

    // 대상에 없으면 옮기고(고정·태그 승계), 있으면 원본 것만 제거(멱등).
    if (!collectionReferenceRepository.existsByCollectionAndImage(target, image)) {
      CollectionReference moved = new CollectionReference();
      moved.setCollection(target);
      moved.setImage(image);
      moved.setPinned(Boolean.TRUE.equals(ref.getPinned()));
      moved.setUserTags(new ArrayList<>(ref.getUserTags() == null ? List.of() : ref.getUserTags()));
      collectionReferenceRepository.save(moved);
    }
    collectionReferenceRepository.delete(ref);
    log.info(
        "레퍼런스 이동: userId={}, imageId={}, {} -> {}",
        user.getId(),
        imageId,
        collectionId,
        targetCollectionId);
  }

  /** 사용자 태그 정리 — 공백 제거·빈값 제외·중복 제거. */
  private List<String> sanitizeTags(List<String> tags) {
    List<String> out = new ArrayList<>();
    for (String t : tags) {
      if (t == null) continue;
      String s = t.strip();
      if (!s.isEmpty() && !out.contains(s)) {
        out.add(s);
      }
    }
    return out;
  }

  /** 고정하기 토글(SCR-ARCH-05 카드 ⋮). pinned 반전. */
  @Transactional
  public void togglePin(User user, Long collectionId, Long imageId) {
    Collection collection = loadAuthorized(user, collectionId);
    Image image =
        imageRepository
            .findById(imageId)
            .orElseThrow(() -> new CustomException(ErrorCode.NOT_FOUND));
    CollectionReference ref =
        collectionReferenceRepository
            .findByCollectionAndImage(collection, image)
            .orElseThrow(() -> new CustomException(ErrorCode.NOT_FOUND));
    ref.setPinned(!Boolean.TRUE.equals(ref.getPinned()));
  }

  /** 이미지 하나를 컬렉션에 담기(멱등). 이미지 없으면 404, 이미 있으면 무시. */
  private void attachImage(Collection collection, Long imageId) {
    Image image =
        imageRepository
            .findById(imageId)
            .orElseThrow(() -> new CustomException(ErrorCode.NOT_FOUND));
    if (collectionReferenceRepository.existsByCollectionAndImage(collection, image)) {
      return;
    }
    CollectionReference ref = new CollectionReference();
    ref.setCollection(collection);
    ref.setImage(image);
    collectionReferenceRepository.save(ref);
  }

  /** 컬렉션 로드 + 소유자 검증. 없으면 404, 남의 것이면 403. */
  private Collection loadAuthorized(User user, Long collectionId) {
    Collection collection =
        collectionRepository
            .findById(collectionId)
            .orElseThrow(() -> new CustomException(ErrorCode.NOT_FOUND));
    if (!collection.getUser().getId().equals(user.getId())) {
      throw new CustomException(ErrorCode.FORBIDDEN);
    }
    return collection;
  }
}
