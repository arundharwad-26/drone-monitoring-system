from fastapi.responses import FileResponse
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4
from io import BytesIO
import sqlite3

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from PIL import Image


router = APIRouter()

BASE_DIR = Path(__file__).resolve().parent
IMAGE_DIR = BASE_DIR / "captured_images"
DB_PATH = BASE_DIR / "drone_monitoring.db"

MAX_IMAGE_SIZE = 10 * 1024 * 1024  # 10 MB

IMAGE_DIR.mkdir(parents=True, exist_ok=True)


def initialize_image_table():
    with sqlite3.connect(DB_PATH) as connection:
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS drone_images (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                drone_id TEXT NOT NULL,
                filename TEXT NOT NULL,
                latitude REAL NOT NULL,
                longitude REAL NOT NULL,
                captured_at TEXT NOT NULL
            )
            """
        )


initialize_image_table()


@router.post("/images/{drone_id}")
async def capture_image(
    drone_id: str,
    latitude: float = Form(...),
    longitude: float = Form(...),
    image: UploadFile = File(...),
):
    if not drone_id.strip() or len(drone_id) > 100:
        raise HTTPException(
            status_code=400,
            detail="Invalid drone ID",
        )

    if not -90 <= latitude <= 90:
        raise HTTPException(
            status_code=400,
            detail="Invalid latitude",
        )

    if not -180 <= longitude <= 180:
        raise HTTPException(
            status_code=400,
            detail="Invalid longitude",
        )

    if image.content_type not in {"image/jpeg", "image/png"}:
        await image.close()
        raise HTTPException(
            status_code=400,
            detail="Only JPEG and PNG images are accepted",
        )

    try:
        content = await image.read(MAX_IMAGE_SIZE + 1)

        if not content:
            raise HTTPException(
                status_code=400,
                detail="Image is empty",
            )

        if len(content) > MAX_IMAGE_SIZE:
            raise HTTPException(
                status_code=413,
                detail="Image exceeds 10 MB",
            )

        try:
            with Image.open(BytesIO(content)) as picture:
                if picture.format not in {"JPEG", "PNG"}:
                    raise ValueError("Unsupported image format")

                image_format = picture.format
                picture.verify()

        except Exception:
            raise HTTPException(
                status_code=400,
                detail="Invalid image file",
            )

    finally:
        await image.close()

    extension = ".jpg" if image_format == "JPEG" else ".png"
    filename = f"{uuid4().hex}{extension}"
    destination = IMAGE_DIR / filename

    captured_at = datetime.now(timezone.utc).isoformat()

    try:
        destination.write_bytes(content)

        with sqlite3.connect(DB_PATH) as connection:
            cursor = connection.execute(
                """
                INSERT INTO drone_images (
                    drone_id, filename, latitude,
                    longitude, captured_at
                )
                VALUES (?, ?, ?, ?, ?)
                """,
                (
                    drone_id,
                    filename,
                    latitude,
                    longitude,
                    captured_at,
                ),
            )

            image_id = cursor.lastrowid

    except Exception:
        destination.unlink(missing_ok=True)

        raise HTTPException(
            status_code=500,
            detail="Could not save image and metadata",
        )

    return {
        "message": "Image uploaded successfully",
        "image_id": image_id,
        "drone_id": drone_id,
        "filename": filename,
        "latitude": latitude,
        "longitude": longitude,
        "captured_at": captured_at,
    }


@router.get("/images")
def list_images():
    with sqlite3.connect(DB_PATH) as connection:
        connection.row_factory = sqlite3.Row

        rows = connection.execute(
            """
            SELECT id, drone_id, filename,
                   latitude, longitude, captured_at
            FROM drone_images
            ORDER BY id DESC
            LIMIT 100
            """
        ).fetchall()

    return {
        "images": [dict(row) for row in rows]
    }

@router.get("/images/{image_id}/file")
def get_image_file(image_id: int):
    with sqlite3.connect(DB_PATH) as connection:
        connection.row_factory = sqlite3.Row

        row = connection.execute(
            """
            SELECT filename
            FROM drone_images
            WHERE id = ?
            """,
            (image_id,),
        ).fetchone()

    if row is None:
        raise HTTPException(
            status_code=404,
            detail="Image not found",
        )

    filename = row["filename"]
    image_path = IMAGE_DIR / filename

    # Ensure the resolved file stays inside the image directory.
    if (
        image_path.resolve().parent != IMAGE_DIR.resolve()
        or not image_path.is_file()
    ):
        raise HTTPException(
            status_code=404,
            detail="Image file not found",
        )

    media_type = (
        "image/jpeg" if filename.lower().endswith(".jpg")
        else "image/png"
    )

    return FileResponse(
        path=image_path,
        media_type=media_type,
    )
