package com.drawe.backend.domain.feedback.repository;

import com.drawe.backend.domain.Image;
import com.drawe.backend.domain.ImageFeedback;
import com.drawe.backend.domain.User;
import com.drawe.backend.domain.enums.FeedbackType;
import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface ImageFeedbackRepository extends JpaRepository<ImageFeedback, Long> {
  Optional<ImageFeedback> findByUserAndImage(User user, Image image);

  /** 특정 반응(예: DISLIKE)을 남긴 이미지 id 목록 — 레퍼런스 보드 검색에서 제외/표시용(SCRUM-113). */
  @Query("SELECT f.image.id FROM ImageFeedback f WHERE f.user = :user AND f.feedback = :type")
  List<Long> findImageIdsByUserAndFeedback(
      @Param("user") User user, @Param("type") FeedbackType type);
}
