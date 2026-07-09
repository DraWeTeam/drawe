package com.drawe.backend.global.config;

import com.drawe.backend.domain.auth.service.CustomOAuth2UserService;
import com.drawe.backend.global.security.JwtAccessDeniedHandler;
import com.drawe.backend.global.security.JwtAuthenticationEntryPoint;
import com.drawe.backend.global.security.JwtAuthenticationFilter;
import com.drawe.backend.global.security.OAuth2SuccessHandler;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.security.config.Customizer;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configurers.AbstractHttpConfigurer;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;
import org.springframework.security.web.context.RequestAttributeSecurityContextRepository;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.CorsConfigurationSource;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;

@RequiredArgsConstructor
@Configuration
public class SecurityConfig {

  private final CustomOAuth2UserService customOAuth2UserService;
  private final JwtAuthenticationEntryPoint jwtAuthenticationEntryPoint;
  private final JwtAccessDeniedHandler jwtAccessDeniedHandler;

  @Value("${app.cors.allowed-origins}")
  private List<String> allowedOrigins;

  @Bean
  public SecurityFilterChain filterChain(
      HttpSecurity http,
      OAuth2SuccessHandler oauth2SuccessHandler,
      JwtAuthenticationFilter jwtAuthenticationFilter)
      throws Exception {
    http.cors(Customizer.withDefaults())
        .csrf(AbstractHttpConfigurer::disable)
        .httpBasic(AbstractHttpConfigurer::disable)
        .formLogin(AbstractHttpConfigurer::disable)
        .sessionManagement(
            session -> session.sessionCreationPolicy((SessionCreationPolicy.IF_REQUIRED)))
        // 인증 성공 컨텍스트(principal)를 세션에 영속하지 않음 — 요청 범위로만 유지.
        // 이 앱은 로그인 후 JWT(stateless)로 인증하므로 세션에 SecurityContext 가 불필요하고,
        // Spring Session(Valkey) 직렬화 대상에서 PrincipalDetails(JPA User 보유)를 제외해 500 회피.
        // OAuth2 authorization request 는 별도 저장소(session 기반)라 cross-pod 공유는 그대로 유지됨.
        .securityContext(
            context ->
                context.securityContextRepository(new RequestAttributeSecurityContextRepository()))
        .exceptionHandling(
            ex ->
                ex.authenticationEntryPoint(jwtAuthenticationEntryPoint)
                    .accessDeniedHandler(jwtAccessDeniedHandler))
        .authorizeHttpRequests(
            auth ->
                auth.requestMatchers(HttpMethod.OPTIONS, "/**")
                    .permitAll()
                    .requestMatchers(
                        "/",
                        "/login/**",
                        "/oauth2/**",
                        "/swagger-ui/**",
                        "/swagger-ui.html",
                        "/v3/api-docs/**",
                        "/actuator/health",
                        "/actuator/health/**",
                        "/actuator/info",
                        "/actuator/prometheus")
                    .permitAll()
                    .requestMatchers(
                        HttpMethod.POST,
                        "/auth/signup",
                        "/auth/login",
                        "/auth/refresh",
                        "/auth/email/send-code",
                        "/auth/email/verify-code",
                        "/auth/password-reset/send-code",
                        "/auth/password-reset/verify-code",
                        "/auth/password-reset",
                        "/search/**")
                    .permitAll()
                    .requestMatchers(HttpMethod.GET, "/image/**", "/guide-asset/**")
                    .permitAll()
                    // /images/{id} GET 만 서명(exp/sig) 검증으로 공개 — 브라우저 <img> 는 Authorization
                    // 헤더를 못 싣기 때문. 컨트롤러가 ImageUrlSigner.verify 로 인가한다. 와일드카드 한 단계라
                    // /images/{id}/download(소유자 검증 필요)·POST /images/upload 는 포함되지 않는다.
                    .requestMatchers(HttpMethod.GET, "/images/*")
                    .permitAll()
                    .requestMatchers(
                        HttpMethod.GET, "/auth/google", "/auth/check-email", "/auth/check-nickname")
                    .permitAll()
                    .requestMatchers(HttpMethod.POST, "/auth/logout", "/auth/check-password")
                    .authenticated()
                    .anyRequest()
                    .authenticated())
        .oauth2Login(
            oauth2 ->
                oauth2
                    .userInfoEndpoint(userInfo -> userInfo.userService(customOAuth2UserService))
                    .successHandler(oauth2SuccessHandler))
        .addFilterBefore(jwtAuthenticationFilter, UsernamePasswordAuthenticationFilter.class);

    return http.build();
  }

  @Bean
  public CorsConfigurationSource corsConfigurationSource() {
    CorsConfiguration configuration = new CorsConfiguration();
    configuration.setAllowedOrigins(allowedOrigins);
    configuration.setAllowedMethods(List.of("GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"));
    configuration.setAllowedHeaders(List.of("*"));
    configuration.setExposedHeaders(List.of("Authorization", "Content-Disposition"));
    configuration.setAllowCredentials(true);

    UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
    source.registerCorsConfiguration("/**", configuration);
    return source;
  }
}
