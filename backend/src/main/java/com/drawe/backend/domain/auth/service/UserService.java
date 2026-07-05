package com.drawe.backend.domain.auth.service;

import com.drawe.backend.domain.User;
import com.drawe.backend.domain.auth.dto.ChangePasswordRequest;
import com.drawe.backend.domain.auth.dto.MyProfileResponse;
import com.drawe.backend.domain.auth.dto.UpdateNicknameRequest;
import com.drawe.backend.domain.auth.repository.UserRepository;
import com.drawe.backend.global.error.CustomException;
import com.drawe.backend.global.error.ErrorCode;
import lombok.RequiredArgsConstructor;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** 내 계정 — 프로필 조회/수정, 비밀번호 변경, 회원탈퇴(soft delete). */
@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class UserService {

  private final UserRepository userRepository;
  private final RefreshTokenService refreshTokenService;
  private final PasswordEncoder passwordEncoder;

  public MyProfileResponse getProfile(Long userId) {
    User user = findActiveUser(userId);
    return new MyProfileResponse(
        user.getId(),
        user.getEmail(),
        user.getNickname(),
        user.getPicture(),
        user.getTermsAgreeAt() != null,
        user.getPlan().getCode(),
        user.getPassword() == null);
  }

  @Transactional
  public MyProfileResponse updateNickname(Long userId, UpdateNicknameRequest request) {
    User user = findActiveUser(userId);
    String nickname = request.getNickname();

    // 본인 닉네임과 같으면 통과(중복검사 스킵), 다르면 중복 검증.
    if (!nickname.equals(user.getNickname()) && userRepository.existsByNickname(nickname)) {
      throw new CustomException(ErrorCode.NICKNAME_ALREADY_EXISTS);
    }
    user.updateNickname(nickname); // 변경 감지로 반영
    return new MyProfileResponse(
        user.getId(),
        user.getEmail(),
        user.getNickname(),
        user.getPicture(),
        user.getTermsAgreeAt() != null,
        user.getPlan().getCode(),
        user.getPassword() == null);
  }

  @Transactional
  public void changePassword(Long userId, ChangePasswordRequest request) {
    User user = findActiveUser(userId);

    // 소셜 로그인 계정(password == null)은 비밀번호가 없어 변경 불가.
    if (user.getPassword() == null) {
      throw new CustomException(ErrorCode.OAUTH_PASSWORD_UNSUPPORTED);
    }
    if (!passwordEncoder.matches(request.getCurrentPassword(), user.getPassword())) {
      throw new CustomException(ErrorCode.PASSWORD_MISMATCH);
    }
    user.changePassword(passwordEncoder.encode(request.getNewPassword())); // 변경 감지
  }

  @Transactional
  public void withdraw(Long userId) {
    User user = findActiveUser(userId);
    user.withdraw(); // soft delete — deletedAt 세팅
    refreshTokenService.deleteAllByUserId(userId); // 모든 세션 무효화
  }

  /** 활성 유저 조회 — 없거나 이미 탈퇴 상태면 예외. */
  private User findActiveUser(Long userId) {
    User user =
        userRepository
            .findById(userId)
            .orElseThrow(() -> new CustomException(ErrorCode.USER_NOT_FOUND));
    if (user.isWithdrawn()) {
      throw new CustomException(ErrorCode.ACCOUNT_WITHDRAWN);
    }
    return user;
  }
}
