package com.drawe.backend.domain.llm.service;

import com.drawe.backend.domain.User;
import com.drawe.backend.domain.image.service.DbImageStorage;
import com.drawe.backend.domain.image.service.ImageStorage;
import com.drawe.backend.global.error.CustomException;
import com.drawe.backend.global.error.ErrorCode;
import java.util.Base64;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

/**
 * 채팅 요청의 imageUrl 필드 처리.
 *
 * <p>지원 형식:
 *
 * <ul>
 *   <li>{@code data:image/...;base64,...} — 디코딩 후 ImageStorage 에 저장 → /images/{id} 로 변환
 *   <li>{@code /images/{id}} — DB 에서 직접 로드 (소유자 검증 포함)
 * </ul>
 *
 * <p>S3/Cloudinary 도입 시 http(s):// URL 분기 추가 예정.
 */
@Component
@RequiredArgsConstructor
public class ImageInputResolver {

  private static final Pattern DATA_URL =
      Pattern.compile("^data:(?<mime>[^;]+);base64,(?<data>.+)$", Pattern.DOTALL);
  private static final Pattern INTERNAL_URL = Pattern.compile("^/images/(?<id>\\d+)$");

  // /images/{id} load + data: 저장 모두 MySQL 전제(javadoc) — s3 @Primary(load=throw) 회피.
  private final DbImageStorage imageStorage;

  public Resolved resolve(User owner, String imageUrl) {
    if (imageUrl == null || imageUrl.isBlank()) {
      return Resolved.empty();
    }

    Matcher internal = INTERNAL_URL.matcher(imageUrl);
    if (internal.matches()) {
      Long id = Long.parseLong(internal.group("id"));
      ImageStorage.Loaded loaded = imageStorage.load(id);
      if (!loaded.ownerId().equals(owner.getId())) {
        throw new CustomException(ErrorCode.FORBIDDEN);
      }
      return new Resolved(loaded.data(), loaded.mimeType(), imageUrl);
    }

    Matcher data = DATA_URL.matcher(imageUrl);
    if (data.matches()) {
      try {
        byte[] bytes = Base64.getDecoder().decode(data.group("data"));
        String mime = data.group("mime");
        ImageStorage.Stored stored = imageStorage.store(owner, bytes, mime);
        return new Resolved(bytes, mime, stored.url());
      } catch (IllegalArgumentException e) {
        throw new CustomException(ErrorCode.INVALID_INPUT);
      }
    }

    throw new CustomException(ErrorCode.INVALID_INPUT);
  }

  /**
   * 채팅 입력 이미지의 디코딩 결과.
   *
   * @param storedUrl 이 이미지를 가리키는 internal URL ({@code /images/{id}}). 이미지 없으면 null.
   */
  public record Resolved(byte[] bytes, String mimeType, String storedUrl) {
    public static Resolved empty() {
      return new Resolved(new byte[0], null, null);
    }

    public boolean hasImage() {
      return bytes != null && bytes.length > 0;
    }
  }
}
