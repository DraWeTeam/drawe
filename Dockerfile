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
# Stage 2: Runtime — Temurin JRE + OTel Agent + 비루트 사용자
# (base: Ubuntu 24.04 noble — default ubuntu 사용자 사전 제거 필요)
# ─────────────────────────────────────────────────────────────
FROM eclipse-temurin:17-jre

# OTel Java Agent — 빌드 시점에 받아 이미지에 포함
ADD https://github.com/open-telemetry/opentelemetry-java-instrumentation/releases/latest/download/opentelemetry-javaagent.jar \
    /opt/otel-javaagent.jar
RUN chmod 644 /opt/otel-javaagent.jar

# 비루트 사용자 (1000:1000) 로 실행 — security best practice
# Ubuntu 24.04 base 에는 default ubuntu 사용자(UID 1000)가 이미 존재 → 제거 후 재생성
RUN userdel -r ubuntu 2>/dev/null; \
    groupadd -g 1000 drawe && \
    useradd -u 1000 -g drawe -m drawe

WORKDIR /app
COPY --from=builder /app/build/libs/*-SNAPSHOT.jar app.jar
EXPOSE 8080

# JAVA_TOOL_OPTIONS 으로 OTel Agent attach (전체 trace 자동 instrumentation)
# JVM heap 은 컨테이너 메모리의 75% 까지 사용 (XX:MaxRAMPercentage)
ENV JAVA_TOOL_OPTIONS="-javaagent:/opt/otel-javaagent.jar -XX:MaxRAMPercentage=75 -XX:+UseG1GC"

ENTRYPOINT ["java", "-jar", "/app/app.jar"]
