import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { getProject } from "../projects/api";
import { getHistory, resetSession, sendMessage } from "./api";
import ReferenceGrid from "./ReferenceGrid";
import AttachmentPicker from "./AttachmentPicker";
import AuthedImage from "./AuthedImage";
import styles from "./ChatPage.module.css";
import { track } from "../../analytics"; 

const sessionKey = (projectId) => `chat_session_${projectId}`;
const MAX_INPUT_HEIGHT = 160;

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
  const lastResponseTime = useRef(null); 

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
    setMessages((prev) => [
      ...prev,
      {
        role: "user",
        content: text,
        imageUrl: sentAttachment?.url ?? null,
        localPreviewUrl: sentAttachment?.previewUrl ?? null,
      },
    ]);
    setInput("");
    setAttachment(null);
    setFollowUp(null);
    setSending(true);

    const userMessageCount = messages.filter((m) => m.role === "user").length;
    const currentIteration = userMessageCount + 1;
    const isFirstSubmission = userMessageCount === 0;
    const inputMode = sentAttachment ? "text_image" : "text";

    if (isFirstSubmission) {
      // 첫 제출
      if (sentAttachment) {
        track("prompt_image_uploaded_submitted", {
          project_id: projectId,
          image_format: sentAttachment.format || "unknown",
          image_size_kb: sentAttachment.sizeKb || 0,
          prompt_length: text.length,
          iteration_count: currentIteration,
        });
      } else {
        track("prompt_submitted", {
          project_id: projectId,
          prompt_length: text.length,
          iteration_count: currentIteration,
        });
      }
    } else {
      // 추가 제출
      const lastAssistant = [...messages]
        .reverse()
        .find((m) => m.role === "assistant");
      const previousResponseType =
        lastAssistant?.references?.length > 0 ? "reference" : "guide";

      track("prompt_additional_submitted", {
        project_id: projectId,
        input_mode: inputMode,
        prompt_length: text.length,
        iteration_count: currentIteration,
        previous_response_type: previousResponseType,
        time_since_previous_response_sec: lastResponseTime.current
          ? Math.floor((Date.now() - lastResponseTime.current) / 1000)
          : 0,
      });
    }

    // 응답 시간 측정용 시작 시각
    const responseStartTime = Date.now();

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

      // 메시지에 references 저장 (히스토리 복원용)
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: res.message,
          references: action === "NEW_SEARCH" ? newRefs : [],
          referencesAction: action,
        },
      ]);
      setFollowUp(res.followUp || null);

      // references 갱신 — NEW_SEARCH이고 결과 있을 때만
      if (action === "NEW_SEARCH" && newRefs.length > 0) {
        setReferences(newRefs);
        setJustUpdated(true);
        setTimeout(() => setJustUpdated(false), 2500);
      }

      track("prompt_response_loaded", {
      project_id: projectId,
      input_mode: inputMode,
      response_type: responseType,
      reference_count: responseType === "reference" ? newRefs.length : 0,
      generation_time_ms: Date.now() - responseStartTime,
      iteration_count: currentIteration,
    });

    lastResponseTime.current = Date.now();
    // ↑↑↑ 응답 도착 트래킹 끝 ↑↑↑

  
      // KEEP, SKIP, 또는 NEW_SEARCH인데 빈 배열: 이전 references 유지 (아무것도 안 함)
    } catch (err) {
      const status = err.response?.status;
      let message = err.response?.data?.error?.message;
      if (status === 503) {
        message = "잠깐 드로가 바빠요. 다시 한 번 보내볼까요?";
      }
      setErrorMessage(message || "메시지 전송에 실패했어요.");
      setMessages((prev) => prev.slice(0, -1));
      setInput(text);
      if (sentAttachment) setAttachment(sentAttachment);
    } finally {
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

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleCardClick = (reference) => {
    // 현재 iteration / input_mode 캡처
  const userMessageCount = messages.filter((m) => m.role === "user").length;
  const lastUserMessage = [...messages].reverse().find((m) => m.role === "user");
  const lastInputMode = lastUserMessage?.imageUrl ? "text_image" : "text";
    navigate(`/projects/${projectId}/reference/${reference.id}`, {
      state: {
        reference,
        position,                       // ← 추가
        iterationCount: userMessageCount, // ← 추가
        inputMode: lastInputMode,         // ← 추가
    },
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
                    <AuthedImage
                      src={m.localPreviewUrl || m.imageUrl}
                      alt="첨부 이미지"
                      className={styles.bubbleImage}
                    />
                  )}
                  {m.content && <div>{m.content}</div>}
                </div>
              ))
            )}
            {sending && (
              <div className={styles.assistantBubble}>응답을 작성 중...</div>
            )}
          </div>

          {followUp && !sending && (
            <div className={styles.followUp}>
              <button
                className={styles.followUpBtn}
                onClick={() => handleFollowUpClick(followUp)}
              >
                💬 {followUp}
              </button>
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
