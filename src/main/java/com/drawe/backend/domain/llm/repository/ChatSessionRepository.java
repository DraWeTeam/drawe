package com.drawe.backend.domain.llm.repository;

import com.drawe.backend.domain.ChatSession;
import com.drawe.backend.domain.Project;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;

public interface ChatSessionRepository extends JpaRepository<ChatSession, String> {

  List<ChatSession> findByProject(Project project);
}
