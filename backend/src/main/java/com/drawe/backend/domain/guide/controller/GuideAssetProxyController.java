package com.drawe.backend.domain.guide.controller;

import com.drawe.backend.global.client.GuideClient;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RestController;

/**
 * 가이드 자산(레퍼런스 이미지·도식) 공개 프록시.
 *
 * <p>guide ECS 서비스는 내부(Service Connect: fastapi-guide.drawe-{env}.local:8000)라 브라우저가 직접 못 연다. 브라우저는
 * 공개 백엔드(api-dev/api)의 이 경로로 {@code <img src>} 요청을 보내고, 백엔드가 내부 guide 의 {@code /image}·{@code
 * /guide-asset} 로 포워딩한다. guide 가 S3 presigned 로 302 하면 그 리다이렉트를 그대로 흘려보내(브라우저 → S3 직접 열람), 인라인
 * SVG(도식)면 본문을 그대로 전달한다.
 *
 * <p>인증 불필요: 이미지 태그는 토큰을 못 싣고, ref_id 형식 검증·경로탈출 차단은 guide 서비스가 수행한다. 프론트의 {@code reference.url}(=
 * FASTAPI_GUIDE_PUBLIC_URL/image/...)·{@code VITE_GUIDE_PUBLIC_URL} 둘 다 이 백엔드 호스트를 가리키도록 설정해야 도달한다.
 */
@RestController
@RequiredArgsConstructor
public class GuideAssetProxyController {

  private final GuideClient guideClient;

  /** 레퍼런스 이미지(ref_id=UUID) → 내부 guide {@code /image} 로 프록시(presigned 302 흘려보냄). */
  @GetMapping("/image/{refId}")
  public ResponseEntity<byte[]> image(@PathVariable String refId) {
    return guideClient.fetchAsset("/image/" + refId);
  }

  /**
   * 도식/자산 슬롯 → 내부 guide {@code /guide-asset} 로 프록시. ref_id 가 {@code floor:<축>}· {@code
   * reference/<name>.svg} 처럼 슬래시/콜론을 포함할 수 있어 와일드카드로 받는다 ({@code {*refId}} 는 선행 슬래시를 포함한다).
   */
  @GetMapping("/guide-asset/{*refId}")
  public ResponseEntity<byte[]> guideAsset(@PathVariable String refId) {
    return guideClient.fetchAsset("/guide-asset" + refId);
  }
}
