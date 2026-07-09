package com.drawe.backend.domain.collection.repository;

import com.drawe.backend.domain.Collection;
import com.drawe.backend.domain.User;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;

public interface CollectionRepository extends JpaRepository<Collection, Long> {

  /** 유저의 모든 컬렉션 — 최신순. 아카이브 목록(SCR-ARCH-02). */
  List<Collection> findByUserOrderByCreatedAtDesc(User user);
}
