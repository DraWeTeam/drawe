import { useEffect, useState } from "react";
import {
  getHistory,
  getGuides,
  getLatestSession,
  sendGuideFeedback,
} from "../chat/api";
import { axisLabel } from "../chat/guideLabels";
import { downloadGuidePdf } from "../chat/guidePdf";
import { track } from "../../analytics";
import AuthedImage from "../chat/AuthedImage";
import GuideCollectionPanel from "../chat/GuideCollectionPanel";
// ★ChatPage.module.css 를 read-only 로 재사용 — ChatPage 파일은 미접촉(0 diff)이고 결과카드·버블
//   스타일 값이 /chat 과 문자 동일(Fidelity 무손실). 신규 board 클래스는 board 모듈에서 얹는다.
import styles from "../chat/ChatPage.module.css";
import logo from "../../assets/drawe_logo.png";

// ★sessionKey 는 ChatPage 와 동일 상수 — /chat↔/board 가 같은 세션을 공유해 대화가 이어진다.
const sessionKey = (projectId) => `chat_session_${projectId}`;

// BoardGuideChat — 작업공간(/board) 우측 인라인 가이드 챗(SCR-BOARD-01 66:26420).
//   ChatPage 를 가르지 않고 standalone 부품을 조립. 복원 로직은 ChatPage 의 a2fe4b0 폴백 패턴을
//   동일하게 구현(stale localStorage → getHistory 404 → getLatestSession 재해결).
//   ★상세는 /chat 의 '좌측 오버레이' 대신 GuideModal 팝업 — /board 좌측은 그쪽 보드라 덮기 금지.
const BoardGuideChat = ({
  projectId,
  reloadSignal = 0,
  onCount,
  collectionOpen = false,
  onCollectionChange,
  onGuidesCount,
  onOpenGuide, // ⑧ 상세를 부모(ReferenceBoardPage)가 좌측 오버레이로 표시
}) => {
  const [messages, setMessages] = useState([]);
  const [sessionId, setSessionId] = useState(null);

  // 부모(ReferenceBoardPage/GeneratePromptPanel)가 인트로 토글·헤더 모아보기 게이팅을 하도록
  //   메시지 수와 가이드 수를 올려준다. 모아보기 오버레이는 부모가 collectionOpen 으로 제어.
  useEffect(() => {
    if (onCount) onCount(messages.length);
  }, [messages.length, onCount]);
  useEffect(() => {
    if (onGuidesCount)
      onGuidesCount(messages.filter((m) => m.type === "guide").length);
  }, [messages, onGuidesCount]);

  // 세션 초기화 — localStorage 우선, 없으면 서버 최신 세션(ChatPage initSession 동일).
  useEffect(() => {
    let alive = true;
    const initSession = async () => {
      const stored = localStorage.getItem(sessionKey(projectId));
      if (stored) {
        if (alive) setSessionId(stored);
        return;
      }
      try {
        const data = await getLatestSession(projectId);
        if (alive && data?.sessionId) {
          localStorage.setItem(sessionKey(projectId), data.sessionId);
          setSessionId(data.sessionId);
        }
      } catch {
        /* 세션 없음 — 무시 */
      }
    };
    initSession();
    return () => {
      alive = false;
    };
  }, [projectId]);

  // 복원 — getHistory(세션 게이트, 404→getLatestSession 폴백) + getGuides(항상, projectId 단위).
  useEffect(() => {
    if (!projectId) return;
    let alive = true;
    const fetchAll = async () => {
      let restored = [];
      if (sessionId) {
        try {
          const data = await getHistory(projectId, sessionId);
          restored = (data?.messages ?? []).map((m) => ({
            role: m.role,
            content: m.content,
            references: m.references,
            imageUrl: m.imageUrl ?? null,
            createdAt: m.createdAt ?? null,
            isAi: m.isAi ?? (m.role === "assistant" && !!m.imageUrl),
          }));
        } catch (err) {
          if (err.response?.status === 404) {
            // stale 세션 — localStorage 비우고 서버 최신 세션으로 재해결(a2fe4b0 패턴).
            localStorage.removeItem(sessionKey(projectId));
            try {
              const latest = await getLatestSession(projectId);
              if (latest?.sessionId && latest.sessionId !== sessionId) {
                localStorage.setItem(sessionKey(projectId), latest.sessionId);
                if (alive) setSessionId(latest.sessionId); // → 재실행
                return;
              } else if (alive) {
                setSessionId(null);
              }
            } catch {
              if (alive) setSessionId(null);
            }
          }
        }
      }

      let guideCards = [];
      try {
        const guides = await getGuides(projectId);
        if (Array.isArray(guides) && guides.length > 0) {
          guideCards = guides.flatMap((g, i) => {
            const card = {
              role: "assistant",
              type: "guide",
              _gid: `restored-${i}`,
              guide: g.guide,
              references: g.references || [],
              guideTitle: axisLabel(g.guide?.primary_focus) || "한 끗",
              guidePreview: g.uploadUrl ?? null,
              guideFeedback: null,
              createdAt: g.createdAt ?? null,
              requestText: g.requestText ?? null, // ① 상세 §2 사용자 버블
            };
            const text = g.requestText?.trim();
            if (!text) return [card];
            return [
              {
                role: "user",
                content: g.requestText,
                imageUrl: g.uploadUrl ?? null,
                createdAt: g.createdAt ?? null,
              },
              card,
            ];
          });
        }
      } catch {
        /* 가이드 복원 실패는 치명적이지 않음 */
      }

      if (!alive) return;
      setMessages(
        [...restored, ...guideCards].sort(
          (a, b) =>
            (a.createdAt ? Date.parse(a.createdAt) : 0) -
            (b.createdAt ? Date.parse(b.createdAt) : 0),
        ),
      );
    };
    fetchAll();
    return () => {
      alive = false;
    };
  }, [projectId, sessionId, reloadSignal]);

  const openGuideFromCard = (m) => {
    // ⑧ 상세는 부모(ReferenceBoardPage)가 좌측 반 오버레이로 표시(SCR-GUIDE-03-1 split).
    onOpenGuide?.({
      guide: m.guide,
      references: m.references,
      requestText: m.requestText, // ① 상세 §2 사용자 버블
      guidePreview: m.guidePreview || null,
    });
  };

  const setGuideCardFeedback = (gidVal, kind) => {
    const msg = messages.find((m) => m._gid === gidVal && m.type === "guide");
    const prevKind = msg?.guideFeedback ?? null;
    const nextKind = msg && msg.guideFeedback === kind ? null : kind; // 토글
    const now = Date.now();
    setMessages((prev) =>
      prev.map((m) =>
        m._gid === gidVal && m.type === "guide"
          ? { ...m, guideFeedback: nextKind, lastFeedbackAt: now }
          : m,
      ),
    );
    const guideId = msg?.guide?.guide_id;
    if (guideId) {
      const fb =
        nextKind === "up" ? "like" : nextKind === "down" ? "dislike" : null;
      sendGuideFeedback(projectId, guideId, fb).catch(() => {});
      // [트래킹] 가이드 좋아요/싫어요 — applied/changed/removed (ChatPage 와 동일 규격).
      const generatedAt = msg.createdAt
        ? new Date(msg.createdAt).getTime()
        : null;
      track("guide_feedback", {
        project_id: projectId,
        guide_id: guideId,
        action_type:
          !prevKind && nextKind
            ? "applied"
            : prevKind && !nextKind
              ? "removed"
              : "changed",
        current_feedback: fb || "none",
        previous_feedback:
          prevKind === "up" ? "like" : prevKind === "down" ? "dislike" : "none",
        guide_category:
          msg.guide?.next_steps?.track?.group || msg.guide?.primary_focus || "",
        time_since_generated_sec: generatedAt
          ? Math.round((now - generatedAt) / 1000)
          : 0,
        time_since_previous_action_sec: msg.lastFeedbackAt
          ? Math.round((now - msg.lastFeedbackAt) / 1000)
          : 0,
      });
    }
  };

  const guides = messages.filter((m) => m.type === "guide");

  return (
    <>
      {/* 메시지 스트림 — 버블 + 인라인 결과카드(Figma 0:56) */}
      {messages.map((m, idx) => {
        if (m.type === "guide") {
          const g = m.guide || {};
          const utterance =
            g.chat_feedback ||
            g.blocks?.[0]?.observation ||
            (g.mode !== "coach" ? g.message : "") ||
            "";
          return (
            <div key={idx} className={styles.assistantMessage}>
              {utterance && (
                <div className={styles.assistantBubble}>
                  <img className={styles.assistantLogo} src={logo} alt="" />
                  <span>{utterance}</span>
                </div>
              )}
              <button
                type="button"
                className={styles.guideCard}
                onClick={() => openGuideFromCard(m)}
              >
                <span className={styles.guideCardThumb}>
                  {m.guidePreview ? (
                    <AuthedImage
                      className={styles.guideCardThumbImg}
                      src={m.guidePreview}
                      alt=""
                    />
                  ) : (
                    <ImgPlaceholderIcon />
                  )}
                </span>
                <span className={styles.guideCardFooter}>
                  <span className={styles.guideCardBody}>
                    <span className={styles.guideCardTitle}>
                      {m.guideTitle}
                    </span>
                    <span className={styles.guideCardSub}>가이드 보기</span>
                  </span>
                  <ChevronRightIcon />
                </span>
              </button>
              <div className={styles.guideActions}>
                <button
                  type="button"
                  className={styles.guideActBtn}
                  aria-label="PDF 다운로드"
                  onClick={() => {
                    // [트래킹] 가이드 저장(PDF 다운로드) — 보드 인라인 가이드 뷰.
                    const generatedAt = m.createdAt
                      ? new Date(m.createdAt).getTime()
                      : null;
                    track("guide_saved", {
                      project_id: projectId,
                      guide_id: m.guide?.guide_id || "",
                      guide_category:
                        m.guide?.next_steps?.track?.group ||
                        m.guide?.primary_focus ||
                        "",
                      previous_feedback:
                        m.guideFeedback === "up"
                          ? "like"
                          : m.guideFeedback === "down"
                            ? "dislike"
                            : "none",
                      time_since_generated_sec: generatedAt
                        ? Math.round((Date.now() - generatedAt) / 1000)
                        : 0,
                      save_entry_point: "guide_view",
                    });
                    downloadGuidePdf(
                      { guide: m.guide, references: m.references },
                      m.guidePreview,
                    );
                  }}
                >
                  <DownloadIcon />
                </button>
                <button
                  type="button"
                  className={styles.guideActBtn}
                  data-active={m.guideFeedback === "up"}
                  aria-label="좋아요"
                  onClick={() => setGuideCardFeedback(m._gid, "up")}
                >
                  <ThumbUpIcon />
                </button>
                <button
                  type="button"
                  className={styles.guideActBtn}
                  data-active={m.guideFeedback === "down"}
                  aria-label="싫어요"
                  onClick={() => setGuideCardFeedback(m._gid, "down")}
                >
                  <ThumbDownIcon />
                </button>
              </div>
            </div>
          );
        }
        return (
          <div
            key={idx}
            className={
              m.role === "user" ? styles.userMessage : styles.assistantMessage
            }
          >
            {m.imageUrl && (
              <div className={styles.messageImages}>
                <div
                  className={`${styles.imageWrap} ${m.isAi ? styles.imageWrapAi : ""}`}
                >
                  <AuthedImage
                    src={m.imageUrl}
                    alt={m.isAi ? "AI로 생성된 이미지" : "첨부 이미지"}
                    className={m.isAi ? styles.aiImage : styles.bubbleImage}
                  />
                </div>
              </div>
            )}
            {m.content && (
              <div
                className={
                  m.role === "user" ? styles.userBubble : styles.assistantBubble
                }
              >
                {m.role !== "user" && (
                  <img className={styles.assistantLogo} src={logo} alt="" />
                )}
                <div>{m.content}</div>
              </div>
            )}
          </div>
        );
      })}

      {/* 모아보기 오버레이 — getGuides 결과 재사용(새 fetch 없음). 진입은 board 헤더 아이콘. */}
      {collectionOpen && (
        <GuideCollectionPanel
          guides={guides}
          onClose={() => onCollectionChange?.(false)}
          onCardClick={(g) => {
            onCollectionChange?.(false);
            openGuideFromCard(g);
          }}
        />
      )}
    </>
  );
};

const ImgPlaceholderIcon = () => (
  <svg
    viewBox="0 0 24 24"
    width="22"
    height="22"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <circle cx="8.5" cy="8.5" r="1.5" />
    <path d="M21 15l-5-5L5 21" />
  </svg>
);
const ChevronRightIcon = () => (
  <svg
    viewBox="0 0 24 24"
    width="18"
    height="18"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M9 18l6-6-6-6" />
  </svg>
);
const ThumbUpIcon = () => (
  <svg
    viewBox="0 0 24 24"
    width="17"
    height="17"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M7 10v11" />
    <path d="M14 9V5a2 2 0 0 0-2-2l-3 7v11h9a2 2 0 0 0 2-1.7l1-6A2 2 0 0 0 20 10z" />
  </svg>
);
const ThumbDownIcon = () => (
  <svg
    viewBox="0 0 24 24"
    width="17"
    height="17"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M17 14V3" />
    <path d="M10 15v4a2 2 0 0 0 2 2l3-7V3H6a2 2 0 0 0-2 1.7l-1 6A2 2 0 0 0 5 14z" />
  </svg>
);
const DownloadIcon = () => (
  <svg
    viewBox="0 0 24 24"
    width="17"
    height="17"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <path d="M7 10l5 5 5-5" />
    <path d="M12 15V3" />
  </svg>
);

export default BoardGuideChat;
