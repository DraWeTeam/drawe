package com.drawe.backend.domain.reference.repository;

import com.drawe.backend.domain.reference.ReferenceGeneration;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;

public interface ReferenceGenerationRepository extends JpaRepository<ReferenceGeneration, Long> {

  /** 프로젝트·사용자의 생성 대화를 시간순(오래된→최신)으로 — 진입 시 채팅 복원 순서. */
  List<ReferenceGeneration> findByProjectIdAndUserIdOrderByCreatedAtAsc(
      Long projectId, Long userId);
}
