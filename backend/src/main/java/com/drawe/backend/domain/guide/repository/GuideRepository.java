package com.drawe.backend.domain.guide.repository;

import com.drawe.backend.domain.Guide;
import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;

public interface GuideRepository extends JpaRepository<Guide, Long> {

  /** 멱등: 같은 request_id 의 가이드가 이미 있으면 재사용(재시도 대응). */
  Optional<Guide> findByRequestId(String requestId);

  /** FastAPI guide_id 로 단건 조회(PDF·레퍼런스 재방문). */
  Optional<Guide> findByGuideId(String guideId);

  /** 프로젝트 내 내 가이드 히스토리(최신순). */
  List<Guide> findByUser_IdAndProject_IdOrderByCreatedAtDesc(Long userId, Long projectId);
}
