package com.drawe.backend.domain.feedback.user.repository;

import com.drawe.backend.domain.feedback.user.UserFeedback;
import org.springframework.data.jpa.repository.JpaRepository;

public interface UserFeedbackRepository extends JpaRepository<UserFeedback, Long> {}
