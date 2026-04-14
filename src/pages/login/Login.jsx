import styles from "./Login.module.css";
import Google from "../../assets/google.png"
import { Link } from "react-router-dom";

const Login = () => {

  return(
        <>
        <div className={styles.wrapper}>
            <div className={styles.section}>
                <div style={{fontWeight: "bold", fontSize: "48px"}}>만나서 반가워요!</div>
                <p style={{fontSize:"14px", opacity: "70%", margin:"12px 0 0 0"}}>DraWe와 함께하기 위해 로그인 또는 회원가입을 진행해주세요.</p>
            </div>
            <form className={styles.loginBox}>
                <div style={{marginBottom: "18px"}}>
                    <p className={styles.loginValue}>이메일</p>
                    <input type="text" name="nickname" className={styles.infoItem} placeholder="예) Drawe@Drawe.com" />
                </div>
                <div style={{marginBottom: "52px"}}>
                    <p className={styles.loginValue} >비밀번호</p>
                    <input type="password" name="password" className={styles.infoItem} placeholder="Password"/>
                </div>


                <button type="submit" className={styles.loginBtn} >로그인</button>
                <div className={styles.divider}>
                    <span className={styles.line}></span>
                    <span className={styles.text}>or</span>
                    <span className={styles.line}></span>
                </div>
                <button className={styles.googleBtn} >
                    <img src={Google} className={styles.googleLogo}></img>
                    <p style={{fontWeight:"500"}}>Sign in with Google</p>
                </button>
                <div className={styles.signin}>
                    <p style={{margin: "0", fontWeight: "350"}}>계정이 없으신가요?</p>
                    <Link style={{margin: "0", fontWeight: "500"}}>회원가입하기</Link>
                </div>
            </form>
        </div>
        </>
    )
};

export default Login;