import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  createProject,
  deleteProject,
  getProject,
  getProjects,
  updateProject,
} from "./api";
import ProjectFormModal from "./ProjectFormModal";
import ConfirmModal from "./ConfirmModal";
import styles from "./ProjectList.module.css";
import { track } from "../../analytics";

const STATUS_LABEL = {
  in_progress: "진행 중",
  completed: "완료",
};

const formatDate = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}.${mm}.${dd}`;
};

const ProjectList = () => {
  const navigate = useNavigate();
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");

  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);

  const [viewMode, setViewMode] = useState("grid"); // 그리드만 동작
  const [openMenuId, setOpenMenuId] = useState(null);
  const menuRef = useRef(null);

  const fetchProjects = async () => {
    setLoading(true);
    setErrorMessage("");
    try {
      const data = await getProjects();
      setProjects(data?.projects ?? []);
    } catch (err) {
      const message =
        err.response?.data?.error?.message ||
        "프로젝트 목록을 불러오지 못했어요.";
      setErrorMessage(message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchProjects();
  }, []);

  // 바깥 클릭으로 카드 메뉴 닫기
  useEffect(() => {
    if (!openMenuId) return;
    const handleClickOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setOpenMenuId(null);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [openMenuId]);

  const handleCreate = async (payload) => {
    const detail = await createProject(payload);
    setCreateOpen(false);
    if (detail?.id) {
      navigate(`/projects/${detail.id}/chat`);
    } else {
      fetchProjects();
    }
  };

  const handleEditClick = async (projectId) => {
    setOpenMenuId(null);
    try {
      const detail = await getProject(projectId);
      setEditTarget(detail);
    } catch (err) {
      const message =
        err.response?.data?.error?.message ||
        "프로젝트 정보를 불러오지 못했어요.";
      setErrorMessage(message);
    }
  };

  const handleEdit = async (payload) => {
    await updateProject(editTarget.id, payload);
    setEditTarget(null);
    fetchProjects();
  };

  const handleDelete = async () => {
    await deleteProject(deleteTarget.id);
    setDeleteTarget(null);
    fetchProjects();
  };

  const handleCardClick = (projectId) => {
    if (openMenuId) return;
    navigate(`/projects/${projectId}/chat`);
  };

  return (
    <div className={styles.wrapper}>
      {/* 헤더 — 두 줄 구조 */}
      <header className={styles.header}>
        <h1 className={styles.title}>프로젝트</h1>
        <div className={styles.headerActions}>
          <div className={styles.headerLeft}>
            {projects.length > 0 && (
              <div className={styles.viewToggle}>
                <button
                  type="button"
                  className={`${styles.viewBtn} ${
                    viewMode === "grid" ? styles.viewBtnActive : ""
                  }`}
                  onClick={() => setViewMode("grid")}
                  aria-label="그리드 보기"
                  title="그리드 보기"
                >
                  <GridIcon />
                </button>
                <button
                  type="button"
                  className={styles.viewBtn}
                  disabled
                  aria-label="리스트 보기"
                  title="리스트 보기 (준비 중)"
                >
                  <ListIcon />
                </button>
              </div>
            )}
          </div>
          <div className={styles.headerRight}>
            {projects.length > 0 && (
              <button
                type="button"
                className={styles.sortBtn}
                disabled
                title="정렬 (준비 중)"
              >
                최근 <ChevronDownIcon />
              </button>
            )}
            <button
              type="button"
              className={styles.createBtn}
              onClick={() => {
                setCreateOpen(true);
                track("project_create_clicked");
              }}
            >
              <PlusIcon />새 프로젝트
            </button>
          </div>
        </div>
      </header>

      {errorMessage && <p className={styles.error}>{errorMessage}</p>}

      {loading ? (
        <p className={styles.placeholder}>불러오는 중...</p>
      ) : projects.length === 0 ? (
        <div className={styles.empty}>
          <FolderPlusIcon />
          <p className={styles.emptyTitle}>아직 생성된 프로젝트가 없어요.</p>
          <p className={styles.emptyHint}>
            새 프로젝트 버튼을 클릭하여 첫 프로젝트를 만들어보세요!
          </p>
        </div>
      ) : (
        <div className={styles.grid}>
          {projects.map((p) => (
            <div
              key={p.id}
              className={`${styles.card} ${
                openMenuId === p.id ? styles.cardActive : ""
              }`}
              onClick={() => handleCardClick(p.id)}
            >
              {/* 이미지 섹션 */}
              <div className={styles.thumb}>
                <span className={styles.statusBadge}>
                  {STATUS_LABEL[p.status] ?? p.status}
                </span>
                <FolderIcon />
              </div>

              {/* 이름 섹션 */}
              <div className={styles.info}>
                <div className={styles.infoTop}>
                  <span className={styles.cardName}>{p.name}</span>
                  <div
                    className={styles.menuWrap}
                    ref={openMenuId === p.id ? menuRef : null}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      type="button"
                      className={styles.menuBtn}
                      onClick={() =>
                        setOpenMenuId((id) => (id === p.id ? null : p.id))
                      }
                      aria-label="더보기"
                    >
                      <DotsIcon />
                    </button>
                    {openMenuId === p.id && (
                      <div className={styles.menuPopup}>
                        <button
                          type="button"
                          className={styles.menuItem}
                          onClick={() => handleEditClick(p.id)}
                        >
                          <EditIcon />
                          <span>프로젝트 수정</span>
                        </button>
                        <button
                          type="button"
                          className={`${styles.menuItem} ${styles.menuItemDanger}`}
                          onClick={() => {
                            setOpenMenuId(null);
                            setDeleteTarget(p);
                          }}
                        >
                          <TrashIcon />
                          <span>삭제하기</span>
                        </button>
                      </div>
                    )}
                  </div>
                </div>
                <p className={styles.cardDate}>{formatDate(p.createdAt)}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {createOpen && (
        <ProjectFormModal
          mode="create"
          onClose={() => setCreateOpen(false)}
          onSubmit={handleCreate}
        />
      )}

      {editTarget && (
        <ProjectFormModal
          mode="edit"
          initial={editTarget}
          onClose={() => setEditTarget(null)}
          onSubmit={handleEdit}
        />
      )}

      {deleteTarget && (
        <ConfirmModal
          title={`"${deleteTarget.name}" 프로젝트를 삭제할까요?`}
          description="연결된 채팅 기록도 함께 삭제되며 되돌릴 수 없어요."
          confirmLabel="삭제"
          onConfirm={handleDelete}
          onClose={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
};

/* ===== 아이콘 ===== */
const PlusIcon = () => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 18 18"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path d="M8 18V10H0V8H8V0H10V8H18V10H10V18H8Z" fill="#FEFEFF" />
  </svg>
);

const GridIcon = () => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 18 18"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path
      d="M0 8V0H8V8H0ZM0 18V10H8V18H0ZM10 8V0H18V8H10ZM10 18V10H18V18H10ZM2 6H6V2H2V6ZM12 6H16V2H12V6ZM12 16H16V12H12V16ZM2 16H6V12H2V16Z"
      fill="#4A4846"
    />
  </svg>
);

const ListIcon = () => (
  <svg
    width="18"
    height="12"
    viewBox="0 0 18 12"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path d="M0 12V10H12V12H0ZM0 7V5H18V7H0ZM0 2V0H18V2H0Z" fill="#888685" />
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
      fill="#4A4846"
    />
  </svg>
);

const EditIcon = () => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 18 18"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path
      d="M2 16H3.425L13.2 6.225L11.775 4.8L2 14.575V16ZM0 18V13.75L13.2 0.575C13.4 0.391667 13.6208 0.25 13.8625 0.15C14.1042 0.05 14.3583 0 14.625 0C14.8917 0 15.15 0.05 15.4 0.15C15.65 0.25 15.8667 0.4 16.05 0.6L17.425 2C17.625 2.18333 17.7708 2.4 17.8625 2.65C17.9542 2.9 18 3.15 18 3.4C18 3.66667 17.9542 3.92083 17.8625 4.1625C17.7708 4.40417 17.625 4.625 17.425 4.825L4.25 18H0ZM12.475 5.525L11.775 4.8L13.2 6.225L12.475 5.525Z"
      fill="#4A4846"
    />
  </svg>
);

const TrashIcon = () => (
  <svg
    width="16"
    height="18"
    viewBox="0 0 16 18"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path
      d="M3 18C2.45 18 1.97917 17.8042 1.5875 17.4125C1.19583 17.0208 1 16.55 1 16V3H0V1H5V0H11V1H16V3H15V16C15 16.55 14.8042 17.0208 14.4125 17.4125C14.0208 17.8042 13.55 18 13 18H3ZM13 3H3V16H13V3ZM5 14H7V5H5V14ZM9 14H11V5H9V14Z"
      fill="#DD3A2E"
    />
  </svg>
);

const FolderPlusIcon = () => (
  <svg
    width="134"
    height="119"
    viewBox="0 0 134 119"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <g filter="url(#filter0_d_456_15920)">
      <path
        d="M36.9119 83.5294C34.8494 83.5294 33.0837 82.795 31.615 81.3263C30.1462 79.8575 29.4119 78.0919 29.4119 76.0294V31.0294C29.4119 28.9669 30.1462 27.2013 31.615 25.7325C33.0837 24.2638 34.8494 23.5294 36.9119 23.5294H59.4119L66.9119 31.0294H96.9119C98.9744 31.0294 100.74 31.7638 102.209 33.2325C103.677 34.7013 104.412 36.4669 104.412 38.5294V76.0294C104.412 78.0919 103.677 79.8575 102.209 81.3263C100.74 82.795 98.9744 83.5294 96.9119 83.5294H36.9119Z"
        fill="#FF8534"
      />
    </g>
    <path
      d="M65.9119 66.5294V58.5294H57.9119V56.5294H65.9119V48.5294H67.9119V56.5294H75.9119V58.5294H67.9119V66.5294H65.9119Z"
      fill="#FEFEFF"
    />
    <defs>
      <filter
        id="filter0_d_456_15920"
        x="9.91821e-05"
        y="6.19888e-06"
        width="133.824"
        height="118.824"
        filterUnits="userSpaceOnUse"
        color-interpolation-filters="sRGB"
      >
        <feFlood flood-opacity="0" result="BackgroundImageFix" />
        <feColorMatrix
          in="SourceAlpha"
          type="matrix"
          values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0"
          result="hardAlpha"
        />
        <feOffset dy="5.88235" />
        <feGaussianBlur stdDeviation="14.7059" />
        <feComposite in2="hardAlpha" operator="out" />
        <feColorMatrix
          type="matrix"
          values="0 0 0 0 1 0 0 0 0 0.521569 0 0 0 0 0.203922 0 0 0 0.25 0"
        />
        <feBlend
          mode="normal"
          in2="BackgroundImageFix"
          result="effect1_dropShadow_456_15920"
        />
        <feBlend
          mode="normal"
          in="SourceGraphic"
          in2="effect1_dropShadow_456_15920"
          result="shape"
        />
      </filter>
    </defs>
  </svg>
);

const ChevronDownIcon = () => (
  <svg
    width="12"
    height="8"
    viewBox="0 0 12 8"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path d="M6 7.4L0 1.4L1.4 0L6 4.6L10.6 0L12 1.4L6 7.4Z" fill="#4A4846" />
  </svg>
);

const FolderIcon = () => (
  <svg
    width="134"
    height="119"
    viewBox="0 0 134 119"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <g filter="url(#filter0_d_457_7434)">
      <path
        d="M36.9118 83.5294C34.8493 83.5294 33.0836 82.795 31.6149 81.3263C30.1461 79.8575 29.4118 78.0919 29.4118 76.0294V31.0294C29.4118 28.9669 30.1461 27.2013 31.6149 25.7325C33.0836 24.2638 34.8493 23.5294 36.9118 23.5294H59.4118L66.9118 31.0294H96.9118C98.9743 31.0294 100.74 31.7638 102.209 33.2325C103.677 34.7013 104.412 36.4669 104.412 38.5294V76.0294C104.412 78.0919 103.677 79.8575 102.209 81.3263C100.74 82.795 98.9743 83.5294 96.9118 83.5294H36.9118Z"
        fill="#FEFEFF"
      />
    </g>
    <defs>
      <filter
        id="filter0_d_457_7434"
        x="7.62939e-06"
        y="6.19888e-06"
        width="133.824"
        height="118.824"
        filterUnits="userSpaceOnUse"
        color-interpolation-filters="sRGB"
      >
        <feFlood flood-opacity="0" result="BackgroundImageFix" />
        <feColorMatrix
          in="SourceAlpha"
          type="matrix"
          values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0"
          result="hardAlpha"
        />
        <feOffset dy="5.88235" />
        <feGaussianBlur stdDeviation="14.7059" />
        <feComposite in2="hardAlpha" operator="out" />
        <feColorMatrix
          type="matrix"
          values="0 0 0 0 1 0 0 0 0 0.521569 0 0 0 0 0.203922 0 0 0 0.1 0"
        />
        <feBlend
          mode="normal"
          in2="BackgroundImageFix"
          result="effect1_dropShadow_457_7434"
        />
        <feBlend
          mode="normal"
          in="SourceGraphic"
          in2="effect1_dropShadow_457_7434"
          result="shape"
        />
      </filter>
    </defs>
  </svg>
);

export default ProjectList;
