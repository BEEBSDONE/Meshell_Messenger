import styles from './ProfilePicture.module.css';

export default function ProfilePicture({ picture, isDarkMode }: { picture?: string; isDarkMode: boolean }) {
  return (
    <div className={`${styles.profilePicture} ${isDarkMode ? styles.darkMode : ''}`}>
      {picture
        ? <img src={picture} alt="" referrerPolicy="no-referrer" className={styles.profileImage} />
        : <div className={styles.noProfilePicture} />}
    </div>
  );
}
