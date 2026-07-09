package com.drawe.backend.domain.auth.service;

import com.drawe.backend.domain.User;
import com.drawe.backend.domain.auth.repository.UserRepository;
import com.drawe.backend.global.error.CustomException;
import com.drawe.backend.global.error.ErrorCode;
import java.security.SecureRandom;
import java.time.Duration;
import lombok.RequiredArgsConstructor;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.thymeleaf.TemplateEngine;
import org.thymeleaf.context.Context;

/**
 * 비밀번호 재설정 — 6자리 이메일 인증코드(Redis) 후 새 비밀번호 설정.
 *
 * <p>회원가입용 {@link EmailVerificationService} 와 반대로 '이미 가입된 로컬 계정'만 대상이다. 소셜 계정(password==null)은
 * 비밀번호가 없어 재설정 불가. Redis 키는 회원가입 인증과 충돌하지 않도록 {@code pwreset:} 네임스페이스를 쓴다.
 */
@Service
@RequiredArgsConstructor
public class PasswordResetService {

  private final StringRedisTemplate redis;
  private final UserRepository userRepository;
  private final TemplateEngine templateEngine;
  private final MailService mailService;
  private final PasswordEncoder passwordEncoder;
  private final RefreshTokenService refreshTokenService;

  private static final SecureRandom RANDOM = new SecureRandom();
  private static final Duration CODE_TTL = Duration.ofMinutes(5);
  private static final Duration COOLDOWN_TTL = Duration.ofSeconds(60);
  private static final Duration VERIFIED_TTL = Duration.ofMinutes(30);
  private static final int MAX_ATTEMPTS = 5;

  private String normalize(String email) {
    return email == null ? null : email.trim().toLowerCase();
  }

  private String codeKey(String email) {
    return "pwreset:code:" + email;
  }

  private String cooldownKey(String email) {
    return "pwreset:cooldown:" + email;
  }

  private String attemptsKey(String email) {
    return "pwreset:attempts:" + email;
  }

  private String verifiedKey(String email) {
    return "pwreset:verified:" + email;
  }

  /** 재설정 인증코드 발송. 미가입 → USER_NOT_FOUND, 소셜 계정(password==null) → OAUTH_PASSWORD_UNSUPPORTED. */
  public void sendResetCode(String email) {
    email = normalize(email);
    User user =
        userRepository
            .findByEmail(email)
            .orElseThrow(() -> new CustomException(ErrorCode.USER_NOT_FOUND));
    if (user.getPassword() == null) {
      throw new CustomException(ErrorCode.OAUTH_PASSWORD_UNSUPPORTED);
    }
    if (redis.hasKey(cooldownKey(email))) {
      throw new CustomException(ErrorCode.EMAIL_SEND_COOLDOWN);
    }

    String code = String.format("%06d", RANDOM.nextInt(1_000_000));
    Context context = new Context();
    context.setVariable("code", code);
    String htmlBody = templateEngine.process("email/verification-code", context);

    // 발송 성공 후에만 코드/쿨다운 저장(실패 시 쿨다운으로 막히는 문제 방지 — 회원가입 인증과 동일 원칙).
    mailService.sendHtml("[Drawe] 비밀번호 재설정 인증번호", htmlBody, email);

    redis.opsForValue().set(codeKey(email), code, CODE_TTL);
    redis.delete(attemptsKey(email));
    redis.opsForValue().set(cooldownKey(email), "1", COOLDOWN_TTL);
  }

  /** 인증코드 검증 → 성공 시 verified 플래그(30분) 설정. */
  public void verifyResetCode(String email, String inputCode) {
    email = normalize(email);
    String savedCode = redis.opsForValue().get(codeKey(email));
    if (savedCode == null) {
      throw new CustomException(ErrorCode.VERIFICATION_CODE_EXPIRED);
    }
    if (!savedCode.equals(inputCode)) {
      Long attempts = redis.opsForValue().increment(attemptsKey(email));
      if (Long.valueOf(1).equals(attempts)) {
        redis.expire(attemptsKey(email), CODE_TTL);
      }
      if (attempts != null && attempts >= MAX_ATTEMPTS) {
        redis.delete(codeKey(email)); // 5회 오답 → 코드 폐기(재발급 필요)
      }
      throw new CustomException(ErrorCode.VERIFICATION_CODE_MISMATCH);
    }
    redis.delete(codeKey(email));
    redis.delete(attemptsKey(email));
    redis.opsForValue().set(verifiedKey(email), "true", VERIFIED_TTL);
  }

  /** 새 비밀번호 설정 — verified 플래그가 있어야 하며(인증 없이 직접 호출 차단), 소비 후 비번 교체. */
  @Transactional
  public void resetPassword(String email, String newPassword) {
    email = normalize(email);
    if (!redis.hasKey(verifiedKey(email))) {
      throw new CustomException(ErrorCode.EMAIL_NOT_VERIFIED);
    }
    User user =
        userRepository
            .findByEmail(email)
            .orElseThrow(() -> new CustomException(ErrorCode.USER_NOT_FOUND));
    if (user.getPassword() == null) {
      throw new CustomException(ErrorCode.OAUTH_PASSWORD_UNSUPPORTED);
    }
    user.changePassword(passwordEncoder.encode(newPassword));
    // 비밀번호 변경 시 기존 세션 전부 무효화 — 탈취된 refresh token 차단(재로그인 필요).
    refreshTokenService.deleteAllByUserId(user.getId());
    redis.delete(verifiedKey(email));
  }
}
