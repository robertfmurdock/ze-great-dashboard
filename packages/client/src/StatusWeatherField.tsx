import styles from './StatusWeatherField.module.css'

export function StatusWeatherField() {
  return (
    <>
      <span className={styles.haze} data-running-part="weather-haze" />
      <span className={styles.pressure} data-running-part="weather-pressure" />
      <span className={`${styles.band} ${styles.bandOne}`} />
      <span className={`${styles.band} ${styles.bandTwo}`} />
      <span className={`${styles.band} ${styles.bandThree}`} />
      <span className={`${styles.drift} ${styles.driftOne}`} />
      <span className={`${styles.drift} ${styles.driftTwo}`} />
      <span className={`${styles.drift} ${styles.driftThree}`} />
      <span className={`${styles.drift} ${styles.driftFour}`} />
      <span className={`${styles.drift} ${styles.driftFive}`} />
    </>
  )
}
