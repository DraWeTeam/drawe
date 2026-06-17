package com.drawe.backend.global.config;

import com.querydsl.jpa.impl.JPAQueryFactory;
import jakarta.persistence.EntityManager;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * QueryDSL 동적 쿼리용 JPAQueryFactory 빈 등록. Repository 구현체(@RequiredArgsConstructor)에서 JPAQueryFactory 를 주입받아
 * QProject 등 Q클래스로 타입세이프 쿼리를 작성한다.
 */
@Configuration
public class QuerydslConfig {

  @Bean
  public JPAQueryFactory jpaQueryFactory(EntityManager em) {
    return new JPAQueryFactory(em);
  }
}
