import styles from './ReleaseTransitField.module.css'

export function ReleaseTransitField() {
  return (
    <>
      <span className={styles.frontier} data-running-part="frontier" />
      <span className={styles.now} data-running-part="transit-now" />
      <span className={styles.routes} data-running-part="transit-routes">
        {[0, 1, 2].map((route) => (
          <span className={styles.route} key={route} />
        ))}
      </span>
      <span className={styles.trail} data-running-part="transit-trail" />
      <span className={styles.packet} data-running-part="transit-packet" />
    </>
  )
}
