
import time
import random
import requests

BASE_URL = "http://127.0.0.1:8000"
API_URL = f"{BASE_URL}/telemetry"
MODE_URL = f"{BASE_URL}/mode"

POLL_INTERVAL = 1
REQUEST_TIMEOUT = 5

DRONES = {
    "drone-001": {
        "latitude": 15.4589,
        "longitude": 75.0078,
        "battery": 85.0,
        "altitude": 120.0,
        "speed": 15.0,
    },
    "drone-002": {
        "latitude": 15.4620,
        "longitude": 75.0100,
        "battery": 70.0,
        "altitude": 150.0,
        "speed": 20.0,
    },
}


def generate_telemetry(drone_id, state):
    """Generate the next simulated telemetry reading."""

    state["latitude"] += random.uniform(-0.0002, 0.0002)
    state["longitude"] += random.uniform(-0.0002, 0.0002)

    state["battery"] = max(
        0.0,
        state["battery"] - random.uniform(0.01, 0.08),
    )

    state["altitude"] = max(
        0.0,
        state["altitude"] + random.uniform(-1.0, 1.0),
    )

    state["speed"] = max(
        0.0,
        state["speed"] + random.uniform(-0.5, 0.5),
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


def get_operating_mode(session):
    """Read the active operating mode from the FastAPI backend."""

    response = session.get(
        MODE_URL,
        timeout=REQUEST_TIMEOUT,
    )
    response.raise_for_status()

    result = response.json()
    mode = result.get("mode")

    if mode not in ("SIMULATOR", "REAL"):
        raise ValueError(f"Unexpected operating mode: {mode}")

    return mode


def send_telemetry(session, drone_id, state):
    """Send one simulated drone reading to the backend."""

    telemetry = generate_telemetry(drone_id, state)

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
                f"{drone_id} | "
                f"Battery: {telemetry['battery']}% | "
                f"Altitude: {telemetry['altitude']} m | "
                f"Speed: {telemetry['speed']} m/s | "
                f"Record: {result.get('record_id', 'N/A')} | "
                f"Status: {analysis.get('status', 'N/A')}"
            )

        elif response.status_code == 409:
            print(
                f"{drone_id} | Telemetry rejected: "
                "the backend is not in Simulator Mode."
            )

        else:
            print(
                f"{drone_id} | HTTP {response.status_code}: "
                f"{response.text[:300]}"
            )

    except requests.RequestException as error:
        print(f"{drone_id} | Telemetry request failed: {error}")

    except ValueError as error:
        print(f"{drone_id} | Invalid backend response: {error}")


def main():
    print("=" * 55)
    print("       DRONE MONITORING SYSTEM - SIMULATOR")
    print("=" * 55)
    print("Waiting for the backend operating mode.")
    print("Press Ctrl+C to stop.\n")

    last_mode = None

    with requests.Session() as session:
        try:
            while True:
                try:
                    mode = get_operating_mode(session)

                    if mode != last_mode:
                        print(f"\nOperating mode changed to: {mode}")
                        last_mode = mode

                    if mode == "REAL":
                        print(
                            "Simulator paused. "
                            "Switch to Simulator Mode to resume telemetry."
                        )
                        time.sleep(POLL_INTERVAL)
                        continue

                    for drone_id, state in DRONES.items():
                        send_telemetry(session, drone_id, state)

                    time.sleep(POLL_INTERVAL)

                except requests.RequestException as error:
                    print(f"Backend connection error: {error}")
                    time.sleep(2)

                except (ValueError, KeyError) as error:
                    print(f"Mode API response error: {error}")
                    time.sleep(2)

        except KeyboardInterrupt:
            print("\n\nDrone simulator stopped by user.")


if __name__ == "__main__":
    main()
