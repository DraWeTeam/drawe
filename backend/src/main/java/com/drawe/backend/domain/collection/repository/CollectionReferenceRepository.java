package com.drawe.backend.domain.collection.repository;

import com.drawe.backend.domain.Collection;
import com.drawe.backend.domain.CollectionReference;
import com.drawe.backend.domain.Image;
import com.drawe.backend.domain.User;
import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface CollectionReferenceRepository
    extends JpaRepository<CollectionReference, Long> {

  boolean existsByCollectionAndImage(Collection collection, Image image);

  Optional<CollectionReference> findByCollectionAndImage(Collection collection, Image image);

  long countByCollection(Collection collection);

  /** 컬렉션 상세(SCR-ARCH-05) — 한 컬렉션의 레퍼런스를 image 와 함께 로드. 고정(pinned) 우선, 그다음 최신순. */
  @Query(
      "SELECT cr FROM CollectionReference cr "
          + "JOIN FETCH cr.image "
          + "WHERE cr.collection = :collection "
          + "ORDER BY cr.pinned DESC, cr.addedAt DESC")
  List<CollectionReference> findByCollectionWithImage(@Param("collection") Collection collection);

  /**
   * 아카이브 목록(SCR-ARCH-02) 카드 썸네일용 — 유저의 모든 컬렉션 레퍼런스를 image·collection 과 함께 한 번에 로드(N+1 방지).
   * 호출 측이 컬렉션별로 그룹핑해 앞의 4개를 4분할 썸네일로 쓴다. 고정 우선, 그다음 최신순.
   */
  @Query(
      "SELECT cr FROM CollectionReference cr "
          + "JOIN FETCH cr.image "
          + "JOIN FETCH cr.collection c "
          + "WHERE c.user = :user "
          + "ORDER BY c.createdAt DESC, cr.pinned DESC, cr.addedAt DESC")
  List<CollectionReference> findAllByUserWithImage(@Param("user") User user);
}
