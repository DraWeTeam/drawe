package com.drawe.backend.domain.collection.service;

import com.drawe.backend.domain.Collection;
import com.drawe.backend.domain.CollectionReference;
import com.drawe.backend.domain.Image;
import com.drawe.backend.domain.User;
import com.drawe.backend.domain.collection.dto.CollectionCreateRequest;
import com.drawe.backend.domain.collection.dto.CollectionDetailResponse;
import com.drawe.backend.domain.collection.dto.CollectionDetailResponse.ReferenceItem;
import com.drawe.backend.domain.collection.dto.CollectionSummaryResponse;
import com.drawe.backend.domain.collection.dto.CollectionSummaryResponse.CollectionCard;
import com.drawe.backend.domain.collection.dto.CollectionUpdateRequest;
import com.drawe.backend.domain.collection.repository.CollectionReferenceRepository;
import com.drawe.backend.domain.collection.repository.CollectionRepository;
import com.drawe.backend.domain.image.repository.ImageRepository;
import com.drawe.backend.global.error.CustomException;
import com.drawe.backend.global.error.ErrorCode;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
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

  private final CollectionRepository collectionRepository;
  private final CollectionReferenceRepository collectionReferenceRepository;
  private final ImageRepository imageRepository;

  /**
   * 아카이브 목록(SCR-ARCH-02) — 유저의 모든 컬렉션을 카드로. 컬렉션 자체는 최신순, 각 카드의 썸네일은 컬렉션 내 (고정 우선, 최신순) 앞 4개.
   * 레퍼런스를 한 번에 로드해 컬렉션별로 그룹핑(N+1 방지). 레퍼런스 0개인 컬렉션도 빈 카드로 노출한다(막 만든 컬렉션 등).
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
        thumbs.add(ref.getImage().getUrl());
      }
    }

    List<CollectionCard> cards = new ArrayList<>();
    for (Collection c : collections) {
      cards.add(
          new CollectionCard(
              c.getId(),
              c.getName(),
              c.getAxis(),
              c.getTags() == null ? List.of() : c.getTags(),
              Boolean.TRUE.equals(c.getIsSystem()),
              countByColl.getOrDefault(c.getId(), 0),
              thumbsByColl.getOrDefault(c.getId(), List.of())));
    }
    return new CollectionSummaryResponse(cards);
  }

  /** 컬렉션 상세(SCR-ARCH-04) — 헤더 + 레퍼런스 그리드(고정 우선, 최신순). 소유자만. */
  @Transactional(readOnly = true)
  public CollectionDetailResponse getCollection(User user, Long collectionId) {
    Collection collection = loadAuthorized(user, collectionId);

    List<ReferenceItem> refs =
        collectionReferenceRepository.findByCollectionWithImage(collection).stream()
            .map(
                cr ->
                    new ReferenceItem(
                        cr.getImage().getId(),
                        cr.getImage().getUrl(),
                        cr.getImage().getSource().name(),
                        Boolean.TRUE.equals(cr.getPinned())))
            .toList();

    return new CollectionDetailResponse(
        collection.getId(),
        collection.getName(),
        collection.getDescription(),
        collection.getAxis(),
        collection.getTags() == null ? List.of() : collection.getTags(),
        Boolean.TRUE.equals(collection.getIsSystem()),
        refs);
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
   * 새 컬렉션 생성 — SCR-ARCH-05 '아카이브 추가(+)' 또는 SCR-ARCH-02 '직접 추가하기'. imageIds 가 있으면 함께 담는다(멱등). axis=null,
   * is_system=false 인 사용자 컬렉션. 생성된 컬렉션 id 반환.
   */
  @Transactional
  public Long createCollection(User user, CollectionCreateRequest req) {
    Collection collection = new Collection();
    collection.setUser(user);
    collection.setName(req.name());
    collection.setIsSystem(false);
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
        "레퍼런스 컬렉션 저장: userId={}, collectionId={}, imageId={}",
        user.getId(),
        collectionId,
        imageId);
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
