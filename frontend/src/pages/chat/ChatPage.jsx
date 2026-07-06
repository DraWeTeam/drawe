import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useNavigate, useParams } from "react-router-dom";
import { addReference, getProject, updateProject } from "../projects/api";
import { getReferenceArchive } from "../gallery/api";
import { notifyArchiveChanged } from "../gallery/archiveEvents";
import {
  addPin,
  generateImage,
  getGuides,
  getHistory,
  getLatestSession,
  getPins,
  removePin,
  requestGuide,
  resetSession,
  sendMessage,
  sendGuideFeedback,
  sendReferenceFeedback,
} from "./api";
import ReferenceGrid from "./ReferenceGrid";
import AttachmentPicker from "./AttachmentPicker";
import GuideForm from "./GuideForm";
import GuideCollectionPanel from "./GuideCollectionPanel";
import { GuideContent } from "./GuideModal";
import { axisLabel } from "./guideLabels";
import { downloadGuidePdf } from "./guidePdf";
import AuthedImage from "./AuthedImage";
import TutorialCoachmark from "./TutorialCoachmark";
import Tooltip from "../../components/Tooltip";
import styles from "./ChatPage.module.css";
import logo from "../../assets/drawe_logo.png";
import { track } from "../../analytics";

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

// 백엔드 RulePreRouter.GENERATE(그려줘/만들어줘 어미) 미러 + 단어 단위(만들/그려/생성/AI)도 폭넓게 매칭.
// 방법 질문("어떻게 그려?")은 HOW_QUESTION 으로 제외. '이미지'는 검색 대부분에 들어가 오탐이 커서 뺐다.
const GENERATE_INTENT_PATTERN =
  /(그려|그리|만들어|만들|생성|제작)\s*(해)?\s*(줘|줄래|주세요|주라)|만들|그려|생성|AI|generate|draw it|make it|create an image/i;
const HOW_QUESTION = /어떻게|어떡|어케|방법|how\s+to/i;
const looksLikeGenerateRequest = (text) =>
  !!text && GENERATE_INTENT_PATTERN.test(text) && !HOW_QUESTION.test(text);

const ChatPage = () => {
  const { projectId } = useParams();
  const navigate = useNavigate();

  const [project, setProject] = useState(null);
  const [messages, setMessages] = useState([]);
  // 가이드 모아보기 오버레이 — getGuides 결과(복원된 guide 메시지) 재사용, 새 fetch 없음.
  const [guideListOpen, setGuideListOpen] = useState(false);
  const [sessionId, setSessionId] = useState(null);

  const [input, setInput] = useState("");
  const [followUp, setFollowUp] = useState(null);
  const [sending, setSending] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [attachment, setAttachment] = useState(null);

  // 한 끗 가이드(이미지 가이딩) — 입력 폼 + 결과 모달
  const [guideFormOpen, setGuideFormOpen] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [guideLoading, setGuideLoading] = useState(false);
  const [guideResult, setGuideResult] = useState(null);
  const [guideError, setGuideError] = useState("");
  const [guidePreview, setGuidePreview] = useState(null);
  const lastGuideArgs = useRef(null);
  const lastDetectedStage = useRef(null); // 직전 감지 스테이지 (전송 간 비교용)

  const [references, setReferences] = useState([]);
  const [justUpdated, setJustUpdated] = useState(false);

  const [pinnedRefs, setPinnedRefs] = useState([]);
  const [pinError, setPinError] = useState("");
  // 이 프로젝트에서 이미 아카이브에 저장된 imageId 집합 (카드 메뉴 상태표시용)
  const [archivedIds, setArchivedIds] = useState(() => new Set());

  // 모드: "split" | "refFull" | "chatFull"
  const [mode, setMode] = useState("split");

  // 이미지 확대 보기 (AI 생성 이미지 클릭 시)
  const [lightboxSrc, setLightboxSrc] = useState(null);

  // 새 프로젝트 생성 직후 노출되는 튜토리얼 코치마크 (플래그는 해당 프로젝트 id)
  const [showTutorial, setShowTutorial] = useState(
    () => localStorage.getItem("drawe_show_project_tutorial") === projectId,
  );

  const dismissTutorial = () => {
    localStorage.removeItem("drawe_show_project_tutorial");
    setShowTutorial(false);
  };

  // 레퍼런스 반응 튜토리얼 — 새 프로젝트에서 레퍼런스가 처음 보일 때 노출
  const [showReactionTutorial, setShowReactionTutorial] = useState(false);

  const dismissReactionTutorial = () => {
    localStorage.removeItem("drawe_show_reaction_tutorial");
    setShowReactionTutorial(false);
  };

  // 한 끗 가이드: 폼 제출 → (1) 첨부 이미지·로딩을 채팅에 반영 → requestGuide
  //  → (2) 결과를 '가이드 카드' 메시지로 채팅에 삽입. 모달은 카드 클릭 시 열림(와이어프레임 의도).
  const handleGuideSubmit = async ({
    file,
    previewUrl,
    message,
    intent,
    track: styleTrack,
  }) => {
    lastGuideArgs.current = { file, previewUrl, message, intent, track };
    setGuideFormOpen(false);
    const gid = `g_${Date.now()}`;
    const guideStartTime = Date.now();
    setGuideLoading(true);
    setMessages((prev) => [
      ...prev,
      // 첨부 이미지(+있으면 메시지)를 사용자 버블로 채팅에 반영
      ...(previewUrl || message
        ? [
            {
              role: "user",
              localPreviewUrl: previewUrl || null,
              content: message || "",
            },
          ]
        : []),
      { role: "assistant", type: "guideLoading", _gid: gid },
    ]);
    try {
      const result = await requestGuide(projectId, file, {
        message,
        intent,
        track,
      });
      console.log("=== requestGuide 응답 ===", result);
      setMessages((prev) =>
        prev.map((m) =>
          m._gid === gid
            ? {
                role: "assistant",
                type: "guide",
                _gid: gid,
                guide: result?.guide,
                references: result?.references || [],
                guideTitle: axisLabel(result?.guide?.primary_focus) || "한 끗",
                guidePreview: result?.uploadUrl || previewUrl || null,
                guideFeedback: null,
                requestText: message, // ① 상세 §2 사용자 버블용
              }
            : m,
        ),
      );
      if (result?.guide) {
    const g = result.guide;
    const inputMode = (() => {
      if (file && (message || CONCERNS.includes(message))) return "text_image";
      if (file) return "image_only";
      if (message) return CONCERNS.includes(message) ? "chip_selected" : "text_only";
      return "text_only";
    })();

    track("guide_generated", {
      project_id: projectId,
      guide_id: g.guide_id || g.id || "",
      guide_category: g.category || g.primary_focus || "",
      guide_sub_category: g.sub_category || "",
      guide_title: g.title || axisLabel(g.primary_focus) || "",
      guide_keywords: Array.isArray(g.keywords) 
        ? g.keywords.join(",") 
        : (g.keywords || ""),
      input_mode: inputMode,
      has_image_uploaded: !!file,
      has_svg: !!(g.svg_id || g.svg_url),
      svg_id: g.svg_id || "",
      task_count: Array.isArray(g.tasks) ? g.tasks.length : 0,
      reference_count: result.references?.length || 0,
      generation_time_sec: Math.round((Date.now() - guideStartTime) / 1000),
      llm_model_used: g.llm_model_used || g.model || "",
    });

    // ↓ 추가 — guide_stage_context (같이 발화)
    track("guide_stage_context", {
      project_id: projectId,
      guide_id: g.guide_id || g.id || "",
      detected_stage: result.detectedStage || lastDetectedStage.current || "",
      user_declared_status: intent === "practice" ? "in_progress" : "completed",
      guide_category: g.category || g.primary_focus || "",
    });
  }
    } catch (err) {
      const msg =
        err.response?.data?.error?.message ||
        "가이드를 만들지 못했어요. 잠시 후 다시 시도해주세요.";
      setMessages((prev) =>
        prev.map((m) =>
          m._gid === gid
            ? { role: "assistant", type: "guideError", _gid: gid, error: msg }
            : m,
        ),
      );
    } finally {
      setGuideLoading(false);
    }

  };

  const retryGuide = () => {
    if (lastGuideArgs.current) handleGuideSubmit(lastGuideArgs.current);
  };

  // 채팅의 가이드 카드 클릭 → 전체 가이드 모달 열기(카드에 담아둔 결과 사용)
  const openGuideFromCard = (m) => {
    setGuideResult({
      guide: m.guide,
      references: m.references,
      requestText: m.requestText, // ① 상세 §2 사용자 버블
    });
    setGuidePreview(m.guidePreview || null);
    setGuideError("");
    setGuideOpen(true);
    setMode((cur) => (cur === "chatFull" ? "split" : cur)); // 좌측 패널 보이게
  };

  // 가이드 내 레퍼런스 묶음 피드백(👍 up / 👎 down / 🔄 refresh).
  //   up→liked, down→disliked 를 백엔드로 전송 → 현재 가이드가 보여준 레퍼런스(최대 3컷)에 기록.
  //   🔄(다른 레퍼런스 보기)는 별도 기능 — 후속.
  const handleRefFeedback = async (kind, refIds) => {
    const gid = guideResult?.guide?.guide_id;
    if (!gid || (kind !== "up" && kind !== "down")) return;
    try {
      await sendReferenceFeedback(
        projectId,
        gid,
        kind === "up" ? "liked" : "disliked",
        refIds || [],
      );
    } catch {
      // 피드백 실패는 사용자 흐름에 치명적이지 않음 — 조용히 무시.
    }
  };

  // 채팅 가이드 카드의 좋아요/싫어요. 로컬 토글 + 백엔드(guide_feedback) 반영.
  //   up→like, down→dislike, 같은 버튼 재클릭(해제)→null(행 삭제). 전송 실패는 조용히 무시(best-effort).
  const setGuideCardFeedback = (gidVal, kind) => {
    const msg = messages.find((m) => m._gid === gidVal && m.type === "guide");
    const nextKind = msg && msg.guideFeedback === kind ? null : kind; // 토글
    setMessages((prev) =>
      prev.map((m) =>
        m._gid === gidVal && m.type === "guide"
          ? { ...m, guideFeedback: nextKind }
          : m,
      ),
    );
    const guideId = msg?.guide?.guide_id;
    if (guideId) {
      const fb =
        nextKind === "up" ? "like" : nextKind === "down" ? "dislike" : null;
      sendGuideFeedback(projectId, guideId, fb).catch(() => {});
    }
  };

  const closeGuide = () => {
    setGuideOpen(false);
    setGuideResult(null);
    setGuideError("");
    setMode((cur) => (cur === "refFull" ? "split" : cur)); // 전체화면이었으면 채팅 복귀
  };

  const listRef = useRef(null);
  const textareaRef = useRef(null);
  const lastResponseTime = useRef(null);
  const attachAnchorRef = useRef(null); // 튜토리얼 코치마크 앵커 (첨부 버튼)
  const firstRefMenuRef = useRef(null); // 레퍼런스 반응 튜토리얼 앵커 (첫 카드 ... 메뉴)

  const pinnedIds = useMemo(
    () => new Set(pinnedRefs.map((r) => r.id)),
    [pinnedRefs],
  );

  const refreshPins = useCallback(async () => {
    try {
      const data = await getPins(projectId);
      setPinnedRefs(data?.pins ?? []);
    } catch (err) {
      console.error("핀 조회 실패", err);
    }
  }, [projectId]);

  const buttonViewedFired = useRef(false);

  const lastDetectedStage = useRef(null);
  const lastPromptLength = useRef(0);

  // 현재 프로젝트의 아카이브 저장 목록 로드 (카드 메뉴 "아카이브됨" 표시용)
  useEffect(() => {
    if (!projectId) return;
    let alive = true;
    (async () => {
      try {
        const data = await getReferenceArchive();
        if (!alive) return;
        const section = (data?.sections ?? []).find(
          (s) => String(s.projectId) === String(projectId),
        );
        setArchivedIds(
          new Set((section?.references ?? []).map((r) => r.imageId)),
        );
      } catch {
        // 상태표시는 부가 정보 — 실패해도 무시
      }
    })();
    return () => {
      alive = false;
    };
  }, [projectId]);

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
    const initSession = async () => {
      // localStorage에 이미 있으면 그대로 사용
      const stored = localStorage.getItem(sessionKey(projectId));
      if (stored) {
        setSessionId(stored);
        return;
      }

      // 없으면 서버에서 최신 세션 조회
      try {
        const data = await getLatestSession(projectId);
        if (data?.sessionId) {
          localStorage.setItem(sessionKey(projectId), data.sessionId);
          setSessionId(data.sessionId);
        }
      } catch {
        // 세션 없으면 새로 시작 (무시)
      }
    };
    initSession();
  }, [projectId]);

  useEffect(() => {
    // ★가이드 복원은 세션과 무관(프로젝트 단위 영속)하므로 sessionId 가 아니라 projectId 로 게이트한다.
    //   이전엔 if(!sessionId) return 이 getGuides 까지 막아, 채팅 없이 가이드만 한 프로젝트에서
    //   영속된 가이드가 새로고침 시 복원되지 않았다(이슈 B). getHistory 만 세션 조건부로 돌린다.
    if (!projectId) return;
    const fetchAll = async () => {
      // 1) 채팅 히스토리 — 세션 있을 때만. 없으면 빈 배열(가이드-우선 흐름).
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
            // 백엔드 isAi 필드 추가 전 임시 휴리스틱:
            // assistant가 보낸 imageUrl은 generate-image 경로뿐이라 AI로 간주
            isAi: m.isAi ?? (m.role === "assistant" && !!m.imageUrl),
          }));
        } catch (err) {
          if (err.response?.status === 404) {
            // stale 세션(대화 초기화·세션 정리로 삭제됨) — localStorage 를 비우고 서버의 최신
            //   세션으로 재해결한다. 폴백 없이 null 만 두면, DB 에 유효 세션·메시지가 있어도
            //   initSession 이 재실행되지 않아(deps [projectId]) 채팅이 복원되지 않는다.
            localStorage.removeItem(sessionKey(projectId));
            try {
              const latest = await getLatestSession(projectId);
              if (latest?.sessionId && latest.sessionId !== sessionId) {
                localStorage.setItem(sessionKey(projectId), latest.sessionId);
                setSessionId(latest.sessionId); // → fetchAll 재실행 → 유효 세션 복원
              } else {
                setSessionId(null);
              }
            } catch {
              setSessionId(null);
            }
          }
        }
      }

      // 2) 영속된 가이드 — 세션 무관, projectId 단위로 항상 복원. 각 항목에 createdAt + uploadUrl.
      //    사용자 질문(requestText)이 있으면 가이드 카드 앞에 주황 말풍선을 재구성한다
      //    (라이브 전송 순서 user→assistant 를 복원에서도 보존). 빈 값이면 말풍선 생략.
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
            const userBubble = {
              role: "user",
              content: g.requestText,
              imageUrl: g.uploadUrl ?? null,
              createdAt: g.createdAt ?? null,
            };
            return [userBubble, card];
          });
        }
      } catch {
        /* 가이드 복원 실패는 치명적이지 않음 — 채팅은 그대로 둔다. */
      }

      // 3) ★채팅 + 가이드를 createdAt 시간순으로 *한 번에* 병합해 set(REPLACE/APPEND 레이스 제거).
      //    타임스탬프 없는 항목은 0(맨 앞). sort 는 안정 정렬이라 동시각 순서 보존.
      setMessages(
        [...restored, ...guideCards].sort(
          (a, b) =>
            (a.createdAt ? Date.parse(a.createdAt) : 0) -
            (b.createdAt ? Date.parse(b.createdAt) : 0),
        ),
      );

      // 4) 참고작 프리필 — 복원된 채팅 중 마지막 references.
      const lastWithReferences = [...restored]
        .reverse()
        .find((m) => m.references && m.references.length > 0);
      if (lastWithReferences) {
        setReferences(lastWithReferences.references);
      }
    };
    fetchAll();
  }, [projectId, sessionId]);

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages]);

  useEffect(() => {
    if (!projectId) return;
    refreshPins();
  }, [projectId, refreshPins]);

  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    const next = Math.min(el.scrollHeight, MAX_INPUT_HEIGHT);
    el.style.height = `${next}px`;
  }, [input]);

  useEffect(() => {
    if (!pinError) return;
    const t = setTimeout(() => setPinError(""), 4000);
    return () => clearTimeout(t);
  }, [pinError]);

  useEffect(() => {
    const isVisible = followUp?.type === "OFFER_GENERATE" && !sending;

    if (isVisible && !buttonViewedFired.current) {
      buttonViewedFired.current = true;
      track("prompt_image_generation_button_viewed", {
        iteration_count: messages.filter((m) => m.role === "user").length,
        project_id: projectId,
      });
    }

    if (!isVisible) {
      buttonViewedFired.current = false; // 다음 노출 위해 리셋
    }
  }, [followUp, sending, messages, projectId]);

  useEffect(() => {
    if (!lightboxSrc) return;
    const onKey = (e) => {
      if (e.key === "Escape") setLightboxSrc(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightboxSrc]);

  // 새로 만든 프로젝트에서 레퍼런스가 처음 생성/노출되고,
  // 보드가 보이는 화면(프롬프트 전체화면 아님)일 때 노출.
  // chatFull(프롬프트만 전체화면)이면 보류 → split/refFull 로 전환되면 노출.
  useEffect(() => {
    if (localStorage.getItem("drawe_show_reaction_tutorial") !== projectId)
      return;
    if (showTutorial) return; // 첨부 튜토리얼과 동시 노출 방지
    const boardVisible = mode !== "chatFull";
    if (references.length > 0 && boardVisible) {
      setShowReactionTutorial(true);
    }
  }, [references, mode, showTutorial, projectId]);

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

    const userMessageCount = messages.filter((m) => m.role === "user").length;
    const currentIteration = userMessageCount + 1;
    const isFirstSubmission = userMessageCount === 0;
    const inputMode = sentAttachment ? "text_image" : "text";

    if (isFirstSubmission) {
      // 첫 제출 — 첨부 없는 텍스트 제출만 추적
      if (!sentAttachment) {
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
      console.log("=== sendMessage 응답 ===", res); 

      if (res?.sessionId && res.sessionId !== sessionId) {
        setSessionId(res.sessionId);
        localStorage.setItem(sessionKey(projectId), res.sessionId);
      }

      if (res?.detectedStage) {
      track("prompt_stage_detected", {
        project_id: projectId,
        detected_stage: res.detectedStage,
        previous_stage: lastDetectedStage.current,
        stage_changed: lastDetectedStage.current !== res.detectedStage,
        confidence_score: res.confidenceScore ?? null,
        input_mode: inputMode,
        prompt_length: text.length,
      });
    }

    // 이미지 업로드 + 감지 단계가 있을 때 발화
    if (sentAttachment && res?.detectedStage) {
      track("drawing_progress_detected", {
        project_id: projectId,
        detected_stage: res.detectedStage,
        previous_stage: lastDetectedStage.current,
        stage_changed: lastDetectedStage.current !== res.detectedStage,
        confidence_score: res.confidenceScore ?? null,
        image_id: sentAttachment.id || sentAttachment.url || "",
        guide_id: res.guide?.guide_id || res.guide?.id || "",
      });
    }

    // stage 업데이트 (다음 이벤트의 previous_stage 계산용)
    if (res?.detectedStage) {
      lastDetectedStage.current = res.detectedStage;
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

      // ↓ 추가 — 이미지 생성 조건 충족 시
      if (res.offerGenerate) {
        const previousAssistant = [...messages]
          .reverse()
          .find((m) => m.role === "assistant");
        const firstType =
          previousAssistant?.references?.length > 0 ? "reference" : "guide";

        track("prompt_image_generation_button_eligible", {
          first_response_type: firstType,
          second_response_type: "guide", // offerGenerate면 현재 응답은 guide
          button_shown: true,
          project_id: projectId,
        });
      }

      if (res?.detectedStage) {
        // 백엔드 응답에 이 필드 와야 함
        track("prompt_stage_detected", {
          detected_stage: res.detectedStage,
          previous_stage: lastDetectedStage.current,
          stage_changed: lastDetectedStage.current !== res.detectedStage,
          confidence_score: res.confidenceScore || null,
          input_mode: inputMode,
          prompt_length: text.length,
          project_id: projectId,
        });
        lastDetectedStage.current = res.detectedStage;
      }

      if (action === "NEW_SEARCH" && newRefs.length > 0) {
        setReferences(newRefs);
        setJustUpdated(true);
        setTimeout(() => setJustUpdated(false), 2500);
      }
      // 응답 타입 계산
      const responseType =
        action === "NEW_SEARCH" && newRefs.length > 0 ? "reference" : "guide";
      track("prompt_response_loaded", {
        project_id: projectId,
        input_mode: inputMode,
        response_type: responseType,
        reference_count: responseType === "reference" ? newRefs.length : 0,
        generation_time_ms: Date.now() - responseStartTime,
        iteration_count: currentIteration,
        reference_ids:
          responseType === "reference"
            ? newRefs.map((r) => r.id).join(",")
            : "",
      });

      lastResponseTime.current = Date.now();
      // ↑↑↑ 응답 도착 트래킹 끝 ↑↑↑

      // KEEP, SKIP, 또는 NEW_SEARCH인데 빈 배열: 이전 references 유지 (아무것도 안 함)
    } catch (err) {
      const status = err.response?.status;
      let message = err.response?.data?.error?.message;
      if (status === 503) {
        message = "잠깐 DRAWE가 바빠요. 다시 한 번 보내볼까요?";
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

  // 완성하기 — 정본: 파일 업로드 없이 status=COMPLETED 만. 백엔드가 최근 가이드 업로드를 대표 이미지로
  //   자동 지정 → 완성작 갤러리에 담긴다(뜬금없는 파일첨부창 없음).
  const handleComplete = async () => {
    if (completing) return;
    setCompleting(true);
    try {
      await updateProject(projectId, { status: "COMPLETED" });
      setProject((prev) => (prev ? { ...prev, status: "completed" } : prev));
      track("project_completed", { project_id: projectId });
      alert("완성작 갤러리에 담았어요!");
    } catch (e2) {
      const message =
        e2.response?.data?.error?.message ||
        "완성 처리에 실패했어요. 다시 시도해주세요.";
      alert(message);
    } finally {
      setCompleting(false);
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
      setJustUpdated(false);
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
    // ↓ 추가 — 생성 요청 트래킹
    track("prompt_image_generation_clicked", {
      prompt_length: lastUser.content.length,
      project_id: projectId,
    });
    const generateStartTime = Date.now();
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
      // ↓ 추가 — 생성 완료 트래킹
      track("prompt_image_generated", {
        generation_time_ms: Date.now() - generateStartTime,
        project_id: projectId,
      });
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
          : err.response?.data?.error?.message || "이미지 생성에 실패했어요.";
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

  const handleCardClick = (reference, position) => {
    track("prompt_reference_viewed", {
      reference_id: reference.id,
      reference_tags: reference?.tags?.join(",") || "",
      reference_position: position,
      project_id: projectId,
    });
    // 현재 iteration / input_mode 캡처
    const userMessageCount = messages.filter((m) => m.role === "user").length;
    const lastUserMessage = [...messages]
      .reverse()
      .find((m) => m.role === "user");
    const lastInputMode = lastUserMessage?.imageUrl ? "text_image" : "text";
    navigate(`/projects/${projectId}/reference/${reference.id}`, {
      state: {
        reference,
        position, // ← 추가
        iterationCount: userMessageCount, // ← 추가
        inputMode: lastInputMode, // ← 추가
      },
    });
  };

  const handlePinToggle = async (imageId) => {
    const wasPinned = pinnedIds.has(imageId);
    const snapshot = [...pinnedRefs];
    // 트래킹용 — 핀 시작 시각 기록 (localStorage)
    const pinKey = `pin_time_${imageId}`;

    if (wasPinned) {
      setPinnedRefs((prev) => prev.filter((r) => r.id !== imageId));
    } else {
      const ref = references.find((r) => r.id === imageId);
      if (ref) setPinnedRefs((prev) => [...prev, ref]);
    }

    try {
      if (wasPinned) {
        await removePin(projectId, imageId);
        // ↓ 핀 해제 트래킹
        const pinStartTime = parseInt(localStorage.getItem(pinKey) || "0");
        track("prompt_reference_unpinned", {
          reference_id: imageId,
          time_pinned_sec: pinStartTime
            ? Math.floor((Date.now() - pinStartTime) / 1000)
            : 0,
          project_id: projectId,
        });
        localStorage.removeItem(pinKey);
      } else {
        await addPin(projectId, imageId);

        // ↓ 핀 적용 트래킹
        const refIdx = references.findIndex((r) => r.id === imageId);
        const ref = references.find((r) => r.id === imageId); // ← 추가 (태그 꺼내려고)
        const userMessageCount = messages.filter(
          (m) => m.role === "user",
        ).length;
        const lastUserMessage = [...messages]
          .reverse()
          .find((m) => m.role === "user");
        const lastInputMode = lastUserMessage?.imageUrl ? "text_image" : "text";

        // 현재 피드백 상태는 카드 컴포넌트에 있어서 여기선 모름 → 'none'으로 처리
        track("prompt_reference_pinned", {
          reference_id: imageId,
          reference_position: refIdx >= 0 ? refIdx + 1 : 0,
          reference_tags: ref?.tags?.join(",") || "", // ← 추가
          feedback_type: "none", // 카드 안에서 안 보임 — 일단 none
          iteration_count: userMessageCount,
          input_mode: lastInputMode,
          project_id: projectId,
        });

        localStorage.setItem(pinKey, Date.now().toString());
      }
      await refreshPins();
    } catch (err) {
      setPinnedRefs(snapshot);
      if (err.response?.status === 409) {
        setPinError("(3/3) 핀 슬롯이 가득 찼어요. 다른 핀을 먼저 풀어주세요.");
      } else {
        setPinError(err.response?.data?.error?.message || "핀 처리 실패");
      }
    }
  };

  // 레퍼런스 카드 ⋮ → 아카이브에 저장
  const handleArchiveReference = async (imageId) => {
    try {
      await addReference(projectId, imageId);
      setArchivedIds((prev) => new Set(prev).add(imageId));
      notifyArchiveChanged();
      track("reference_archived", {
        reference_id: imageId,
        project_id: projectId,
      });
      alert("아카이브에 저장했어요!");
    } catch (err) {
      alert(
        err.response?.data?.error?.message ||
          "저장에 실패했어요. 다시 시도해주세요.",
      );
    }
  };

  const goToChatFull = () => setMode("chatFull");
  const goToRefFull = () => setMode("refFull");
  const goToSplit = () => setMode("split");

  // 모아보기용 가이드 목록 = 복원/생성된 guide 카드 메시지. 1건+ 있을 때만 진입 아이콘 노출.
  const guideMessages = messages.filter((m) => m.type === "guide");
  const hasGuides = guideMessages.length > 0;

  return (
    <div className={styles.layout}>
      {/* 페이지 헤더 — 상단 전체 */}
      <header className={styles.pageHeader}>
        <Tooltip label="뒤로가기" placement="bottom">
          <button
            type="button"
            className={styles.iconBtn}
            onClick={() => navigate("/projects")}
            aria-label="뒤로가기"
          >
            <BackIcon />
          </button>
        </Tooltip>
        <h1 className={styles.pageTitle}>{project?.name ?? "..."}</h1>
        {hasGuides && (
          <Tooltip label="가이드 모아보기" placement="bottom">
            <button
              type="button"
              className={`${styles.iconBtn} ${
                guideListOpen ? styles.iconBtnActive : ""
              }`}
              onClick={() => setGuideListOpen((o) => !o)}
              aria-label="가이드 모아보기"
              aria-pressed={guideListOpen}
            >
              <GuideCollectionIcon />
            </button>
          </Tooltip>
        )}
        <Tooltip label="대화 초기화" placement="bottom">
          <button
            type="button"
            className={styles.iconBtn}
            onClick={handleReset}
            disabled={!sessionId}
            aria-label="대화 초기화"
          >
            <DotsIcon />
          </button>
        </Tooltip>
      </header>

      {/* 본문 — 좌/우 분할 */}
      <div className={styles.body}>
        {/* 좌측: 레퍼런스 — 항상 mount, hidden 클래스로 숨김 처리 */}
        <aside
          className={`${styles.leftPanel} ${
            mode === "chatFull" ? styles.panelHidden : ""
          }`}
        >
          <ReferenceGrid
            references={references}
            loading={sending}
            justUpdated={justUpdated}
            pinnedRefs={pinnedRefs}
            pinnedIds={pinnedIds}
            pinError={pinError}
            onClearPinError={() => setPinError("")}
            onPinToggle={handlePinToggle}
            onCardClick={handleCardClick}
            onArchive={handleArchiveReference}
            archivedIds={archivedIds}
            expanded={mode === "refFull"}
            firstMenuRef={firstRefMenuRef}
          />
          {/* 가이드 — 떠 있는 모달이 아니라 좌측 패널을 덮어서 표시(분할/전체화면) */}
          {guideOpen && (
            <div className={styles.guideInlineWrap}>
              <GuideContent
                result={guideResult}
                loading={guideLoading}
                error={guideError}
                drawingPreviewUrl={guidePreview}
                onClose={closeGuide}
                onRetry={retryGuide}
                onRefFeedback={handleRefFeedback}
                onGuideFeedback={(kind) => {
                  // 열린 가이드(guideResult)에 해당하는 카드 메시지를 guide_id 로 찾아 토글
                  //   (기존 setGuideCardFeedback 재사용 — 백엔드 guide_feedback 반영).
                  const gid = guideResult?.guide?.guide_id;
                  const msg = messages.find(
                    (m) => m.type === "guide" && m.guide?.guide_id === gid,
                  );
                  if (msg) setGuideCardFeedback(msg._gid, kind);
                }}
                guideFeedback={
                  messages.find(
                    (m) =>
                      m.type === "guide" &&
                      m.guide?.guide_id === guideResult?.guide?.guide_id,
                  )?.guideFeedback ?? null
                }
                onToggleFull={() =>
                  setMode((cur) => (cur === "refFull" ? "split" : "refFull"))
                }
                isFull={mode === "refFull"}
                projectId={projectId}
              />
            </div>
          )}
        </aside>

        {/* 우측: 채팅 */}
        <section
          className={`${styles.rightPanel} ${
            mode === "refFull" ? styles.panelHidden : ""
          }`}
        >
          <div className={styles.chatContainer}>
            {/* 채팅 상단 컨트롤 */}
            <div className={styles.chatTop}>
              {mode === "split" && (
                <>
                  <Tooltip label="전체화면 보기" placement="bottom">
                    <button
                      className={styles.iconBtn}
                      onClick={goToChatFull}
                      aria-label="전체화면 보기"
                    >
                      <ExpandIcon />
                    </button>
                  </Tooltip>
                  <Tooltip label="닫기" placement="bottom">
                    <button
                      className={styles.iconBtn}
                      onClick={goToRefFull}
                      aria-label="닫기"
                    >
                      <MinimizeIcon />
                    </button>
                  </Tooltip>
                </>
              )}
              {mode === "chatFull" && (
                <>
                  <span />
                  <Tooltip label="분할 보기" placement="bottom">
                    <button
                      className={styles.iconBtn}
                      onClick={goToSplit}
                      aria-label="분할 보기"
                    >
                      <CollapseIcon />
                    </button>
                  </Tooltip>
                </>
              )}
            </div>

            {/* 메시지 / 빈 상태 */}
            <div className={styles.messagesScroll} ref={listRef}>
              <div className={styles.messages}>
                {messages.length === 0 ? (
                  <div className={styles.empty}>
                    <img className={styles.emptyLogo} src={logo} alt="" />
                    <h2 className={styles.emptyTitle}>
                      오늘은 어떤 도움이 필요하신가요?
                    </h2>
                    <p className={styles.emptyHint}>
                      작성하신 프로젝트 주제를 바탕으로 이런 가이드를 해드릴 수
                      있어요.
                    </p>
                  </div>
                ) : (
                  messages.map((m, idx) => {
                    // 가이드 로딩 placeholder
                    if (m.type === "guideLoading") {
                      return (
                        <div key={idx} className={styles.assistantMessage}>
                          <div className={styles.assistantBubble}>
                            <img
                              className={styles.assistantLogo}
                              src={logo}
                              alt=""
                            />
                            한 끗 가이드를 만들고 있어요…
                          </div>
                        </div>
                      );
                    }
                    // 가이드 실패 + 인라인 재시도
                    if (m.type === "guideError") {
                      return (
                        <div key={idx} className={styles.assistantMessage}>
                          <div className={styles.assistantBubble}>
                            <img
                              className={styles.assistantLogo}
                              src={logo}
                              alt=""
                            />
                            <div>
                              {m.error}
                              <button
                                type="button"
                                className={styles.followUpBtn}
                                style={{ marginTop: 8 }}
                                onClick={retryGuide}
                              >
                                다시 시도
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    }
                    // 가이드 카드(채팅 반영) — 클릭 시 전체 보기, 아래 좋아요/싫어요/PDF
                    if (m.type === "guide") {
                      // 채팅 인라인 AI 발화 = 이 그림 '한 줄 피드백'(결정론). 백엔드가 조립한
                      //   chat_feedback(현재 그림 진단 + 사용자 의도 진입, 성장 없음)을 우선 쓴다.
                      //   없으면(구버전 응답 등) 현재 그림 관찰로 폴백. ★성장(next_steps.note/synthesis)은
                      //   더 이상 채팅에 안 끌어옴 — 성장 흐름은 한 끗 상세 모달에만.
                      const g = m.guide || {};
                      // clarify/redirect 등 비-coach 응답은 chat_feedback·blocks 가 없으므로
                      //   안내 문구(message)를 채팅에도 한 줄 띄운다(빈 버블 침묵 해소).
                      const utterance =
                        g.chat_feedback ||
                        g.blocks?.[0]?.observation ||
                        (g.mode !== "coach" ? g.message : "") ||
                        "";
                      return (
                        <div key={idx} className={styles.assistantMessage}>
                          {utterance && (
                            <div className={styles.assistantBubble}>
                              <img
                                className={styles.assistantLogo}
                                src={logo}
                                alt=""
                              />
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
                                <span className={styles.guideCardSub}>
                                  가이드 보기
                                </span>
                              </span>
                              <ChevronRightIcon />
                            </span>
                          </button>
                          <div className={styles.guideActions}>
                            <button
                              type="button"
                              className={styles.guideActBtn}
                              aria-label="PDF 다운로드"
                              onClick={() =>
                                downloadGuidePdf(
                                  { guide: m.guide, references: m.references },
                                  m.guidePreview,
                                )
                              }
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
                              onClick={() =>
                                setGuideCardFeedback(m._gid, "down")
                              }
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
                          m.role === "user"
                            ? styles.userMessage
                            : styles.assistantMessage
                        }
                      >
                        {/* 이미지 묶음 — 배경 없이 */}
                        {(m.localPreviewUrl || m.imageUrl) && (
                          <div className={styles.messageImages}>
                            <div
                              className={`${styles.imageWrap} ${
                                m.isAi ? styles.imageWrapAi : ""
                              }`}
                            >
                              <AuthedImage
                                src={m.localPreviewUrl || m.imageUrl}
                                alt={
                                  m.isAi ? "AI로 생성된 이미지" : "첨부 이미지"
                                }
                                className={
                                  m.isAi ? styles.aiImage : styles.bubbleImage
                                }
                                onClick={() =>
                                  setLightboxSrc(
                                    m.localPreviewUrl || m.imageUrl,
                                  )
                                }
                              />
                              {m.isAi && (
                                <span
                                  className={styles.aiBadge}
                                  aria-label="AI로 생성된 이미지"
                                >
                                  ✨ AI
                                </span>
                              )}
                            </div>
                          </div>
                        )}

                        {/* 텍스트 버블 */}
                        {m.content && (
                          <div
                            className={
                              m.role === "user"
                                ? styles.userBubble
                                : styles.assistantBubble
                            }
                          >
                            {m.role !== "user" && (
                              <img
                                className={styles.assistantLogo}
                                src={logo}
                                alt=""
                              />
                            )}
                            <div>{m.content}</div>
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
                {sending && !messages.some((m) => m._generating) && (
                  <div className={styles.assistantBubble}>
                    <img className={styles.assistantLogo} src={logo} alt="" />
                    응답을 작성 중...
                  </div>
                )}
              </div>
            </div>

            {followUp && !sending && (
              <div className={styles.followUp}>
                {followUp.type === "OFFER_GENERATE" ? (
                  <button
                    type="button"
                    className={styles.generateBtn}
                    onClick={handleGenerateImage}
                  >
                    ✨ AI 이미지 만들기
                  </button>
                ) : (
                  <button
                    type="button"
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
              {/* 액션 칩 줄 — 프로젝트 완료(완성작 갤러리에 담기, 파일 업로드 없음) */}
              <div className={styles.actionChips}>
                <button
                  type="button"
                  className={styles.completeChip}
                  onClick={handleComplete}
                  disabled={completing}
                  title="완성작 갤러리에 담아요"
                >
                  <CompleteIcon />
                  <span>
                    {completing
                      ? "완료 중…"
                      : project?.status === "completed"
                        ? "다시 완료하기"
                        : "프로젝트 완료"}
                  </span>
                </button>
              </div>

              {/* 첨부 미리보기 — 있을 때만 위쪽에 표시 */}
              {attachment && (
                <div className={styles.attachmentPreviews}>
                  <div className={styles.previewItem}>
                    <img
                      src={attachment.previewUrl}
                      alt="첨부"
                      className={styles.previewImage}
                    />
                    <button
                      type="button"
                      className={styles.previewRemove}
                      onClick={() => setAttachment(null)}
                      aria-label="첨부 제거"
                    >
                      <CloseIcon />
                    </button>
                  </div>
                </div>
              )}

              {/* 입력 줄 — 클립 + textarea + 전송 */}
              <div className={styles.inputRow}>
                <span ref={attachAnchorRef} className={styles.attachAnchor}>
                  <AttachmentPicker
                    onClick={() => setGuideFormOpen(true)}
                    disabled={sending}
                  />
                </span>
                <textarea
                  ref={textareaRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="어떻게 도와드릴까요?"
                  className={styles.input}
                  disabled={sending}
                  rows={1}
                />
                <button
                  type="submit"
                  className={styles.sendBtn}
                  disabled={sending || (!input.trim() && !attachment)}
                  aria-label="전송"
                >
                  <SendIcon />
                </button>
              </div>
            </form>
          </div>

          {/* 가이드 모아보기 — 채팅 위 오버레이(뒤 채팅 유지) */}
          {guideListOpen && hasGuides && (
            <GuideCollectionPanel
              guides={guideMessages}
              onClose={() => setGuideListOpen(false)}
              onCardClick={(g) => {
                setGuideListOpen(false);
                openGuideFromCard(g);
              }}
            />
          )}
        </section>
      </div>

      {/* FAB — 항상 mount, 클래스로 토글 */}
      <div
        className={`${styles.fabTip} ${
          mode === "refFull" ? styles.fabTipVisible : ""
        }`}
      >
        <Tooltip label="DraWe에게 질문하기" placement="top">
          <button
            type="button"
            className={styles.fab}
            onClick={goToSplit}
            aria-label="DraWe에게 질문하기"
          >
            <img className={styles.fabIcon} src={logo} alt="" />
          </button>
        </Tooltip>
      </div>

      {/* 첫 프로젝트 진입 튜토리얼 */}
      {showTutorial && (
        <TutorialCoachmark
          anchorRef={attachAnchorRef}
          onClose={dismissTutorial}
          step="1 of 1"
        />
      )}

      {/* 레퍼런스 반응 튜토리얼 — 첫 카드 ... 메뉴 오른쪽 */}
      {showReactionTutorial && (
        <TutorialCoachmark
          anchorRef={firstRefMenuRef}
          onClose={dismissReactionTutorial}
          placement="right"
          variant="reaction"
          gap={8}
          step="1 of 1"
          title="반응할수록 더 정확해져요"
          description="고정하기, 마음에 들어요, 별로예요 등의 반응을 통해 학습하고 더 정확한 레퍼런스를 제공할 수 있어요."
        />
      )}

      {/* 이미지 확대 라이트박스 */}
      {lightboxSrc && (
        <div
          className={styles.lightboxBackdrop}
          onClick={() => setLightboxSrc(null)}
          role="dialog"
          aria-modal="true"
          aria-label="이미지 확대 보기"
        >
          <button
            type="button"
            className={styles.lightboxClose}
            onClick={() => setLightboxSrc(null)}
            aria-label="닫기"
          >
            <CloseIcon />
          </button>
          <AuthedImage
            src={lightboxSrc}
            alt="확대된 이미지"
            className={styles.lightboxImage}
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}

      {guideFormOpen && (
        <GuideForm
          onSubmit={handleGuideSubmit}
          onClose={() => setGuideFormOpen(false)}
          submitting={guideLoading}
        />
      )}
    </div>
  );
};

/* ===== 아이콘 ===== */
const BackIcon = () => (
  <svg
    width="12"
    height="20"
    viewBox="0 0 12 20"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path
      d="M10 20L0 10L10 0L11.775 1.775L3.55 10L11.775 18.225L10 20Z"
      fill="#4A4846"
    />
  </svg>
);

// 가이드 모아보기 진입 — 겹친 카드(컬렉션) 글리프
const GuideCollectionIcon = () => (
  <svg
    width="22"
    height="22"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <rect x="3" y="7" width="14" height="14" rx="2" />
    <path d="M7 7V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-2" />
  </svg>
);

const ExpandIcon = () => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 18 18"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path
      d="M0 18V13H2V16H5V18H0ZM13 18V16H16V13H18V18H13ZM0 5V0H5V2H2V5H0ZM16 5V2H13V0H18V5H16Z"
      fill="#4A4846"
    />
  </svg>
);

const CollapseIcon = () => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 18 18"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path
      d="M3 0H5V5H0V3H3V0ZM13 0H15V3H18V5H13V0ZM0 13H5V18H3V15H0V13ZM15 18V15H18V13H13V18H15Z"
      fill="#4A4846"
    />
  </svg>
);

const MinimizeIcon = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 14 14"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path
      d="M0 14L5 7L0 0H2.45L7.45 7L2.45 14H0ZM5.95 14L10.95 7L5.95 0H8.4L13.4 7L8.4 14H5.95Z"
      fill="#4A4846"
    />
  </svg>
);

const CompleteIcon = () => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.4"
    strokeLinecap="round"
    strokeLinejoin="round"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path d="M20 6L9 17l-5-5" />
  </svg>
);

const DotsIcon = () => (
  <svg
    width="4"
    height="16"
    viewBox="0 0 4 16"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path
      d="M2 16C1.45 16 0.979167 15.8042 0.5875 15.4125C0.195833 15.0208 0 14.55 0 14C0 13.45 0.195833 12.9792 0.5875 12.5875C0.979167 12.1958 1.45 12 2 12C2.55 12 3.02083 12.1958 3.4125 12.5875C3.80417 12.9792 4 13.45 4 14C4 14.55 3.80417 15.0208 3.4125 15.4125C3.02083 15.8042 2.55 16 2 16ZM2 10C1.45 10 0.979167 9.80417 0.5875 9.4125C0.195833 9.02083 0 8.55 0 8C0 7.45 0.195833 6.97917 0.5875 6.5875C0.979167 6.19583 1.45 6 2 6C2.55 6 3.02083 6.19583 3.4125 6.5875C3.80417 6.97917 4 7.45 4 8C4 8.55 3.80417 9.02083 3.4125 9.4125C3.02083 9.80417 2.55 10 2 10ZM2 4C1.45 4 0.979167 3.80417 0.5875 3.4125C0.195833 3.02083 0 2.55 0 2C0 1.45 0.195833 0.979167 0.5875 0.5875C0.979167 0.195833 1.45 0 2 0C2.55 0 3.02083 0.195833 3.4125 0.5875C3.80417 0.979167 4 1.45 4 2C4 2.55 3.80417 3.02083 3.4125 3.4125C3.02083 3.80417 2.55 4 2 4Z"
      fill="#1C1B1F"
    />
  </svg>
);

const SendIcon = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 16 16"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path
      d="M7 16V3.825L1.4 9.425L0 8L8 0L16 8L14.6 9.425L9 3.825V16H7Z"
      fill="#FCFBFA"
    />
  </svg>
);

const CloseIcon = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 14 14"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path
      d="M1.4 14L0 12.6L5.6 7L0 1.4L1.4 0L7 5.6L12.6 0L14 1.4L8.4 7L14 12.6L12.6 14L7 8.4L1.4 14Z"
      fill="currentColor"
    />
  </svg>
);

/* ===== 가이드 카드 아이콘 ===== */
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

export default ChatPage;
