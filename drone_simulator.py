
import time
import random
import requests

# =========================================================
# CONFIGURATION
# =========================================================

BASE_URL = "http://127.0.0.1:8000"

API_URL = f"{BASE_URL}/telemetry"
MODE_URL = f"{BASE_URL}/mode"

POLL_INTERVAL = 1
REQUEST_TIMEOUT = 5
RECONNECT_INTERVAL = 2

EMERGENCY_LANDING_THRESHOLD = 10.0
DESCENT_RATE_METERS = 2.0
GROUND_ALTITUDE = 0.0

MIN_ALTITUDE = 20.0
MAX_ALTITUDE = 100.0

MIN_LATITUDE = 15.4500
MAX_LATITUDE = 15.4800

MIN_LONGITUDE = 74.9900
MAX_LONGITUDE = 75.0300

# Set True only when you want to test an emergency landing.
# The selected drone will start with a critical battery.
TEST_EMERGENCY_LANDING = False
TEST_DRONE_ID = "drone-001"


# =========================================================
# SIMULATED DRONES
# =========================================================

DRONES = {
    "drone-001": {
        "latitude": 15.4589,
        "longitude": 75.0078,
        "battery": 85.0,
        "altitude": 80.0,
        "speed": 15.0,
        "emergency_landing": False,
        "landed": False,
        "completion_requested": False,
    },
    "drone-002": {
        "latitude": 15.4620,
        "longitude": 75.0100,
        "battery": 70.0,
        "altitude": 90.0,
        "speed": 20.0,
        "emergency_landing": False,
        "landed": False,
        "completion_requested": False,
    },
}

if TEST_EMERGENCY_LANDING and TEST_DRONE_ID in DRONES:
    DRONES[TEST_DRONE_ID]["battery"] = 9.0


# =========================================================
# OPERATING MODE
# =========================================================

def get_operating_mode(session):
    """Get the current operating mode from the backend."""

    response = session.get(
        MODE_URL,
        timeout=REQUEST_TIMEOUT,
    )
    response.raise_for_status()

    result = response.json()
    mode = result.get("mode")

    if mode not in ("SIMULATOR", "REAL"):
        raise ValueError(
            f"Unexpected operating mode: {mode}"
        )

    return mode


# =========================================================
# BACKEND EMERGENCY LANDING STATUS
# =========================================================

def get_landing_status(session, drone_id):
    """Read a drone's emergency landing status."""

    url = (
        f"{BASE_URL}/emergency-landing/status/"
        f"{drone_id}"
    )

    response = session.get(
        url,
        timeout=REQUEST_TIMEOUT,
    )
    response.raise_for_status()

    result = response.json()
    landing = result.get("landing") or {}

    return landing.get("status", "NORMAL")


# =========================================================
# NORMAL TELEMETRY GENERATION
# =========================================================

def generate_normal_telemetry(drone_id, state):
    """Generate telemetry during normal flight."""

    # Simulate small GPS movements.
    next_latitude = state["latitude"] + random.uniform(
        -0.0001, 0.0001
    )
    next_longitude = state["longitude"] + random.uniform(
        -0.0001, 0.0001
    )

    state["latitude"] = max(
        MIN_LATITUDE,
        min(MAX_LATITUDE, next_latitude),
    )

    state["longitude"] = max(
        MIN_LONGITUDE,
        min(MAX_LONGITUDE, next_longitude),
    )

    # Simulate battery consumption.
    state["battery"] = max(
        0.0,
        state["battery"] - random.uniform(0.01, 0.05),
    )

    # Maintain normal flight altitude.
    altitude_change = random.uniform(-1.0, 1.0)

    state["altitude"] = max(
        MIN_ALTITUDE,
        min(
            MAX_ALTITUDE,
            state["altitude"] + altitude_change,
        ),
    )

    # Simulate small speed changes.
    state["speed"] = max(
        0.0,
        min(
            25.0,
            state["speed"] + random.uniform(-0.3, 0.3),
        ),
    )

    return {
        "drone_id": drone_id,
        "latitude": round(state["latitude"], 6),
        "longitude": round(state["longitude"], 6),
        "battery": round(state["battery"], 2),
        "altitude": round(state["altitude"], 2),
        "speed": round(state["speed"], 2),
        "connected": True,
    }


# =========================================================
# EMERGENCY DESCENT
# =========================================================

def generate_emergency_telemetry(drone_id, state):
    """Simulate a controlled descent to ground level."""

    if state["altitude"] > GROUND_ALTITUDE:
        state["altitude"] = max(
            GROUND_ALTITUDE,
            state["altitude"] - DESCENT_RATE_METERS,
        )

    state["speed"] = 0.0

    if state["altitude"] <= GROUND_ALTITUDE:
        state["altitude"] = GROUND_ALTITUDE
        state["landed"] = True

    return {
        "drone_id": drone_id,
        "latitude": round(state["latitude"], 6),
        "longitude": round(state["longitude"], 6),
        "battery": round(state["battery"], 2),
        "altitude": round(state["altitude"], 2),
        "speed": 0.0,
        "connected": True,
    }


# =========================================================
# SEND TELEMETRY
# =========================================================

def send_telemetry(session, telemetry):
    """Send telemetry to the backend."""

    try:
        response = session.post(
            API_URL,
            json=telemetry,
            headers={
                "X-Telemetry-Source": "simulator",
            },
            timeout=REQUEST_TIMEOUT,
        )

        if response.status_code == 200:
            result = response.json()
            analysis = result.get("analysis") or {}

            print(
                f"{telemetry['drone_id']} | "
                f"Battery: {telemetry['battery']:.2f}% | "
                f"Altitude: {telemetry['altitude']:.2f} m | "
                f"Speed: {telemetry['speed']:.2f} m/s | "
                f"Status: {analysis.get('status', 'N/A')} | "
                f"Record: {result.get('record_id', 'N/A')}"
            )

            for alert in analysis.get("alerts") or []:
                if isinstance(alert, dict):
                    message = alert.get("message", str(alert))
                else:
                    message = str(alert)

                print(f"    ALERT: {message}")

            return True

        print(
            f"{telemetry['drone_id']} | "
            f"HTTP {response.status_code}: "
            f"{response.text[:300]}"
        )

    except requests.RequestException as error:
        print(
            f"{telemetry['drone_id']} | "
            f"Telemetry request failed: {error}"
        )

    except ValueError as error:
        print(
            f"{telemetry['drone_id']} | "
            f"Invalid backend response: {error}"
        )

    return False


# =========================================================
# COMPLETE EMERGENCY LANDING
# =========================================================

def complete_landing(session, drone_id, state):
    """
    Ask the backend to mark the simulated landing as complete.

    The backend endpoint only accepts completion when an
    emergency landing is currently active.
    """

    if state["completion_requested"]:
        return

    url = (
        f"{BASE_URL}/emergency-landing/complete/"
        f"{drone_id}"
    )

    try:
        response = session.post(
            url,
            timeout=REQUEST_TIMEOUT,
        )

        if response.status_code == 200:
            state["completion_requested"] = True
            state["landed"] = True

            print(
                f"{drone_id} | "
                "Backend confirmed emergency landing completed."
            )

        elif response.status_code == 404:
            # The backend may already have changed the status.
            landing_status = get_landing_status(
                session,
                drone_id,
            )

            if landing_status == "LANDED":
                state["completion_requested"] = True
                state["landed"] = True

                print(
                    f"{drone_id} | "
                    "Landing was already marked LANDED."
                )
            else:
                print(
                    f"{drone_id} | "
                    "Backend has no active landing to complete. "
                    "Check the emergency status."
                )

        else:
            print(
                f"{drone_id} | Landing completion returned "
                f"HTTP {response.status_code}: "
                f"{response.text[:200]}"
            )

    except requests.RequestException as error:
        print(
            f"{drone_id} | Could not confirm landing: {error}"
        )


# =========================================================
# PROCESS ONE DRONE
# =========================================================

def process_drone(session, drone_id, state):
    """Handle normal flight, emergency descent, or landed state."""

    try:
        landing_status = get_landing_status(
            session,
            drone_id,
        )

    except requests.RequestException as error:
        print(
            f"{drone_id} | Could not read landing status: "
            f"{error}"
        )

        # Do not start a new emergency based on an unknown status.
        # Continue an already active descent if one was recorded.
        if not state["emergency_landing"]:
            return

        landing_status = "EMERGENCY_LANDING"

    if landing_status == "LANDED":
        state["emergency_landing"] = True
        state["landed"] = True
        state["altitude"] = GROUND_ALTITUDE
        state["speed"] = 0.0

        print(
            f"{drone_id} | Landing confirmed. "
            "Normal flight remains stopped."
        )
        return

    if landing_status == "EMERGENCY_LANDING":
        if not state["emergency_landing"]:
            print(
                f"\n{drone_id} | EMERGENCY LANDING TRIGGERED"
            )

        state["emergency_landing"] = True

    if state["landed"]:
        state["altitude"] = GROUND_ALTITUDE
        state["speed"] = 0.0

        # Retry completion if the backend request previously failed.
        if not state["completion_requested"]:
            complete_landing(session, drone_id, state)

        return

    if state["emergency_landing"]:
        telemetry = generate_emergency_telemetry(
            drone_id,
            state,
        )

        sent = send_telemetry(session, telemetry)

        if state["landed"] and sent:
            complete_landing(session, drone_id, state)

        return

    telemetry = generate_normal_telemetry(
        drone_id,
        state,
    )

    send_telemetry(session, telemetry)


# =========================================================
# MAIN LOOP
# =========================================================

def main():
    print("=" * 65)
    print("       AQUAAIRX DRONE MONITORING SYSTEM")
    print("                  SIMULATOR")
    print("=" * 65)

    print(f"Backend: {BASE_URL}")
    print(f"Simulated drones: {len(DRONES)}")
    print(
        f"Emergency threshold: "
        f"{EMERGENCY_LANDING_THRESHOLD}%"
    )
    print(
        f"Descent rate: {DESCENT_RATE_METERS} metres "
        "per update"
    )

    if TEST_EMERGENCY_LANDING:
        print(
            f"TEST MODE: {TEST_DRONE_ID} starts with "
            "a critical battery."
        )

    print("Press Ctrl+C to stop.\n")

    last_mode = None

    with requests.Session() as session:
        try:
            while True:
                try:
                    mode = get_operating_mode(session)

                    if mode != last_mode:
                        print(
                            f"\nOperating mode changed to: {mode}"
                        )
                        last_mode = mode

                    if mode == "REAL":
                        print(
                            "Simulator paused. Switch to "
                            "SIMULATOR mode to resume."
                        )

                        time.sleep(POLL_INTERVAL)
                        continue

                    for drone_id, state in DRONES.items():
                        process_drone(
                            session,
                            drone_id,
                            state,
                        )

                    time.sleep(POLL_INTERVAL)

                except requests.RequestException as error:
                    print(
                        f"Backend connection error: {error}"
                    )
                    time.sleep(RECONNECT_INTERVAL)

                except (ValueError, KeyError) as error:
                    print(
                        f"Backend response error: {error}"
                    )
                    time.sleep(RECONNECT_INTERVAL)

        except KeyboardInterrupt:
            print("\nDrone simulator stopped by user.")

    print("Simulator shut down successfully.")


if __name__ == "__main__":
    main()