package com.drawe.backend.domain.log;

import com.drawe.backend.domain.Project;
import org.springframework.data.jpa.repository.JpaRepository;

public interface SearchLogRepository extends JpaRepository<SearchLog, Long> {
  void deleteByProject(Project project);
}
