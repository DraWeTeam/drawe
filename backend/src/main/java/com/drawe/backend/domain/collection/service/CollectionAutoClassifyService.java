package com.drawe.backend.domain.collection.service;

import com.drawe.backend.domain.Collection;
import com.drawe.backend.domain.CollectionReference;
import com.drawe.backend.domain.Image;
import com.drawe.backend.domain.User;
import com.drawe.backend.domain.collection.repository.CollectionReferenceRepository;
import com.drawe.backend.domain.collection.repository.CollectionRepository;
import com.drawe.backend.global.client.FastApiClient;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 아카이브 컬렉션 자동분류 — 레퍼런스를 저장할 때 성격(명암/구도/색감 등 축)을 판별해 알맞은 축 컬렉션에 담는다. 판별 못 하면 "미분류" 폴백.
 *
 * <ul>
 *   <li><b>레벨2 (가이드 §4)</b>: {@link #classifyByAxis} — 가이드가 이미 아는 축 id 를 직접 받아 그 축 컬렉션에 배치(가장 정확).
 *   <li><b>레벨3 (검색/AI/업로드)</b>: {@link #classifyByImage} — CLIP 이미지 임베딩 vs 6축 텍스트 probe 코사인 최댓값이
 *       임계 이상이면 그 축, 아니면 미분류.
 * </ul>
 *
 * <p>축 텍스트 임베딩은 최초 1회 계산 후 캐시. FastAPI(임베딩) 실패·cold start 시 예외를 삼키고 "미분류"로 폴백해 저장 자체는 절대 막지 않는다.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class CollectionAutoClassifyService {

  /** CLIP 코사인 최소 임계 — 이 미만이면 신뢰 부족으로 미분류. zero-shot 특성상 보수적으로 잡는다. */
  private static final double MIN_COSINE = 0.20;

  /** 미분류 폴백 컬렉션 이름. */
  private static final String UNCLASSIFIED = "미분류";

  private final CollectionRepository collectionRepository;
  private final CollectionReferenceRepository collectionReferenceRepository;
  private final FastApiClient fastApiClient;

  /** 축 텍스트 probe 임베딩 캐시 (probe → 정규화 벡터). 최초 접근 시 채운다. */
  private volatile List<float[]> axisVectors;

  /**
   * 레벨2 — 가이드 축 id 로 분류. 6종 축이면 그 축 컬렉션, 아니면(형태 축·null) 미분류. 저장은 멱등.
   *
   * @return 담긴 컬렉션 id
   */
  @Transactional
  public Long classifyByAxis(User user, Image image, String axisId) {
    Optional<CollectionAxis> axis = CollectionAxis.fromId(axisId);
    Collection target =
        axis.map(a -> axisCollection(user, a)).orElseGet(() -> unclassifiedCollection(user));
    attach(target, image);
    return target.getId();
  }

  /**
   * 레벨3 — CLIP 이미지 임베딩(bytes)으로 분류. 6축 probe 와 코사인 비교해 최댓값이 임계 이상이면 그 축, 아니면 미분류.
   * FastApiClient.embedImage 는 픽셀 bytes 를 받으므로, 저장 경로가 원본 bytes 를 갖고 있을 때만(업로드 등) 쓴다. 임베딩
   * 실패·cold start 시에도 미분류로 안전 폴백해 저장을 막지 않는다.
   *
   * @return 담긴 컬렉션 id
   */
  @Transactional
  public Long classifyByImageBytes(User user, Image image, byte[] bytes, String mime) {
    CollectionAxis best = null;
    try {
      List<Float> imgVec = fastApiClient.embedImage(bytes, mime);
      best = pickAxis(imgVec);
    } catch (Exception e) {
      log.warn("CLIP bytes 임베딩 실패 → 미분류: err={}", e.getClass().getSimpleName());
    }
    Collection target =
        best != null ? axisCollection(user, best) : unclassifiedCollection(user);
    attach(target, image);
    return target.getId();
  }

  /** 임베딩 벡터에서 임계 넘는 최대 축 선택. */
  private CollectionAxis pickAxis(List<Float> imgVec) {
    if (imgVec == null || imgVec.isEmpty()) {
      return null;
    }
    List<float[]> axes = axisVectors();
    if (axes == null) {
      return null;
    }
    float[] q = normalize(imgVec);
    double bestCos = -1;
    CollectionAxis bestAxis = null;
    CollectionAxis[] all = CollectionAxis.values();
    for (int i = 0; i < all.length; i++) {
      double cos = dot(q, axes.get(i));
      if (cos > bestCos) {
        bestCos = cos;
        bestAxis = all[i];
      }
    }
    return bestCos >= MIN_COSINE ? bestAxis : null;
  }

  /** 축 컬렉션 멱등 조회/생성 — axis 는 유저별 유니크(UNIQUE user_id,axis). */
  private Collection axisCollection(User user, CollectionAxis axis) {
    return collectionRepository
        .findByUserAndAxis(user, axis.id())
        .orElseGet(
            () -> {
              Collection c = new Collection();
              c.setUser(user);
              c.setName(axis.label());
              c.setAxis(axis.id());
              c.setIsSystem(false);
              c.setTags(new ArrayList<>(List.of(axis.label())));
              return collectionRepository.save(c);
            });
  }

  /** "미분류" 폴백 컬렉션 멱등 조회/생성. */
  private Collection unclassifiedCollection(User user) {
    return collectionRepository
        .findFirstByUserAndIsSystemTrueAndName(user, UNCLASSIFIED)
        .orElseGet(
            () -> {
              Collection c = new Collection();
              c.setUser(user);
              c.setName(UNCLASSIFIED);
              c.setIsSystem(true);
              return collectionRepository.save(c);
            });
  }

  /** 이미지를 컬렉션에 담기(멱등). */
  private void attach(Collection collection, Image image) {
    if (collectionReferenceRepository.existsByCollectionAndImage(collection, image)) {
      return;
    }
    CollectionReference ref = new CollectionReference();
    ref.setCollection(collection);
    ref.setImage(image);
    collectionReferenceRepository.save(ref);
  }

  /** 축 텍스트 probe 임베딩 캐시(정규화). 최초 1회 FastAPI 호출, 실패 시 null(→ 이번 분류는 미분류). */
  private List<float[]> axisVectors() {
    List<float[]> cached = axisVectors;
    if (cached != null) {
      return cached;
    }
    synchronized (this) {
      if (axisVectors != null) {
        return axisVectors;
      }
      try {
        List<float[]> vecs = new ArrayList<>();
        for (CollectionAxis a : CollectionAxis.values()) {
          List<Float> v = fastApiClient.embedText(a.probe());
          if (v == null || v.isEmpty()) {
            return null; // 하나라도 실패하면 캐시 안 함(다음 저장 때 재시도).
          }
          vecs.add(normalize(v));
        }
        axisVectors = vecs;
        return vecs;
      } catch (Exception e) {
        log.warn("축 probe 임베딩 실패 → 이번 분류 미분류: err={}", e.getClass().getSimpleName());
        return null;
      }
    }
  }

  private static float[] normalize(List<Float> v) {
    float[] out = new float[v.size()];
    double norm = 0;
    for (int i = 0; i < v.size(); i++) {
      out[i] = v.get(i);
      norm += (double) out[i] * out[i];
    }
    norm = Math.sqrt(norm);
    if (norm > 0) {
      for (int i = 0; i < out.length; i++) {
        out[i] /= (float) norm;
      }
    }
    return out;
  }

  private static double dot(float[] a, float[] b) {
    double s = 0;
    int n = Math.min(a.length, b.length);
    for (int i = 0; i < n; i++) {
      s += (double) a[i] * b[i];
    }
    return s;
  }
}
