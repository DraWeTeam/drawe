package com.drawe.backend.domain.image.controller;

import com.drawe.backend.domain.image.dto.ImageUploadResponse;
import com.drawe.backend.domain.image.service.DbImageStorage;
import com.drawe.backend.domain.image.service.ImageDownloadService;
import com.drawe.backend.domain.image.service.ImageStorage;
import com.drawe.backend.domain.image.service.ImageUploadService;
import com.drawe.backend.domain.image.service.ImageUrlSigner;
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
  // /images/{id} 바이트 서빙(load)은 MySQL 전용 — s3 프로파일의 @Primary(S3ImageStorage.load=throw) 회피.
  private final DbImageStorage imageStorage;
  private final ImageDownloadService imageDownloadService;
  private final ImageUrlSigner imageUrlSigner;

  @PostMapping("/upload")
  public ApiResponse<ImageUploadResponse> upload(
      @AuthenticationPrincipal PrincipalDetails principal,
      @RequestParam("file") MultipartFile file) {
    ImageStorage.Stored stored = imageUploadService.upload(principal.getUser(), file);
    return ApiResponse.success(new ImageUploadResponse(stored.id(), stored.url()));
  }

  /**
   * 이미지 바이트 서빙. {@code download=true} 면 {@code Content-Disposition: attachment} 로 브라우저가 인라인 표시 대신
   * 파일을 내려받게 한다(레퍼런스/완성작 다운로드).
   *
   * <p>접근 제어는 두 경로 중 하나로 인가한다:
   *
   * <ul>
   *   <li><b>서명 URL</b>({@code ?exp=&sig=}): 브라우저 {@code <img src>} 는 Authorization 헤더를 못 싣는다.
   *       {@link ImageUrlSigner} 가 노출 직전 발급한 단기 HMAC 서명을 검증해 통과시킨다(소유자 무관 — 보드에서 타인의 AI 이미지도 노출돼야
   *       하므로 서명 자체가 인가다).
   *   <li><b>JWT</b>: 서명이 없으면 인증 주체의 소유자 검증으로 폴백한다(직접 API 호출 등).
   * </ul>
   */
  @GetMapping("/{id}")
  public ResponseEntity<byte[]> view(
      @AuthenticationPrincipal PrincipalDetails principal,
      @PathVariable Long id,
      @RequestParam(name = "exp", required = false) Long exp,
      @RequestParam(name = "sig", required = false) String sig,
      @RequestParam(name = "download", defaultValue = "false") boolean download) {
    ImageStorage.Loaded loaded = imageStorage.load(id);

    boolean signed = exp != null && sig != null;
    if (signed) {
      if (!imageUrlSigner.verify(id, exp, sig)) {
        throw new CustomException(ErrorCode.FORBIDDEN);
      }
    } else {
      // 서명이 없으면 JWT 인증 + 소유자 검증(헤더 인증 가능한 직접 호출 경로).
      if (principal == null) {
        throw new CustomException(ErrorCode.UNAUTHORIZED);
      }
      if (!loaded.ownerId().equals(principal.getUser().getId())) {
        throw new CustomException(ErrorCode.FORBIDDEN);
      }
    }
    ResponseEntity.BodyBuilder builder =
        ResponseEntity.ok()
            .contentType(MediaType.parseMediaType(loaded.mimeType()))
            .header(HttpHeaders.CACHE_CONTROL, "private, max-age=3600");
    if (download) {
      String filename = "image_" + id + extensionFor(loaded.mimeType());
      builder.header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"" + filename + "\"");
    }
    return builder.body(loaded.data());
  }

  /**
   * 출처 무관 다운로드 — 외부 URL 레퍼런스(Unsplash 등)는 서버가 프록시로 받아오고, 서버 저장 이미지는 바이트를 그대로 내려준다. 항상 {@code
   * Content-Disposition: attachment} 라 브라우저(아이패드 Safari 포함)가 새 탭이 아닌 파일 다운로드로 처리한다.
   */
  @GetMapping("/{id}/download")
  public ResponseEntity<byte[]> download(
      @AuthenticationPrincipal PrincipalDetails principal, @PathVariable Long id) {
    ImageDownloadService.Download dl =
        imageDownloadService.download(id, principal.getUser().getId());
    return ResponseEntity.ok()
        .contentType(MediaType.parseMediaType(dl.contentType()))
        .header(HttpHeaders.CACHE_CONTROL, "private, max-age=3600")
        .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"" + dl.filename() + "\"")
        .body(dl.data());
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
