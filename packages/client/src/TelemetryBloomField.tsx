import styles from './TelemetryBloomField.module.css'

export function TelemetryBloomField() {
  return (
    <>
      <span className={styles.frontier} data-running-part="frontier" />
      <span className={styles.lanes} data-running-part="bloom-lanes">
        {[0, 1, 2, 3].map((lane) => (
          <span className={styles.lane} key={lane} data-running-part="bloom-lane">
            <span className={styles.marker} data-running-part="bloom-marker" />
          </span>
        ))}
      </span>
    </>
  )
}
