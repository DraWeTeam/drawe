import { useEffect, useState } from "react";
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

const STATUS_LABEL = {
  in_progress: "진행 중",
  completed: "완료",
};

const ProjectList = () => {
  const navigate = useNavigate();
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");

  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);

  const fetchProjects = async () => {
    setLoading(true);
    setErrorMessage("");
    try {
      const data = await getProjects();
      setProjects(data?.projects ?? []);
    } catch (err) {
      const message =
        err.response?.data?.error?.message || "프로젝트 목록을 불러오지 못했어요.";
      setErrorMessage(message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchProjects();
  }, []);

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
    try {
      const detail = await getProject(projectId);
      setEditTarget(detail);
    } catch (err) {
      const message =
        err.response?.data?.error?.message || "프로젝트 정보를 불러오지 못했어요.";
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

  return (
    <div className={styles.wrapper}>
      <div className={styles.header}>
        <h1 className={styles.title}>내 프로젝트</h1>
        <button
          className={styles.createBtn}
          onClick={() => setCreateOpen(true)}
        >
          + 새 프로젝트
        </button>
      </div>

      {errorMessage && <p className={styles.error}>{errorMessage}</p>}

      {loading ? (
        <p className={styles.placeholder}>불러오는 중...</p>
      ) : projects.length === 0 ? (
        <p className={styles.placeholder}>
          아직 만든 프로젝트가 없어요. 새 프로젝트를 만들어보세요.
        </p>
      ) : (
        <ul className={styles.grid}>
          {projects.map((p) => (
            <li key={p.id} className={styles.card}>
              <div
                className={styles.cardBody}
                onClick={() => navigate(`/projects/${p.id}/chat`)}
              >
                <div className={styles.cardTop}>
                  <span className={styles.cardName}>{p.name}</span>
                  <span className={styles.cardStatus}>
                    {STATUS_LABEL[p.status] ?? p.status}
                  </span>
                </div>
                <p className={styles.cardMeta}>
                  {p.technique || "기법 미지정"}
                </p>
                <p className={styles.cardSub}>
                  참고 이미지 {p.referenceCount}개
                </p>
              </div>
              <div className={styles.cardActions}>
                <button
                  className={styles.editBtn}
                  onClick={() => handleEditClick(p.id)}
                >
                  수정
                </button>
                <button
                  className={styles.deleteBtn}
                  onClick={() => setDeleteTarget(p)}
                >
                  삭제
                </button>
              </div>
            </li>
          ))}
        </ul>
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

export default ProjectList;
