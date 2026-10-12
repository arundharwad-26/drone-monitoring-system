
import os
from typing import Literal

from fastapi import (
    FastAPI,
    HTTPException,
    Header,
    WebSocket,
    WebSocketDisconnect,
)
from fastapi.encoders import jsonable_encoder
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from websocket_manager import manager
from schemas import Telemetry
from services import analyze_telemetry
from database import get_connection, create_table
from image_capture import router as image_router
from anomaly_detection import detect_anomaly


app = FastAPI(
    title="Drone Monitoring System",
    description="Backend API for monitoring autonomous vehicles",
    version="1.1.0",
)


# --------------------------------------------------
# CORS CONFIGURATION
# --------------------------------------------------

frontend_origins = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
]

# Set FRONTEND_URL in your deployment environment.
# Example: https://your-frontend.example.com
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


# --------------------------------------------------
# ROUTERS AND APPLICATION STATE
# --------------------------------------------------

app.include_router(image_router)

ACTIVE_MODE = "SIMULATOR"


class ModeRequest(BaseModel):
    mode: Literal["SIMULATOR", "REAL"]


@app.on_event("startup")
def startup():
    create_table()


# --------------------------------------------------
# GENERAL ENDPOINTS
# --------------------------------------------------

@app.get("/")
def home():
    return {
        "message": "Drone Monitoring System API is running",
        "status": "online",
    }


@app.get("/health")
def health_check():
    return {"status": "healthy"}


# --------------------------------------------------
# DRONE OPERATING MODE
# --------------------------------------------------

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


# --------------------------------------------------
# TELEMETRY INGESTION AND ANOMALY DETECTION
# --------------------------------------------------

@app.post("/telemetry")
async def receive_telemetry(
    data: Telemetry,
    source: Literal["simulator", "real"] = Header(
        ...,
        alias="X-Telemetry-Source",
    ),
):
    if source != ACTIVE_MODE.lower():
        raise HTTPException(
            status_code=409,
            detail=(
                f"Telemetry rejected. Active mode is {ACTIVE_MODE}; "
                f"received source is {source}."
            ),
        )

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
                    detail=(
                        "Duplicate telemetry: identical to latest reading"
                    ),
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

    analysis = analyze_telemetry(data)
    telemetry_dict = jsonable_encoder(data)
    ai_result = detect_anomaly(telemetry_dict)

    alerts = analysis.get("alerts", [])
    if not isinstance(alerts, list):
        alerts = []

    combined_alerts = list(alerts)

    existing_messages = {
        alert.get("message", str(alert))
        if isinstance(alert, dict)
        else str(alert)
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


# --------------------------------------------------
# LATEST TELEMETRY FOR A DRONE
# --------------------------------------------------

@app.get("/telemetry/{drone_id}")
def get_telemetry(drone_id: str):
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
    finally:
        connection.close()

    if row is None:
        raise HTTPException(
            status_code=404,
            detail="Drone telemetry not found",
        )

    return dict(row)


# --------------------------------------------------
# LATEST TELEMETRY FOR ALL DRONES
# --------------------------------------------------

@app.get("/drones")
def get_all_drones():
    connection = get_connection()

    try:
        rows = connection.execute(
            """
            SELECT t.*,
                CASE
                    WHEN t.connected = 0 THEN 'DISCONNECTED'
                    WHEN datetime(t.created_at)
                         < datetime('now', '-2 minutes')
                        THEN 'STALE'
                    ELSE 'ONLINE'
                END AS telemetry_status
            FROM telemetry AS t
            INNER JOIN (
                SELECT drone_id, MAX(id) AS latest_id
                FROM telemetry
                GROUP BY drone_id
            ) AS latest
                ON t.id = latest.latest_id
            ORDER BY t.drone_id
            """
        ).fetchall()
    finally:
        connection.close()

    drones = [dict(row) for row in rows]

    return {
        "total_drones": len(drones),
        "drones": drones,
    }


# --------------------------------------------------
# WEBSOCKET TELEMETRY
# --------------------------------------------------

@app.websocket("/ws/telemetry")
async def telemetry_websocket(websocket: WebSocket):
    await manager.connect(websocket)

    try:
        while True:
            await websocket.receive_text()

    except WebSocketDisconnect:
        pass

    except Exception as error:
        print("WebSocket error:", repr(error))

    finally:
        manager.disconnect(websocket)
