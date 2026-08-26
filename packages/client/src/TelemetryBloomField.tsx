import { PhasedProgressMarker } from './PhasedProgressMarker.tsx'
import styles from './TelemetryBloomField.module.css'

export function TelemetryBloomField() {
  return (
    <>
      <span className={styles.frontier} data-running-part="frontier" />
      <span className={styles.lanes} data-running-part="bloom-lanes">
        {[0, 1, 2, 3].map((lane) => (
          <span className={styles.lane} key={lane} data-running-part="bloom-lane">
            <PhasedProgressMarker
              anchorClassName={styles.markerAnchor}
              bodyClassName={styles.markerBody}
              delay={[undefined, '-0.8s', '-1.7s', '-2.4s'][lane]}
              anchorPart="bloom-marker-anchor"
              bodyPart="bloom-marker"
            />
          </span>
        ))}
      </span>
    </>
  )
}
