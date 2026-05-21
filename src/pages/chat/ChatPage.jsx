import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { getProject } from "../projects/api";
import { generateImage, getHistory, resetSession, sendMessage } from "./api";
import ReferenceGrid from "./ReferenceGrid";
import AttachmentPicker from "./AttachmentPicker";
import AuthedImage from "./AuthedImage";
import styles from "./ChatPage.module.css";

const sessionKey = (projectId) => `chat_session_${projectId}`;
const MAX_INPUT_HEIGHT = 160;

const GENERATING_MESSAGES = [
  "완전 어울리는 이미지를 만들고있어요! 조금만 기다려주세요!",
  "붓을 들고 열심히 그리는 중이에요 🎨",
  "상상 속 장면을 픽셀로 옮기고 있어요...",
  "조금만요! 멋진 그림이 나오고 있어요 ✨",
  "색감을 고르는 중이에요. 두근두근...",
  "거의 다 됐어요! 마지막 터치 중이에요!",
];
const pickGeneratingMsg = () =>
  GENERATING_MESSAGES[Math.floor(Math.random() * GENERATING_MESSAGES.length)];

const GENERATE_INTENT_PATTERN = /만들|그려|생성|AI|이미지/i;
const looksLikeGenerateRequest = (text) =>
  !!text && GENERATE_INTENT_PATTERN.test(text);

const ChatPage = () => {
  const { projectId } = useParams();
  const navigate = useNavigate();

  const [project, setProject] = useState(null);
  const [messages, setMessages] = useState([]);
  const [sessionId, setSessionId] = useState(
    () => localStorage.getItem(sessionKey(projectId)) || null,
  );
  const [input, setInput] = useState("");
  const [followUp, setFollowUp] = useState(null);
  const [sending, setSending] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [attachment, setAttachment] = useState(null);

  const [references, setReferences] = useState([]);
  const [justUpdated, setJustUpdated] = useState(false);

  const listRef = useRef(null);
  const textareaRef = useRef(null);

  useEffect(() => {
    const fetchProject = async () => {
      try {
        const detail = await getProject(projectId);
        setProject(detail);
      } catch (err) {
        const message =
          err.response?.data?.error?.message ||
          "프로젝트 정보를 불러오지 못했어요.";
        setErrorMessage(message);
      }
    };
    fetchProject();
  }, [projectId]);

  useEffect(() => {
    if (!sessionId) return;
    const fetchHistory = async () => {
      try {
        const data = await getHistory(projectId, sessionId);
        const restored = (data?.messages ?? []).map((m) => ({
          role: m.role,
          content: m.content,
          references: m.references,
          imageUrl: m.imageUrl ?? null,
          // 백엔드 isAi 필드 추가 전 임시 휴리스틱:
          // assistant가 보낸 imageUrl은 generate-image 경로뿐이라 AI로 간주
          isAi: m.isAi ?? (m.role === "assistant" && !!m.imageUrl),
        }));
        setMessages(restored);

        const lastWithReferences = [...restored]
          .reverse()
          .find((m) => m.references && m.references.length > 0);

        if (lastWithReferences) {
          setReferences(lastWithReferences.references);
        }
      } catch (err) {
        if (err.response?.status === 404) {
          localStorage.removeItem(sessionKey(projectId));
          setSessionId(null);
        }
      }
    };
    fetchHistory();
  }, [projectId, sessionId]);

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages]);

  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    const next = Math.min(el.scrollHeight, MAX_INPUT_HEIGHT);
    el.style.height = `${next}px`;
  }, [input]);

  const handleSend = async (e) => {
    e?.preventDefault?.();
    const text = input.trim();
    if ((!text && !attachment) || sending) return;

    const sentAttachment = attachment;
    setErrorMessage("");

    const showGeneratingHint = looksLikeGenerateRequest(text);
    const placeholderId = showGeneratingHint ? `gen-${Date.now()}` : null;

    setMessages((prev) => {
      const next = [
        ...prev,
        {
          role: "user",
          content: text,
          imageUrl: sentAttachment?.url ?? null,
          localPreviewUrl: sentAttachment?.previewUrl ?? null,
        },
      ];
      if (placeholderId) {
        next.push({
          role: "assistant",
          content: "이미지 만들고 있어요... (보통 15~25초 정도 걸려요)",
          _placeholderId: placeholderId,
          _generating: true,
        });
      }
      return next;
    });
    setInput("");
    setAttachment(null);
    setFollowUp(null);
    setSending(true);

    const rotator = placeholderId
      ? setInterval(() => {
          setMessages((prev) =>
            prev.map((m) =>
              m._placeholderId === placeholderId
                ? { ...m, content: pickGeneratingMsg() }
                : m,
            ),
          );
        }, 3500)
      : null;

    try {
      const res = await sendMessage(projectId, {
        message: text,
        sessionId,
        imageUrl: sentAttachment?.url,
      });
      if (res?.sessionId && res.sessionId !== sessionId) {
        setSessionId(res.sessionId);
        localStorage.setItem(sessionKey(projectId), res.sessionId);
      }

      const action = res.referencesAction;
      const newRefs = res.references || [];
      const generated = res.generatedImage;

      setMessages((prev) => {
        const next = prev.filter((m) => !m._generating);
        return [
          ...next,
          {
            role: "assistant",
            content: res.message,
            references: action === "NEW_SEARCH" ? newRefs : [],
            referencesAction: action,
            imageUrl: generated?.url ?? null,
            isAi: !!generated,
          },
        ];
      });
      setFollowUp(
        generated
          ? null
          : res.offerGenerate
            ? { type: "OFFER_GENERATE" }
            : res.suggestedPrompt
              ? { type: "PROMPT", text: res.suggestedPrompt }
              : null,
      );

      // references 갱신 — NEW_SEARCH이고 결과 있을 때만
      if (action === "NEW_SEARCH" && newRefs.length > 0) {
        setReferences(newRefs);
        setJustUpdated(true);
        setTimeout(() => setJustUpdated(false), 2500);
      }
      // KEEP, SKIP, GENERATE_NOW, 또는 NEW_SEARCH인데 빈 배열: 이전 references 유지
    } catch (err) {
      const status = err.response?.status;
      let message = err.response?.data?.error?.message;
      if (status === 503) {
        message = "잠깐 드로가 바빠요. 다시 한 번 보내볼까요?";
      }
      setErrorMessage(message || "메시지 전송에 실패했어요.");
      setMessages((prev) => {
        const withoutPlaceholder = placeholderId
          ? prev.filter((m) => m._placeholderId !== placeholderId)
          : prev;
        return withoutPlaceholder.slice(0, -1);
      });
      setInput(text);
      if (sentAttachment) setAttachment(sentAttachment);
    } finally {
      if (rotator) clearInterval(rotator);
      setSending(false);
    }
  };

  const handleReset = async () => {
    if (!sessionId) return;
    if (!window.confirm("대화를 초기화할까요? 메시지가 모두 사라져요.")) return;
    try {
      await resetSession(projectId, sessionId);
      setMessages([]);
      setFollowUp(null);
      setReferences([]);
      setJustUpdated(false); // ← 추가
    } catch (err) {
      const message =
        err.response?.data?.error?.message || "초기화에 실패했어요.";
      setErrorMessage(message);
    }
  };

  const handleFollowUpClick = (text) => {
    setInput(text);
  };

  const handleGenerateImage = async () => {
    if (sending) return;
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    if (!lastUser?.content) {
      setErrorMessage("이미지를 만들 메시지를 찾지 못했어요.");
      return;
    }
    const placeholderId = `gen-${Date.now()}`;
    setErrorMessage("");
    setFollowUp(null);
    setSending(true);
    setMessages((prev) => [
      ...prev,
      {
        role: "assistant",
        content: pickGeneratingMsg(),
        _placeholderId: placeholderId,
        _generating: true,
      },
    ]);

    const rotator = setInterval(() => {
      setMessages((prev) =>
        prev.map((m) =>
          m._placeholderId === placeholderId
            ? { ...m, content: pickGeneratingMsg() }
            : m,
        ),
      );
    }, 3500);

    try {
      const res = await generateImage(projectId, sessionId, lastUser.content);
      setMessages((prev) =>
        prev.map((m) =>
          m._placeholderId === placeholderId
            ? {
                role: "assistant",
                content: "여기 만들어봤어요! 어떠세요?",
                imageUrl: res.imageUrl,
                isAi: true,
              }
            : m,
        ),
      );
    } catch (err) {
      const status = err.response?.status;
      const msg =
        status === 503
          ? "이미지 생성에 실패했어요. 다시 시도해주세요."
          : err.response?.data?.error?.message ||
            "이미지 생성에 실패했어요.";
      setErrorMessage(msg);
      setMessages((prev) =>
        prev.map((m) =>
          m._placeholderId === placeholderId
            ? { role: "assistant", content: "앗, 그림을 못 그렸어요 😢" }
            : m,
        ),
      );
    } finally {
      clearInterval(rotator);
      setSending(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleCardClick = (reference) => {
    navigate(`/projects/${projectId}/reference/${reference.id}`, {
      state: { reference },
    });
  };

  return (
    <div className={styles.layout}>
      {/* 좌측: 참고 이미지 그리드 */}
      <aside className={styles.leftPanel}>
        <ReferenceGrid
          references={references}
          loading={sending}
          justUpdated={justUpdated}
          onCardClick={handleCardClick}
        />
      </aside>

      {/* 우측: 챗 */}
      <section className={styles.rightPanel}>
        <div className={styles.wrapper}>
          <header className={styles.header}>
            <button
              className={styles.backBtn}
              onClick={() => navigate("/projects")}
            >
              ← 목록
            </button>
            <div className={styles.headerInfo}>
              <h1 className={styles.title}>{project?.name ?? "..."}</h1>
              {project && (
                <p className={styles.subtitle}>
                  {[project.subject, project.technique, project.mood]
                    .filter(Boolean)
                    .join(" · ") || "프로젝트 정보 없음"}
                </p>
              )}
            </div>
            <button
              className={styles.resetBtn}
              onClick={handleReset}
              disabled={!sessionId}
            >
              대화 초기화
            </button>
          </header>

          <div className={styles.messages} ref={listRef}>
            {messages.length === 0 ? (
              <div className={styles.empty}>
                <p>그림에 대해 무엇이든 물어보세요.</p>
                <p className={styles.emptyHint}>
                  예) "벚꽃을 그릴 때 어떤 색을 쓰면 좋을까?"
                </p>
              </div>
            ) : (
              messages.map((m, idx) => (
                <div
                  key={idx}
                  className={
                    m.role === "user"
                      ? styles.userBubble
                      : styles.assistantBubble
                  }
                >
                  {(m.localPreviewUrl || m.imageUrl) && (
                    <div className={styles.imageWrap}>
                      <AuthedImage
                        src={m.localPreviewUrl || m.imageUrl}
                        alt={m.isAi ? "AI로 생성된 이미지" : "첨부 이미지"}
                        className={styles.bubbleImage}
                      />
                      {m.isAi && (
                        <span
                          className={styles.aiBadge}
                          aria-label="AI로 생성된 이미지"
                        >
                          ✨ AI Generated
                        </span>
                      )}
                    </div>
                  )}
                  {m.content && <div>{m.content}</div>}
                </div>
              ))
            )}
            {sending && !messages.some((m) => m._generating) && (
              <div className={styles.assistantBubble}>응답을 작성 중...</div>
            )}
          </div>

          {followUp && !sending && (
            <div className={styles.followUp}>
              {followUp.type === "OFFER_GENERATE" ? (
                <button
                  className={styles.generateBtn}
                  onClick={handleGenerateImage}
                >
                  ✨ AI 이미지 만들기
                </button>
              ) : (
                <button
                  className={styles.followUpBtn}
                  onClick={() => handleFollowUpClick(followUp.text)}
                >
                  💬 {followUp.text}
                </button>
              )}
            </div>
          )}

          {errorMessage && <p className={styles.error}>{errorMessage}</p>}

          <form className={styles.inputBar} onSubmit={handleSend}>
            <AttachmentPicker
              attachment={attachment}
              onAttach={setAttachment}
              onClear={() => setAttachment(null)}
              onError={setErrorMessage}
              disabled={sending}
            />
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="메시지를 입력하세요 (Shift+Enter 줄바꿈)"
              className={styles.input}
              disabled={sending}
              rows={1}
            />
            <button
              type="submit"
              className={styles.sendBtn}
              disabled={sending || (!input.trim() && !attachment)}
            >
              전송
            </button>
          </form>
        </div>
      </section>
    </div>
  );
};

export default ChatPage;
