package com.drawe.backend.domain.auth.service;

import com.drawe.backend.domain.auth.repository.UserRepository;
import com.drawe.backend.global.error.CustomException;
import com.drawe.backend.global.error.ErrorCode;
import java.security.SecureRandom;
import java.time.Duration;
import lombok.RequiredArgsConstructor;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;
import org.thymeleaf.TemplateEngine;
import org.thymeleaf.context.Context;

@Service
@RequiredArgsConstructor
public class EmailVerificationService {

  private final StringRedisTemplate redis;
  private final UserRepository userRepository;
  private final TemplateEngine templateEngine;

  private static final SecureRandom RANDOM = new SecureRandom();
  // --- Redis TTL
  private static final Duration CODE_TTL = Duration.ofMinutes(5);
  private static final Duration COOLDOWN_TTL = Duration.ofSeconds(60);
  private static final Duration VERIFIED_TTL = Duration.ofMinutes(30);
  private static final int MAX_ATTEMPTS = 5;
  private final MailService mailService;

  // 이메일 대소문자/공백 정규화 — 키 불일치(예: Foo@x.com vs foo@x.com)로 인증이 깨지는 것 방지
  private String normalize(String email) {
    return email == null ? null : email.trim().toLowerCase();
  }

  // --- Redis Key
  private String codeKey(String email) {
    return "email:verify:code:" + email;
  }

  private String cooldownKey(String email) {
    return "email:verify:cooldown:" + email;
  }

  private String attemptsKey(String email) {
    return "email:verify:attempts:" + email;
  }

  private String verifiedKey(String email) {
    return "email:verify:verified:" + email;
  }

  // --- Redis Value
  public void sendCode(String email) {
    email = normalize(email);

    // 이미 가입된 이메일이면 코드 발송 차단
    if (userRepository.existsByEmail(email)) {
      throw new CustomException(ErrorCode.EMAIL_ALREADY_EXISTS);
    }

    // 60초 쿨다운(키가 있으면 아직 재발송 불가)
    if (redis.hasKey(cooldownKey(email))) {
      throw new CustomException(ErrorCode.EMAIL_SEND_COOLDOWN);
    }

    String code = String.format("%06d", RANDOM.nextInt(1_000_000));

    // Thymeleaf 템플릿(templates/email/verification-code.html)에 코드를 넣어 HTML 본문 렌더
    Context context = new Context();
    context.setVariable("code", code);
    String htmlBody = templateEngine.process("email/verification-code", context);

    // 메일을 먼저 보내고, 성공한 뒤에 코드/쿨다운을 저장한다.
    // (발송이 실패하면 쿨다운이 걸려 사용자가 메일도 못 받고 60초간 막히는 문제 방지)
    mailService.sendHtml("[Drawe] 이메일 인증번호", htmlBody, email);

    redis.opsForValue().set(codeKey(email), code, CODE_TTL);
    redis.delete(attemptsKey(email)); // 이전 시도 횟수 초기화
    redis.opsForValue().set(cooldownKey(email), "1", COOLDOWN_TTL); // 쿨다운 키 넣음 -> 60s 동안 재발송 불가.
  }

  public void verifyCode(String email, String inputCode) {
    email = normalize(email);
    String savedCode = redis.opsForValue().get(codeKey(email));
    // 코드 만료 체크
    if (savedCode == null) {
      throw new CustomException(ErrorCode.VERIFICATION_CODE_EXPIRED);
    }

    if (!savedCode.equals(inputCode)) {
      // 인증번호 시도 횟수
      Long attempts = redis.opsForValue().increment(attemptsKey(email)); // 없으면 1부터
      if (Long.valueOf(1).equals(attempts)) {
        redis.expire(attemptsKey(email), CODE_TTL); // 인증 횟수 시도에도 TTL 걸기
      }
      if (attempts != null && attempts >= MAX_ATTEMPTS) {
        redis.delete(codeKey(email)); // 5회 틀리면 코드 폐기 -> 재발급 필요
      }
      throw new CustomException(ErrorCode.VERIFICATION_CODE_MISMATCH);
    }

    // 성공: 코드/시도 삭제 후 verified 플래그 30분
    redis.delete(codeKey(email));
    redis.delete(attemptsKey(email));
    redis.opsForValue().set(verifiedKey(email), "true", VERIFIED_TTL);
  }

  // 가입 시 호출 - 인증 안 됐으면 예외, 됐으면 플래그 삭제
  public void assertVerifiedAndConsume(String email) {
    email = normalize(email);
    if (!redis.hasKey(verifiedKey(email))) {
      throw new CustomException(ErrorCode.EMAIL_NOT_VERIFIED);
    }
    redis.delete(verifiedKey(email));
  }
}
