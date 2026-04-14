import styles from "./Header.module.css";

const Header = () => {
    return (
    <div className={styles.wrapper}>
      <div className={styles.section}>
        <div style={{display:"flex", alignItems:"center"}}>
            <div style={{width:"32px", height:"32px", backgroundColor:"#ff8534", borderRadius:"11.43px", marginRight:"8px"}}></div>
            <p style={{margin:"0", color:"#ff8534"}}>Dra</p>We
        </div>
      </div>
    </div>
  );
}

export default Header