import Sidebar from "./Sidebar.jsx";
import styles from "./Template.module.css";
import { useEffect } from "react";
import { useLocation } from "react-router-dom";

const Template = ({ children }) => {
  const { pathname } = useLocation();

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  }, [pathname]);

  return (
    <div className={styles.wrapper}>
      <Sidebar />
      <main className={styles.main}>{children}</main>
    </div>
  );
};

export default Template;
