package com.drawe.backend.domain.reference.session;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.Duration;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;

/**
 * 레퍼런스 보드 세션({@link ReferenceBoardSession}) Redis 저장소. 챗 세션({@code RedisSessionService})과 분리된 별도
 * 키스페이스({@code refboard:}). 순수 세션성 상태라 MySQL 폴백 없이 best-effort — Redis 장애 시 새 세션으로 진행한다.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class ReferenceBoardSessionService {

  private static final Duration TTL = Duration.ofHours(6);
  private static final String KEY_PREFIX = "refboard:";

  private final StringRedisTemplate redisTemplate;
  private final ObjectMapper objectMapper;

  public ReferenceBoardSession get(Long userId, Long projectId) {
    String key = key(userId, projectId);
    try {
      String json = redisTemplate.opsForValue().get(key);
      if (json != null) {
        redisTemplate.expire(key, TTL); // 활동 = TTL 갱신
        return objectMapper.readValue(json, ReferenceBoardSession.class);
      }
    } catch (Exception e) {
      log.warn(
          "refboard session read failed — key={}, error_class={}",
          key,
          e.getClass().getSimpleName());
    }
    return ReferenceBoardSession.start(userId, projectId);
  }

  public void save(ReferenceBoardSession session) {
    if (session == null) {
      return;
    }
    String key = key(session.getUserId(), session.getProjectId());
    try {
      redisTemplate.opsForValue().set(key, objectMapper.writeValueAsString(session), TTL);
    } catch (Exception e) {
      log.warn(
          "refboard session save failed — key={}, error_class={}",
          key,
          e.getClass().getSimpleName());
    }
  }

  public void clear(Long userId, Long projectId) {
    try {
      redisTemplate.delete(key(userId, projectId));
    } catch (Exception e) {
      log.warn("refboard session clear failed — error_class={}", e.getClass().getSimpleName());
    }
  }

  private static String key(Long userId, Long projectId) {
    return KEY_PREFIX + userId + ":" + projectId;
  }
}
