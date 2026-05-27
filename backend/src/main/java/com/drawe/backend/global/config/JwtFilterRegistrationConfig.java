package com.drawe.backend.global.config;

import com.drawe.backend.global.security.JwtAuthenticationFilter;
import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * {@link JwtAuthenticationFilter} 의 서블릿 레벨 자동 등록을 끈다.
 *
 * <p><b>왜</b>: 이 필터는 {@code @Component} + {@code OncePerRequestFilter} 라, Spring Boot 가 서블릿 컨테이너에
 * 전체 경로(/**) 대상으로 자동 등록한다. 그런데 이 필터는 {@link SecurityConfig} 의 메인 체인에 {@code addFilterBefore}
 * 로 이미 정상 배치되어 있으므로, 서블릿 레벨 등록은 <b>중복</b>이며 {@code /admin/**} 같은 다른 체인 경로에까지 새어든다.
 * 지금은 Authorization 헤더만 읽어 브라우저 네비게이션엔 무해하지만, 향후 헤더가 어드민 경로로 들어오면 의도치 않은 인증이 섞일 수 있다.
 *
 * <p>{@code setEnabled(false)} 는 서블릿 컨테이너 등록만 끈다 — 시큐리티 체인(FilterChainProxy) 내부의 필터 동작은
 * 그대로 유지되므로 기존 API 인증에는 영향이 없다.
 */
@Configuration
public class JwtFilterRegistrationConfig {

  @Bean
  public FilterRegistrationBean<JwtAuthenticationFilter> jwtFilterServletRegistration(
      JwtAuthenticationFilter filter) {
    FilterRegistrationBean<JwtAuthenticationFilter> registration =
        new FilterRegistrationBean<>(filter);
    registration.setEnabled(false);
    return registration;
  }
}
