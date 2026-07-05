package com.drawe.backend.domain.image.service;

import com.drawe.backend.domain.Image;
import com.drawe.backend.domain.image.repository.ImageRepository;
import com.drawe.backend.global.error.CustomException;
import com.drawe.backend.global.error.ErrorCode;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestClient;

/**
 * 레퍼런스/완성작 이미지 다운로드 — 출처(외부 URL vs 서버 저장 바이트)에 무관하게 파일 바이트를 돌려준다.
 *
 * <p>레퍼런스의 대부분은 Unsplash 등 <b>외부 URL</b>(예: {@code https://images.unsplash.com/...})이라 서버에 바이트가 없다.
 * 이 경우 서버가 그 URL 을 대신 받아(프록시) 돌려준다 — 브라우저가 외부 URL 을 직접 다운로드하면 CORS·{@code Content-Disposition} 부재로
 * "새 탭에 열림"만 되기 때문. AI 생성/업로드 이미지는 {@link ImageStorage}(MySQL/S3)에 바이트가 있으므로 그대로 읽는다.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class ImageDownloadService {

  private final ImageRepository imageRepository;
  private final ImageStorage imageStorage;
  private final RestClient restClient = RestClient.create();

  /** 다운로드 결과 — 파일 바이트 + 다운로드 파일명 + content-type. */
  public record Download(byte[] data, String filename, String contentType) {}

  /**
   * 이미지 id 로 다운로드 바이트를 해소한다.
   *
   * <p>외부 URL 이미지(공개 레퍼런스)는 소유자 검증을 하지 않는다(누구나 볼 수 있는 검색 결과). 서버 저장 바이트 이미지(AI 생성/업로드)는 {@link
   * ImageStorage#load}의 소유자 검증을 그대로 따른다.
   */
  public Download download(Long id, Long requesterId) {
    Image image =
        imageRepository.findById(id).orElseThrow(() -> new CustomException(ErrorCode.NOT_FOUND));
    String url = image.getUrl();

    // 외부 URL(http/https) → 서버가 프록시로 받아온다.
    if (url != null && (url.startsWith("http://") || url.startsWith("https://"))) {
      return downloadExternal(id, url);
    }

    // 그 외(서버 저장 바이트) → ImageStorage 의 소유자 검증 포함 로드.
    ImageStorage.Loaded loaded = imageStorage.load(id);
    if (!loaded.ownerId().equals(requesterId)) {
      throw new CustomException(ErrorCode.FORBIDDEN);
    }
    return new Download(
        loaded.data(), "image_" + id + extensionFor(loaded.mimeType()), loaded.mimeType());
  }

  private Download downloadExternal(Long id, String url) {
    try {
      var resp = restClient.get().uri(url).retrieve().toEntity(byte[].class);
      byte[] data = resp.getBody();
      if (data == null || data.length == 0) {
        throw new CustomException(ErrorCode.NOT_FOUND);
      }
      MediaType ct = resp.getHeaders().getContentType();
      String contentType = ct != null ? ct.toString() : "application/octet-stream";
      String filename = "image_" + id + extensionFor(contentType);
      return new Download(data, filename, contentType);
    } catch (CustomException e) {
      throw e;
    } catch (Exception e) {
      log.warn("외부 이미지 다운로드 실패: id={}, url={}, error={}", id, url, e.toString());
      throw new CustomException(ErrorCode.NOT_FOUND);
    }
  }

  /** content-type → 파일 확장자. 알 수 없으면 빈 문자열. */
  private static String extensionFor(String contentType) {
    if (contentType == null) {
      return "";
    }
    String ct = contentType.toLowerCase();
    if (ct.contains("jpeg") || ct.contains("jpg")) {
      return ".jpg";
    }
    if (ct.contains("png")) {
      return ".png";
    }
    if (ct.contains("webp")) {
      return ".webp";
    }
    if (ct.contains("gif")) {
      return ".gif";
    }
    return "";
  }
}
