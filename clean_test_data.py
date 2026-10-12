from database import get_connection

connection=get_connection()

try:
    cursor=connection.execute(
        "DELETE FROM telemetry WHERE drone_id=?",
        ("string",)
    )

    connection.commit()
    print(f"Removed {cursor.rowcount} invalid test record(s).")
finally:
    connection.close()