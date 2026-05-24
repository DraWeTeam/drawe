package com.drawe.backend.domain.image.controller;

import com.drawe.backend.domain.image.dto.ImageUploadResponse;
import com.drawe.backend.domain.image.service.ImageStorage;
import com.drawe.backend.domain.image.service.ImageUploadService;
import com.drawe.backend.global.error.CustomException;
import com.drawe.backend.global.error.ErrorCode;
import com.drawe.backend.global.response.ApiResponse;
import com.drawe.backend.global.security.PrincipalDetails;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

@RestController
@RequestMapping("/images")
@RequiredArgsConstructor
public class ImageController {

  private final ImageUploadService imageUploadService;
  private final ImageStorage imageStorage;

  @PostMapping("/upload")
  public ApiResponse<ImageUploadResponse> upload(
      @AuthenticationPrincipal PrincipalDetails principal,
      @RequestParam("file") MultipartFile file) {
    ImageStorage.Stored stored = imageUploadService.upload(principal.getUser(), file);
    return ApiResponse.success(new ImageUploadResponse(stored.id(), stored.url()));
  }

  @GetMapping("/{id}")
  public ResponseEntity<byte[]> view(
      @AuthenticationPrincipal PrincipalDetails principal, @PathVariable Long id) {
    ImageStorage.Loaded loaded = imageStorage.load(id);
    if (!loaded.ownerId().equals(principal.getUser().getId())) {
      throw new CustomException(ErrorCode.FORBIDDEN);
    }
    return ResponseEntity.ok()
        .contentType(MediaType.parseMediaType(loaded.mimeType()))
        .header(HttpHeaders.CACHE_CONTROL, "private, max-age=3600")
        .body(loaded.data());
  }
}
