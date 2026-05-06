package com.drawe.backend.global.client;

import com.drawe.backend.global.client.dto.PineconeMatch;
import com.drawe.backend.global.client.dto.PineconeQueryRequest;
import com.drawe.backend.global.client.dto.PineconeQueryResponse;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.reactive.function.client.WebClient;

import java.util.List;

@Slf4j
@Component
public class PineconeClient {
    private final WebClient webClient;

    public PineconeClient(
            @Value("${pinecone.host}") String pineconeHost,
            @Value("${pinecone.api-key}") String apiKey) {
        this.webClient = WebClient.builder()
                .baseUrl(pineconeHost)
                .defaultHeader("Api-Key", apiKey)
                .defaultHeader("Content-Type", MediaType.APPLICATION_JSON_VALUE)
                .defaultHeader("X-Pinecone-API-Version", "2024-07")
                .build();
    }

    /**
     * 주어진 벡터와 가장 유사한 top-K 이미지의 ID와 점수 반환
     *
     * @param vector CLIP에서 생성된 768차원 정규화 벡터
     * @param topK   반환할 결과 개수
     * @return 유사도 순으로 정렬된 매치 리스트
     */
    public List<PineconeMatch> queryByVector(List<Float> vector, int topK){
        try{
            PineconeQueryResponse response = webClient.post()
                    .uri("/query")
                    .bodyValue(PineconeQueryRequest.of(vector, topK))
                    .retrieve()
                    .bodyToMono(PineconeQueryResponse.class)
                    .block();

            if( response == null || response.matches() == null ){
                log.warn("Pinecone 응답이 비어있습니다.");
                return List.of();
            }

            log.debug("Pinecone 검색 완료: 결과 {}개", response.matches().size());
            return response.matches();

        } catch (Exception e) {
            log.error("Pinecone 호출 실패: error={}", e.getMessage());
            throw new RuntimeException("벡터 검색 실패: " + e.getMessage(), e);
        }
    }
}
