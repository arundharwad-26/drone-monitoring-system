import { useCallback, useEffect, useRef, useState } from "react";
import {
  MapContainer,
  TileLayer,
  CircleMarker,
  Polyline,
  Popup,
} from "react-leaflet";
import "leaflet/dist/leaflet.css";
import "./App.css";

const API_URL = (
  import.meta.env.VITE_API_URL || "http://127.0.0.1:8000"
).replace(/\/+$/, "");

const WS_URL = `${API_URL.replace(/^http/, "ws")}/ws/telemetry`;

const DEFAULT_HOME = {
  name: "Home Base",
  latitude: "15.4589",
  longitude: "75.0078",
};

// Start with five empty optional stops. Unused stops must not carry old GPS values.
const DEFAULT_WAYPOINTS = Array.from({ length: 5 }, () => ({
  name: "",
  latitude: "",
  longitude: "",
  task_duration_minutes: "",
}));

const NAV_ITEMS = [
  { id: "dashboard", label: "Dashboard", icon: "⌂" },
  { id: "mission", label: "Mission Planner", icon: "⌖" },
  { id: "tracking", label: "Live Drone Tracking", icon: "◎" },
  { id: "planning", label: "Drone Planning", icon: "◷" },
  { id: "history", label: "Flight History & Replay", icon: "↻" },
  { id: "alerts", label: "Emergency Alerts", icon: "⚠" },
  { id: "images", label: "Captured Images", icon: "▧" },
  { id: "privacy", label: "Privacy Protection", icon: "🛡" },
];

function getAlertMessage(alert) {
  if (typeof alert === "string") return alert;
  return alert?.message || "Unknown alert";
}

function isCriticalAlert(alert) {
  const type =
    typeof alert === "object" && alert !== null
      ? alert.type || ""
      : "";

  return /critical|danger|ai_anomaly|unusual_altitude|unusual_speed|low_battery|disconnected|invalid_battery/i.test(
    `${type} ${getAlertMessage(alert)}`
  );
}

function getDroneAlerts(drones) {
  return drones.flatMap((drone) =>
    (drone.analysis?.alerts || []).map((alert, index) => ({
      id: `${drone.drone_id}-${index}-${getAlertMessage(alert)}`,
      droneId: drone.drone_id,
      message: getAlertMessage(alert),
      critical: isCriticalAlert(alert),
    }))
  );
}

function isValidPosition(drone) {
  const lat = Number(drone.latitude);
  const lng = Number(drone.longitude);

  return (
    drone.latitude !== null &&
    drone.latitude !== undefined &&
    drone.longitude !== null &&
    drone.longitude !== undefined &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
}

function SummaryCard({ label, value, detail }) {
  return (
    <article className="summary-card">
      <p>{label}</p>
      <h2>{value}</h2>
      {detail && <span className="summary-detail">{detail}</span>}
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

function PageHeader({ eyebrow, title, description, action }) {
  return (
    <div className="page-header">
      <div>
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h1 className="page-title">{title}</h1>
        {description && (
          <p className="page-description">{description}</p>
        )}
      </div>
      {action}
    </div>
  );
}

function EmptyState({ title, description }) {
  return (
    <div className="empty-state">
      <h3>{title}</h3>
      <p>{description}</p>
    </div>
  );
}

/* Drone card with battery monitoring and battery swap */

function DroneCard({ drone, operatingMode }) {
  const [batteryStatus, setBatteryStatus] = useState(null);
  const [batteryLoading, setBatteryLoading] = useState(false);
  const [batteryMessage, setBatteryMessage] = useState("");
  const [batteryError, setBatteryError] = useState("");

  const loadBatteryStatus = useCallback(async () => {
    if (!drone.drone_id) return;

    try {
      const response = await fetch(
        `${API_URL}/batteries/status/${encodeURIComponent(
          drone.drone_id
        )}`
      );

      if (!response.ok) {
        if (response.status !== 404) {
          throw new Error(
            `Battery status request failed (${response.status}).`
          );
        }
        return;
      }

      const data = await response.json();
      setBatteryStatus(data);
      setBatteryError("");
    } catch (error) {
      setBatteryError(
        error.message || "Unable to load battery status."
      );
    }
  }, [drone.drone_id]);

  useEffect(() => {
    loadBatteryStatus();

    const timer = window.setInterval(loadBatteryStatus, 5000);

    return () => window.clearInterval(timer);
  }, [loadBatteryStatus]);

  const displayedBattery = Number(
    batteryStatus?.battery_percent ??
      batteryStatus?.current_battery_percent ??
      batteryStatus?.battery_level ??
      batteryStatus?.battery ??
      drone.battery ??
      0
  );

  const canSwap =
    operatingMode === "simulator" &&
    Boolean(drone.connected) &&
    Number.isFinite(displayedBattery) &&
    displayedBattery <= 20 &&
    !batteryLoading;

  const swapBattery = async () => {
    if (!canSwap) return;

    setBatteryLoading(true);
    setBatteryMessage("");
    setBatteryError("");

    try {
      const response = await fetch(
        `${API_URL}/batteries/swap/${encodeURIComponent(
          drone.drone_id
        )}`,
        { method: "POST" }
      );

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        const detail =
          typeof data.detail === "string"
            ? data.detail
            : data.message || "Battery swap failed.";

        throw new Error(detail);
      }

      setBatteryStatus(
        data.status || data.battery_status || data
      );

      setBatteryMessage(
        data.message || "Battery swap completed successfully."
      );

      await loadBatteryStatus();
    } catch (error) {
      setBatteryError(error.message || "Battery swap failed.");
    } finally {
      setBatteryLoading(false);
    }
  };

  const battery = displayedBattery;

  const warning =
    drone.analysis?.status === "Warning" ||
    (drone.analysis?.alerts || []).some(isCriticalAlert);

  const disconnected =
    !drone.connected ||
    drone.telemetry_status === "DISCONNECTED" ||
    drone.telemetry_status === "STALE";

  const status = disconnected
    ? drone.telemetry_status || "DISCONNECTED"
    : warning
      ? "WARNING"
      : "ONLINE";

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
          {status}
        </span>
      </div>

      <div className="battery-section">
        <div className="metric-heading">
          <span>Battery</span>
          <strong>{battery.toFixed(1)}%</strong>
        </div>

        <div className="battery-track">
          <div
            className={`battery-fill ${
              battery <= 20 ? "low" : ""
            }`}
            style={{
              width: `${Math.min(
                100,
                Math.max(0, battery)
              )}%`,
            }}
          />
        </div>

        {battery <= 20 && (
          <p
            role="alert"
            style={{
              color: "#b91c1c",
              fontWeight: 700,
              marginTop: 8,
            }}
          >
            ⚠ Low battery — land or swap the battery before continuing.
          </p>
        )}

        {operatingMode === "simulator" && (
          <div style={{ marginTop: 10 }}>
            <button
              type="button"
              onClick={swapBattery}
              disabled={!canSwap}
            >
              {batteryLoading ? "Swapping..." : "Swap Battery"}
            </button>

            {!drone.connected && (
              <p className="mission-note">
                Connect the simulator drone before swapping.
              </p>
            )}

            {battery > 20 && (
              <p className="mission-note">
                Battery swap becomes available at 20% or below.
              </p>
            )}

            {batteryMessage && (
              <p role="status" className="mission-note">
                {batteryMessage}
              </p>
            )}

            {batteryError && (
              <p role="alert" className="mission-error">
                {batteryError}
              </p>
            )}
          </div>
        )}
      </div>

      <div className="metrics-grid">
        <Metric label="Altitude" value={`${drone.altitude ?? "—"} m`} />
        <Metric label="Speed" value={`${drone.speed ?? "—"} m/s`} />
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

/* Fleet map */

function FleetMap({ drones, trails = false, history = {} }) {
  const validDrones = drones.filter(isValidPosition);

  return (
    <section className={trails ? "tracking-map-card" : "map-section"}>
      <div className="map-heading">
        <div>
          <h2>{trails ? "Live Drone Tracking" : "Live Drone Locations"}</h2>
          <p>
            {trails
              ? "Current positions and recently received GPS points"
              : "Latest reported GPS positions"}
          </p>
        </div>

        <span className="live-label">
          {validDrones.length} DRONES
        </span>
      </div>

      <MapContainer
        center={[15.459, 75.008]}
        zoom={13}
        scrollWheelZoom
        className={trails ? "tracking-map" : "fleet-map"}
      >
        <TileLayer
          attribution="&copy; OpenStreetMap contributors"
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        {validDrones.map((drone) => {
          const battery = Number(drone.battery ?? 0);

          const warning =
            !drone.connected ||
            battery <= 20 ||
            drone.analysis?.status === "Warning";

          const points = history[drone.drone_id] || [];

          const position = [
            Number(drone.latitude),
            Number(drone.longitude),
          ];

          return (
            <div key={drone.drone_id}>
              {trails && points.length > 1 && (
                <Polyline
                  positions={points}
                  pathOptions={{
                    color: "#087c57",
                    weight: 3,
                    opacity: 0.7,
                  }}
                />
              )}

              <CircleMarker
                center={position}
                radius={8}
                pathOptions={{
                  color: warning ? "#dc4655" : "#087c57",
                  fillColor: warning ? "#dc4655" : "#16a36a",
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
                  Altitude: {drone.altitude ?? "—"} m
                  <br />
                  Speed: {drone.speed ?? "—"} m/s
                  <br />
                  Latitude: {drone.latitude}
                  <br />
                  Longitude: {drone.longitude}
                </Popup>
              </CircleMarker>
            </div>
          );
        })}
      </MapContainer>
    </section>
  );
}

/* Dashboard */

function DashboardPage({
  drones,
  operatingMode,
  connection,
  lastUpdate,
  onlineCount,
  warningCount,
}) {
  return (
    <div className="page-content">
      <PageHeader
        eyebrow="FLEET OVERVIEW"
        title="Dashboard"
        description="Live telemetry and drone health monitoring."
        action={
          <span className="live-label">
            {connection === "Connected"
              ? "LIVE"
              : connection.toUpperCase()}
          </span>
        }
      />

      <div className="summary-grid">
        <SummaryCard label="Total Drones" value={drones.length} />
        <SummaryCard label="Connected" value={onlineCount} />
        <SummaryCard label="Warnings" value={warningCount} />
        <SummaryCard
          label="Last Update"
          value={lastUpdate ? lastUpdate.toLocaleTimeString() : "Waiting"}
        />
      </div>

      <FleetMap drones={drones} />

      <div className="section-heading">
        <div>
          <h2>Drone Fleet</h2>
          <p>Latest telemetry from each registered drone.</p>
        </div>
      </div>

      {drones.length === 0 ? (
        <EmptyState
          title="Waiting for drone telemetry"
          description="Start the FastAPI backend and drone simulator. Check the browser console if no telemetry arrives."
        />
      ) : (
        <div className="drone-grid">
          {drones.map((drone, index) => (
            <DroneCard
              key={drone.drone_id ?? index}
              drone={drone}
              operatingMode={operatingMode}
            />
          ))}
        </div>
      )}
    </div>
  );
}/* Emergency alerts */

function EmergencyAlerts({ drones, incident }) {
  const alerts = getDroneAlerts(drones);
  const critical = alerts.filter((alert) => alert.critical).length;

  return (
    <div className="page-content">
      <PageHeader
        eyebrow="SAFETY CENTER"
        title="Emergency Alerts"
        description="Review current warnings reported by your drones."
      />

      <div className="summary-grid">
        <SummaryCard
          label="Total Alerts"
          value={alerts.length + (incident ? 1 : 0)}
        />
        <SummaryCard
          label="Critical"
          value={critical + (incident ? 1 : 0)}
        />
        <SummaryCard
          label="Warnings"
          value={alerts.length - critical}
        />
        <SummaryCard label="Monitored Drones" value={drones.length} />
      </div>

      <section className="content-card">
        <div className="section-heading">
          <h2>Active Notifications</h2>
        </div>

        {incident && (
          <article className="emergency-item critical">
            <strong>
              CRITICAL · {incident.drone_id || "Unknown drone"}
            </strong>
            <p>
              {incident.message || "Simulated security compromise detected."}
            </p>
            <p>Incident ID: {incident.incident_id}</p>
          </article>
        )}

        {alerts.length === 0 && !incident ? (
          <EmptyState
            title="No active alerts"
            description="No alerts are currently being reported."
          />
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
                  {alert.critical ? "CRITICAL" : "WARNING"} · {alert.droneId}
                </strong>
                <p>{alert.message}</p>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

/* Captured image gallery */

function ImageGallery({ images, loading, error }) {
  return (
    <div className="page-content">
      <PageHeader
        eyebrow="MISSION MEDIA"
        title="Captured Images"
        description="Images reported by the backend, including GPS metadata."
        action={<span className="live-label">{images.length} IMAGES</span>}
      />

      {loading ? (
        <EmptyState
          title="Loading images"
          description="Retrieving captured images from the backend."
        />
      ) : error ? (
        <p className="gallery-message">{error}</p>
      ) : images.length === 0 ? (
        <EmptyState
          title="No images captured yet"
          description="Captured images will appear here when the backend provides them."
        />
      ) : (
        <div className="image-grid">
          {images.map((image) => {
            const imageUrl = `${API_URL}/images/${image.id}/file`;
            const lat = Number(image.latitude);
            const lng = Number(image.longitude);

            const hasPosition =
              Number.isFinite(lat) &&
              Number.isFinite(lng) &&
              lat >= -90 &&
              lat <= 90 &&
              lng >= -180 &&
              lng <= 180;

            return (
              <article className="image-card" key={image.id}>
                <a
                  className="image-preview"
                  href={imageUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  <img
                    src={imageUrl}
                    alt={`Image captured by ${image.drone_id || "drone"}`}
                    loading="lazy"
                  />
                </a>

                <div className="image-details">
                  <h3>{image.drone_id || "Unknown drone"}</h3>

                  <p>
                    <strong>Latitude:</strong>{" "}
                    {hasPosition ? lat.toFixed(6) : "Unavailable"}
                  </p>

                  <p>
                    <strong>Longitude:</strong>{" "}
                    {hasPosition ? lng.toFixed(6) : "Unavailable"}
                  </p>

                  <p>
                    <strong>Captured:</strong>{" "}
                    {image.captured_at
                      ? new Date(image.captured_at).toLocaleString()
                      : "Unknown"}
                  </p>

                  {hasPosition && (
                    <a
                      href={`https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=16/${lat}/${lng}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      View location on map ↗
                    </a>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* Mission planner */

function MissionPlanner({
  home,
  setHome,
  waypoints,
  setWaypoints,
  onContinue,
}) {
  const [error, setError] = useState("");

  const updateWaypoint = (index, field, value) => {
    setWaypoints((previous) =>
      previous.map((point, i) =>
        i === index ? { ...point, [field]: value } : point
      )
    );
  };

  function submit(event) {
    event.preventDefault();

    const homeLat = Number(home.latitude);
    const homeLng = Number(home.longitude);

    if (
      !home.name.trim() ||
      home.latitude === "" ||
      home.longitude === "" ||
      !Number.isFinite(homeLat) ||
      !Number.isFinite(homeLng) ||
      homeLat < -90 ||
      homeLat > 90 ||
      homeLng < -180 ||
      homeLng > 180
    ) {
      setError(
        "Enter a home-base name and valid latitude (-90 to 90) and longitude (-180 to 180)."
      );
      return;
    }

    // Blank-name stops are optional and are not sent to the backend.
    // A named stop must have valid coordinates and a duration.
    for (let index = 0; index < waypoints.length; index += 1) {
      const point = waypoints[index];

      if (!point.name.trim()) {
        continue;
      }

      const lat = Number(point.latitude);
      const lng = Number(point.longitude);
      const duration = Number(point.task_duration_minutes);

      if (
        point.latitude === "" ||
        point.longitude === "" ||
        point.task_duration_minutes === "" ||
        !Number.isFinite(lat) ||
        lat < -90 ||
        lat > 90 ||
        !Number.isFinite(lng) ||
        lng < -180 ||
        lng > 180 ||
        !Number.isFinite(duration) ||
        duration < 0 ||
        duration > 240
      ) {
        setError(
          `Complete Stop ${index + 1} with valid coordinates and a task duration from 0 to 240 minutes.`
        );
        return;
      }
    }

    setError("");
    onContinue();
  }

  return (
    <div className="page-content">
      <PageHeader
        eyebrow="MISSION CONFIGURATION · STEP 1"
        title="Mission Planner"
        description="Configure the home base and up to five mission stops."
      />

      <div className="step-indicator">
        <div className="step active">
          <span>1</span>
          <div>
            <strong>Locations</strong>
            <small>Home base and waypoints</small>
          </div>
        </div>

        <div className="step">
          <span>2</span>
          <div>
            <strong>Flight planning</strong>
            <small>Battery and route calculation</small>
          </div>
        </div>
      </div>

      <section className="mission-planner">
        <form onSubmit={submit}>
          <h3>Home Base</h3>

          <div className="mission-input-grid">
            <label>
              Name
              <input
                required
                value={home.name}
                onChange={(event) =>
                  setHome({ ...home, name: event.target.value })
                }
              />
            </label>

            <label>
              Latitude
              <input
                required
                type="number"
                min="-90"
                max="90"
                step="any"
                value={home.latitude}
                onChange={(event) =>
                  setHome({ ...home, latitude: event.target.value })
                }
              />
            </label>

            <label>
              Longitude
              <input
                required
                type="number"
                min="-180"
                max="180"
                step="any"
                value={home.longitude}
                onChange={(event) =>
                  setHome({ ...home, longitude: event.target.value })
                }
              />
            </label>
          </div>

          <h3>Mission Waypoints</h3>

          {waypoints.map((point, index) => (
            <div className="waypoint-card" key={index}>
              <div className="waypoint-title">
                <span className="waypoint-number">{index + 1}</span>
                <h4>Stop {index + 1}</h4>
              </div>

              <div className="mission-input-grid">
                <label>
                  Location name
                  <input
                    value={point.name}
                    onChange={(event) =>
                      updateWaypoint(index, "name", event.target.value)
                    }
                    placeholder="Leave blank if unused"
                  />
                </label>

                <label>
                  Latitude
                  <input
                    type="number"
                    min="-90"
                    max="90"
                    step="any"
                    value={point.latitude}
                    onChange={(event) =>
                      updateWaypoint(index, "latitude", event.target.value)
                    }
                  />
                </label>

                <label>
                  Longitude
                  <input
                    type="number"
                    min="-180"
                    max="180"
                    step="any"
                    value={point.longitude}
                    onChange={(event) =>
                      updateWaypoint(index, "longitude", event.target.value)
                    }
                  />
                </label>

                <label>
                  Task duration (minutes)
                  <input
                    type="number"
                    min="0"
                    max="240"
                    step="any"
                    value={point.task_duration_minutes}
                    onChange={(event) =>
                      updateWaypoint(
                        index,
                        "task_duration_minutes",
                        event.target.value
                      )
                    }
                  />
                </label>
              </div>
            </div>
          ))}

          {error && <p className="mission-error">{error}</p>}

          <button type="submit">
            Continue to Drone Planning →
          </button>
        </form>
      </section>
    </div>
  );
}

/* Drone planning */

function DronePlanning({ home, waypoints, onBack, result, setResult }) {
  const [battery, setBattery] = useState("85");
  const [capacity, setCapacity] = useState("500");
  const [speed, setSpeed] = useState("40");
  const [power, setPower] = useState("300");
  const [reserve, setReserve] = useState("20");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function calculate(event) {
    event.preventDefault();

    setLoading(true);
    setError("");
    setResult(null);

    const activeWaypoints = waypoints.filter(
      (point) => point.name.trim() !== ""
    );

    const payload = {
      home: {
        ...home,
        latitude: Number(home.latitude),
        longitude: Number(home.longitude),
      },
      waypoints: activeWaypoints.map((point) => ({
        ...point,
        latitude: Number(point.latitude),
        longitude: Number(point.longitude),
        task_duration_minutes: Number(point.task_duration_minutes),
      })),
      current_battery_percent: Number(battery),
      battery_capacity_wh: Number(capacity),
      cruise_speed_kmh: Number(speed),
      flight_power_watts: Number(power),
      reserve_percent: Number(reserve),
    };

    try {
      const response = await fetch(`${API_URL}/missions/calculate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        const detail = Array.isArray(data.detail)
          ? data.detail.map((item) => item.msg).join(", ")
          : data.detail;

        throw new Error(detail || "Mission calculation failed.");
      }

      setResult(data);
    } catch (err) {
      setError(err.message || "Unable to contact the backend.");
    } finally {
      setLoading(false);
    }
  }

  const activeWaypoints = waypoints.filter(
    (point) => point.name.trim() !== ""
  );

  return (
    <div className="page-content">
      <PageHeader
        eyebrow="MISSION CONFIGURATION · STEP 2"
        title="Drone Planning"
        description="Estimate mission feasibility using your drone's battery and flight parameters."
      />

      <button className="secondary-button" onClick={onBack} type="button">
        ← Back to Mission Planner
      </button>

      <section className="mission-planner" style={{ marginTop: 18 }}>
        <form onSubmit={calculate}>
          <div className="mission-input-grid">
            <label>
              Current battery (%)
              <input
                required
                type="number"
                min="0"
                max="100"
                value={battery}
                onChange={(event) => setBattery(event.target.value)}
              />
            </label>

            <label>
              Battery capacity (Wh)
              <input
                required
                type="number"
                min="1"
                value={capacity}
                onChange={(event) => setCapacity(event.target.value)}
              />
            </label>

            <label>
              Cruise speed (km/h)
              <input
                required
                type="number"
                min="1"
                value={speed}
                onChange={(event) => setSpeed(event.target.value)}
              />
            </label>

            <label>
              Flight power (watts)
              <input
                required
                type="number"
                min="1"
                value={power}
                onChange={(event) => setPower(event.target.value)}
              />
            </label>

            <label>
              Required reserve battery (%)
              <input
                required
                type="number"
                min="0"
                max="100"
                value={reserve}
                onChange={(event) => setReserve(event.target.value)}
              />
            </label>
          </div>

          <p className="mission-note">
            Route: {home.name}
            {activeWaypoints.map((point) => ` → ${point.name}`).join("")}
            {" → "}
            {home.name}
          </p>

          {error && <p className="mission-error">{error}</p>}

          <button type="submit" disabled={loading}>
            {loading ? "Calculating..." : "Calculate Mission"}
          </button>
        </form>

        {result && (
          <section className="mission-results">
            <h3>Mission Calculation Results</h3>
            <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
              {JSON.stringify(result, null, 2)}
            </pre>
          </section>
        )}
      </section>
    </div>
  );
}/* Live drone tracking */

function TrackingPage({ drones, history }) {
  return (
    <div className="page-content">
      <PageHeader
        eyebrow="LIVE TELEMETRY"
        title="Live Drone Tracking"
        description="Track current GPS positions and recent position history."
      />

      <div className="tracking-toolbar">
        <div className="tracking-legend">
          <span>
            <i className="legend-dot moving" /> Connected
          </span>
          <span>
            <i className="legend-dot stationary" /> Low battery / warning
          </span>
          <span>
            <i className="legend-dot offline" /> Disconnected
          </span>
        </div>
      </div>

      <FleetMap drones={drones} trails history={history} />

      {drones.length === 0 ? (
        <EmptyState
          title="No drones available"
          description="Start the backend and simulator to receive live positions."
        />
      ) : (
        <div className="tracking-grid">
          {drones.map((drone, index) => {
            const disconnected =
              !drone.connected ||
              drone.telemetry_status === "DISCONNECTED" ||
              drone.telemetry_status === "STALE";

            const warning =
              Number(drone.battery ?? 0) <= 20 ||
              drone.analysis?.status === "Warning";

            const status = disconnected
              ? "offline"
              : warning
                ? "stationary"
                : "moving";

            return (
              <article
                className="tracking-card"
                key={drone.drone_id ?? index}
              >
                <div className="tracking-card-header">
                  <h3>{drone.drone_id}</h3>

                  <span className={`tracking-status ${status}`}>
                    {disconnected
                      ? "DISCONNECTED"
                      : warning
                        ? "WARNING"
                        : "CONNECTED"}
                  </span>
                </div>

                <div className="metrics-grid">
                  <Metric label="Battery" value={`${drone.battery ?? "—"}%`} />
                  <Metric label="Speed" value={`${drone.speed ?? "—"} m/s`} />
                  <Metric label="Latitude" value={drone.latitude} />
                  <Metric label="Longitude" value={drone.longitude} />
                </div>

                <p className="tracking-footnote">
                  {history[drone.drone_id]?.length || 0} GPS positions
                  recorded in this session. Movement status is approximate
                  and based on telemetry and warning data.
                </p>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* Real drone setup — demo configuration only */

function RealDroneSetup({ onBack }) {
  const [droneName, setDroneName] = useState("");
  const [droneModel, setDroneModel] = useState("");
  const [connectionType, setConnectionType] = useState("network");
  const [address, setAddress] = useState("");
  const [port, setPort] = useState("14550");
  const [serialPort, setSerialPort] = useState("");
  const [baudRate, setBaudRate] = useState("57600");
  const [message, setMessage] = useState("");

  function handleSubmit(event) {
    event.preventDefault();

    const config = {
      droneName: droneName.trim(),
      droneModel: droneModel.trim(),
      connectionType,
      ...(connectionType === "network"
        ? { address: address.trim(), port: Number(port) }
        : { serialPort: serialPort.trim(), baudRate: Number(baudRate) }),
    };

    setMessage(
      `Configuration prepared for ${config.droneName}. This is a demo configuration only; no physical drone has been connected.`
    );
  }

  return (
    <div className="page-content">
      <PageHeader
        eyebrow="HARDWARE CONFIGURATION"
        title="Connect a Real Drone"
        description="Enter the hardware details needed for a compatible telemetry adapter."
      />

      <section className="content-card">
        <form onSubmit={handleSubmit} className="real-drone-form">
          <div className="mission-input-grid">
            <label>
              Drone name or ID
              <input
                required
                value={droneName}
                onChange={(event) => setDroneName(event.target.value)}
                placeholder="e.g. AquaAirX-01"
              />
            </label>

            <label>
              Drone model / flight controller
              <input
                required
                value={droneModel}
                onChange={(event) => setDroneModel(event.target.value)}
                placeholder="e.g. Pixhawk or supported drone model"
              />
            </label>

            <label>
              Connection method
              <select
                value={connectionType}
                onChange={(event) => {
                  setConnectionType(event.target.value);
                  setMessage("");
                }}
              >
                <option value="network">Network / telemetry endpoint</option>
                <option value="serial">Serial / USB telemetry</option>
              </select>
            </label>

            {connectionType === "network" ? (
              <>
                <label>
                  IP address or hostname
                  <input
                    required
                    value={address}
                    onChange={(event) => setAddress(event.target.value)}
                    placeholder="Telemetry gateway address"
                  />
                </label>

                <label>
                  Telemetry port
                  <input
                    required
                    type="number"
                    min="1"
                    max="65535"
                    value={port}
                    onChange={(event) => setPort(event.target.value)}
                  />
                </label>
              </>
            ) : (
              <>
                <label>
                  Serial port
                  <input
                    required
                    value={serialPort}
                    onChange={(event) => setSerialPort(event.target.value)}
                    placeholder="e.g. COM3 or /dev/ttyUSB0"
                  />
                </label>

                <label>
                  Baud rate
                  <select
                    value={baudRate}
                    onChange={(event) => setBaudRate(event.target.value)}
                  >
                    <option value="57600">57600</option>
                    <option value="115200">115200</option>
                    <option value="38400">38400</option>
                    <option value="9600">9600</option>
                  </select>
                </label>
              </>
            )}
          </div>

          <div className="page-actions">
            <button type="submit" className="primary-button">
              Save Demo Configuration
            </button>

            <button
              type="button"
              className="secondary-button"
              onClick={onBack}
            >
              Back to Simulator
            </button>
          </div>

          {message && (
            <p className="mission-note" role="status">
              {message}
            </p>
          )}

          <p className="mission-note">
            Status: Not connected. Saving these details does not connect to
            a physical drone. Do not enter passwords, API keys, or other
            secrets in this demo form.
          </p>
        </form>
      </section>
    </div>
  );
}function SecurityIncidentBanner({
  incident,
  onResolve,
  resolving,
  error,
  muted,
  onToggleMute,
  soundEnabled,
  onEnableSound,
}) {
  if (!incident) return null;

  return (
    <section
      role="alert"
      aria-live="assertive"
      style={{
        margin: "16px 0",
        padding: 18,
        border: "2px solid #dc2626",
        borderRadius: 12,
        background: "#fff1f2",
        color: "#7f1d1d",
      }}
    >
      <div
        style={{
          display: "flex",
          gap: 12,
          alignItems: "center",
          flexWrap: "wrap",
        }}
      >
        <strong style={{ fontSize: 18 }}>
          🚨 CRITICAL SECURITY INCIDENT
        </strong>
        <span>SIMULATOR DEMO</span>
      </div>

      <p>
        <strong>Drone:</strong> {incident.drone_id || "Unknown"}
      </p>
      <p>
        <strong>Severity:</strong> {incident.severity || "CRITICAL"}
      </p>
      <p>
        <strong>Status:</strong> {incident.status || "ACTIVE"}
      </p>
      <p>{incident.message || "Simulated security compromise detected."}</p>

      <p style={{ overflowWrap: "anywhere" }}>
        <strong>Incident ID:</strong> {incident.incident_id}
      </p>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {!soundEnabled && (
          <button type="button" onClick={onEnableSound}>
            Enable alarm sound
          </button>
        )}

        <button type="button" onClick={onToggleMute}>
          {muted ? "Unmute alarm" : "Mute alarm"}
        </button>

        <button
          type="button"
          disabled={resolving}
          onClick={onResolve}
        >
          {resolving ? "Resolving..." : "Resolve demo incident"}
        </button>
      </div>

      {error && (
        <p role="status" style={{ fontWeight: 600 }}>
          {error}
        </p>
      )}

      <p style={{ fontSize: 12, marginBottom: 0 }}>
        This is a simulated event. It does not indicate a real drone compromise.
      </p>
    </section>
  );
}

/* Privacy protection — simulator demo data */

function PrivacyProtectionPage({ operatingMode }) {
  const [confirmed, setConfirmed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [history, setHistory] = useState([]);

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);

    try {
      const response = await fetch(
        `${API_URL}/security/sanitization-history`
      );
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(
          data.detail || "Could not load sanitization history."
        );
      }

      setHistory(Array.isArray(data.history) ? data.history : []);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Could not load sanitization history."
      );
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  async function sanitizeDemoData() {
    if (!confirmed) {
      setError("Please confirm the simulator-only action first.");
      return;
    }

    if (operatingMode !== "simulator") {
      setError("Switch to Simulator Mode before sanitizing demo data.");
      return;
    }

    const accepted = window.confirm(
      "Clear the designated in-memory simulator demo-data list? " +
        "This does not delete SQLite records, captured images, or physical-drone data."
    );

    if (!accepted) return;

    setLoading(true);
    setMessage("");
    setError("");

    try {
      const response = await fetch(
        `${API_URL}/security/sanitize-demo`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            confirm_demo: true,
          }),
        }
      );

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(
          data.detail || "Simulator sanitization failed."
        );
      }

      setMessage(
        `${data.message} Items cleared: ${
          data.result?.items_cleared ?? 0
        }.`
      );

      setConfirmed(false);
      await loadHistory();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Simulator sanitization failed."
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="page-content">
      <PageHeader
        eyebrow="SECURITY CENTER"
        title="Privacy Protection"
        description="Manage designated simulator demo data during a simulated security incident."
      />

      <section className="content-card">
        <h2>Emergency Demo-Data Sanitization</h2>

        <p>
          Use this feature to clear the designated in-memory demo-data
          collection. It is intended for simulator demonstrations only.
        </p>

        <div
          role="note"
          style={{
            padding: 14,
            border: "1px solid #d97706",
            borderRadius: 8,
            background: "#fffbeb",
            color: "#78350f",
            margin: "16px 0",
          }}
        >
          <strong>Important limitation</strong>
          <p style={{ marginBottom: 0 }}>
            This operation does not erase SQLite telemetry records,
            captured image files, physical-drone storage, or other
            persistent data. It is not a physical drone emergency
            response mechanism.
          </p>
        </div>

        <label
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 10,
            margin: "18px 0",
          }}
        >
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(event) => {
              setConfirmed(event.target.checked);
              setError("");
              setMessage("");
            }}
            disabled={loading}
          />

          <span>
            I understand this action only clears the designated
            in-memory simulator demo-data list.
          </span>
        </label>

        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 10,
          }}
        >
          <button
            type="button"
            onClick={sanitizeDemoData}
            disabled={
              loading ||
              !confirmed ||
              operatingMode !== "simulator"
            }
          >
            {loading ? "Sanitizing..." : "Sanitize Demo Data"}
          </button>

          <button
            type="button"
            className="secondary-button"
            onClick={loadHistory}
            disabled={historyLoading || loading}
          >
            {historyLoading ? "Refreshing..." : "Refresh History"}
          </button>
        </div>

        {operatingMode !== "simulator" && (
          <p className="mission-note" role="status">
            Switch to Simulator Mode to use this demo feature.
          </p>
        )}

        {message && (
          <p
            role="status"
            style={{ color: "#166534", marginTop: 16 }}
          >
            {message}
          </p>
        )}

        {error && (
          <p
            role="alert"
            className="mission-error"
            style={{ marginTop: 16 }}
          >
            {error}
          </p>
        )}
      </section>

      <section className="content-card" style={{ marginTop: 20 }}>
        <div className="section-heading">
          <div>
            <h2>Sanitization Audit History</h2>
            <p>Recent records returned by the backend.</p>
          </div>

          <span className="live-label">
            {history.length} EVENTS
          </span>
        </div>

        {historyLoading && history.length === 0 ? (
          <EmptyState
            title="Loading history"
            description="Retrieving sanitization records."
          />
        ) : history.length === 0 ? (
          <EmptyState
            title="No sanitization events"
            description="Completed simulator sanitization events will appear here."
          />
        ) : (
          <div className="emergency-list">
            {history.map((item) => (
              <article
                className="emergency-item"
                key={item.event_id}
              >
                <strong>
                  {item.action || "SIMULATOR SANITIZATION"}
                </strong>

                <p>Status: {item.status || "UNKNOWN"}</p>
                <p>Items cleared: {item.items_cleared ?? 0}</p>

                <p>
                  Created:{" "}
                  {item.created_at
                    ? new Date(item.created_at).toLocaleString()
                    : "Unknown"}
                </p>

                <p style={{ overflowWrap: "anywhere" }}>
                  Event ID: {item.event_id || "Unavailable"}
                </p>

                <p className="mission-note">
                  Simulator-only operation. This record does not
                  establish deletion of persistent or physical-drone data.
                </p>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}/* Flight History & Replay */

function FlightHistoryPage() {
  const [summaries, setSummaries] = useState([]);
  const [selectedDrone, setSelectedDrone] = useState("");
  const [records, setRecords] = useState([]);
  const [totalRecords, setTotalRecords] = useState(0);
  const [loadingSummary, setLoadingSummary] = useState(true);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [error, setError] = useState("");
  const [playing, setPlaying] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [playbackSpeed, setPlaybackSpeed] = useState("1");
  const PAGE_SIZE = 5000;

  useEffect(() => {
    let cancelled = false;

    async function loadSummaries() {
      setLoadingSummary(true);
      setError("");

      try {
        const response = await fetch(`${API_URL}/flight-history`);
        const data = await response.json();

        if (!response.ok) {
          throw new Error(
            data.detail || "Could not load flight history."
          );
        }

        if (cancelled) return;

        const drones = Array.isArray(data.drones) ? data.drones : [];
        setSummaries(drones);

        if (drones.length) {
          const preferred = drones.find(
            (drone) => drone.drone_id === "drone-001"
          );
          setSelectedDrone((preferred || drones[0]).drone_id);
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err.message || "Could not connect to flight history API."
          );
        }
      } finally {
        if (!cancelled) setLoadingSummary(false);
      }
    }

    loadSummaries();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!selectedDrone) {
      setRecords([]);
      setTotalRecords(0);
      return undefined;
    }

    let cancelled = false;

    async function loadHistory() {
      setLoadingHistory(true);
      setPlaying(false);
      setCurrentIndex(0);
      setError("");

      try {
        const url =
          `${API_URL}/flight-history/${encodeURIComponent(selectedDrone)}` +
          `?limit=${PAGE_SIZE}&offset=0`;

        const response = await fetch(url);
        const data = await response.json();

        if (!response.ok) {
          throw new Error(
            data.detail || "Could not load drone history."
          );
        }

        if (cancelled) return;

        setRecords(Array.isArray(data.records) ? data.records : []);
        setTotalRecords(Number(data.total_records || 0));
      } catch (err) {
        if (!cancelled) {
          setRecords([]);
          setTotalRecords(0);
          setError(err.message || "Could not load drone history.");
        }
      } finally {
        if (!cancelled) setLoadingHistory(false);
      }
    }

    loadHistory();

    return () => {
      cancelled = true;
    };
  }, [selectedDrone]);

  async function loadOlderRecords() {
    if (loadingHistory || records.length >= totalRecords) return;

    setLoadingHistory(true);
    setPlaying(false);
    setError("");

    try {
      const offset = records.length;
      const url =
        `${API_URL}/flight-history/${encodeURIComponent(selectedDrone)}` +
        `?limit=${PAGE_SIZE}&offset=${offset}`;

      const response = await fetch(url);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.detail || "Could not load older telemetry."
        );
      }

      const older = Array.isArray(data.records) ? data.records : [];

      setRecords((previous) => {
        const combined = [...previous, ...older];
        combined.sort((a, b) => Number(a.id) - Number(b.id));

        return combined.filter(
          (record, index, array) =>
            index === 0 || record.id !== array[index - 1].id
        );
      });
    } catch (err) {
      setError(err.message || "Could not load older telemetry.");
    } finally {
      setLoadingHistory(false);
    }
  }

  const validRecords = records.filter((record) => {
    const lat = Number(record.latitude);
    const lng = Number(record.longitude);

    return (
      Number.isFinite(lat) &&
      Number.isFinite(lng) &&
      lat >= -90 &&
      lat <= 90 &&
      lng >= -180 &&
      lng <= 180
    );
  });

  const currentRecord = validRecords.length
    ? validRecords[Math.min(currentIndex, validRecords.length - 1)]
    : null;

  const routePositions = validRecords.map((record) => [
    Number(record.latitude),
    Number(record.longitude),
  ]);

  const summary = summaries.find(
    (item) => item.drone_id === selectedDrone
  );

  useEffect(() => {
    if (!playing || validRecords.length < 2) return undefined;

    const delay = Math.max(100, 1000 / Number(playbackSpeed));

    const timer = window.setInterval(() => {
      setCurrentIndex((previous) => {
        if (previous >= validRecords.length - 1) {
          setPlaying(false);
          return previous;
        }

        return previous + 1;
      });
    }, delay);

    return () => window.clearInterval(timer);
  }, [playing, playbackSpeed, validRecords.length]);

  function startReplay() {
    if (validRecords.length < 2) {
      setError(
        "At least two valid GPS positions are required for replay."
      );
      return;
    }

    setError("");

    if (currentIndex >= validRecords.length - 1) {
      setCurrentIndex(0);
    }

    setPlaying(true);
  }

  function resetReplay() {
    setPlaying(false);
    setCurrentIndex(0);
  }

  return (
    <div className="page-content">
      <PageHeader
        eyebrow="FLIGHT OPERATIONS"
        title="Flight History & Replay"
        description="Explore stored drone telemetry and replay historical GPS movement."
        action={
          <span className="live-label">
            {validRecords.length.toLocaleString()} POSITIONS LOADED
          </span>
        }
      />

      <section className="content-card">
        <div className="mission-input-grid">
          <label>
            Select drone
            <select
              value={selectedDrone}
              onChange={(event) => setSelectedDrone(event.target.value)}
              disabled={loadingSummary || summaries.length === 0}
            >
              {summaries.map((drone) => (
                <option key={drone.drone_id} value={drone.drone_id}>
                  {drone.drone_id}
                </option>
              ))}
            </select>
          </label>

          <div className="metric">
            <span>Total stored records</span>
            <strong>
              {Number(
                summary?.total_records ?? totalRecords
              ).toLocaleString()}
            </strong>
          </div>

          <div className="metric">
            <span>Loaded records</span>
            <strong>{records.length.toLocaleString()}</strong>
          </div>

          <div className="metric">
            <span>Valid GPS positions</span>
            <strong>{validRecords.length.toLocaleString()}</strong>
          </div>
        </div>

        {loadingSummary && (
          <p className="mission-note">
            Loading available drone histories...
          </p>
        )}

        {loadingHistory && (
          <p className="mission-note">
            Loading telemetry records...
          </p>
        )}

        {error && (
          <p className="mission-error" role="alert">
            {error}
          </p>
        )}

        {!loadingSummary && summaries.length === 0 && !error && (
          <EmptyState
            title="No flight history found"
            description="Stored telemetry will appear here when available."
          />
        )}
      </section>

      <section className="tracking-map-card" style={{ marginTop: 20 }}>
        <div className="map-heading">
          <div>
            <h2>Historical Route</h2>
            <p>
              {selectedDrone
                ? `Recorded route for ${selectedDrone}`
                : "Select a drone to view its route"}
            </p>
          </div>

          <span className="live-label">
            {validRecords.length > 1
              ? "ROUTE AVAILABLE"
              : "WAITING FOR GPS"}
          </span>
        </div>

        <MapContainer
          key={selectedDrone}
          center={
            currentRecord
              ? [
                  Number(currentRecord.latitude),
                  Number(currentRecord.longitude),
                ]
              : [15.459, 75.008]
          }
          zoom={13}
          scrollWheelZoom
          className="tracking-map"
          style={{
            height: 420,
            width: "100%",
            borderRadius: 12,
          }}
        >
          <TileLayer
            attribution="&copy; OpenStreetMap contributors"
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />

          {routePositions.length > 1 && (
            <Polyline
              positions={routePositions}
              pathOptions={{
                color: "#087c57",
                weight: 4,
                opacity: 0.8,
              }}
            />
          )}

          {routePositions.length > 0 && (
            <CircleMarker
              center={routePositions[0]}
              radius={6}
              pathOptions={{
                color: "#ffffff",
                fillColor: "#16a36a",
                fillOpacity: 1,
                weight: 2,
              }}
            >
              <Popup>Start of loaded history</Popup>
            </CircleMarker>
          )}

          {currentRecord && (
            <CircleMarker
              center={[
                Number(currentRecord.latitude),
                Number(currentRecord.longitude),
              ]}
              radius={9}
              pathOptions={{
                color: "#ffffff",
                fillColor: "#2563eb",
                fillOpacity: 1,
                weight: 3,
              }}
            >
              <Popup>
                <strong>{selectedDrone}</strong>
                <br />
                Record ID: {currentRecord.id ?? "—"}
                <br />
                Battery: {currentRecord.battery ?? "—"}%
                <br />
                Altitude: {currentRecord.altitude ?? "—"} m
                <br />
                Speed: {currentRecord.speed ?? "—"} m/s
              </Popup>
            </CircleMarker>
          )}
        </MapContainer>

        {validRecords.length === 0 && !loadingHistory && (
          <p className="mission-note">
            No valid GPS positions are available for this drone.
          </p>
        )}
      </section>

      <section className="content-card" style={{ marginTop: 20 }}>
        <div className="section-heading">
          <div>
            <h2>Flight Replay Controls</h2>
            <p>
              Move through the loaded GPS positions in chronological order.
            </p>
          </div>
        </div>

        <div
          style={{
            display: "flex",
            gap: 10,
            flexWrap: "wrap",
            alignItems: "center",
            marginBottom: 20,
          }}
        >
          <button
            type="button"
            onClick={startReplay}
            disabled={loadingHistory || validRecords.length < 2}
          >
            {playing ? "Playing..." : "▶ Play"}
          </button>

          <button
            type="button"
            className="secondary-button"
            onClick={() => setPlaying(false)}
            disabled={!playing}
          >
            ⏸ Pause
          </button>

          <button
            type="button"
            className="secondary-button"
            onClick={resetReplay}
            disabled={validRecords.length === 0}
          >
            ↺ Reset
          </button>

          <label>
            Playback speed
            <select
              value={playbackSpeed}
              onChange={(event) =>
                setPlaybackSpeed(event.target.value)
              }
              style={{ display: "block", marginTop: 6 }}
            >
              <option value="0.5">0.5×</option>
              <option value="1">1×</option>
              <option value="2">2×</option>
              <option value="4">4×</option>
            </select>
          </label>
        </div>

        <label style={{ display: "block" }}>
          Replay position:{" "}
          {validRecords.length
            ? `${currentIndex + 1} / ${validRecords.length}`
            : "0 / 0"}

          <input
            type="range"
            min="0"
            max={Math.max(0, validRecords.length - 1)}
            value={Math.min(
              currentIndex,
              Math.max(0, validRecords.length - 1)
            )}
            onChange={(event) => {
              setPlaying(false);
              setCurrentIndex(Number(event.target.value));
            }}
            disabled={validRecords.length < 2}
            style={{
              display: "block",
              width: "100%",
              marginTop: 12,
            }}
          />
        </label>

        {currentRecord && (
          <div className="metrics-grid" style={{ marginTop: 20 }}>
            <Metric label="Record ID" value={currentRecord.id ?? "—"} />
            <Metric
              label="Battery"
              value={`${currentRecord.battery ?? "—"}%`}
            />
            <Metric
              label="Altitude"
              value={`${currentRecord.altitude ?? "—"} m`}
            />
            <Metric
              label="Speed"
              value={`${currentRecord.speed ?? "—"} m/s`}
            />
            <Metric label="Latitude" value={currentRecord.latitude} />
            <Metric label="Longitude" value={currentRecord.longitude} />
          </div>
        )}

        {records.length < totalRecords && (
          <div style={{ marginTop: 20 }}>
            <button
              type="button"
              className="secondary-button"
              onClick={loadOlderRecords}
              disabled={loadingHistory}
            >
              {loadingHistory
                ? "Loading..."
                : `Load Older Records (${records.length.toLocaleString()} of ${totalRecords.toLocaleString()})`}
            </button>

            <p className="mission-note">
              Older records are loaded in chunks of up to{" "}
              {PAGE_SIZE.toLocaleString()} to avoid fetching the entire
              database at once.
            </p>
          </div>
        )}

        {records.length > 0 && (
          <p className="mission-note">
            Replay is based on stored telemetry record order. It does not
            represent a verified flight start time or flight duration.
          </p>
        )}
      </section>
    </div>
  );
}/* Main application */

function App() {
  const [page, setPage] = useState("dashboard");
  const [operatingMode, setOperatingMode] = useState("simulator");

  const [drones, setDrones] = useState([]);
  const [connection, setConnection] = useState("Connecting");
  const [lastUpdate, setLastUpdate] = useState(null);

  const [images, setImages] = useState([]);
  const [imagesLoading, setImagesLoading] = useState(true);
  const [imagesError, setImagesError] = useState("");

  const [home, setHome] = useState(DEFAULT_HOME);
  const [waypoints, setWaypoints] = useState(DEFAULT_WAYPOINTS);
  const [missionResult, setMissionResult] = useState(null);
  const [history, setHistory] = useState({});

  const [activeIncident, setActiveIncident] = useState(null);
  const [incidentBusy, setIncidentBusy] = useState(false);
  const [incidentError, setIncidentError] = useState("");

  const [alarmMuted, setAlarmMuted] = useState(false);
  const [alarmEnabled, setAlarmEnabled] = useState(false);

  const audioContextRef = useRef(null);
  const alarmTimerRef = useRef(null);
  const activeIncidentRef = useRef(null);

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

  const navigateTo = useCallback((nextPage) => {
    setPage(nextPage);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  useEffect(() => {
    activeIncidentRef.current = activeIncident;
  }, [activeIncident]);

  const playAlarm = useCallback(() => {
    try {
      const AudioContextClass =
        window.AudioContext || window.webkitAudioContext;

      if (!AudioContextClass) return;

      if (!audioContextRef.current) {
        audioContextRef.current = new AudioContextClass();
      }

      const context = audioContextRef.current;

      if (context.state === "suspended") {
        context.resume().catch(() => {});
      }

      const oscillator = context.createOscillator();
      const gain = context.createGain();

      oscillator.type = "square";
      oscillator.frequency.value = 880;

      gain.gain.setValueAtTime(0.0001, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(
        0.12,
        context.currentTime + 0.02
      );
      gain.gain.exponentialRampToValueAtTime(
        0.0001,
        context.currentTime + 0.25
      );

      oscillator.connect(gain);
      gain.connect(context.destination);

      oscillator.start();
      oscillator.stop(context.currentTime + 0.27);
    } catch (error) {
      console.warn("Alarm audio could not be played:", error);
    }
  }, []);

  const enableAlarmSound = useCallback(async () => {
    const AudioContextClass =
      window.AudioContext || window.webkitAudioContext;

    if (!AudioContextClass) {
      setIncidentError(
        "This browser does not support the alarm audio API."
      );
      return;
    }

    try {
      if (!audioContextRef.current) {
        audioContextRef.current = new AudioContextClass();
      }

      const context = audioContextRef.current;

      if (context.state !== "running") {
        await context.resume();
      }

      const oscillator = context.createOscillator();
      const gain = context.createGain();

      oscillator.type = "square";
      oscillator.frequency.value = 880;

      gain.gain.setValueAtTime(0.0001, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(
        0.08,
        context.currentTime + 0.02
      );
      gain.gain.exponentialRampToValueAtTime(
        0.0001,
        context.currentTime + 0.18
      );

      oscillator.connect(gain);
      gain.connect(context.destination);

      oscillator.start();
      oscillator.stop(context.currentTime + 0.2);

      setAlarmEnabled(true);
      setAlarmMuted(false);
      setIncidentError("");
    } catch (error) {
      setIncidentError(
        error.message || "Could not enable alarm sound."
      );
    }
  }, []);

  useEffect(() => {
    if (alarmTimerRef.current) {
      window.clearInterval(alarmTimerRef.current);
      alarmTimerRef.current = null;
    }

    if (activeIncident && alarmEnabled && !alarmMuted) {
      playAlarm();
      alarmTimerRef.current = window.setInterval(playAlarm, 1200);
    }

    return () => {
      if (alarmTimerRef.current) {
        window.clearInterval(alarmTimerRef.current);
        alarmTimerRef.current = null;
      }
    };
  }, [activeIncident, alarmEnabled, alarmMuted, playAlarm]);

  useEffect(() => {
    return () => {
      if (alarmTimerRef.current) {
        window.clearInterval(alarmTimerRef.current);
      }

      if (audioContextRef.current) {
        audioContextRef.current.close().catch(() => {});
      }
    };
  }, []);

  const loadSecurityStatus = useCallback(async () => {
    try {
      const response = await fetch(`${API_URL}/security/status`);

      if (!response.ok) {
        throw new Error(
          `Security status request failed: ${response.status}`
        );
      }

      const data = await response.json();

      if (data.incident_active && data.incident) {
        setActiveIncident(data.incident);
      } else {
        setActiveIncident(null);
      }

      setIncidentError("");
    } catch (error) {
      console.error("Could not load security status:", error);

      setIncidentError(
        "Could not load security status. Check that the backend is running."
      );
    }
  }, []);

  const resolveSecurityIncident = useCallback(async () => {
    const incident = activeIncidentRef.current;

    if (!incident?.incident_id) {
      setIncidentError("There is no active incident to resolve.");
      return;
    }

    setIncidentBusy(true);
    setIncidentError("");

    try {
      const response = await fetch(`${API_URL}/security/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          incident_id: incident.incident_id,
        }),
      });

      const result = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(
          result.detail || "Could not resolve the demo incident."
        );
      }

      setActiveIncident(null);
      activeIncidentRef.current = null;
      setIncidentError("");
    } catch (error) {
      setIncidentError(
        error instanceof Error
          ? error.message
          : "Could not resolve the demo incident."
      );
    } finally {
      setIncidentBusy(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    let socket;

    async function loadDrones() {
      try {
        const response = await fetch(`${API_URL}/drones`);

        if (!response.ok) {
          throw new Error(`Request failed: ${response.status}`);
        }

        const data = await response.json();

        if (active) {
          setDrones(Array.isArray(data.drones) ? data.drones : []);
        }
      } catch (error) {
        console.error("Could not load drones:", error);
      }
    }

    async function loadImages() {
      try {
        const response = await fetch(`${API_URL}/images`);

        if (!response.ok) {
          throw new Error(`Request failed: ${response.status}`);
        }

        const data = await response.json();

        if (active) {
          setImages(Array.isArray(data.images) ? data.images : []);
          setImagesError("");
        }
      } catch (error) {
        if (active) {
          setImagesError(`Image loading failed: ${error.message}`);
        }
      } finally {
        if (active) setImagesLoading(false);
      }
    }

    loadDrones();
    loadImages();
    loadSecurityStatus();

    try {
      socket = new WebSocket(WS_URL);

      socket.onopen = () => {
        if (active) setConnection("Connected");
      };

      socket.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);

          if (!active) return;

          if (message.event === "security_incident") {
            const incident =
              message.incident ||
              message.data?.incident ||
              message.data ||
              message.payload?.incident ||
              message.payload;

            if (incident?.incident_id) {
              const nextIncident = {
                status: "ACTIVE",
                severity: "CRITICAL",
                ...incident,
              };

              setActiveIncident(nextIncident);
              activeIncidentRef.current = nextIncident;
              setIncidentError("");
            } else {
              console.warn(
                "Received security_incident without an incident ID:",
                message
              );
            }

            return;
          }

          if (message.event === "security_resolved") {
            const resolved =
              message.incident ||
              message.data?.incident ||
              message.data ||
              message.payload?.incident ||
              message.payload;

            setActiveIncident((current) => {
              if (!current) return null;

              if (
                !resolved?.incident_id ||
                current.incident_id === resolved.incident_id
              ) {
                activeIncidentRef.current = null;
                return null;
              }

              return current;
            });

            setIncidentError("");
            return;
          }

          if (
            message.event !== "telemetry_update" ||
            !message.data
          ) {
            return;
          }

          const updatedDrone = {
            ...message.data,
            analysis: message.analysis || message.data.analysis || {},
            record_id:
              message.record_id ?? message.data.record_id,
            created_at: new Date().toISOString(),
            telemetry_status: message.data.connected
              ? "ONLINE"
              : "DISCONNECTED",
          };

          setDrones((previous) => {
            const exists = previous.some(
              (drone) =>
                drone.drone_id === updatedDrone.drone_id
            );

            return exists
              ? previous.map((drone) =>
                  drone.drone_id === updatedDrone.drone_id
                    ? { ...drone, ...updatedDrone }
                    : drone
                )
              : [...previous, updatedDrone];
          });

          if (isValidPosition(updatedDrone)) {
            const point = [
              Number(updatedDrone.latitude),
              Number(updatedDrone.longitude),
            ];

            setHistory((previous) => {
              const existing =
                previous[updatedDrone.drone_id] || [];
              const last = existing[existing.length - 1];

              if (
                last &&
                last[0] === point[0] &&
                last[1] === point[1]
              ) {
                return previous;
              }

              return {
                ...previous,
                [updatedDrone.drone_id]: [
                  ...existing,
                  point,
                ].slice(-100),
              };
            });
          }

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

      if (socket) {
        socket.onopen = null;
        socket.onmessage = null;
        socket.onerror = null;
        socket.onclose = null;

        if (
          socket.readyState === WebSocket.CONNECTING ||
          socket.readyState === WebSocket.OPEN
        ) {
          socket.close();
        }
      }
    };
  }, [loadSecurityStatus]);

  return (
    <main className="dashboard">
      <header className="topbar">
        <div>
          <p className="eyebrow">
            AQUAAIRX · FLIGHT OPERATIONS
          </p>

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

        <div
          style={{
            marginTop: 12,
            display: "flex",
            gap: 8,
            flexWrap: "wrap",
          }}
        >
          <button
            type="button"
            onClick={enableAlarmSound}
            disabled={alarmEnabled && !alarmMuted}
          >
            {alarmEnabled
              ? alarmMuted
                ? "Enable / Unmute Alarm"
                : "Alarm Sound Enabled"
              : "Enable Alarm Sound"}
          </button>

          {alarmEnabled && (
            <button
              type="button"
              className="secondary-button"
              onClick={() => setAlarmMuted((value) => !value)}
            >
              {alarmMuted ? "Unmute Alarm" : "Mute Alarm"}
            </button>
          )}
        </div>

        <div className="mode-selector" style={{ marginTop: 16 }}>
          <strong>Operating Mode</strong>

          <div
            style={{
              display: "flex",
              gap: 8,
              flexWrap: "wrap",
              marginTop: 8,
            }}
          >
            <button
              type="button"
              className={
                operatingMode === "simulator"
                  ? "active"
                  : "secondary-button"
              }
              aria-pressed={operatingMode === "simulator"}
              onClick={() => {
                setOperatingMode("simulator");
                navigateTo("dashboard");
              }}
            >
              Simulator Mode
            </button>

            <button
              type="button"
              className={
                operatingMode === "real"
                  ? "active"
                  : "secondary-button"
              }
              aria-pressed={operatingMode === "real"}
              onClick={() => {
                setOperatingMode("real");
                navigateTo("real-setup");
              }}
            >
              Real Drone Mode
            </button>
          </div>

          <p className="mission-note">
            Real Drone Mode currently prepares a demo configuration only.
            It does not connect to or control physical hardware.
          </p>
        </div>
      </header>

      <SecurityIncidentBanner
        incident={activeIncident}
        onResolve={resolveSecurityIncident}
        resolving={incidentBusy}
        error={incidentError}
        muted={alarmMuted}
        onToggleMute={() => setAlarmMuted((value) => !value)}
        soundEnabled={alarmEnabled}
        onEnableSound={enableAlarmSound}
      />

      <div className="app-layout">
        <aside className="sidebar">
          <div className="sidebar-brand">
            <span className="brand-mark">A</span>

            <div>
              <strong>AquaAirX</strong>
              <small>Flight Operations</small>
            </div>
          </div>

          <nav className="sidebar-nav" aria-label="Main navigation">
            {NAV_ITEMS.map((item) => (
              <button
                type="button"
                key={item.id}
                className={`nav-item ${
                  page === item.id ? "active" : ""
                }`}
                onClick={() => navigateTo(item.id)}
              >
                <span className="nav-icon" aria-hidden="true">
                  {item.icon}
                </span>

                <span>{item.label}</span>
              </button>
            ))}
          </nav>

          <div className="sidebar-status">
            <span
              className={`status-dot ${
                connection === "Connected" ? "green" : "red"
              }`}
            />

            <div>
              <strong>{connection}</strong>
              <small>Telemetry connection</small>
            </div>
          </div>
        </aside>

        <section className="main-content">
          {page === "real-setup" && (
            <RealDroneSetup
              onBack={() => {
                setOperatingMode("simulator");
                navigateTo("dashboard");
              }}
            />
          )}

          {page === "dashboard" && (
            <DashboardPage
              drones={drones}
              operatingMode={operatingMode}
              connection={connection}
              lastUpdate={lastUpdate}
              onlineCount={onlineCount}
              warningCount={warningCount}
            />
          )}

          {page === "mission" && (
            <MissionPlanner
              home={home}
              setHome={setHome}
              waypoints={waypoints}
              setWaypoints={setWaypoints}
              onContinue={() => navigateTo("planning")}
            />
          )}

          {page === "planning" && (
            <DronePlanning
              home={home}
              waypoints={waypoints}
              onBack={() => navigateTo("mission")}
              result={missionResult}
              setResult={setMissionResult}
            />
          )}

          {page === "tracking" && (
            <TrackingPage
              drones={drones}
              history={history}
            />
          )}

          {page === "history" && <FlightHistoryPage />}

          {page === "alerts" && (
            <EmergencyAlerts
              drones={drones}
              incident={activeIncident}
            />
          )}

          {page === "images" && (
            <ImageGallery
              images={images}
              loading={imagesLoading}
              error={imagesError}
            />
          )}

          {page === "privacy" && (
            <PrivacyProtectionPage
              operatingMode={operatingMode}
            />
          )}

          <footer className="app-footer">
            <span>Drone Monitoring System</span>

            <span>
              {lastUpdate
                ? `Last telemetry update: ${lastUpdate.toLocaleTimeString()}`
                : connection}
            </span>
          </footer>
        </section>
      </div>
    </main>
  );
}

export default App;