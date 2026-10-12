import sqlite3
DATABASE_NAME="drone_monitoring.db"

def get_connection():
    connection = sqlite3.connect(DATABASE_NAME)
    connection.row_factory = sqlite3.Row
    return connection

def create_table():
    connection=get_connection()

    connection.execute("""
        CREATE TABLE IF NOT EXISTS telemetry(
        id INTEGER PRIMARY KEY AUTOINCREMENT,
            drone_id TEXT NOT NULL,
            latitude REAL NOT NULL,
            longitude REAL NOT NULL,
            battery REAL NOT NULL,
            altitude REAL NOT NULL,
            speed REAL NOT NULL,
            connected INTEGER NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)""")

    connection.commit()
    connection.close()
    
if __name__ == "__main__":
    create_table()
    print("Database and telemetry table created successfully!")