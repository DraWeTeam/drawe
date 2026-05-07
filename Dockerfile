# Stage 1: Build
FROM gradle:jdk17 AS builder
WORKDIR /app

COPY gradlew .
COPY gradle ./gradle
COPY build.gradle settings.gradle ./
RUN chmod +x ./gradlew

RUN ./gradlew dependencies -x test --no-daemon

COPY src ./src
RUN ./gradlew bootJar -x test --no-daemon

# ─────────────────────────────────────────────────────────────
# Stage 2: Runtime — JRE Ubuntu (eclipse-temurin) + OTel Agent + 비루트 사용자
# ─────────────────────────────────────────────────────────────
FROM eclipse-temurin:17-jre

# OTel Java Agent 다운로드 (auto-instrumentation)
# 빌드 시점에 받아 이미지에 포함 — 부팅 시 외부 의존성 0
RUN apt-get update && \
    apt-get install -y curl && \
    curl -L https://github.com/open-telemetry/opentelemetry-java-instrumentation/releases/latest/download/opentelemetry-javaagent.jar \
         -o /opt/otel-javaagent.jar && \
    apt-get remove -y curl && \
    apt-get autoremove -y && \
    rm -rf /var/lib/apt/lists/*

# 비루트 사용자 (1000:1000) 로 실행 — security best practice
RUN groupadd -g 1000 drawe && \
    useradd -u 1000 -g drawe -m drawe

WORKDIR /app
COPY --from=builder /app/build/libs/*-SNAPSHOT.jar app.jar
EXPOSE 8080
ENTRYPOINT ["java","-jar","app.jar"]