package com.drawe.backend.domain;

import com.drawe.backend.domain.enums.UserPlan;
import jakarta.persistence.*;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.time.Instant;
import lombok.*;
import org.hibernate.annotations.CreationTimestamp;

@Getter
@Setter
@Entity
@NoArgsConstructor(access = AccessLevel.PROTECTED)
@AllArgsConstructor
@Builder
@Table(
    name = "users",
    indexes = {@Index(name = "idx_user_prov_pid", columnList = "provider, provider_id")})
public class User {
  @Id
  @GeneratedValue(strategy = GenerationType.IDENTITY)
  @Column(name = "id", nullable = false)
  private Long id;

  @Size(max = 255)
  @NotNull
  @Column(name = "email", nullable = false, unique = true)
  private String email;

  // OAuth 유저는 null
  @Size(max = 255)
  @Column(name = "password")
  private String password;

  @Size(max = 100)
  @NotNull
  @Column(name = "nickname", nullable = false, length = 100)
  private String nickname;

  @Column(length = 500)
  private String picture;

  // null(일반) / google
  @Size(max = 20)
  @Column(name = "provider", length = 20)
  private String provider;

  @Size(max = 100)
  @Column(name = "provider_id", length = 100)
  private String providerId;

  @NotNull
  @Enumerated(EnumType.STRING)
  @Column(name = "plan", nullable = false, length = 20)
  @Builder.Default
  private UserPlan plan = UserPlan.FREE;

  @CreationTimestamp
  @Column(name = "created_at", updatable = false)
  private Instant createdAt;

  @Column(name = "terms_agreed_at")
  private Instant termsAgreeAt; // 약관 동의 시각

  // 회원탈퇴 시각. null = 활성. soft delete — 탈퇴해도 자식 데이터(프로젝트/이미지 등)는 보존하고
  // 로그인/조회에서만 제외한다. 추후 hard delete 배치로 실제 삭제 가능.
  @Column(name = "deleted_at")
  private Instant deletedAt;

  public void updateProfile(String nickname, String picture) {
    this.nickname = nickname;
    this.picture = picture;
  }

  /** 닉네임만 변경(프로필 사진은 유지). */
  public void updateNickname(String nickname) {
    this.nickname = nickname;
  }

  /** 비밀번호 변경(이미 인코딩된 값을 받는다). */
  public void changePassword(String encodedPassword) {
    this.password = encodedPassword;
  }

  /** 회원탈퇴(soft delete) — 탈퇴 시각을 찍는다. 이미 탈퇴 상태면 호출 측에서 막는다. */
  public void withdraw() {
    this.deletedAt = Instant.now();
  }

  public boolean isWithdrawn() {
    return this.deletedAt != null;
  }

  public void updateOAuthInfo(String provider, String providerId) {
    this.provider = provider;
    this.providerId = providerId;
  }

  public void agreeTerms() {
    if (this.termsAgreeAt == null) { // 이미 동의했으면 최초 동의 시각 유지
      this.termsAgreeAt = Instant.now();
    }
  }
}
