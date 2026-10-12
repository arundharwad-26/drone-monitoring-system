
import { useEffect, useState } from "react";
import {
  MapContainer,
  TileLayer,
  CircleMarker,
  Popup,
} from "react-leaflet";

import "leaflet/dist/leaflet.css";
import "./App.css";
import useDangerBuzzer from "./useDangerBuzzer";

const API_URL = "http://127.0.0.1:8000";
const WS_URL = "ws://127.0.0.1:8000/ws/telemetry";

function getAlertMessage(alert) {
  if (typeof alert === "string") return alert;
  return alert?.message || "Unknown alert";
}

function isCriticalAlert(alert) {
  const message = getAlertMessage(alert);
  const type =
    typeof alert === "object" && alert !== null
      ? alert.type || ""
      : "";

  return /critical|danger|ai_anomaly|unusual_altitude|unusual_speed|low_battery|disconnected|invalid_battery/i.test(
    `${type} ${message}`
  );
}

function EmergencyAlerts({ drones }) {
  const alerts = drones.flatMap((drone) =>
    (drone.analysis?.alerts || []).map((alert, index) => ({
      id: `${drone.drone_id}-${index}-${getAlertMessage(alert)}`,
      droneId: drone.drone_id,
      message: getAlertMessage(alert),
      critical: isCriticalAlert(alert),
    }))
  );

  return (
    <section className="emergency-panel">
      <div className="emergency-heading">
        <div>
          <h2>Emergency Alerts</h2>
          <p>Live fleet safety notifications</p>
        </div>
        <span className="alert-count">{alerts.length} ACTIVE</span>
      </div>

      {alerts.length === 0 ? (
        <p className="no-alerts">No active alerts detected.</p>
      ) : (
        <div className="emergency-list">
          {alerts.map((alert) => (
            <article
              key={alert.id}
              className={`emergency-item ${
                alert.critical ? "critical" : "warning"
              }`}
            >
              <strong>
                {alert.critical ? "CRITICAL" : "WARNING"}
              </strong>
              <span>{alert.droneId}</span>
              <p>{alert.message}</p>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function SummaryCard({ label, value }) {
  return (
    <article className="summary-card">
      <p>{label}</p>
      <h2>{value}</h2>
    </article>
  );
}

function Metric({ label, value }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value ?? "—"}</strong>
    </div>
  );
}

function DroneCard({ drone }) {
  const battery = Number(drone.battery ?? 0);

  const warning =
    drone.analysis?.status === "Warning" ||
    (drone.analysis?.alerts || []).some(isCriticalAlert);

  const disconnected =
    !drone.connected ||
    drone.telemetry_status === "DISCONNECTED" ||
    drone.telemetry_status === "STALE";

  return (
    <article className="drone-card">
      <div className="drone-card-header">
        <div>
          <p className="eyebrow">AUTONOMOUS VEHICLE</p>
          <h3>{drone.drone_id}</h3>
        </div>

        <span
          className={`badge ${
            disconnected
              ? "offline"
              : warning
                ? "warning"
                : "online"
          }`}
        >
          {disconnected
            ? drone.telemetry_status || "DISCONNECTED"
            : warning
              ? "WARNING"
              : "ONLINE"}
        </span>
      </div>

      <div className="battery-section">
        <div className="metric-heading">
          <span>Battery</span>
          <strong>{battery.toFixed(1)}%</strong>
        </div>

        <div className="battery-track">
          <div
            className={`battery-fill ${battery <= 20 ? "low" : ""}`}
            style={{
              width: `${Math.min(100, Math.max(0, battery))}%`,
            }}
          />
        </div>
      </div>

      <div className="metrics-grid">
        <Metric
          label="Altitude"
          value={`${drone.altitude ?? "—"} m`}
        />
        <Metric
          label="Speed"
          value={`${drone.speed ?? "—"} m/s`}
        />
        <Metric label="Latitude" value={drone.latitude} />
        <Metric label="Longitude" value={drone.longitude} />
      </div>

      {drone.analysis?.alerts?.length > 0 && (
        <div className="alerts">
          {drone.analysis.alerts.map((alert, index) => (
            <p key={`${drone.drone_id}-alert-${index}`}>
              ⚠ {getAlertMessage(alert)}
            </p>
          ))}
        </div>
      )}

      <p className="record-id">
        Latest record: {drone.record_id ?? drone.id ?? "—"}
      </p>
    </article>
  );
}

function FleetMap({ drones }) {
  const validDrones = drones.filter(
    (drone) =>
      drone.latitude !== null &&
      drone.latitude !== undefined &&
      drone.longitude !== null &&
      drone.longitude !== undefined &&
      Number.isFinite(Number(drone.latitude)) &&
      Number.isFinite(Number(drone.longitude)) &&
      Number(drone.latitude) >= -90 &&
      Number(drone.latitude) <= 90 &&
      Number(drone.longitude) >= -180 &&
      Number(drone.longitude) <= 180
  );

  return (
    <section className="map-section">
      <div className="map-heading">
        <div>
          <h2>Live Drone Locations</h2>
          <p>Latest reported GPS positions</p>
        </div>
        <span className="live-label">
          {validDrones.length} DRONES
        </span>
      </div>

      <MapContainer
        center={[15.459, 75.008]}
        zoom={14}
        scrollWheelZoom={false}
        className="fleet-map"
      >
        <TileLayer
          attribution="&copy; OpenStreetMap contributors"
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        {validDrones.map((drone) => {
          const battery = Number(drone.battery ?? 0);

          const isWarning =
            !drone.connected ||
            battery <= 20 ||
            drone.analysis?.status === "Warning" ||
            (drone.analysis?.alerts || []).some(isCriticalAlert);

          return (
            <CircleMarker
              key={drone.drone_id}
              center={[
                Number(drone.latitude),
                Number(drone.longitude),
              ]}
              radius={9}
              pathOptions={{
                color: isWarning ? "#dc4655" : "#087c57",
                fillColor: isWarning ? "#dc4655" : "#16a36a",
                fillOpacity: 0.9,
                weight: 2,
              }}
            >
              <Popup>
                <strong>{drone.drone_id}</strong>
                <br />
                Status: {drone.connected ? "Connected" : "Disconnected"}
                <br />
                Battery: {battery.toFixed(1)}%
                <br />
                Speed: {drone.speed ?? "—"} m/s
                <br />
                Latitude: {drone.latitude}
                <br />
                Longitude: {drone.longitude}
              </Popup>
            </CircleMarker>
          );
        })}
      </MapContainer>
    </section>
  );
}

function ImageGallery({ images, loading, error }) {
  return (
    <section className="gallery-section">
      <div className="section-heading">
        <div>
          <h2>Captured Images</h2>
          <p>Drone images with GPS and capture timestamps</p>
        </div>
        <span className="live-label">
          {images.length} IMAGES
        </span>
      </div>

      {loading ? (
        <p>Loading captured images...</p>
      ) : error ? (
        <p className="gallery-message">{error}</p>
      ) : images.length === 0 ? (
        <div className="empty-state">
          <h3>No images captured yet</h3>
          <p>Upload an image through the backend API to see it here.</p>
        </div>
      ) : (
        <div className="image-grid">
          {images.map((image) => (
            <article className="image-card" key={image.id}>
              <a
                href={`${API_URL}/images/${image.id}/file`}
                target="_blank"
                rel="noreferrer"
              >
                <img
                  src={`${API_URL}/images/${image.id}/file`}
                  alt={`Image captured by ${image.drone_id}`}
                  loading="lazy"
                />
              </a>

              <div className="image-details">
                <h3>{image.drone_id}</h3>

                <p>
                  <strong>Latitude:</strong>{" "}
                  {Number(image.latitude).toFixed(6)}
                </p>

                <p>
                  <strong>Longitude:</strong>{" "}
                  {Number(image.longitude).toFixed(6)}
                </p>

                <p>
                  <strong>Captured:</strong>{" "}
                  {image.captured_at
                    ? new Date(image.captured_at).toLocaleString()
                    : "Unknown"}
                </p>

                <a
                  href={`https://www.openstreetmap.org/?mlat=${image.latitude}&mlon=${image.longitude}#map=16/${image.latitude}/${image.longitude}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  View location on map
                </a>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function App() {
  const [drones, setDrones] = useState([]);
  const [connection, setConnection] = useState("Connecting...");
  const [lastUpdate, setLastUpdate] = useState(null);

  const [images, setImages] = useState([]);
  const [imagesLoading, setImagesLoading] = useState(true);
  const [imagesError, setImagesError] = useState("");

  const [mode, setMode] = useState("SIMULATOR");
  const [modeLoading, setModeLoading] = useState(false);
  const [modeMessage, setModeMessage] = useState("");

  const {
    muted,
    setMuted,
    audioEnabled,
    enableAudio,
  } = useDangerBuzzer(drones);

  // Load the current backend operating mode.
  useEffect(() => {
    let active = true;

    async function loadMode() {
      try {
        const response = await fetch(`${API_URL}/mode`);

        if (!response.ok) {
          throw new Error("Unable to load operating mode");
        }

        const result = await response.json();

        if (active) {
          setMode(result.mode);
          setModeMessage("");
        }
      } catch (error) {
        if (active) {
          setModeMessage(
            error instanceof Error
              ? error.message
              : "Unable to load operating mode"
          );
        }
      }
    }

    loadMode();

    return () => {
      active = false;
    };
  }, []);

  // Switch between Simulator and Real Drone modes.
  async function changeMode(nextMode) {
    if (modeLoading || nextMode === mode) return;

    setModeLoading(true);
    setModeMessage("");

    try {
      const response = await fetch(`${API_URL}/mode`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ mode: nextMode }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(
          result.detail || "Unable to change operating mode"
        );
      }

      setMode(result.mode);
      setModeMessage(`Successfully switched to ${result.mode} mode`);
    } catch (error) {
      setModeMessage(
        error instanceof Error
          ? error.message
          : "Mode change failed"
      );
    } finally {
      setModeLoading(false);
    }
  }

  // Load existing drones and receive live telemetry.
  useEffect(() => {
    let active = true;
    let socket;

    async function loadDrones() {
      try {
        const response = await fetch(`${API_URL}/drones`);

        if (!response.ok) {
          throw new Error(`Request failed: ${response.status}`);
        }

        const result = await response.json();

        if (active) {
          setDrones(
            Array.isArray(result.drones) ? result.drones : []
          );
        }
      } catch (error) {
        console.error("Drone API error:", error);
      }
    }

    loadDrones();

    try {
      socket = new WebSocket(WS_URL);

      socket.onopen = () => {
        if (active) setConnection("Connected");
      };

      socket.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);

          if (
            message.event !== "telemetry_update" ||
            !message.data
          ) {
            return;
          }

          const updatedDrone = {
            ...message.data,
            analysis: message.analysis || {},
            record_id: message.record_id,
            created_at: new Date().toISOString(),
            telemetry_status: message.data.connected
              ? "ONLINE"
              : "DISCONNECTED",
          };

          if (!active) return;

          setDrones((previous) => {
            const exists = previous.some(
              (drone) =>
                drone.drone_id === updatedDrone.drone_id
            );

            if (!exists) {
              return [...previous, updatedDrone];
            }

            return previous.map((drone) =>
              drone.drone_id === updatedDrone.drone_id
                ? { ...drone, ...updatedDrone }
                : drone
            );
          });

          setLastUpdate(new Date());
        } catch (error) {
          console.error("Invalid WebSocket message:", error);
        }
      };

      socket.onerror = (error) => {
        console.error("WebSocket error:", error);
        if (active) setConnection("Connection error");
      };

      socket.onclose = () => {
        if (active) setConnection("Disconnected");
      };
    } catch (error) {
      console.error("Could not create WebSocket:", error);
      setConnection("Connection error");
    }

    return () => {
      active = false;
      if (socket) socket.close();
    };
  }, []);

  // Load captured images.
  useEffect(() => {
    let active = true;

    async function loadImages() {
      try {
        const response = await fetch(`${API_URL}/images`);

        if (!response.ok) {
          throw new Error(`Request failed: ${response.status}`);
        }

        const result = await response.json();

        if (active) {
          setImages(
            Array.isArray(result.images) ? result.images : []
          );
          setImagesError("");
        }
      } catch (error) {
        console.error("Image gallery error:", error);

        if (active) {
          setImagesError(
            error instanceof Error
              ? `Image loading failed: ${error.message}`
              : "Image loading failed"
          );
        }
      } finally {
        if (active) setImagesLoading(false);
      }
    }

    loadImages();

    return () => {
      active = false;
    };
  }, []);

  const onlineCount = drones.filter(
    (drone) =>
      drone.connected &&
      drone.telemetry_status !== "STALE" &&
      drone.telemetry_status !== "DISCONNECTED"
  ).length;

  const warningCount = drones.filter(
    (drone) =>
      drone.analysis?.status === "Warning" ||
      (drone.analysis?.alerts || []).some(isCriticalAlert)
  ).length;

  return (
    <main className="dashboard">
      <header className="topbar">
        <div>
          <p className="eyebrow">FLIGHT OPERATIONS</p>
          <h1>Drone Monitoring System</h1>
          <p className="subtitle">
            Live telemetry and fleet health monitoring
          </p>
        </div>

        <div className="connection">
          <span
            className={`status-dot ${
              connection === "Connected" ? "green" : "red"
            }`}
          />
          WebSocket: {connection}
        </div>

        <div className="mode-selector">
          <strong>Operating Mode</strong>

          <div className="mode-buttons">
            <button
              type="button"
              className={mode === "SIMULATOR" ? "active" : ""}
              onClick={() => changeMode("SIMULATOR")}
              disabled={modeLoading || mode === "SIMULATOR"}
            >
              Simulator Mode
            </button>

            <button
              type="button"
              className={mode === "REAL" ? "active" : ""}
              onClick={() => changeMode("REAL")}
              disabled={modeLoading || mode === "REAL"}
            >
              Real Drone Mode
            </button>
          </div>

          <p>
            Current mode: <strong>{mode}</strong>
          </p>

          {modeLoading && <p>Changing mode...</p>}

          {modeMessage && (
            <p role="status">{modeMessage}</p>
          )}
        </div>

        <div className="buzzer-controls">
          <button
            type="button"
            onClick={enableAudio}
            disabled={audioEnabled}
          >
            {audioEnabled
              ? "Alarm Audio Enabled"
              : "Enable Alarm Sound"}
          </button>

          <button
            type="button"
            onClick={() => setMuted((current) => !current)}
          >
            {muted ? "Unmute Alarm" : "Mute Alarm"}
          </button>
        </div>
      </header>

      <section className="summary-grid">
        <SummaryCard label="Total Drones" value={drones.length} />
        <SummaryCard label="Connected" value={onlineCount} />
        <SummaryCard label="Warnings" value={warningCount} />
        <SummaryCard
          label="Last Live Update"
          value={
            lastUpdate
              ? lastUpdate.toLocaleTimeString()
              : "Waiting"
          }
        />
      </section>

      <section className="section-heading">
        <div>
          <h2>Fleet Overview</h2>
          <p>Live information for each registered drone</p>
        </div>
        <span className="live-label">LIVE TELEMETRY</span>
      </section>

      <FleetMap drones={drones} />

      <EmergencyAlerts drones={drones} />

      {drones.length === 0 ? (
        <div className="empty-state">
          <h3>Waiting for drone telemetry</h3>
          <p>
            Start your FastAPI backend and drone simulator.
          </p>
        </div>
      ) : (
        <section className="drone-grid">
          {drones.map((drone) => (
            <DroneCard
              key={drone.drone_id}
              drone={drone}
            />
          ))}
        </section>
      )}

      <ImageGallery
        images={images}
        loading={imagesLoading}
        error={imagesError}
      />
    </main>
  );
}

export default App;
