import AuthedImage from "./AuthedImage";
import styles from "./OverlayImage.module.css";

// 사용자 그림 위에 백엔드 오버레이 SVG(visual_mode의 overlay_axes 결과)를 정렬 합성한다.
// overlay 가 없으면(이론 모드/첫 사용자/측정 불가) 그냥 그림만 보여준다 → AuthedImage 폴백.
// 오버레이 SVG 는 백엔드가 생성(좌표 숫자 + 고정 라벨, 사용자 입력 없음)이라 신뢰 가능 →
// dangerouslySetInnerHTML 안전. 정렬: 래퍼가 그림에 '딱 맞고'(inline-block, object-fit 미사용)
// SVG viewBox(원본 WxH)가 같은 비율로 채워 좌표가 정확히 겹친다.
const OverlayImage = ({ src, overlay, className, alt }) => {
  if (!overlay) {
    return <AuthedImage src={src} alt={alt} className={className} />;
  }
  return (
    <div className={styles.wrap}>
      <AuthedImage src={src} alt={alt} className={styles.img} />
      <div
        className={styles.layer}
        aria-hidden="true"
        dangerouslySetInnerHTML={{ __html: overlay }}
      />
    </div>
  );
};

export default OverlayImage;
