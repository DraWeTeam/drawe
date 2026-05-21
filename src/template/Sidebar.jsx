import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import api from "../pages/login/api";
import styles from "./Sidebar.module.css";
import logo from "../assets/drawe_logo.png";

const HIDDEN_PATHS = ["/login", "/signup", "/oauth/callback", "/onboarding"];

const Sidebar = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [collapsed, setCollapsed] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(true);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const userMenuRef = useRef(null);

  const hidden = HIDDEN_PATHS.includes(location.pathname);

  // 유저 정보 로드
  useEffect(() => {
    if (hidden) {
      setUser(null);
      return;
    }
    const token = localStorage.getItem("accessToken");
    if (!token) {
      setUser(null);
      return;
    }
    const fetchMe = async () => {
      try {
        const res = await api.get("/user/profile");
        setUser(res.data.data);
      } catch {
        setUser(null);
      }
    };
    fetchMe();
  }, [hidden, location.pathname]);

  // 바깥 클릭으로 유저 메뉴 닫기
  useEffect(() => {
    if (!userMenuOpen) return;
    const handleClickOutside = (e) => {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target)) {
        setUserMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [userMenuOpen]);

  const handleLogout = async () => {
    setUserMenuOpen(false);
    try {
      const refreshToken = localStorage.getItem("refreshToken");
      if (refreshToken) {
        await api.post("/auth/logout", { refreshToken });
      }
    } catch {
      // ignore
    } finally {
      localStorage.removeItem("accessToken");
      localStorage.removeItem("refreshToken");
      setUser(null);
      navigate("/login");
    }
  };

  if (hidden) return null;

  const isProjectActive = location.pathname.startsWith("/projects");

  return (
    <aside className={`${styles.sidebar} ${collapsed ? styles.collapsed : ""}`}>
      {/* 상단: 로고 + 토글 */}
      <div className={styles.top}>
        {!collapsed && (
          <Link to="/projects" className={styles.logo}>
            <img className={styles.logoIcon} src={logo} />
            <span className={styles.logoText}>
              <span className={styles.logoHighlight}>Dra</span>We
            </span>
          </Link>
        )}
        <button
          type="button"
          className={styles.toggleBtn}
          onClick={() => setCollapsed((c) => !c)}
          aria-label={collapsed ? "사이드바 펼치기" : "사이드바 접기"}
          title={collapsed ? "사이드바 펼치기" : "사이드바 접기"}
        >
          <PanelIcon />
        </button>
      </div>

      <div className={styles.line}></div>

      {/* 검색 (UI only) */}
      <div className={styles.searchArea}>
        {collapsed ? (
          <button
            type="button"
            className={`${styles.menuItem} ${styles.iconOnly}`}
            disabled
            title="검색 (준비 중)"
            aria-label="검색"
          >
            <span className={styles.menuIcon}>
              <SearchIcon />
            </span>
          </button>
        ) : (
          <div className={styles.searchBox}>
            <span className={styles.searchIcon}>
              <SearchIcon />
            </span>
            <input
              type="text"
              placeholder="검색"
              className={styles.searchInput}
              disabled
            />
          </div>
        )}
      </div>

      {/* 메뉴 */}
      <nav className={styles.nav}>
        {/* 프로젝트 */}
        <Link
          to="/projects"
          className={`${styles.menuItem} ${
            isProjectActive ? styles.active : ""
          } ${collapsed ? styles.iconOnly : ""}`}
        >
          <span className={styles.menuIcon}>
            <ProjectIcon />
          </span>
          {!collapsed && <span className={styles.menuLabel}>프로젝트</span>}
        </Link>

        {/* 아카이브 */}
        {collapsed ? (
          <button
            type="button"
            className={`${styles.menuItem} ${styles.iconOnly}`}
            disabled
            title="아카이브 (준비 중)"
          >
            <span className={styles.menuIcon}>
              <ArchiveIcon />
            </span>
          </button>
        ) : (
          <>
            <button
              type="button"
              className={styles.menuItem}
              onClick={() => setArchiveOpen((o) => !o)}
            >
              <span className={styles.menuIcon}>
                <ArchiveIcon />
              </span>
              <span className={styles.menuLabel}>아카이브</span>
              <span
                className={`${styles.chevron} ${
                  archiveOpen ? styles.chevronOpen : ""
                }`}
              >
                <ChevronIcon />
              </span>
            </button>
            {archiveOpen && (
              <div className={styles.submenu}>
                <button
                  type="button"
                  className={styles.submenuItem}
                  disabled
                  title="준비 중"
                >
                  <span>레퍼런스</span>
                  <span className={styles.count}>0</span>
                </button>
              </div>
            )}
          </>
        )}
      </nav>

      {/* 하단: 유저 카드 */}
      <div className={styles.bottom} ref={userMenuRef}>
        {userMenuOpen && (
          <div
            className={`${styles.userMenu} ${
              collapsed ? styles.userMenuCollapsed : ""
            }`}
          >
            <button
              type="button"
              className={styles.userMenuItem}
              disabled
              title="준비 중"
            >
              <SettingsIcon />
              <span>환경설정</span>
            </button>
            <button
              type="button"
              className={styles.userMenuItem}
              disabled
              title="준비 중"
            >
              <BillingIcon />
              <span>요금제 보기</span>
            </button>
            <button
              type="button"
              className={`${styles.userMenuItem} ${styles.logoutItem}`}
              onClick={handleLogout}
            >
              <LogoutIcon />
              <span>로그아웃</span>
            </button>
          </div>
        )}

        {user ? (
          collapsed ? (
            <button
              type="button"
              className={styles.avatarOnlyBtn}
              onClick={() => setUserMenuOpen((o) => !o)}
              aria-label="유저 메뉴"
            >
              <div className={styles.avatar}>
                <UserIcon />
              </div>
            </button>
          ) : (
            <button
              type="button"
              className={styles.userCard}
              onClick={() => setUserMenuOpen((o) => !o)}
            >
              <div className={styles.avatar}>
                <UserIcon />
              </div>
              <div className={styles.userInfo}>
                <div className={styles.nickname}>{user.nickname}</div>
                <div className={styles.email}>{user.email}</div>
              </div>
              <span className={styles.cardDots}>
                <DotsIcon />
              </span>
            </button>
          )
        ) : (
          !collapsed && (
            <Link to="/login" className={styles.userCard}>
              <div className={styles.avatar}>
                <UserIcon />
              </div>
              <div className={styles.userInfo}>
                <div className={styles.nickname}>로그인</div>
                <div className={styles.email}>로그인이 필요해요.</div>
              </div>
            </Link>
          )
        )}
      </div>
    </aside>
  );
};

/* ===== 아이콘 ===== */
const PanelIcon = () => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 18 18"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path
      d="M2 18C1.45 18 0.979167 17.8042 0.5875 17.4125C0.195833 17.0208 0 16.55 0 16V2C0 1.45 0.195833 0.979167 0.5875 0.5875C0.979167 0.195833 1.45 0 2 0H16C16.55 0 17.0208 0.195833 17.4125 0.5875C17.8042 0.979167 18 1.45 18 2V16C18 16.55 17.8042 17.0208 17.4125 17.4125C17.0208 17.8042 16.55 18 16 18H2ZM5 16V2H2V16H5ZM7 16H16V2H7V16Z"
      fill="#4A4846"
    />
  </svg>
);

const SearchIcon = () => (
  <svg
    width="32"
    height="32"
    viewBox="0 0 32 32"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path
      d="M26.1333 28L17.7333 19.6C17.0667 20.1333 16.3 20.5556 15.4333 20.8667C14.5667 21.1778 13.6444 21.3333 12.6667 21.3333C10.2444 21.3333 8.19444 20.4944 6.51667 18.8167C4.83889 17.1389 4 15.0889 4 12.6667C4 10.2444 4.83889 8.19444 6.51667 6.51667C8.19444 4.83889 10.2444 4 12.6667 4C15.0889 4 17.1389 4.83889 18.8167 6.51667C20.4944 8.19444 21.3333 10.2444 21.3333 12.6667C21.3333 13.6444 21.1778 14.5667 20.8667 15.4333C20.5556 16.3 20.1333 17.0667 19.6 17.7333L28 26.1333L26.1333 28ZM12.6667 18.6667C14.3333 18.6667 15.75 18.0833 16.9167 16.9167C18.0833 15.75 18.6667 14.3333 18.6667 12.6667C18.6667 11 18.0833 9.58333 16.9167 8.41667C15.75 7.25 14.3333 6.66667 12.6667 6.66667C11 6.66667 9.58333 7.25 8.41667 8.41667C7.25 9.58333 6.66667 11 6.66667 12.6667C6.66667 14.3333 7.25 15.75 8.41667 16.9167C9.58333 18.0833 11 18.6667 12.6667 18.6667Z"
      fill="#4A4846"
    />
  </svg>
);

const ProjectIcon = () => (
  <svg
    width="32"
    height="32"
    viewBox="0 0 32 32"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path
      d="M8 24C7.45 24 6.97917 23.8042 6.5875 23.4125C6.19583 23.0208 6 22.55 6 22V10C6 9.45 6.19583 8.97917 6.5875 8.5875C6.97917 8.19583 7.45 8 8 8H14L16 10H24C24.55 10 25.0208 10.1958 25.4125 10.5875C25.8042 10.9792 26 11.45 26 12V22C26 22.55 25.8042 23.0208 25.4125 23.4125C25.0208 23.8042 24.55 24 24 24H8ZM8 22H24V12H15.175L13.175 10H8V22Z"
      fill="#FCFBFA"
    />
  </svg>
);

const ArchiveIcon = () => (
  <svg
    width="32"
    height="32"
    viewBox="0 0 32 32"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path
      d="M9 25L7 13H25L23 25H9ZM10.675 23H21.325L22.6 15H9.4L10.675 23ZM14 19H18C18.2833 19 18.5208 18.9042 18.7125 18.7125C18.9042 18.5208 19 18.2833 19 18C19 17.7167 18.9042 17.4792 18.7125 17.2875C18.5208 17.0958 18.2833 17 18 17H14C13.7167 17 13.4792 17.0958 13.2875 17.2875C13.0958 17.4792 13 17.7167 13 18C13 18.2833 13.0958 18.5208 13.2875 18.7125C13.4792 18.9042 13.7167 19 14 19ZM10 12C9.71667 12 9.47917 11.9042 9.2875 11.7125C9.09583 11.5208 9 11.2833 9 11C9 10.7167 9.09583 10.4792 9.2875 10.2875C9.47917 10.0958 9.71667 10 10 10H22C22.2833 10 22.5208 10.0958 22.7125 10.2875C22.9042 10.4792 23 10.7167 23 11C23 11.2833 22.9042 11.5208 22.7125 11.7125C22.5208 11.9042 22.2833 12 22 12H10ZM12 9C11.7167 9 11.4792 8.90417 11.2875 8.7125C11.0958 8.52083 11 8.28333 11 8C11 7.71667 11.0958 7.47917 11.2875 7.2875C11.4792 7.09583 11.7167 7 12 7H20C20.2833 7 20.5208 7.09583 20.7125 7.2875C20.9042 7.47917 21 7.71667 21 8C21 8.28333 20.9042 8.52083 20.7125 8.7125C20.5208 8.90417 20.2833 9 20 9H12Z"
      fill="#4A4846"
    />
  </svg>
);

const ChevronIcon = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <polyline points="6 9 12 15 18 9" />
  </svg>
);

const UserIcon = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 16 16"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path
      d="M5.175 6.825C4.39167 6.04167 4 5.1 4 4C4 2.9 4.39167 1.95833 5.175 1.175C5.95833 0.391667 6.9 0 8 0C9.1 0 10.0417 0.391667 10.825 1.175C11.6083 1.95833 12 2.9 12 4C12 5.1 11.6083 6.04167 10.825 6.825C10.0417 7.60833 9.1 8 8 8C6.9 8 5.95833 7.60833 5.175 6.825ZM0 16V13.2C0 12.6333 0.145833 12.1125 0.4375 11.6375C0.729167 11.1625 1.11667 10.8 1.6 10.55C2.63333 10.0333 3.68333 9.64583 4.75 9.3875C5.81667 9.12917 6.9 9 8 9C9.1 9 10.1833 9.12917 11.25 9.3875C12.3167 9.64583 13.3667 10.0333 14.4 10.55C14.8833 10.8 15.2708 11.1625 15.5625 11.6375C15.8542 12.1125 16 12.6333 16 13.2V16H0ZM2 14H14V13.2C14 13.0167 13.9542 12.85 13.8625 12.7C13.7708 12.55 13.65 12.4333 13.5 12.35C12.6 11.9 11.6917 11.5625 10.775 11.3375C9.85833 11.1125 8.93333 11 8 11C7.06667 11 6.14167 11.1125 5.225 11.3375C4.30833 11.5625 3.4 11.9 2.5 12.35C2.35 12.4333 2.22917 12.55 2.1375 12.7C2.04583 12.85 2 13.0167 2 13.2V14ZM9.4125 5.4125C9.80417 5.02083 10 4.55 10 4C10 3.45 9.80417 2.97917 9.4125 2.5875C9.02083 2.19583 8.55 2 8 2C7.45 2 6.97917 2.19583 6.5875 2.5875C6.19583 2.97917 6 3.45 6 4C6 4.55 6.19583 5.02083 6.5875 5.4125C6.97917 5.80417 7.45 6 8 6C8.55 6 9.02083 5.80417 9.4125 5.4125Z"
      fill="#FEFEFF"
    />
  </svg>
);

const DotsIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
    <circle cx="12" cy="5" r="1.6" />
    <circle cx="12" cy="12" r="1.6" />
    <circle cx="12" cy="19" r="1.6" />
  </svg>
);

const SettingsIcon = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
);

const BillingIcon = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <rect x="2" y="5" width="20" height="14" rx="2" />
    <line x1="2" y1="10" x2="22" y2="10" />
  </svg>
);

const LogoutIcon = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <polyline points="16 17 21 12 16 7" />
    <line x1="21" y1="12" x2="9" y2="12" />
  </svg>
);

export default Sidebar;
