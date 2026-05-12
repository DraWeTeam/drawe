package com.drawe.backend.domain.image.repository;

import com.drawe.backend.domain.ImageBlob;
import org.springframework.data.jpa.repository.JpaRepository;

public interface ImageBlobRepository extends JpaRepository<ImageBlob, Long> {}
