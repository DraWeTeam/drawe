package com.drawe.backend.domain.llm.service;

import com.drawe.backend.domain.enums.LlmProvider;
import com.drawe.backend.domain.enums.MessageRole;
import com.drawe.backend.domain.llm.dto.LlmCallContext;
import com.drawe.backend.domain.llm.dto.LlmCallResult;
import java.util.ArrayList;
import java.util.List;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

@Slf4j
@Component
@RequiredArgsConstructor
public class KeywordExtractor {

    private static final String SYSTEM_PROMPT =
            """
            You are a keyword extractor for an image search system that uses CLIP embeddings.
            
            Your task: Read the user's message (in any language) considering the conversation context, \
            and extract 3-6 English keywords that would best match the user's intent for finding visual reference images.
            
            Rules:
            1. Output ONLY the keywords, separated by spaces. No quotes, no explanations.
            2. Convert any non-English input to natural English keywords.
            3. Focus on visual elements: subjects, scenes, moods, lighting, colors, styles, poses, actions.
            4. Use conversation context to disambiguate. The user often refers to previous messages.
            5. CAREFUL with Korean homophones — choose meaning based on visual/action context:
               - 쥐다 (to grasp/hold) vs 쥐 (mouse animal): if discussing hands, poses, actions → "grasping/holding"
               - 손 (hand) vs 손님 (guest): default to body part unless context says otherwise
               - 눈 (eye) vs 눈 (snow): use context (face/weather)
               - 배 (boat/stomach/pear): use context
               - 다리 (leg/bridge): use context
            6. If the message refers to "this/that image" or implies continuation of previous topic, \
               maintain the topic from the conversation context.
            7. If the message is NOT asking about visual content (greeting, thanks, off-topic), \
               output exactly: SKIP
            
            Examples with context:
            
            Context: User is drawing a girl in a cafe.
            User: "그럼 저 쥐고 있는 손으로 그리고 여자 아이 캐릭터 그리고 싶어"
            Output: girl character holding cup hand pose cafe
            
            Context: User is drawing a winter landscape.
            User: "눈이 더 많이 내리는 느낌으로"
            Output: heavy snowfall winter scene
            
            Context: First message.
            User: "벚꽃이 핀 봄 풍경 어떻게 그려요?"
            Output: cherry blossoms spring landscape
            
            Context: User is drawing a portrait.
            User: "눈이 더 크게"
            Output: large eyes portrait expressive
            
            Context: First message.
            User: "How do I draw a cozy cafe interior?"
            Output: cozy cafe interior warm lighting
            
            Context: any
            User: "안녕하세요"
            Output: SKIP
            """;

    private static final int MAX_CONTEXT_TURNS = 4;  // 최근 4턴만 컨텍스트로

    private final List<LlmService> llmServices;

    /**
     * 메시지에서 검색 키워드 추출 (대화 컨텍스트 고려).
     *
     * @param userMessage 사용자 메시지
     * @param recentHistory 최근 대화 (system 제외, USER/ASSISTANT)
     * @return 영어 검색 키워드 (검색 불필요시 빈 문자열)
     */
    public String extract(String userMessage, List<LlmCallContext.Turn> recentHistory) {
        if (userMessage == null || userMessage.isBlank()) {
            return "";
        }

        LlmService grok = pickService(LlmProvider.GROK);

        // 컨텍스트 구성: SYSTEM 프롬프트 + 최근 N턴
        List<LlmCallContext.Turn> turns = new ArrayList<>();
        turns.add(new LlmCallContext.Turn(MessageRole.SYSTEM, SYSTEM_PROMPT));

        if (recentHistory != null && !recentHistory.isEmpty()) {
            List<LlmCallContext.Turn> trimmed = trimRecent(recentHistory, MAX_CONTEXT_TURNS);
            turns.addAll(trimmed);
        }

        LlmCallContext ctx = new LlmCallContext(turns, userMessage, null, null);

        try {
            LlmCallResult result = grok.generate(ctx);
            String keywords = result.content().trim();

            if ("SKIP".equalsIgnoreCase(keywords) || keywords.isEmpty()) {
                log.debug("키워드 추출 건너뜀: message='{}'", userMessage);
                return "";
            }

            log.info("키워드 추출: '{}' → '{}'", userMessage, keywords);
            return keywords;

        } catch (Exception e) {
            log.warn("키워드 추출 실패, 검색 건너뜀: message='{}', error={}",
                    userMessage, e.getMessage());
            return "";
        }
    }

    /**
     * 기존 호환성 — 컨텍스트 없이 호출 (사용 안 함, 폴백용)
     */
    public String extract(String userMessage) {
        return extract(userMessage, null);
    }

    /**
     * 최근 N개의 USER/ASSISTANT 턴만 추출 (SYSTEM 제외).
     */
    private List<LlmCallContext.Turn> trimRecent(
            List<LlmCallContext.Turn> history, int maxTurns) {
        List<LlmCallContext.Turn> nonSystem = history.stream()
                .filter(t -> t.role() != MessageRole.SYSTEM)
                .toList();
        int from = Math.max(0, nonSystem.size() - maxTurns);
        return new ArrayList<>(nonSystem.subList(from, nonSystem.size()));
    }

    private LlmService pickService(LlmProvider provider) {
        return llmServices.stream()
                .filter(s -> s.provider() == provider)
                .findFirst()
                .orElseThrow(() -> new IllegalStateException(
                        "Provider not available: " + provider));
    }
}