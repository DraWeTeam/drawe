package com.drawe.backend.domain.image.repository;

import com.drawe.backend.domain.Image;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface ImageRepository extends JpaRepository<Image, Long> {

    //여러 source_id 이미지를 한번에 조회
    List<Image> findBySourceIdIn(List<String> sourceIds);
}