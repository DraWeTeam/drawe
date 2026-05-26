package com.drawe.backend.global.config;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.annotation.Order;
import org.springframework.security.config.Customizer;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.provisioning.InMemoryUserDetailsManager;
import org.springframework.security.web.SecurityFilterChain;

/**
 * 어드민 대시보드 전용 보안 설정. {@code /admin/**} 만 담당하며, 기존 {@link SecurityConfig}(JWT 무상태 API 체인)는 손대지 않는다.
 *
 * <p><b>왜 별도 체인인가</b>: 본 서비스는 stateless JWT + OAuth2 라 formLogin·csrf 가 꺼져 있다. 어드민은 브라우저에서 사람이 쓰는
 * 내부 도구라 form login + 세션 + csrf 가 자연스럽다. 두 성격을 한 체인에 섞지 않으려고 {@code @Order(1)} 로 먼저 매칭되는 어드민 전용 체인을
 * 둔다. {@code /admin/**} 외 요청은 전부 기존 체인으로 흘러간다.
 *
 * <p><b>왜 user 테이블에 role 안 붙이나</b>: 베타 운영자 1명이면 충분. DB 스키마(=Flyway 마이그레이션) 건드리지 않고 설정값(env) 으로만 어드민
 * 계정을 만든다. 운영자가 늘면 그때 UserRole 도입을 Phase 후순위로.
 */
@Configuration
public class AdminSecurityConfig {

  @Bean
  @Order(1)
  public SecurityFilterChain adminSecurityFilterChain(HttpSecurity http) throws Exception {
    http.securityMatcher("/admin/**")
        .authorizeHttpRequests(
            auth -> auth.requestMatchers("/admin/login").permitAll().anyRequest().hasRole("ADMIN"))
        .formLogin(
            form ->
                form.loginPage("/admin/login")
                    .loginProcessingUrl("/admin/login")
                    .defaultSuccessUrl("/admin/overview", true)
                    .failureUrl("/admin/login?error")
                    .permitAll())
        .logout(logout -> logout.logoutUrl("/admin/logout").logoutSuccessUrl("/admin/login?logout"))
        .sessionManagement(s -> s.sessionCreationPolicy(SessionCreationPolicy.IF_REQUIRED))
        // 어드민 폼은 csrf 켠 상태 유지 (Thymeleaf 폼에 토큰 자동 주입). 기존 API 체인은 그대로 csrf off.
        .csrf(Customizer.withDefaults());
    return http.build();
  }

  /**
   * 어드민 계정 (인메모리). 이 체인에만 쓰인다 — 기존 JWT 체인은 UserDetailsService 를 참조하지 않으므로 영향 없음.
   *
   * <p>{@code admin.password} 는 평문을 env 로 주입받아 기동 시 BCrypt 인코딩. (프로퍼티에 해시를 직접 박아도 됨)
   */
  @Bean
  public UserDetailsService adminUserDetailsService(
      PasswordEncoder passwordEncoder,
      @Value("${admin.username:admin}") String username,
      @Value("${admin.password}") String rawPassword) {
    UserDetails admin =
        org.springframework.security.core.userdetails.User.withUsername(username)
            .password(passwordEncoder.encode(rawPassword))
            .roles("ADMIN")
            .build();
    return new InMemoryUserDetailsManager(admin);
  }
}
