package com.drawe.backend.domain.reference.repository;

import com.drawe.backend.domain.reference.ReferenceBoardImpression;
import org.springframework.data.jpa.repository.JpaRepository;

/** 레퍼런스 보드 검색 노출 로그 저장소. 배치 insert(saveAll)만 쓰며, 조회는 어드민 퍼널 native 쿼리가 담당한다. */
public interface ReferenceBoardImpressionRepository
    extends JpaRepository<ReferenceBoardImpression, Long> {}
