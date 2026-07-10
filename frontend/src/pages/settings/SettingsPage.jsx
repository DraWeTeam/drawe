import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import api from "../login/api";
import {
  getProfile,
  updateNickname,
  changePassword,
  withdraw,
  sendFeedback,
} from "./api";
import { track } from "../../analytics";
import styles from "./SettingsPage.module.css";

const SUPPORT_EMAIL = "drawe3648@gmail.com";
const APP_VERSION = "1.0.0";
const FEEDBACK_MAX = 2000;

// onClose 가 있으면 모달(사이드바 '환경설정' 플로팅 팝업), 없으면 기존 전체화면 페이지(/settings 라우트 호환).
const SettingsPage = ({ onClose }) => {
  const navigate = useNavigate();
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        const data = await getProfile();
        if (alive) setProfile(data);
      } catch (err) {
        if (alive)
          setErrorMessage(
            err.response?.data?.error?.message || "프로필을 불러오지 못했어요.",
          );
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const clearTokens = () => {
    localStorage.removeItem("accessToken");
    localStorage.removeItem("refreshToken");
  };

  const handleLogout = async () => {
    try {
      const refreshToken = localStorage.getItem("refreshToken");
      if (refreshToken) await api.post("/auth/logout", { refreshToken });
    } catch {
      // ignore
    } finally {
      clearTokens();
      navigate("/login");
    }
  };

  const body =
    loading || errorMessage || !profile ? (
      <div className={styles.stateBox}>
        {loading
          ? "불러오는 중…"
          : errorMessage || "프로필을 불러오지 못했어요."}
      </div>
    ) : (
      <>
        <ProfileSection
          profile={profile}
          onUpdated={(next) => setProfile(next)}
        />

        <AccountSection
          social={profile.social}
          onLogout={() => {
            onClose?.();
            handleLogout();
          }}
          onWithdrawn={() => {
            clearTokens();
            navigate("/login");
          }}
        />

        <FeedbackSection />

        <AboutSection onNavigate={onClose} />
      </>
    );

  // ── 모달 컨텍스트(사이드바 '환경설정') — 중앙 플로팅 팝업 + 딤 배경 + X 닫기 ──
  if (onClose) {
    return (
      <div className={styles.overlay} onClick={onClose}>
        <div
          className={styles.settingsModal}
          role="dialog"
          aria-modal="true"
          aria-label="환경설정"
          onClick={(e) => e.stopPropagation()}
        >
          <header className={styles.modalHeader}>
            <h2 className={styles.modalHeaderTitle}>환경설정</h2>
            <button
              type="button"
              className={styles.closeBtn}
              onClick={onClose}
              aria-label="닫기"
            >
              ×
            </button>
          </header>
          {body}
        </div>
      </div>
    );
  }

  // ── 페이지 컨텍스트(/settings 라우트, 하위호환) ──
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>환경설정</h1>
      </header>
      {body}
    </div>
  );
};

/* ── 프로필 (닉네임 수정) ───────────────────────── */
const ProfileSection = ({ profile, onUpdated }) => {
  const [nickname, setNickname] = useState(profile.nickname);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null); // { type, text }

  const dirty = nickname.trim() !== profile.nickname;
  const valid = nickname.trim().length > 0 && nickname.trim().length <= 100;

  const handleSave = async () => {
    if (!dirty || !valid || saving) return;
    setSaving(true);
    setMessage(null);
    try {
      const next = await updateNickname(nickname.trim());
      onUpdated(next);
      setMessage({ type: "ok", text: "닉네임을 변경했어요." });
    } catch (err) {
      setMessage({
        type: "error",
        text: err.response?.data?.error?.message || "닉네임 변경에 실패했어요.",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className={styles.card}>
      <h2 className={styles.cardTitle}>프로필</h2>

      <div className={styles.field}>
        <label className={styles.label}>이메일</label>
        <div className={styles.readonly}>{profile.email}</div>
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="nickname">
          닉네임
        </label>
        <div className={styles.inlineRow}>
          <input
            id="nickname"
            className={styles.input}
            value={nickname}
            maxLength={100}
            onChange={(e) => setNickname(e.target.value)}
          />
          <button
            type="button"
            className={styles.primaryBtn}
            onClick={handleSave}
            disabled={!dirty || !valid || saving}
          >
            {saving ? "저장 중…" : "저장"}
          </button>
        </div>
        {message && (
          <p
            className={message.type === "ok" ? styles.hintOk : styles.hintError}
          >
            {message.text}
          </p>
        )}
      </div>
    </section>
  );
};

/* ── 계정 (비밀번호 / 로그아웃 / 회원탈퇴) ──────── */
const AccountSection = ({ social, onLogout, onWithdrawn }) => {
  const [withdrawOpen, setWithdrawOpen] = useState(false);

  return (
    <section className={styles.card}>
      <h2 className={styles.cardTitle}>계정</h2>

      {social ? (
        <p className={styles.note}>소셜 로그인 계정은 비밀번호가 없어요.</p>
      ) : (
        <PasswordChanger />
      )}

      <div className={styles.accountActions}>
        <button
          type="button"
          className={styles.secondaryBtn}
          onClick={onLogout}
        >
          로그아웃
        </button>
        <button
          type="button"
          className={styles.dangerText}
          onClick={() => setWithdrawOpen(true)}
        >
          회원탈퇴
        </button>
      </div>

      {withdrawOpen && (
        <WithdrawModal
          onClose={() => setWithdrawOpen(false)}
          onWithdrawn={onWithdrawn}
        />
      )}
    </section>
  );
};

/* ── 비밀번호 변경 ───────────────────────────────── */
const PasswordChanger = () => {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);

  const reset = () => {
    setCurrent("");
    setNext("");
    setConfirm("");
    setMessage(null);
  };

  const valid = current.length > 0 && next.length >= 8 && next === confirm;

  const handleSave = async () => {
    if (!valid || saving) return;
    setSaving(true);
    setMessage(null);
    try {
      await changePassword(current, next);
      reset();
      setOpen(false);
      setMessage({ type: "ok", text: "비밀번호를 변경했어요." });
    } catch (err) {
      setMessage({
        type: "error",
        text:
          err.response?.data?.error?.message || "비밀번호 변경에 실패했어요.",
      });
    } finally {
      setSaving(false);
    }
  };

  if (!open) {
    return (
      <div className={styles.field}>
        <label className={styles.label}>비밀번호</label>
        <button
          type="button"
          className={styles.secondaryBtn}
          onClick={() => setOpen(true)}
        >
          비밀번호 변경
        </button>
        {message?.type === "ok" && (
          <p className={styles.hintOk}>{message.text}</p>
        )}
      </div>
    );
  }

  return (
    <div className={styles.field}>
      <label className={styles.label}>비밀번호 변경</label>
      <input
        type="password"
        className={styles.input}
        placeholder="현재 비밀번호"
        value={current}
        onChange={(e) => setCurrent(e.target.value)}
      />
      <input
        type="password"
        className={styles.input}
        placeholder="새 비밀번호 (8자 이상)"
        value={next}
        onChange={(e) => setNext(e.target.value)}
      />
      <input
        type="password"
        className={styles.input}
        placeholder="새 비밀번호 확인"
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
      />
      {confirm.length > 0 && next !== confirm && (
        <p className={styles.hintError}>새 비밀번호가 일치하지 않아요.</p>
      )}
      {message?.type === "error" && (
        <p className={styles.hintError}>{message.text}</p>
      )}
      <div className={styles.inlineRow}>
        <button
          type="button"
          className={styles.primaryBtn}
          onClick={handleSave}
          disabled={!valid || saving}
        >
          {saving ? "변경 중…" : "변경"}
        </button>
        <button
          type="button"
          className={styles.secondaryBtn}
          onClick={() => {
            reset();
            setOpen(false);
          }}
        >
          취소
        </button>
      </div>
    </div>
  );
};

/* ── 회원탈퇴 확인 모달 ──────────────────────────── */
const WithdrawModal = ({ onClose, onWithdrawn }) => {
  const [confirmText, setConfirmText] = useState("");
  const [processing, setProcessing] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const handleWithdraw = async () => {
    if (confirmText !== "탈퇴" || processing) return;
    setProcessing(true);
    setErrorMessage("");
    try {
      await withdraw();
      onWithdrawn();
    } catch (err) {
      setErrorMessage(
        err.response?.data?.error?.message || "탈퇴 처리에 실패했어요.",
      );
      setProcessing(false);
    }
  };

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <h3 className={styles.modalTitle}>회원탈퇴</h3>
        <p className={styles.modalBody}>
          탈퇴하면 이 계정으로 다시 로그인할 수 없어요.
          <br />
          계속하려면 아래에 <b>탈퇴</b> 라고 입력해주세요.
        </p>
        <input
          className={styles.input}
          placeholder="탈퇴"
          value={confirmText}
          onChange={(e) => setConfirmText(e.target.value)}
        />
        {errorMessage && <p className={styles.hintError}>{errorMessage}</p>}
        <div className={styles.modalActions}>
          <button
            type="button"
            className={styles.secondaryBtn}
            onClick={onClose}
            disabled={processing}
          >
            취소
          </button>
          <button
            type="button"
            className={styles.dangerBtn}
            onClick={handleWithdraw}
            disabled={confirmText !== "탈퇴" || processing}
          >
            {processing ? "처리 중…" : "탈퇴하기"}
          </button>
        </div>
      </div>
    </div>
  );
};

/* ── 피드백 보내기 ───────────────────────────────── */
const FeedbackSection = () => {
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState(null); // { type, text }

  const trimmed = message.trim();
  const valid = trimmed.length > 0 && trimmed.length <= FEEDBACK_MAX;

  // [트래킹] 작성 시작 시각/제출 여부/최신 입력값을 ref 로 보관(이탈 계측용, 최신 클로저 회피).
  const startedAtRef = useRef(null); // 첫 작성 진입 시각(ms) — feedback_started 발화 여부 겸용
  const submittedRef = useRef(false);
  const trimmedRef = useRef("");
  trimmedRef.current = trimmed;

  // [트래킹] 피드백 폼 첫 진입(작성 시도) 1회 → feedback_started.
  const handleFeedbackFocus = () => {
    if (startedAtRef.current) return;
    startedAtRef.current = Date.now();
    track("feedback_started", {});
  };

  // [트래킹] 작성 중 이탈(언마운트) 시 → feedback_cancelled. 제출했거나 빈 입력이면 발화 안 함.
  useEffect(() => {
    return () => {
      if (
        startedAtRef.current &&
        !submittedRef.current &&
        trimmedRef.current.length > 0
      ) {
        track("feedback_cancelled", {
          time_spent_sec: Math.round(
            (Date.now() - startedAtRef.current) / 1000,
          ),
          content_length: trimmedRef.current.length,
        });
      }
    };
  }, []);

  const handleSend = async () => {
    if (!valid || sending) return;
    setSending(true);
    setResult(null);
    try {
      await sendFeedback(trimmed);
      submittedRef.current = true;
      track("feedback_submitted", { feedback_length: trimmed.length });
      setMessage("");
      setResult({ type: "ok", text: "소중한 의견 감사합니다!" });
    } catch (err) {
      setResult({
        type: "error",
        text:
          err.response?.data?.error?.message ||
          "전송에 실패했어요. 잠시 후 다시 시도해주세요.",
      });
    } finally {
      setSending(false);
    }
  };

  return (
    <section className={styles.card}>
      <h2 className={styles.cardTitle}>피드백 보내기</h2>
      <p className={styles.note}>
        서비스를 쓰면서 느낀 점이나 개선 아이디어를 자유롭게 남겨주세요.
      </p>

      <div className={styles.field}>
        <textarea
          className={styles.textarea}
          placeholder="의견을 입력해주세요"
          maxLength={FEEDBACK_MAX}
          value={message}
          onFocus={handleFeedbackFocus}
          onChange={(e) => setMessage(e.target.value)}
        />
        <div className={styles.feedbackActions}>
          <button
            type="button"
            className={styles.primaryBtn}
            onClick={handleSend}
            disabled={!valid || sending}
          >
            {sending ? "보내는 중…" : "보내기"}
          </button>
          <span className={styles.charCount}>
            {trimmed.length}/{FEEDBACK_MAX}
          </span>
        </div>
        {result && (
          <p
            className={result.type === "ok" ? styles.hintOk : styles.hintError}
          >
            {result.text}
          </p>
        )}
      </div>
    </section>
  );
};

/* ── 정보 / 약관 ─────────────────────────────────── */
const AboutSection = ({ onNavigate }) => {
  return (
    <section className={styles.card}>
      <h2 className={styles.cardTitle}>정보</h2>

      <div className={styles.linkRow}>
        <span className={styles.linkLabel}>이용약관 및 개인정보처리방침</span>
        <Link to="/policy" className={styles.linkAction} onClick={onNavigate}>
          보기
        </Link>
      </div>

      <div className={styles.linkRow}>
        <span className={styles.linkLabel}>문의</span>
        <a href={`mailto:${SUPPORT_EMAIL}`} className={styles.linkAction}>
          {SUPPORT_EMAIL}
        </a>
      </div>

      <div className={styles.linkRow}>
        <span className={styles.linkLabel}>버전</span>
        <span className={styles.linkValue}>v{APP_VERSION}</span>
      </div>
    </section>
  );
};

export default SettingsPage;
