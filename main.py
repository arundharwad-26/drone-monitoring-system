import os
from datetime import datetime, timezone
from typing import Literal
from uuid import uuid4

from fastapi import (
    FastAPI,
    HTTPException,
    Header,
    Query,
    WebSocket,
    WebSocketDisconnect,
)
from fastapi.encoders import jsonable_encoder
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from websocket_manager import manager
from schemas import Telemetry
from services import analyze_telemetry
from database import get_connection, create_table
from image_capture import router as image_router
from anomaly_detection import detect_anomaly
from mission_planner import router as mission_router


# =========================================================
# APPLICATION
# =========================================================

app = FastAPI(
    title="Drone Monitoring System",
    description="Backend API for monitoring autonomous vehicles",
    version="1.4.0",
)


# =========================================================
# CORS CONFIGURATION
# =========================================================

frontend_origins = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
]

deployed_frontend = os.getenv("FRONTEND_URL", "").strip().rstrip("/")

if deployed_frontend:
    frontend_origins.append(deployed_frontend)

app.add_middleware(
    CORSMiddleware,
    allow_origins=frontend_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# =========================================================
# ROUTERS AND APPLICATION STATE
# =========================================================

app.include_router(image_router)
app.include_router(mission_router)

ACTIVE_MODE = "SIMULATOR"


class ModeRequest(BaseModel):
    mode: Literal["SIMULATOR", "REAL"]


class SecurityIncidentRequest(BaseModel):
    drone_id: str = Field(min_length=1, max_length=100)
    confirm_demo: bool = False
    wipe_demo_data: bool = False


class SecurityResolveRequest(BaseModel):
    incident_id: str = Field(min_length=1, max_length=100)


class DemoSanitizationRequest(BaseModel):
    confirm_demo: bool = False


# =========================================================
# SECURITY SIMULATION STATE
# =========================================================

SECURITY_STATE = {
    "active": False,
    "incident": None,
    "last_event": None,
    "demo_data": [],
}

SANITIZATION_HISTORY = []


@app.on_event("startup")
def startup():
    create_table()


# =========================================================
# GENERAL ENDPOINTS
# =========================================================

@app.get("/")
def home():
    return {
        "message": "Drone Monitoring System API is running",
        "status": "online",
    }


@app.get("/health")
def health_check():
    return {"status": "healthy"}


# =========================================================
# OPERATING MODE
# =========================================================

@app.get("/mode")
def get_mode():
    return {
        "mode": ACTIVE_MODE,
        "available_modes": ["SIMULATOR", "REAL"],
    }


@app.post("/mode")
def set_mode(request: ModeRequest):
    global ACTIVE_MODE

    ACTIVE_MODE = request.mode

    return {
        "message": "Operating mode updated successfully",
        "mode": ACTIVE_MODE,
    }


# =========================================================
# SECURITY STATUS
# =========================================================

@app.get("/security/status")
def get_security_status():
    return {
        "mode": ACTIVE_MODE,
        "incident_active": SECURITY_STATE["active"],
        "incident": SECURITY_STATE["incident"],
        "last_event": SECURITY_STATE["last_event"],
        "demo_data_count": len(SECURITY_STATE["demo_data"]),
        "note": (
            "Demo security state only. This endpoint does not inspect "
            "or delete actual drone, database, or image data."
        ),
    }


# =========================================================
# SIMULATOR PRIVACY SANITIZATION
# =========================================================

@app.post("/security/sanitize-demo")
async def sanitize_demo_data(request: DemoSanitizationRequest):
    """
    Clear the designated in-memory demo-data collection.

    This does not erase SQLite records, captured image files,
    physical-drone storage, or other persistent data.
    """

    if ACTIVE_MODE != "SIMULATOR":
        raise HTTPException(
            status_code=409,
            detail="Demo sanitization is available only in SIMULATOR mode.",
        )

    if not request.confirm_demo:
        raise HTTPException(
            status_code=400,
            detail="Explicit confirmation is required.",
        )

    cleared_count = len(SECURITY_STATE["demo_data"])
    SECURITY_STATE["demo_data"].clear()

    now = datetime.now(timezone.utc).isoformat()

    audit_record = {
        "event_id": str(uuid4()),
        "action": "SIMULATOR_DEMO_DATA_SANITIZATION",
        "status": "SUCCESS",
        "items_cleared": cleared_count,
        "created_at": now,
        "simulator_only": True,
    }

    SANITIZATION_HISTORY.append(audit_record)

    if len(SANITIZATION_HISTORY) > 100:
        del SANITIZATION_HISTORY[:-100]

    await manager.broadcast({
        "event": "demo_data_sanitized",
        "mode": ACTIVE_MODE,
        "result": audit_record,
        "message": "Designated simulator demo data cleared.",
        "created_at": now,
    })

    return {
        "message": "Simulator demo-data sanitization completed.",
        "result": audit_record,
        "note": (
            "Only SECURITY_STATE['demo_data'] was cleared. "
            "SQLite records, captured image files, physical-drone "
            "storage, and other persistent data were not erased."
        ),
    }


@app.get("/security/sanitization-history")
def get_sanitization_history():
    return {
        "mode": ACTIVE_MODE,
        "simulator_only": True,
        "count": len(SANITIZATION_HISTORY),
        "history": list(reversed(SANITIZATION_HISTORY)),
    }


# =========================================================
# SIMULATE SECURITY INCIDENT
# =========================================================

@app.post("/security/simulate")
async def simulate_security_incident(
    request: SecurityIncidentRequest,
):
    if ACTIVE_MODE != "SIMULATOR":
        raise HTTPException(
            status_code=409,
            detail=(
                "Security simulation is available only "
                "in SIMULATOR mode."
            ),
        )

    if not request.confirm_demo:
        raise HTTPException(
            status_code=400,
            detail=(
                "Set confirm_demo to true to confirm that this "
                "is a simulated security incident."
            ),
        )

    if SECURITY_STATE["active"]:
        raise HTTPException(
            status_code=409,
            detail=(
                "Resolve the active demo incident before "
                "creating another."
            ),
        )

    drone_id = request.drone_id.strip()

    if not drone_id:
        raise HTTPException(
            status_code=422,
            detail="Drone ID cannot be blank.",
        )

    now = datetime.now(timezone.utc).isoformat()

    incident = {
        "incident_id": str(uuid4()),
        "drone_id": drone_id,
        "type": "SIMULATED_SECURITY_COMPROMISE",
        "severity": "CRITICAL",
        "status": "ACTIVE",
        "created_at": now,
        "message": f"Simulated security compromise detected for drone {drone_id}.",
        "demo_data_wiped": False,
    }

    if request.wipe_demo_data:
        cleared_count = len(SECURITY_STATE["demo_data"])
        SECURITY_STATE["demo_data"].clear()
        incident["demo_data_wiped"] = True
        incident["demo_items_cleared"] = cleared_count

    SECURITY_STATE["active"] = True
    SECURITY_STATE["incident"] = incident
    SECURITY_STATE["last_event"] = now

    await manager.broadcast({
        "event": "security_incident",
        "mode": ACTIVE_MODE,
        "incident": incident,
        "demo_data_wiped": incident["demo_data_wiped"],
        "message": incident["message"],
        "created_at": now,
    })

    return {
        "message": "Simulated security incident created.",
        "incident": incident,
        "demo_data_wiped": incident["demo_data_wiped"],
        "note": (
            "Demo-only event. No physical drone was accessed, "
            "and no persistent database or image files were deleted."
        ),
    }


# =========================================================
# RESOLVE SECURITY INCIDENT
# =========================================================

@app.post("/security/resolve")
async def resolve_security_incident(
    request: SecurityResolveRequest,
):
    if ACTIVE_MODE != "SIMULATOR":
        raise HTTPException(
            status_code=409,
            detail=(
                "Demo incident resolution is available only "
                "in SIMULATOR mode."
            ),
        )

    incident = SECURITY_STATE["incident"]

    if not SECURITY_STATE["active"] or incident is None:
        raise HTTPException(
            status_code=404,
            detail="There is no active security incident.",
        )

    if incident["incident_id"] != request.incident_id:
        raise HTTPException(
            status_code=404,
            detail="The supplied incident ID does not match the active incident.",
        )

    now = datetime.now(timezone.utc).isoformat()

    resolved_incident = {
        **incident,
        "status": "RESOLVED",
        "resolved_at": now,
    }

    SECURITY_STATE["active"] = False
    SECURITY_STATE["incident"] = resolved_incident
    SECURITY_STATE["last_event"] = now

    await manager.broadcast({
        "event": "security_resolved",
        "mode": ACTIVE_MODE,
        "incident": resolved_incident,
        "message": (
            f"Demo security incident for drone "
            f"{resolved_incident['drone_id']} has been resolved."
        ),
        "created_at": now,
    })

    return {
        "message": "Demo security incident resolved.",
        "incident": resolved_incident,
    }


# =========================================================
# SIMULATED BATTERY MANAGEMENT
# =========================================================

LOW_BATTERY_THRESHOLD = 20

BATTERY_POOL = {
    f"BAT-{number:03d}": {
        "battery_id": f"BAT-{number:03d}",
        "status": "CHARGED",
        "charge_percent": 100,
        "assigned_drone": None,
    }
    for number in range(1, 5)
}

DRONE_BATTERY_STATE = {}
BATTERY_SWAP_HISTORY = []


# =========================================================
# EMERGENCY LANDING STATE
# =========================================================

EMERGENCY_LANDING_THRESHOLD = 10

EMERGENCY_LANDING_STATE = {}
EMERGENCY_LANDING_HISTORY = []


def get_emergency_landing_state(drone_id: str):
    return EMERGENCY_LANDING_STATE.get(
        drone_id,
        {
            "drone_id": drone_id,
            "status": "NORMAL",
            "reason": None,
            "battery_percent": None,
            "triggered_at": None,
            "landed_at": None,
            "incident_id": None,
        },
    )


async def trigger_emergency_landing(
    drone_id: str,
    battery_percent: int,
    reason: str,
):
    existing = EMERGENCY_LANDING_STATE.get(drone_id)

    if existing and existing.get("status") in {
        "EMERGENCY_LANDING",
        "LANDED",
    }:
        return existing

    now = datetime.now(timezone.utc).isoformat()

    incident = {
        "incident_id": str(uuid4()),
        "drone_id": drone_id,
        "status": "EMERGENCY_LANDING",
        "reason": reason,
        "battery_percent": int(battery_percent),
        "triggered_at": now,
        "landed_at": None,
        "simulator_only": True,
    }

    EMERGENCY_LANDING_STATE[drone_id] = incident.copy()
    EMERGENCY_LANDING_HISTORY.append(incident.copy())

    await manager.broadcast({
        "event": "emergency_landing_started",
        "mode": ACTIVE_MODE,
        "drone_id": drone_id,
        "incident": incident.copy(),
        "message": (
            f"Emergency landing simulation started for {drone_id}: "
            f"{reason}"
        ),
        "created_at": now,
    })

    return incident


async def mark_landing_completed(drone_id: str):
    incident = EMERGENCY_LANDING_STATE.get(drone_id)

    if not incident:
        return None

    if incident.get("status") == "LANDED":
        return incident

    if incident.get("status") != "EMERGENCY_LANDING":
        return incident

    now = datetime.now(timezone.utc).isoformat()

    incident["status"] = "LANDED"
    incident["landed_at"] = now

    for history_item in reversed(EMERGENCY_LANDING_HISTORY):
        if history_item.get("incident_id") == incident.get("incident_id"):
            history_item.update({
                "status": "LANDED",
                "landed_at": now,
            })
            break

    await manager.broadcast({
        "event": "emergency_landing_completed",
        "mode": ACTIVE_MODE,
        "drone_id": drone_id,
        "incident": incident.copy(),
        "message": (
            f"Simulated emergency landing completed for {drone_id}."
        ),
        "created_at": now,
    })

    return incident


# =========================================================
# BATTERY HELPERS
# =========================================================

def get_latest_telemetry(drone_id: str):
    connection = get_connection()

    try:
        row = connection.execute(
            """
            SELECT *
            FROM telemetry
            WHERE drone_id = ?
            ORDER BY id DESC
            LIMIT 1
            """,
            (drone_id,),
        ).fetchone()

        return dict(row) if row is not None else None

    finally:
        connection.close()


def get_or_create_drone_battery_state(
    drone_id: str,
    telemetry=None,
):
    state = DRONE_BATTERY_STATE.get(drone_id)

    if state is None:
        battery_percent = 100

        if telemetry is not None:
            try:
                battery_percent = max(
                    0,
                    min(100, int(float(telemetry.get("battery", 100)))),
                )
            except (TypeError, ValueError):
                battery_percent = 100

        state = {
            "drone_id": drone_id,
            "battery_id": f"{drone_id}-INITIAL",
            "battery_percent": battery_percent,
            "swapped_in_simulator": False,
            "last_swap_at": None,
        }

        DRONE_BATTERY_STATE[drone_id] = state

    elif telemetry is not None and not state["swapped_in_simulator"]:
        try:
            state["battery_percent"] = max(
                0,
                min(
                    100,
                    int(float(
                        telemetry.get(
                            "battery",
                            state["battery_percent"],
                        )
                    )),
                ),
            )
        except (TypeError, ValueError):
            pass

    return state


def build_battery_status(drone_id: str):
    telemetry = get_latest_telemetry(drone_id)

    if telemetry is None:
        raise HTTPException(
            status_code=404,
            detail=(
                f"No telemetry found for drone '{drone_id}'. "
                "Start its simulator first."
            ),
        )

    state = get_or_create_drone_battery_state(drone_id, telemetry)
    battery_percent = int(state["battery_percent"])

    charged_batteries_available = any(
        battery["status"] == "CHARGED"
        for battery in BATTERY_POOL.values()
    )

    return {
        "drone_id": drone_id,
        "battery": state.copy(),
        "battery_percent": battery_percent,
        "low_battery": battery_percent <= LOW_BATTERY_THRESHOLD,
        "emergency_landing_threshold": EMERGENCY_LANDING_THRESHOLD,
        "emergency_landing": get_emergency_landing_state(drone_id),
        "charged_batteries_available": charged_batteries_available,
        "battery_pool": list(BATTERY_POOL.values()),
        "simulator_only": True,
    }


# =========================================================
# BATTERY ENDPOINTS
# =========================================================

@app.get("/batteries")
def list_batteries():
    return {
        "mode": ACTIVE_MODE,
        "batteries": list(BATTERY_POOL.values()),
        "swap_history": BATTERY_SWAP_HISTORY[-50:],
        "simulator_only": True,
    }


@app.get("/batteries/status/{drone_id}")
def battery_status(drone_id: str):
    return build_battery_status(drone_id)


@app.post("/batteries/swap/{drone_id}")
async def swap_battery(drone_id: str):
    if ACTIVE_MODE != "SIMULATOR":
        raise HTTPException(
            status_code=409,
            detail=(
                "Simulated battery swapping is available only "
                "in SIMULATOR mode."
            ),
        )

    telemetry = get_latest_telemetry(drone_id)

    if telemetry is None:
        raise HTTPException(
            status_code=404,
            detail=f"No telemetry found for drone '{drone_id}'.",
        )

    state = get_or_create_drone_battery_state(drone_id, telemetry)
    battery_percent = float(state["battery_percent"])

    if battery_percent > LOW_BATTERY_THRESHOLD:
        raise HTTPException(
            status_code=409,
            detail=(
                f"Battery swap is allowed only at "
                f"{LOW_BATTERY_THRESHOLD}% or below. "
                f"Current battery: {battery_percent:.1f}%."
            ),
        )

    landing = get_emergency_landing_state(drone_id)

    if landing["status"] == "EMERGENCY_LANDING":
        raise HTTPException(
            status_code=409,
            detail="Battery swapping is blocked during an active emergency landing.",
        )

    available_battery = next(
        (
            battery
            for battery in BATTERY_POOL.values()
            if battery["status"] == "CHARGED"
        ),
        None,
    )

    if available_battery is None:
        raise HTTPException(
            status_code=409,
            detail="No charged spare batteries are available.",
        )

    old_battery_id = state["battery_id"]
    new_battery_id = available_battery["battery_id"]
    now = datetime.now(timezone.utc).isoformat()

    if old_battery_id in BATTERY_POOL:
        old_battery = BATTERY_POOL[old_battery_id]
        old_battery["status"] = "CHARGING"
        old_battery["assigned_drone"] = None
        old_battery["charge_percent"] = battery_percent
    else:
        BATTERY_POOL[old_battery_id] = {
            "battery_id": old_battery_id,
            "status": "CHARGING",
            "charge_percent": battery_percent,
            "assigned_drone": None,
        }

    available_battery["status"] = "IN_USE"
    available_battery["charge_percent"] = 100
    available_battery["assigned_drone"] = drone_id

    state.update({
        "battery_id": new_battery_id,
        "battery_percent": 100,
        "swapped_in_simulator": True,
        "last_swap_at": now,
    })

    history_item = {
        "swap_id": str(uuid4()),
        "drone_id": drone_id,
        "old_battery_id": old_battery_id,
        "new_battery_id": new_battery_id,
        "battery_percent_after_swap": 100,
        "status": "SUCCESS",
        "created_at": now,
        "simulator_only": True,
    }

    BATTERY_SWAP_HISTORY.append(history_item)

    await manager.broadcast({
        "event": "battery_swapped",
        "mode": ACTIVE_MODE,
        "drone_id": drone_id,
        "battery": state.copy(),
        "swap": history_item,
        "message": f"Simulated battery swap completed for {drone_id}.",
        "created_at": now,
    })

    return {
        "message": f"Simulated battery swap completed for {drone_id}.",
        "battery": state.copy(),
        "swap": history_item,
        "battery_pool": list(BATTERY_POOL.values()),
        "note": "Simulator state only. No physical battery was changed.",
    }# =========================================================
# EMERGENCY LANDING ENDPOINTS
# =========================================================

@app.get("/emergency-landing/status/{drone_id}")
def emergency_landing_status(drone_id: str):
    return {
        "mode": ACTIVE_MODE,
        "simulator_only": True,
        "drone_id": drone_id,
        "landing": get_emergency_landing_state(drone_id),
        "threshold_percent": EMERGENCY_LANDING_THRESHOLD,
    }


@app.get("/emergency-landing/history")
def emergency_landing_history():
    return {
        "mode": ACTIVE_MODE,
        "simulator_only": True,
        "incidents": EMERGENCY_LANDING_HISTORY[-50:],
        "count": len(EMERGENCY_LANDING_HISTORY),
    }


@app.post("/emergency-landing/complete/{drone_id}")
async def complete_emergency_landing(drone_id: str):
    """Mark an active simulated emergency landing as complete."""

    if ACTIVE_MODE != "SIMULATOR":
        raise HTTPException(
            status_code=409,
            detail="Emergency landing simulation is available only in SIMULATOR mode.",
        )

    incident = EMERGENCY_LANDING_STATE.get(drone_id)

    if not incident:
        raise HTTPException(
            status_code=404,
            detail="No emergency landing exists for this drone.",
        )

    if incident.get("status") == "LANDED":
        return {
            "message": "Emergency landing is already completed.",
            "landing": incident.copy(),
            "simulator_only": True,
        }

    if incident.get("status") != "EMERGENCY_LANDING":
        raise HTTPException(
            status_code=404,
            detail="No active simulated emergency landing exists for this drone.",
        )

    telemetry = get_latest_telemetry(drone_id)

    if telemetry is not None and float(telemetry.get("altitude", 0)) > 0:
        raise HTTPException(
            status_code=409,
            detail="The simulated drone has not reached ground level yet.",
        )

    incident = await mark_landing_completed(drone_id)

    return {
        "message": f"Simulated emergency landing completed for {drone_id}.",
        "landing": incident.copy(),
        "simulator_only": True,
    }


@app.post("/emergency-landing/reset/{drone_id}")
async def reset_emergency_landing(drone_id: str):
    """Reset a completed demo landing."""

    if ACTIVE_MODE != "SIMULATOR":
        raise HTTPException(
            status_code=409,
            detail="Emergency landing reset is available only in SIMULATOR mode.",
        )

    existing = EMERGENCY_LANDING_STATE.get(drone_id)

    if existing and existing.get("status") == "EMERGENCY_LANDING":
        raise HTTPException(
            status_code=409,
            detail="Complete the active simulated landing before resetting it.",
        )

    EMERGENCY_LANDING_STATE[drone_id] = {
        "drone_id": drone_id,
        "status": "NORMAL",
        "reason": None,
        "battery_percent": None,
        "triggered_at": None,
        "landed_at": None,
        "incident_id": None,
    }

    now = datetime.now(timezone.utc).isoformat()

    await manager.broadcast({
        "event": "emergency_landing_reset",
        "mode": ACTIVE_MODE,
        "drone_id": drone_id,
        "landing": EMERGENCY_LANDING_STATE[drone_id].copy(),
        "message": f"Emergency landing simulation reset for {drone_id}.",
        "created_at": now,
    })

    return {
        "message": f"Emergency landing simulation reset for {drone_id}.",
        "landing": EMERGENCY_LANDING_STATE[drone_id].copy(),
        "simulator_only": True,
    }


# =========================================================
# TELEMETRY INGESTION AND ANOMALY DETECTION
# =========================================================

@app.post("/telemetry")
async def receive_telemetry(
    data: Telemetry,
    source: Literal["simulator", "real"] = Header(
        ...,
        alias="X-Telemetry-Source",
    ),
):
    """Validate, save, analyze, and broadcast telemetry."""

    if source != ACTIVE_MODE.lower():
        raise HTTPException(
            status_code=409,
            detail=(
                f"Telemetry rejected. Active mode is {ACTIVE_MODE}; "
                f"received source is {source}."
            ),
        )

    if source == "simulator" and ACTIVE_MODE == "SIMULATOR":
        landing = EMERGENCY_LANDING_STATE.get(data.drone_id)

        if landing and landing.get("status") == "EMERGENCY_LANDING":
            if data.altitude <= 0:
                data.altitude = 0.0
                data.speed = 0.0
            else:
                data.speed = 0.0

    connection = get_connection()

    try:
        previous = connection.execute(
            """
            SELECT latitude, longitude, battery,
                   altitude, speed, connected
            FROM telemetry
            WHERE drone_id = ?
            ORDER BY id DESC
            LIMIT 1
            """,
            (data.drone_id,),
        ).fetchone()

        if previous is not None:
            same_reading = (
                previous["latitude"] == data.latitude
                and previous["longitude"] == data.longitude
                and previous["battery"] == data.battery
                and previous["altitude"] == data.altitude
                and previous["speed"] == data.speed
                and previous["connected"] == int(data.connected)
            )

            if same_reading:
                raise HTTPException(
                    status_code=409,
                    detail="Duplicate telemetry: identical to latest reading",
                )

        cursor = connection.execute(
            """
            INSERT INTO telemetry (
                drone_id, latitude, longitude, battery,
                altitude, speed, connected
            )
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                data.drone_id,
                data.latitude,
                data.longitude,
                data.battery,
                data.altitude,
                data.speed,
                data.connected,
            ),
        )

        connection.commit()
        record_id = cursor.lastrowid

    finally:
        connection.close()

    # Update simulated battery state.
    if source == "simulator":
        battery_state = DRONE_BATTERY_STATE.get(data.drone_id)

        if battery_state is not None:
            if battery_state["swapped_in_simulator"]:
                battery_state["battery_percent"] = max(
                    0,
                    int(battery_state["battery_percent"]) - 1,
                )

                current_pack = BATTERY_POOL.get(
                    battery_state["battery_id"]
                )

                if current_pack is not None:
                    current_pack["charge_percent"] = (
                        battery_state["battery_percent"]
                    )
            else:
                try:
                    battery_state["battery_percent"] = max(
                        0,
                        min(100, int(float(data.battery))),
                    )
                except (TypeError, ValueError):
                    pass

    # Trigger emergency landing at the critical battery threshold.
    if source == "simulator" and ACTIVE_MODE == "SIMULATOR":
        battery_state = DRONE_BATTERY_STATE.get(data.drone_id)

        try:
            if battery_state is not None:
                effective_battery = int(
                    battery_state["battery_percent"]
                )
            else:
                effective_battery = int(float(data.battery))
        except (TypeError, ValueError, KeyError):
            effective_battery = None

        if (
            bool(data.connected)
            and effective_battery is not None
            and effective_battery <= EMERGENCY_LANDING_THRESHOLD
        ):
            await trigger_emergency_landing(
                data.drone_id,
                effective_battery,
                f"Critical battery level ({effective_battery}%).",
            )

    # Complete landing when simulator reports ground level.
    landing = EMERGENCY_LANDING_STATE.get(data.drone_id)

    if (
        source == "simulator"
        and ACTIVE_MODE == "SIMULATOR"
        and landing
        and landing.get("status") == "EMERGENCY_LANDING"
        and data.altitude <= 0
    ):
        data.altitude = 0.0
        data.speed = 0.0
        await mark_landing_completed(data.drone_id)

    # Run telemetry analysis.
    analysis = analyze_telemetry(data)

    telemetry_dict = jsonable_encoder(data)
    ai_result = detect_anomaly(telemetry_dict)

    alerts = analysis.get("alerts", [])

    if not isinstance(alerts, list):
        alerts = []

    combined_alerts = list(alerts)

    existing_messages = {
        (
            alert.get("message", str(alert))
            if isinstance(alert, dict)
            else str(alert)
        )
        for alert in combined_alerts
    }

    for alert in ai_result.get("alerts", []):
        alert_message = alert.get("message", str(alert))

        if alert_message not in existing_messages:
            combined_alerts.append(alert)
            existing_messages.add(alert_message)

    anomaly_detected = ai_result.get("anomaly_detected", False)

    analysis.update({
        "status": (
            "Warning"
            if (
                anomaly_detected
                or analysis.get("status") == "Warning"
                or bool(combined_alerts)
            )
            else "Normal"
        ),
        "anomaly_detected": anomaly_detected,
        "anomaly_score": ai_result.get("anomaly_score"),
        "anomaly_model": ai_result.get("model"),
        "samples_used": ai_result.get("samples_used", 0),
        "alerts": combined_alerts,
    })

    message = {
        "event": "telemetry_update",
        "record_id": record_id,
        "drone_id": data.drone_id,
        "data": telemetry_dict,
        "analysis": analysis,
        "source": source,
        "mode": ACTIVE_MODE,
    }

    await manager.broadcast(message)

    return {
        "message": "Telemetry saved successfully",
        "record_id": record_id,
        "drone_id": data.drone_id,
        "data": telemetry_dict,
        "analysis": analysis,
        "source": source,
        "mode": ACTIVE_MODE,
    }


# =========================================================
# LATEST TELEMETRY FOR A DRONE
# =========================================================

@app.get("/telemetry/{drone_id}")
def get_drone_telemetry(drone_id: str):
    connection = get_connection()

    try:
        rows = connection.execute(
            """
            SELECT *
            FROM telemetry
            WHERE drone_id = ?
            ORDER BY id DESC
            LIMIT 1
            """,
            (drone_id,),
        ).fetchall()

        if not rows:
            raise HTTPException(
                status_code=404,
                detail=f"No telemetry found for drone '{drone_id}'.",
            )

        return dict(rows[0])

    finally:
        connection.close()


# =========================================================
# FLIGHT HISTORY API
# =========================================================

@app.get("/flight-history")
def get_flight_history():
    """Return a summary of stored telemetry for each drone."""

    connection = get_connection()

    try:
        rows = connection.execute(
            """
            SELECT
                drone_id,
                COUNT(*) AS total_records,
                MIN(id) AS first_record_id,
                MAX(id) AS last_record_id
            FROM telemetry
            GROUP BY drone_id
            ORDER BY drone_id
            """
        ).fetchall()

        return {
            "count": len(rows),
            "drones": [dict(row) for row in rows],
            "note": (
                "Summaries are based on stored telemetry records. "
                "They do not represent formally started or completed flights."
            ),
        }

    finally:
        connection.close()


@app.get("/flight-history/{drone_id}")
def get_drone_flight_history(
    drone_id: str,
    limit: int = Query(default=5000, ge=1, le=20000),
    offset: int = Query(default=0, ge=0),
):
    """Return historical telemetry points in chronological order."""

    connection = get_connection()

    try:
        summary = connection.execute(
            """
            SELECT COUNT(*) AS total_records
            FROM telemetry
            WHERE drone_id = ?
            """,
            (drone_id,),
        ).fetchone()

        total_records = summary["total_records"]

        if total_records == 0:
            raise HTTPException(
                status_code=404,
                detail=f"No history found for drone '{drone_id}'.",
            )

        # Select the newest page, then return that page chronologically.
        rows = connection.execute(
            """
            SELECT *
            FROM (
                SELECT *
                FROM telemetry
                WHERE drone_id = ?
                ORDER BY id DESC
                LIMIT ? OFFSET ?
            )
            ORDER BY id ASC
            """,
            (drone_id, limit, offset),
        ).fetchall()

        records = [dict(row) for row in rows]

        return {
            "drone_id": drone_id,
            "total_records": total_records,
            "returned_records": len(records),
            "limit": limit,
            "offset": offset,
            "records": records,
        }

    finally:
        connection.close()# =========================================================
# LIST DRONES
# =========================================================

@app.get("/drones")
def list_drones():
    connection = get_connection()

    try:
        rows = connection.execute(
            """
            SELECT t.*
            FROM telemetry t
            INNER JOIN (
                SELECT drone_id, MAX(id) AS latest_id
                FROM telemetry
                GROUP BY drone_id
            ) latest
            ON t.id = latest.latest_id
            ORDER BY t.drone_id
            """
        ).fetchall()

        drones = []

        for row in rows:
            drone = dict(row)

            drone["battery_status"] = DRONE_BATTERY_STATE.get(
                drone["drone_id"]
            )

            drone["emergency_landing"] = get_emergency_landing_state(
                drone["drone_id"]
            )

            drones.append(drone)

        return {
            "mode": ACTIVE_MODE,
            "count": len(drones),
            "drones": drones,
        }

    finally:
        connection.close()


# =========================================================
# WEBSOCKET
# =========================================================

@app.websocket("/ws/telemetry")
async def websocket_telemetry(websocket: WebSocket):
    await manager.connect(websocket)

    try:
        while True:
            await websocket.receive_text()

    except WebSocketDisconnect:
        manager.disconnect(websocket)

    except Exception:
        manager.disconnect(websocket)