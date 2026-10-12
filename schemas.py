# This file contains the drone related validation
import re
from pydantic import BaseModel,Field, field_validator

class Telemetry(BaseModel):
    drone_id: str=Field(min_length=3, max_length=50)
    # drone_id:str
    latitude:float=Field(ge=-90,le=90)
    longitude:float=Field(ge=-180,le=180)
    battery:float=Field(ge=0,le=100)
    altitude:float
    speed:float = Field(ge=0)
    connected:bool

    @field_validator("drone_id")
    @classmethod
    def validate_drone_id(cls, value):
        value=value.strip()

        if value.lower() in {"string","unknown","null","none"}:
            raise ValueError("Enter a real drone ID, not a placeholder")

        if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]*", value):
            raise ValueError(
                "Drone ID may contain only letters, numbers, hyphens and underscores"
            )

        return value

