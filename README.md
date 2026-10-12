# 🚁 Drone Monitoring System

A real-time drone monitoring dashboard built with **FastAPI, React.js, WebSockets, and SQLite**, featuring live telemetry visualization, AI-based anomaly detection, and drone simulation.

## 📌 Project Overview

The Drone Monitoring System monitors drone telemetry data and displays drone activity through a web-based dashboard. It combines a Python backend with a React frontend to support real-time updates, anomaly alerts, and location visualization.

The project includes a simulator mode for testing and a real-drone mode selector intended for future hardware integration.

## ✨ Features

- **Real-Time Telemetry:** Receive and display drone telemetry updates.
- **Interactive Map:** Visualize drone locations using a map interface.
- **AI-Based Anomaly Detection:** Identify unusual telemetry patterns using Isolation Forest and rule-based checks.
- **Live Dashboard:** Monitor drone status and telemetry through a React interface.
- **WebSocket Communication:** Deliver real-time updates between the backend and frontend.
- **Drone Simulator:** Generate simulated telemetry for development and testing.
- **Alert System:** Display alerts when abnormal drone behavior is detected.
- **Image Monitoring:** Support image capture and viewing through the application's image gallery.
- **Operating Modes:** Switch between Simulator Mode and Real Drone Mode.

> **Note:** Real Drone Mode currently provides a mode-selection mechanism. Connecting physical drone hardware requires a compatible communication adapter and supported drone protocol.

## 🛠️ Technology Stack

| Component | Technologies |
|---|---|
| Frontend | React.js, Vite, CSS |
| Backend | Python, FastAPI |
| Real-time Communication | WebSockets |
| Database | SQLite |
| Machine Learning | Scikit-learn, Isolation Forest |
| Mapping | React Leaflet |
| Simulation | Python |

## 🏗️ Project Structure

```text
drone-monitoring-system/
├── main.py
├── database.py
├── schemas.py
├── services.py
├── anomaly_detection.py
├── drone_simulator.py
├── image_capture.py
├── websocket_manager.py
├── clean_test_data.py
├── ws_test.html
├── README.md
└── frontend/
    ├── package.json
    ├── index.html
    └── src/
        ├── App.jsx
        ├── App.css
        └── main.jsx
```

## ⚙️ Prerequisites

- Python 3.10 or later
- Node.js and npm
- Git

## 🚀 Getting Started

### 1. Clone the repository

```bash
git clone https://github.com/arundharwad-26/drone-monitoring-system.git
cd drone-monitoring-system
```

### 2. Set up the backend

Create and activate a virtual environment.

**Windows PowerShell:**

```powershell
python -m venv venv
.\venv\Scripts\Activate.ps1
```

Install the Python dependencies required by the backend. Install the packages listed in your project's dependency file if one is available.

Start the FastAPI server:

```powershell
uvicorn main:app --reload
```

Backend API: http://127.0.0.1:8000

API documentation: http://127.0.0.1:8000/docs

### 3. Set up the frontend

Open a separate terminal:

```powershell
cd frontend
npm install
npm run dev
```

Frontend dashboard: http://localhost:5173

### 4. Run the drone simulator

Open another terminal in the project root and activate the virtual environment:

```powershell
.\venv\Scripts\Activate.ps1
python drone_simulator.py
```

Keep the backend, frontend, and simulator running in separate terminals when testing simulated telemetry.

## 🧠 Anomaly Detection

The system uses Isolation Forest and rule-based checks to identify unusual telemetry patterns. Detected anomalies can be presented through the dashboard's monitoring and alert features.

## 🔌 API and Real-Time Communication

The FastAPI backend provides telemetry and drone-related endpoints, with WebSocket communication for live updates.

Interactive API documentation is available at `/docs` while the backend is running.

## 🔮 Future Enhancements

- Integrate physical drones through compatible telemetry protocols such as MAVLink.
- Add authenticated users and role-based access.
- Store historical telemetry for trend analysis.
- Improve anomaly detection with additional telemetry features.
- Deploy the frontend and backend for public access.

## 👨‍💻 Author

**Arun B Dharwad**

GitHub: [@arundharwad-26](https://github.com/arundharwad-26)

---

*Developed as a drone monitoring and AI-based anomaly detection project.*