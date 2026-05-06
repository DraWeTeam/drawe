import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { getProject } from "../projects/api";
import { getHistory, resetSession, sendMessage } from "./api";
import ReferenceGrid from "./ReferenceGrid";
import styles from "./ChatPage.module.css";

const sessionKey = (projectId) => `chat_session_${projectId}`;

const ChatPage = () => {
  const { projectId } = useParams();
  const navigate = useNavigate();

  const [project, setProject] = useState(null);
  const [messages, setMessages] = useState([]);
  const [sessionId, setSessionId] = useState(
    () => localStorage.getItem(sessionKey(projectId)) || null
  );
  const [input, setInput] = useState("");
  const [followUp, setFollowUp] = useState(null);
  const [sending, setSending] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const [references, setReferences] = useState([]);

  const listRef = useRef(null);

  useEffect(() => {
    const fetchProject = async () => {
      try {
        const detail = await getProject(projectId);
        setProject(detail);
      } catch (err) {
        const message =
          err.response?.data?.error?.message || "프로젝트 정보를 불러오지 못했어요.";
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
          references: m.references
        }));
        setMessages(restored);

      
      // references가 "있는" 가장 최근 메시지를 찾음
      const lastWithReferences = [...restored]
        .reverse()
        .find(m => m.references && m.references.length > 0);
      
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

  const handleSend = async (e) => {
    e?.preventDefault?.();
    const text = input.trim();
    if (!text || sending) return;

    setErrorMessage("");
    setMessages((prev) => [...prev, { role: "user", content: text }]);
    setInput("");
    setFollowUp(null);
    setSending(true);

    try {
      const res = await sendMessage(projectId, { message: text, sessionId });
      if (res?.sessionId && res.sessionId !== sessionId) {
        setSessionId(res.sessionId);
        localStorage.setItem(sessionKey(projectId), res.sessionId);
      }
      setMessages((prev) => [...prev, { role: "assistant", content: res.message, references: res.references || [] }]);
      setFollowUp(res.followUp || null);
      
      if (res.references && res.references.length > 0) {
        setReferences(res.references);
      }
    } catch (err) {
      const message =
        err.response?.data?.error?.message || "메시지 전송에 실패했어요.";
      setErrorMessage(message);
      setMessages((prev) => prev.slice(0, -1));
      setInput(text);
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
    } catch (err) {
      const message =
        err.response?.data?.error?.message || "초기화에 실패했어요.";
      setErrorMessage(message);
    }
  };

  const handleFollowUpClick = (text) => {
    setInput(text);
  };

  return (
    <div className={styles.layout}>
      {/* 좌측: 참고 이미지 그리드 */}
      <aside className={styles.leftPanel}>
        <ReferenceGrid references={references} loading={sending} />
      </aside>

      {/* 우측: 챗 */}
      <section className={styles.rightPanel}>
        <div className={styles.wrapper}>
          <header className={styles.header}>
            <button className={styles.backBtn} onClick={() => navigate("/projects")}>
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
                    m.role === "user" ? styles.userBubble : styles.assistantBubble
                  }
                >
                  {m.content}
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
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="메시지를 입력하세요"
              className={styles.input}
              disabled={sending}
            />
            <button
              type="submit"
              className={styles.sendBtn}
              disabled={sending || !input.trim()}
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