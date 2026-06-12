import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useNavigate, useParams } from "react-router-dom";
import { getProject } from "../projects/api";
import {
  addPin,
  generateImage,
  getHistory,
  getLatestSession,
  getPins,
  removePin,
  resetSession,
  sendMessage,
  uploadImage,
} from "./api";
import { resizeImage } from "./imageUtils";
import ReferenceGrid from "./ReferenceGrid";
import AttachmentPicker from "./AttachmentPicker";
import AuthedImage from "./AuthedImage";
import TutorialCoachmark from "./TutorialCoachmark";
import GuideRequestModal from "./GuideRequestModal";
import GuidePanel from "./GuidePanel";
import { getRoadmap, adoptReference } from "./guideApi";
import { labelOf } from "./guideLabels";
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

const GENERATE_INTENT_PATTERN = /만들|그려|생성|AI|이미지/i;
const looksLikeGenerateRequest = (text) =>
  !!text && GENERATE_INTENT_PATTERN.test(text);

// 채팅 응답에서 한 끗 가이드 데이터를 정규화해서 꺼낸다.
// TODO(백엔드 통합): 응답 형태는 woz(artcoach) 프로토타입을 가정한 것이다.
//   백엔드가 가이드를 어떤 키로 실어 줄지(res.guide vs mode:"coach" vs 별도 필드) 확정되면
//   여기 매핑만 맞추면 GuidePanel/가이드 카드가 그대로 동작한다. 가이드가 아니면 null.
const extractGuide = (res, imageUrl, fallbackRefs) => {
  const g = res?.guide || (res?.mode === "coach" ? res : null);
  if (!g) return null;
  const b = (g.blocks && g.blocks[0]) || {};
  const ns = g.next_steps || {};
  const focusKey = g.primary_focus || ns.focus;
  const goalKey = ns.next_goal || ns.focus;
  const blockRefs = (b.reference_ids || []).map((id) => ({ id }));
  return {
    guideId: g.guide_id || "",
    title: g.title || labelOf(focusKey),
    focusLabel: labelOf(focusKey),
    imageUrl,
    observation: b.observation,
    effect: b.effect,
    direction: b.direction || g.one_thing,
    guideAsset: b.guide_asset?.ref_id
      ? {
          refId: b.guide_asset.ref_id,
          label: b.guide_asset.label,
          caption: b.guide_asset.caption,
        }
      : null,
    references: blockRefs.length ? blockRefs : fallbackRefs || [],
    nextGoal: goalKey
      ? {
          key: goalKey,
          label: labelOf(goalKey),
          practice: ns.next_goal_practice || ns.focus_practice || g.one_thing,
        }
      : null,
  };
};

const ChatPage = () => {
  const { projectId } = useParams();
  const navigate = useNavigate();

  const [project, setProject] = useState(null);
  const [messages, setMessages] = useState([]);
  const [sessionId, setSessionId] = useState(null);

  const [input, setInput] = useState("");
  const [followUp, setFollowUp] = useState(null);
  const [sending, setSending] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [attachment, setAttachment] = useState(null);

  // 한 끗 가이드 입력 모달 (첨부 버튼으로 열림)
  const [guideOpen, setGuideOpen] = useState(false);
  const [guideSubmitting, setGuideSubmitting] = useState(false);

  // 채팅 가이드 카드 클릭 시 좌측 패널에 뜨는 전체 가이드
  const [activeGuide, setActiveGuide] = useState(null);
  const [guideGrowth, setGuideGrowth] = useState(undefined); // undefined=로딩, null=미제공

  const openGuide = useCallback(
    async (guide) => {
      setActiveGuide(guide);
      setGuideGrowth(undefined);
      try {
        // 성장 흐름은 별도 조회 (백엔드 미통합이면 null 반환 → 섹션 숨김)
        const data = await getRoadmap(projectId);
        setGuideGrowth(data ?? null);
      } catch {
        setGuideGrowth(null);
      }
    },
    [projectId],
  );

  const handleGuideReact = useCallback((guideId, refId, kind) => {
    if (!kind) return; // 취소는 로깅 안 함
    adoptReference({
      guideId,
      referenceId: refId,
      event: kind === "like" ? "liked" : "disliked",
    });
  }, []);

  const [references, setReferences] = useState([]);
  const [justUpdated, setJustUpdated] = useState(false);

  const [pinnedRefs, setPinnedRefs] = useState([]);
  const [pinError, setPinError] = useState("");

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

  // override: 한 끗 가이드 모달이 직접 전송할 때 state 대신 명시적으로 넘긴다.
  //   { text, attachment, intent, medium }
  const handleSend = async (e, override) => {
    e?.preventDefault?.();
    const text = (override?.text ?? input).trim();
    const sentAttachment = override?.attachment ?? attachment;
    if ((!text && !sentAttachment) || sending) return;

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
        // 가이드 모달에서 온 경우에만 채워짐 (백엔드 의도 분류용)
        intent: override?.intent,
        medium: override?.medium,
      });
      if (res?.sessionId && res.sessionId !== sessionId) {
        setSessionId(res.sessionId);
        localStorage.setItem(sessionKey(projectId), res.sessionId);
      }

      const action = res.referencesAction;
      const newRefs = res.references || [];
      const generated = res.generatedImage;

      // 한 끗 가이드 응답이면 메시지에 가이드 데이터를 실어 카드로 렌더한다.
      const guide = extractGuide(
        res,
        sentAttachment?.previewUrl || sentAttachment?.url || null,
        newRefs,
      );

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
            guide,
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

  // 한 끗 가이드 모달 제출 → 이미지 업로드 후 채팅 전송으로 흘려보낸다.
  //   백엔드가 첨부 이미지를 보고 의도를 분류해 가이드(coach) 응답을 돌려주는 구조라,
  //   별도 /guide 호출 없이 기존 채팅 전송(handleSend)을 그대로 탄다.
  // TODO(백엔드 통합): 가이드 전용 엔드포인트/응답 형태가 확정되면 이 흐름을 맞춰 조정할 것.
  const handleGuideSubmit = async ({ file, message, medium, intent }) => {
    setGuideSubmitting(true);
    setErrorMessage("");
    try {
      const resized = await resizeImage(file);
      const { imageId, url } = await uploadImage(resized);
      const attachmentObj = {
        imageId,
        url,
        previewUrl: URL.createObjectURL(file),
        format: file.type?.split("/")[1] || "unknown",
        sizeKb: Math.round((resized?.size || file.size) / 1024),
      };
      setGuideOpen(false);
      await handleSend(null, {
        text: message,
        attachment: attachmentObj,
        intent,
        medium,
      });
    } catch (e) {
      setErrorMessage(
        e.response?.data?.error?.message || "이미지 업로드에 실패했어요.",
      );
    } finally {
      setGuideSubmitting(false);
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

  const goToChatFull = () => setMode("chatFull");
  const goToRefFull = () => setMode("refFull");
  const goToSplit = () => setMode("split");

  return (
    <div className={styles.layout}>
      {/* 페이지 헤더 — 상단 전체 */}
      <header className={styles.pageHeader}>
        <button
          type="button"
          className={styles.iconBtn}
          onClick={() => navigate("/projects")}
          aria-label="목록"
          title="목록"
        >
          <BackIcon />
        </button>
        <h1 className={styles.pageTitle}>{project?.name ?? "..."}</h1>
        <button
          type="button"
          className={styles.iconBtn}
          onClick={handleReset}
          disabled={!sessionId}
          aria-label="대화 초기화"
          title="대화 초기화"
        >
          <DotsIcon />
        </button>
      </header>

      {/* 본문 — 좌/우 분할 */}
      <div className={styles.body}>
        {/* 좌측: 가이드 패널이 열려 있으면 그것을, 아니면 레퍼런스 보드 */}
        <aside
          className={`${styles.leftPanel} ${
            mode === "chatFull" ? styles.panelHidden : ""
          }`}
        >
          {activeGuide ? (
            <GuidePanel
              guide={activeGuide}
              growth={guideGrowth}
              onClose={() => setActiveGuide(null)}
              onReact={(refId, kind) =>
                handleGuideReact(activeGuide.guideId, refId, kind)
              }
            />
          ) : (
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
              expanded={mode === "refFull"}
              firstMenuRef={firstRefMenuRef}
            />
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
                  <button
                    className={styles.iconBtn}
                    onClick={goToChatFull}
                    title="전체화면"
                  >
                    <ExpandIcon />
                  </button>
                  <button
                    className={styles.iconBtn}
                    onClick={goToRefFull}
                    title="채팅 최소화"
                  >
                    <MinimizeIcon />
                  </button>
                </>
              )}
              {mode === "chatFull" && (
                <>
                  <span />
                  <button
                    className={styles.iconBtn}
                    onClick={goToSplit}
                    title="분할 보기"
                  >
                    <CollapseIcon />
                  </button>
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
                  messages.map((m, idx) => (
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
                              onClick={
                                m.isAi
                                  ? () =>
                                      setLightboxSrc(
                                        m.localPreviewUrl || m.imageUrl,
                                      )
                                  : undefined
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

                      {/* 한 끗 가이드 카드 — 클릭 시 좌측 패널에 전체 가이드 */}
                      {m.guide && (
                        <button
                          type="button"
                          className={styles.guideCard}
                          onClick={() => openGuide(m.guide)}
                        >
                          <span className={styles.guideCardThumb}>
                            {m.guide.imageUrl ? (
                              <img src={m.guide.imageUrl} alt="" />
                            ) : (
                              <PhotoGlyph />
                            )}
                          </span>
                          <span className={styles.guideCardText}>
                            <span className={styles.guideCardTitle}>
                              {m.guide.title || "한 끗 가이드"}
                            </span>
                            <span className={styles.guideCardSub}>
                              한 끗 가이드 보기
                            </span>
                          </span>
                          <ChevronRightIcon />
                        </button>
                      )}
                    </div>
                  ))
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
                    attachment={attachment}
                    onAttach={setAttachment}
                    onClear={() => setAttachment(null)}
                    onError={setErrorMessage}
                    disabled={sending}
                    onOpenGuide={() => setGuideOpen(true)}
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
        </section>
      </div>

      {/* FAB — 항상 mount, 클래스로 토글 */}
      <button
        type="button"
        className={`${styles.fab} ${
          mode === "refFull" ? styles.fabVisible : ""
        }`}
        onClick={goToSplit}
        aria-label="채팅 열기"
        title="채팅 열기"
      >
        <img className={styles.fabIcon} src={logo} alt="" />
      </button>

      {/* 한 끗 가이드 입력 모달 */}
      {guideOpen && (
        <GuideRequestModal
          onClose={() => setGuideOpen(false)}
          onSubmit={handleGuideSubmit}
          submitting={guideSubmitting}
        />
      )}

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
    </div>
  );
};

/* ===== 아이콘 ===== */
const ChevronRightIcon = () => (
  <svg
    width="8"
    height="14"
    viewBox="0 0 8 14"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path
      d="M1 13L7 7L1 1"
      stroke="#888685"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const PhotoGlyph = () => (
  <svg
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill="none"
    stroke="#b8b6b4"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <circle cx="8.5" cy="8.5" r="1.5" />
    <path d="M21 15l-5-5L5 21" />
  </svg>
);

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

export default ChatPage;
