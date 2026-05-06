package com.drawe.backend.domain.llm.service;

import com.drawe.backend.domain.ChatSession;
import com.drawe.backend.domain.LlmMessage;
import com.drawe.backend.domain.Project;
import com.drawe.backend.domain.User;
import com.drawe.backend.domain.enums.LlmCallStatus;
import com.drawe.backend.domain.enums.LlmProvider;
import com.drawe.backend.domain.enums.MessageRole;
import com.drawe.backend.domain.enums.UserPlan;
import com.drawe.backend.domain.llm.dto.ChatHistoryResponse;
import com.drawe.backend.domain.llm.dto.ChatRequest;
import com.drawe.backend.domain.llm.dto.ChatResponse;
import com.drawe.backend.domain.llm.dto.LlmCallContext;
import com.drawe.backend.domain.llm.dto.LlmCallResult;
import com.drawe.backend.domain.llm.repository.ChatSessionRepository;
import com.drawe.backend.domain.llm.repository.LlmMessageRepository;
import com.drawe.backend.domain.log.SearchLogService;
import com.drawe.backend.domain.project.repository.ProjectRepository;
import com.drawe.backend.domain.search.dto.ImageResult;
import com.drawe.backend.domain.search.dto.SearchRequest;
import com.drawe.backend.domain.search.dto.SearchResponse;
import com.drawe.backend.domain.search.service.SearchService;
import com.drawe.backend.global.config.LlmProperties;
import com.drawe.backend.global.error.CustomException;
import com.drawe.backend.global.error.ErrorCode;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.stream.Collectors;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Slf4j
@Service
@RequiredArgsConstructor
public class ChatLlmService {

  private final ChatSessionRepository chatSessionRepository;
  private final ProjectRepository projectRepository;
  private final LlmMessageRepository llmMessageRepository;
  private final PersonaRegistry personaRegistry;
  private final LlmProperties llmProperties;
  private final ImageInputResolver imageInputResolver;
  private final List<LlmService> llmServices;

  private final KeywordExtractor keywordExtractor;
  private final SearchService searchService;
  private final SearchLogService searchLogService;

  @Transactional
  public ChatResponse chat(User user, Long projectId, ChatRequest request) {
    Project project = loadProjectAuthorized(user, projectId);
    ChatSession session = resolveOrCreateSession(user, project, request.sessionId());
    ImageInputResolver.Resolved image = imageInputResolver.resolve(request.imageUrl());

    // history 먼저
    List<LlmMessage> all = llmMessageRepository.findByChatSessionOrderByCreatedAtAsc(session);
    List<LlmCallContext.Turn> history = trimHistory(all, llmProperties.getMaxHistory());

    // history를 reference에 전달
    List<ImageResult> references = retrieveReferences(user, project, request.message(), history);

    // 레퍼런스 검색 결과를 system 컨텍스트에 추가
    if (!references.isEmpty()) {
        String referenceContext = buildReferenceContext(references);
        history.add(new LlmCallContext.Turn(MessageRole.SYSTEM, referenceContext));
    }

    LlmProvider provider = resolveProvider(user);
    LlmService llm = pickService(provider);
    LlmCallContext ctx =
        new LlmCallContext(history, request.message(), image.bytes(), image.mimeType());

    // 사용자 메시지 저장 (LLM 호출 전: 실패해도 발화는 남김)
    LlmMessage userMsg = new LlmMessage();
    userMsg.setChatSession(session);
    userMsg.setRole(MessageRole.USER);
    userMsg.setContent(request.message());
    userMsg.setHasImage(image.hasImage());
    userMsg.setImageUrl(image.hasImage() ? "(base64-data)" : null);
    llmMessageRepository.save(userMsg);

    LlmMessage assistantMsg = new LlmMessage();
    assistantMsg.setChatSession(session);
    assistantMsg.setRole(MessageRole.ASSISTANT);
    assistantMsg.setProvider(provider);
    assistantMsg.setHasImage(false);

    try {
      LlmCallResult result = llm.generate(ctx);
      assistantMsg.setContent(result.content());
      assistantMsg.setModel(result.model());
      assistantMsg.setLatencyMs(result.latencyMs());
      assistantMsg.setStatus(LlmCallStatus.SUCCESS);

      List<ChatResponse.ReferenceItem> refItems = convertToReferenceItems(references);
      assistantMsg.setReferences(refItems);

      llmMessageRepository.save(assistantMsg);
      session.setLastActive(Instant.now());

      return new ChatResponse(
          session.getId(), "guide", result.content(), refItems, null);
    } catch (CustomException e) {
      persistFailure(assistantMsg, e);
      throw e;
    } catch (Exception e) {
      log.error("LLM call failed for session={} provider={}", session.getId(), provider, e);
      persistFailure(assistantMsg, e);
      throw new CustomException(ErrorCode.AI_SERVICE_ERROR);
    }
  }

  @Transactional(readOnly = true)
  public ChatHistoryResponse getHistory(User user, Long projectId, String sessionId) {
    loadProjectAuthorized(user, projectId);
    ChatSession session = loadSessionAuthorized(user, sessionId, projectId);
    List<ChatHistoryResponse.HistoryItem> items =
        llmMessageRepository.findByChatSessionOrderByCreatedAtAsc(session).stream()
            .filter(m -> m.getRole() != MessageRole.SYSTEM)
            .map(ChatHistoryResponse.HistoryItem::from)
            .toList();
    return new ChatHistoryResponse(session.getId(), items);
  }

  @Transactional
  public void resetSession(User user, Long projectId, String sessionId) {
    loadProjectAuthorized(user, projectId);
    ChatSession session = loadSessionAuthorized(user, sessionId, projectId);
    List<LlmMessage> messages = llmMessageRepository.findByChatSessionOrderByCreatedAtAsc(session);
    List<LlmMessage> nonSystem =
        messages.stream().filter(m -> m.getRole() != MessageRole.SYSTEM).toList();
    llmMessageRepository.deleteAll(nonSystem);
    session.setLastActive(Instant.now());
  }

  private Project loadProjectAuthorized(User user, Long projectId) {
    Project project =
        projectRepository
            .findById(projectId)
            .orElseThrow(() -> new CustomException(ErrorCode.NOT_FOUND));
    if (!project.getUser().getId().equals(user.getId())) {
      throw new CustomException(ErrorCode.FORBIDDEN);
    }
    return project;
  }

  private ChatSession loadSessionAuthorized(User user, String sessionId, Long projectId) {
    ChatSession session =
        chatSessionRepository
            .findById(sessionId)
            .orElseThrow(() -> new CustomException(ErrorCode.NOT_FOUND));
    if (!session.getUser().getId().equals(user.getId())
        || !session.getProject().getId().equals(projectId)) {
      throw new CustomException(ErrorCode.FORBIDDEN);
    }
    return session;
  }

  private ChatSession resolveOrCreateSession(User user, Project project, String sessionId) {
    if (sessionId == null || sessionId.isBlank()) {
      return createSessionWithPersona(user, project);
    }
    return loadSessionAuthorized(user, sessionId, project.getId());
  }

  private ChatSession createSessionWithPersona(User user, Project project) {
    ChatSession session = new ChatSession();
    session.setId(UUID.randomUUID().toString());
    session.setUser(user);
    session.setProject(project);
    session.setLastActive(Instant.now());
    chatSessionRepository.save(session);

    LlmMessage persona = new LlmMessage();
    persona.setChatSession(session);
    persona.setRole(MessageRole.SYSTEM);
    persona.setContent(personaRegistry.resolve(PersonaRegistry.DEFAULT_KEY));
    persona.setHasImage(false);
    llmMessageRepository.save(persona);

    String projectContext = buildProjectContext(project);
    if (projectContext != null) {
      LlmMessage context = new LlmMessage();
      context.setChatSession(session);
      context.setRole(MessageRole.SYSTEM);
      context.setContent(projectContext);
      context.setHasImage(false);
      llmMessageRepository.save(context);
    }
    return session;
  }

  private String buildProjectContext(Project project) {
    StringBuilder sb = new StringBuilder("[프로젝트 정보]\n");
    boolean any = false;
    if (notBlank(project.getName())) {
      sb.append("- 이름: ").append(project.getName()).append('\n');
      any = true;
    }
    if (notBlank(project.getSubject())) {
      sb.append("- 주제: ").append(project.getSubject()).append('\n');
      any = true;
    }
    if (notBlank(project.getTechnique())) {
      sb.append("- 스타일: ").append(project.getTechnique()).append('\n');
      any = true;
    }
    if (notBlank(project.getMood())) {
      sb.append("- 분위기: ").append(project.getMood()).append('\n');
      any = true;
    }
    if (notBlank(project.getDescription())) {
      sb.append("- 메모: ").append(project.getDescription()).append('\n');
      any = true;
    }
    return any ? sb.toString() : null;
  }

  private boolean notBlank(String s) {
    return s != null && !s.isBlank();
  }

  private LlmProvider resolveProvider(User user) {
    // 플랜 기반 라우팅: PAID → CLAUDE, FREE → GROK
    UserPlan plan = user.getPlan();
    if (plan == UserPlan.PAID) {
      return LlmProvider.CLAUDE;
    }
    return LlmProvider.GROK;
  }

  private LlmService pickService(LlmProvider provider) {
    return llmServices.stream()
        .filter(s -> s.provider() == provider)
        .findFirst()
        .orElseThrow(() -> new CustomException(ErrorCode.INVALID_INPUT));
  }

  private List<LlmCallContext.Turn> trimHistory(List<LlmMessage> all, int maxNonSystem) {
    List<LlmCallContext.Turn> systems = new ArrayList<>();
    List<LlmCallContext.Turn> rest = new ArrayList<>();
    for (LlmMessage m : all) {
      if (m.getStatus() == LlmCallStatus.FAILED) {
        continue;
      }
      LlmCallContext.Turn turn = new LlmCallContext.Turn(m.getRole(), m.getContent());
      if (m.getRole() == MessageRole.SYSTEM) {
        systems.add(turn);
      } else {
        rest.add(turn);
      }
    }
    int from = Math.max(0, rest.size() - maxNonSystem);
    List<LlmCallContext.Turn> trimmed = new ArrayList<>(systems);
    trimmed.addAll(rest.subList(from, rest.size()));
    return trimmed;
  }

  private void persistFailure(LlmMessage assistantMsg, Exception e) {
    assistantMsg.setContent("");
    assistantMsg.setStatus(LlmCallStatus.FAILED);
    assistantMsg.setErrorMessage(safeError(e));
    llmMessageRepository.save(assistantMsg);
  }

  private String safeError(Exception e) {
    String msg = e.getMessage();
    if (msg == null) {
      return e.getClass().getSimpleName();
    }
    return msg.length() > 1000 ? msg.substring(0, 1000) : msg;
  }

    /**
     * 사용자 메시지에서 키워드를 추출하고 이미지 검색 수행
     * 검색이 불필요하거나 실패하면 빈 리스트 반환 (가이드 응답에 영향 없음).
     */
    private List<ImageResult> retrieveReferences(User user, Project project, String userMessage, List<LlmCallContext.Turn> recentHistory) {
        String keywords = keywordExtractor.extract(userMessage, recentHistory);
        if (keywords.isEmpty()) {
            return List.of();
        }

        try {
            SearchResponse searchResult = searchService.search(
                    new SearchRequest(keywords, 6)
            );
            log.info("RAG 검색: keywords='{}', 결과={}개",
                    keywords, searchResult.results().size());

            // 로그 저장 (비동기)
            searchLogService.log(
                    user, project, userMessage, keywords,
                    searchResult.results(), "rag_chat"
            );

            // 평균 점수 계산
            double avgScore = searchResult.results().stream()
                    .mapToDouble(r -> r.score().doubleValue())
                    .average()
                    .orElse(0.0);

            // 점수 너무 낮으면 무관한 결과로 판단
            if (avgScore < 0.18) {
                log.info("검색 결과 점수 낮음 (avgScore={}), 무관한 결과로 판단", avgScore);
                return List.of();  // 빈 배열 → 프론트에서 이전 references 유지
            }

            return searchResult.results();
        } catch (Exception e) {
            log.warn("RAG 검색 실패, references 없이 응답: error={}", e.getMessage());
            return List.of();
        }
    }

    /**
     * 검색 결과를 LLM에게 줄 system 메시지로 포맷팅
     * LLM이 응답에서 [1], [2] 형식으로 인용하도록 지시
     */
    private String buildReferenceContext(List<ImageResult> references) {
        StringBuilder sb = new StringBuilder();
        sb.append("[참고 이미지]\n");
        sb.append("아래는 사용자 질문과 관련하여 검색된 참고 이미지들입니다. ")
                .append("응답할 때 자연스럽게 이 이미지들을 [1], [2] 같은 형식으로 인용해주세요.\n\n");

        for (int i = 0; i < references.size(); i++) {
            ImageResult ref = references.get(i);
            sb.append("[").append(i + 1).append("] ");
            sb.append("유사도: ").append(String.format("%.2f", ref.score()));

            // 카테고리 한 줄로
            if (ref.technique() != null || ref.subject() != null || ref.mood() != null) {
                sb.append(" (");
                if (ref.technique() != null) sb.append(ref.technique());
                if (ref.subject() != null) sb.append("/").append(ref.subject());
                if (ref.mood() != null) sb.append("/").append(ref.mood());
                sb.append(")");
            }
            sb.append("\n");

            // utility (구체적 용도)
            if (ref.utility() != null && !ref.utility().isEmpty()) {
                sb.append("    용도: ").append(String.join(", ", ref.utility())).append("\n");
            }

            // rawTags — 핵심 정보 (10개 제한)
            if (ref.rawTags() != null && !ref.rawTags().isEmpty()) {
                String topTags = ref.rawTags().stream()
                        .limit(10)
                        .collect(Collectors.joining(", "));
                sb.append("    태그: ").append(topTags).append("\n");
            }
        }

        sb.append("\n응답 가이드:\n");
        sb.append("- 위 참고 이미지를 자연스럽게 언급하며 답변하세요.\n");
        sb.append("- 예: \"[1]번 이미지처럼 부드러운 색감을 표현하려면...\"\n");
        sb.append("- 모든 이미지를 다 언급할 필요는 없습니다. 관련 있는 것만 인용하세요.\n");
        sb.append("- 태그 정보를 활용해 구체적인 조언을 해주세요.\n");

        return sb.toString();
    }

    /**
     * SearchService의 ImageResult를 ChatResponse의 ReferenceItem으로 변환합니다.
     */
    private List<ChatResponse.ReferenceItem> convertToReferenceItems(List<ImageResult> results) {
        return results.stream()
                .map(r -> new ChatResponse.ReferenceItem(
                        r.id(),
                        r.url(),
                        r.photographerName(),
                        r.photographerUsername(),
                        r.technique(),
                        r.subject(),
                        r.mood(),
                        r.score().doubleValue()
                ))
                .toList();
    }

}
