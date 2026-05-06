package com.drawe.backend.domain.image.repository;

import com.drawe.backend.domain.ImageDraweTag;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.Repository;
import org.springframework.data.repository.query.Param;

import java.util.List;

public interface ImageDraweTagRepository extends JpaRepository<ImageDraweTag, Long> {

    @Query("SELECT t FROM ImageDraweTag t WHERE t.image.id IN :imageIds")
    List<ImageDraweTag> findByImageIdIn(@Param("imageIds") List<Long> imageIds);
}