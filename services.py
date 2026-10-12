
# This file contains business logic about drones

from schemas import Telemetry

LOW_BATTERY_THRESHOLD = 20
CRITICAL_BATTERY_THRESHOLD = 10
MAX_ALTITUDE = 120
MAX_SPEED = 25


def analyze_telemetry(data: Telemetry) -> dict:
    alerts = []

    # 1. Critical battery alert
    if data.battery <= CRITICAL_BATTERY_THRESHOLD:
        alerts.append({
            "type": "CRITICAL_BATTERY",
            "message": f"CRITICAL: Battery is at {data.battery}%"
        })

    # 2. Low battery alert
    elif data.battery <= LOW_BATTERY_THRESHOLD:
        alerts.append({
            "type": "Low_Battery",
            "message": f"Battery is low: {data.battery}%"
        })

    # 3. Disconnection alert
    if not data.connected:
        alerts.append({
            "type": "DISCONNECTED",
            "message": "The drone reports that it is disconnected"
        })

    # 4. Abnormal altitude alert
    if data.altitude > MAX_ALTITUDE:
        alerts.append({
            "type": "HIGH_ALTITUDE",
            "message": f"Altitude exceeds configured limit: {data.altitude} m"
        })

    # 5. Abnormal speed alert
    if data.speed > MAX_SPEED:
        alerts.append({
            "type": "HIGH_SPEED",
            "message": f"Speed exceeds configured limit: {data.speed} m/s"
        })

    status = "Warning" if alerts else "Normal"

    return {
        "drone_id": data.drone_id,
        "status": status,
        "battery": data.battery,
        "connected": data.connected,
        "alerts": alerts
    }
