import Header from "./Header.jsx"
import styles from "./Template.module.css"

const Template = ({ children }) => {
    return (
        <>
            <div className={styles.wrapper}>
                <main>
                    <Header/>
                    {children}
                </main>
            </div>
        </>
    )
}

export default Template