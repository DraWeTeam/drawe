package com.drawe.backend.domain.collection.repository;

import com.drawe.backend.domain.Collection;
import com.drawe.backend.domain.User;
import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;

public interface CollectionRepository extends JpaRepository<Collection, Long> {

  /** 유저의 모든 컬렉션 — 최신순. 아카이브 목록(SCR-ARCH-02). */
  List<Collection> findByUserOrderByCreatedAtDesc(User user);

  /** 자동분류 축 컬렉션 조회(멱등 생성용). axis 는 유저별 유니크. */
  Optional<Collection> findByUserAndAxis(User user, String axis);

  /** 시스템 컬렉션("미분류" 폴백) 조회. 유저당 name+is_system 로 하나만 둔다. */
  Optional<Collection> findFirstByUserAndIsSystemTrueAndName(User user, String name);
}
