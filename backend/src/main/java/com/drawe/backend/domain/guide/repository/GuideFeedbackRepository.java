package com.drawe.backend.domain.guide.repository;

import com.drawe.backend.domain.Guide;
import com.drawe.backend.domain.GuideFeedback;
import com.drawe.backend.domain.User;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;

public interface GuideFeedbackRepository extends JpaRepository<GuideFeedback, Long> {
  /** 사용자별 가이드 1행(토글 갱신/해제용). (user_id, guide_id) UNIQUE 와 짝. */
  Optional<GuideFeedback> findByUserAndGuide(User user, Guide guide);
}
