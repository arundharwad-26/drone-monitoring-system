
from collections import defaultdict, deque
from threading import Lock

import numpy as np
from sklearn.ensemble import IsolationForest


class DroneAnomalyDetector:
    """
    Online, per-drone anomaly detector.

    The Isolation Forest model learns from previous telemetry samples.
    Until enough samples are available, basic safety checks are used.
    """

    FEATURES = ("battery", "altitude", "speed")

    # Adjust these limits to match your drone and simulator.
    MIN_BATTERY = 0
    MAX_ALTITUDE_METERS = 120
    MAX_SPEED_MPS = 35

    MIN_TRAINING_SAMPLES = 20
    HISTORY_SIZE = 200

    def __init__(self):
        self.history = defaultdict(
            lambda: deque(maxlen=self.HISTORY_SIZE)
        )
        self.models = {}
        self.lock = Lock()

    def _features(self, telemetry):
        values = []

        for feature in self.FEATURES:
            value = telemetry.get(feature)

            if value is None:
                raise ValueError(f"Missing telemetry field: {feature}")

            value = float(value)

            if not np.isfinite(value):
                raise ValueError(f"Invalid telemetry field: {feature}")

            values.append(value)

        return np.array(values, dtype=float).reshape(1, -1)

    def _rule_alerts(self, telemetry):
        alerts = []

        try:
            battery = float(telemetry.get("battery", 100))
            altitude = float(telemetry.get("altitude", 0))
            speed = float(telemetry.get("speed", 0))
        except (TypeError, ValueError):
            return [{
                "type": "INVALID_TELEMETRY",
                "message": "Battery, altitude or speed is not numeric."
            }]

        if not 0 <= battery <= 100:
            alerts.append({
                "type": "INVALID_BATTERY",
                "message": f"Battery reading is outside 0-100%: {battery}."
            })

        if altitude < 0 or altitude > self.MAX_ALTITUDE_METERS:
            alerts.append({
                "type": "UNUSUAL_ALTITUDE",
                "message": (
                    f"Altitude {altitude:.1f} m is outside the configured "
                    f"0-{self.MAX_ALTITUDE_METERS} m range."
                )
            })

        if speed < 0 or speed > self.MAX_SPEED_MPS:
            alerts.append({
                "type": "UNUSUAL_SPEED",
                "message": (
                    f"Speed {speed:.1f} m/s is outside the configured "
                    f"0-{self.MAX_SPEED_MPS} m/s range."
                )
            })

        if 0 <= battery <= 20:
            alerts.append({
                "type": "LOW_BATTERY",
                "message": f"Low battery detected: {battery:.1f}%."
            })

        if telemetry.get("connected") is False:
            alerts.append({
                "type": "DISCONNECTED",
                "message": "Drone is reporting a disconnected state."
            })

        return alerts

    def analyze(self, telemetry):
        drone_id = str(telemetry.get("drone_id", "unknown"))
        alerts = self._rule_alerts(telemetry)

        if drone_id == "unknown":
            return {
                "status": "Warning" if alerts else "Normal",
                "anomaly_detected": bool(alerts),
                "anomaly_score": None,
                "model": "IsolationForest",
                "samples_used": 0,
                "alerts": alerts,
            }

        try:
            sample = self._features(telemetry)
        except (TypeError, ValueError) as exc:
            alerts.append({
                "type": "INVALID_TELEMETRY",
                "message": str(exc),
            })

            return {
                "status": "Warning",
                "anomaly_detected": True,
                "anomaly_score": None,
                "model": "IsolationForest",
                "samples_used": len(self.history[drone_id]),
                "alerts": alerts,
            }

        with self.lock:
            history = self.history[drone_id]
            score = None
            ml_anomaly = False

            # Train and score only after collecting a baseline.
            # The current sample is scored BEFORE it is added to history.
            if len(history) >= self.MIN_TRAINING_SAMPLES:
                training_data = np.array(list(history), dtype=float)

                model = IsolationForest(
                    n_estimators=100,
                    contamination=0.05,
                    random_state=42,
                )

                model.fit(training_data)

                prediction = int(model.predict(sample)[0])
                score = float(model.decision_function(sample)[0])
                ml_anomaly = prediction == -1

                if ml_anomaly:
                    alerts.append({
                        "type": "AI_ANOMALY",
                        "message": (
                            "Isolation Forest detected an unusual "
                            "combination of battery, altitude and speed."
                        ),
                    })

            # Avoid adding clearly suspicious samples to the normal baseline.
            if not alerts:
                history.append(sample.flatten().tolist())

        return {
            "status": "Warning" if alerts else "Normal",
            "anomaly_detected": bool(alerts),
            "anomaly_score": score,
            "model": "IsolationForest",
            "samples_used": len(self.history[drone_id]),
            "alerts": alerts,
        }


# One shared detector for all incoming telemetry.
detector = DroneAnomalyDetector()


def detect_anomaly(telemetry):
    """Call this function for each incoming telemetry dictionary."""
    return detector.analyze(telemetry)
