import styles from "./ReferenceGrid.module.css";

const ReferenceGrid = ({ references, loading, justUpdated, onCardClick }) => {
  const hasReferences = references && references.length > 0;

  const columns = splitIntoColumns(references || [], 2);

  return (
    <div className={styles.wrapper}>
      <div className={styles.header}>
        <h2 className={styles.title}>참고 이미지</h2>
        <div className={styles.headerRight}>
          {justUpdated && (
            <span className={styles.updateBadge}>🆕 새로 추가됨</span>
          )}
          {hasReferences && (
            <span className={styles.count}>{references.length}개</span>
          )}
        </div>
      </div>

      {loading && hasReferences && (
        <div className={styles.searchingBadge}>
          <span className={styles.searchingDot}></span>새 이미지 검색 중
        </div>
      )}

      {loading && !hasReferences ? (
        <div className={styles.loading}>이미지 검색 중...</div>
      ) : !hasReferences ? (
        <div className={styles.empty}>
          <p>그림에 대해 질문해보세요.</p>
          <p className={styles.emptyHint}>
            관련 참고 이미지를 자동으로 찾아드려요.
          </p>
        </div>
      ) : (
        <div className={styles.masonry}>
          {columns.map((column, colIdx) => (
            <div key={colIdx} className={styles.column}>
              {column.map((item) => (
                <ReferenceCard
                  key={item.ref.id}
                  reference={item.ref}
                  index={item.index}
                  onClick={() => onCardClick(item.ref)}
                />
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

function splitIntoColumns(refs, columnCount) {
  const columns = Array.from({ length: columnCount }, () => []);
  refs.forEach((ref, idx) => {
    const colIdx = idx % columnCount;
    columns[colIdx].push({ ref, index: idx + 1 });
  });
  return columns;
}

const ReferenceCard = ({ reference, index, onClick }) => {
  const photographerLink = reference.photographerUsername
    ? `https://unsplash.com/@${reference.photographerUsername}?utm_source=drawe&utm_medium=referral`
    : null;

  return (
    <div className={styles.card} onClick={onClick} style={{ cursor: 'pointer' }} >
      <div className={styles.imageWrapper}>
        <img
          src={reference.url}
          alt={`참고 이미지 ${index}`}
          className={styles.image}
          loading="lazy"
        />
        <span className={styles.index}>[{index}]</span>

        <div className={styles.overlay}>
          {(reference.technique || reference.subject || reference.mood) && (
            <div className={styles.tags}>
              {reference.technique && (
                <span className={styles.tag}>{reference.technique}</span>
              )}
              {reference.subject && (
                <span className={styles.tag}>{reference.subject}</span>
              )}
              {reference.mood && (
                <span className={styles.tag}>{reference.mood}</span>
              )}
            </div>
          )}
        </div>
      </div>

      {reference.photographerName && (
        <div className={styles.attribution}>
          <span className={styles.byText}>by</span>
          {photographerLink ? (
            <a
              href={photographerLink}
              target="_blank"
              rel="noopener noreferrer"
              className={styles.photographer}
            >
              {reference.photographerName}
            </a>
          ) : (
            <span className={styles.photographer}>
              {reference.photographerName}
            </span>
          )}
          <span className={styles.source}>· Unsplash</span>
        </div>
      )}
    </div>
  );
};

export default ReferenceGrid;
