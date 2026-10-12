
from fastapi import WebSocket


class ConnectionManager:
    def __init__(self):
        self.active_connections = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)
        print("WebSocket client connected")
        print("Active connections:", len(self.active_connections))

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)
            print("WebSocket client disconnected")

    async def broadcast(self, message: dict):
        print("Broadcasting telemetry:", message)
        print("Active connections:", len(self.active_connections))

        disconnected = []

        for connection in self.active_connections.copy():
            try:
                await connection.send_json(message)
                print("Telemetry sent successfully")
            except Exception as error:
                print("WebSocket send failed:", error)
                disconnected.append(connection)

        for connection in disconnected:
            self.disconnect(connection)


manager = ConnectionManager()
