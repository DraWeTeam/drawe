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

  /**
   * 이미지 바이트 서빙. {@code download=true} 면 {@code Content-Disposition: attachment} 로 브라우저가 인라인
   * 표시 대신 파일을 내려받게 한다(레퍼런스/완성작 다운로드). 접근 제어는 동일한 소유자 검증을 그대로 쓴다.
   */
  @GetMapping("/{id}")
  public ResponseEntity<byte[]> view(
      @AuthenticationPrincipal PrincipalDetails principal,
      @PathVariable Long id,
      @RequestParam(name = "download", defaultValue = "false") boolean download) {
    ImageStorage.Loaded loaded = imageStorage.load(id);
    if (!loaded.ownerId().equals(principal.getUser().getId())) {
      throw new CustomException(ErrorCode.FORBIDDEN);
    }
    ResponseEntity.BodyBuilder builder =
        ResponseEntity.ok()
            .contentType(MediaType.parseMediaType(loaded.mimeType()))
            .header(HttpHeaders.CACHE_CONTROL, "private, max-age=3600");
    if (download) {
      String filename = "image_" + id + extensionFor(loaded.mimeType());
      builder.header(
          HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"" + filename + "\"");
    }
    return builder.body(loaded.data());
  }

  /** mimeType → 파일 확장자. 알 수 없으면 빈 문자열(확장자 없는 파일명). */
  private static String extensionFor(String mimeType) {
    if (mimeType == null) {
      return "";
    }
    return switch (mimeType) {
      case "image/jpeg" -> ".jpg";
      case "image/png" -> ".png";
      case "image/webp" -> ".webp";
      case "image/gif" -> ".gif";
      default -> "";
    };
  }
}
