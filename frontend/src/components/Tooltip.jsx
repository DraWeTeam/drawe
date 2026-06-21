import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import styles from "./Tooltip.module.css";

const GAP = 8; // 아이콘과 말풍선 사이 여유

// 대상 위치(rect)와 방향에 맞춰 fixed 말풍선 좌표 계산
function bubbleStyle(rect, placement) {
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  switch (placement) {
    case "top":
      return { top: rect.top - GAP, left: cx, transform: "translate(-50%, -100%)" };
    case "right":
      return { top: cy, left: rect.right + GAP, transform: "translateY(-50%)" };
    case "left":
      return { top: cy, left: rect.left - GAP, transform: "translate(-100%, -50%)" };
    case "bottom":
    default:
      return { top: rect.bottom + GAP, left: cx, transform: "translateX(-50%)" };
  }
}

/**
 * label 없이 아이콘만 있는 버튼에 hover/focus 시 노출되는 툴팁.
 *
 * 말풍선을 body로 portal + position:fixed로 띄워, 부모의 overflow:hidden이나
 * stacking에 가려지지 않고 항상 최상단에 표시된다.
 *
 * @param {string} label - 툴팁 문구
 * @param {"top"|"bottom"|"left"|"right"} [placement="bottom"] - 노출 방향
 * @param {string} [className] - 래퍼에 추가할 클래스 (flex 레이아웃 대응 등)
 */
const Tooltip = ({ label, placement = "bottom", className = "", children }) => {
  const wrapRef = useRef(null);
  const [rect, setRect] = useState(null);

  const show = useCallback(() => {
    const el = wrapRef.current;
    if (el) setRect(el.getBoundingClientRect());
  }, []);
  const hide = useCallback(() => setRect(null), []);

  // 떠 있는 동안 스크롤/리사이즈되면 위치가 어긋나므로 닫는다
  useEffect(() => {
    if (!rect) return;
    window.addEventListener("scroll", hide, true);
    window.addEventListener("resize", hide);
    return () => {
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("resize", hide);
    };
  }, [rect, hide]);

  return (
    <span
      ref={wrapRef}
      className={`${styles.wrap} ${className}`}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      {children}
      {rect &&
        createPortal(
          <span
            className={`${styles.bubble} ${styles[placement]}`}
            style={bubbleStyle(rect, placement)}
            role="tooltip"
          >
            {label}
          </span>,
          document.body,
        )}
    </span>
  );
};

export default Tooltip;
