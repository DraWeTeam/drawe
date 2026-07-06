import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getCollections } from "./api";
import CollectionCard from "./CollectionCard";
import styles from "./ArchivePage.module.css";

// SCR-ARCH-02 아카이브 목록(전체) — 레퍼런스 컬렉션 카드 그리드.
//   아카이브 홈(/archive)의 '레퍼런스 더보기' 목적지. 컬렉션 = 명명된 레퍼런스 그룹(명암/손 구도 등).
const ReferenceListPage = () => {
  const navigate = useNavigate();
  const [collections, setCollections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    let alive = true;
    const fetchCollections = async () => {
      setLoading(true);
      setErrorMessage("");
      try {
        const data = await getCollections();
        if (alive) setCollections(data?.collections ?? []);
      } catch (err) {
        if (alive) {
          setErrorMessage(
            err.response?.data?.error?.message ||
              "아카이브를 불러오지 못했어요.",
          );
        }
      } finally {
        if (alive) setLoading(false);
      }
    };
    fetchCollections();
    return () => {
      alive = false;
    };
  }, []);

  const totalRefs = collections.reduce((sum, c) => sum + (c.count ?? 0), 0);

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>레퍼런스</h1>
        {!loading && !errorMessage && collections.length > 0 && (
          <span className={styles.subtitle}>
            {collections.length}개 컬렉션 · 총 {totalRefs}개의 레퍼런스
          </span>
        )}
      </header>

      {loading ? (
        <div className={styles.stateBox}>불러오는 중…</div>
      ) : errorMessage ? (
        <div className={styles.stateBox}>{errorMessage}</div>
      ) : collections.length === 0 ? (
        <div className={styles.stateBox}>
          아직 저장된 레퍼런스가 없어요.
          <br />
          마음에 드는 레퍼런스를 아카이브 해보세요.
        </div>
      ) : (
        <div className={styles.collectionGrid}>
          {collections.map((c) => (
            <CollectionCard
              key={c.id}
              collection={c}
              onClick={() => navigate(`/archive/collections/${c.id}`)}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export default ReferenceListPage;
