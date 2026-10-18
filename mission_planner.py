
from math import asin, cos, radians, sin, sqrt
from typing import List

from fastapi import APIRouter
from pydantic import BaseModel, Field, model_validator


router = APIRouter(prefix="/missions", tags=["Mission Planner"])

EARTH_RADIUS_KM = 6371.0


class Location(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    task_duration_minutes: float = Field(default=0, ge=0, le=240)


class MissionRequest(BaseModel):
    home: Location
    waypoints: List[Location] = Field(min_length=1, max_length=5)

    current_battery_percent: float = Field(ge=0, le=100)
    battery_capacity_wh: float = Field(gt=0)
    cruise_speed_kmh: float = Field(gt=0, le=300)
    flight_power_watts: float = Field(gt=0)
    reserve_percent: float = Field(default=20, ge=0, le=100)

    @model_validator(mode="after")
    def validate_reserve(self):
        if self.reserve_percent >= self.current_battery_percent:
            raise ValueError(
                "Current battery must be greater than reserve percentage."
            )
        return self


def distance_km(a: Location, b: Location) -> float:
    """Calculate great-circle distance between two GPS coordinates."""

    lat1 = radians(a.latitude)
    lat2 = radians(b.latitude)
    delta_lat = radians(b.latitude - a.latitude)
    delta_lon = radians(b.longitude - a.longitude)

    h = (
        sin(delta_lat / 2) ** 2
        + cos(lat1) * cos(lat2) * sin(delta_lon / 2) ** 2
    )

    return 2 * EARTH_RADIUS_KM * asin(sqrt(min(1.0, h)))


@router.post("/calculate")
def calculate_mission(request: MissionRequest):
    """
    Estimate a route through all waypoints and back home.

    Results are planning estimates, not real-flight safety guarantees.
    """

    route = [request.home] + request.waypoints + [request.home]

    legs = []
    total_distance_km = 0.0

    for index in range(len(route) - 1):
        start = route[index]
        end = route[index + 1]

        leg_distance = distance_km(start, end)
        total_distance_km += leg_distance

        legs.append({
            "from": start.name,
            "to": end.name,
            "distance_km": round(leg_distance, 3),
        })

    cruise_time_hours = total_distance_km / request.cruise_speed_kmh
    cruise_time_minutes = cruise_time_hours * 60

    task_time_minutes = sum(
        waypoint.task_duration_minutes
        for waypoint in request.waypoints
    )

    total_time_minutes = cruise_time_minutes + task_time_minutes

    estimated_energy_wh = (
        request.flight_power_watts * cruise_time_hours
        + request.flight_power_watts * task_time_minutes / 60
    )

    available_energy_wh = (
        request.battery_capacity_wh
        * (request.current_battery_percent - request.reserve_percent)
        / 100
    )

    required_battery_percent = (
        estimated_energy_wh / request.battery_capacity_wh * 100
    )

    feasible_by_energy_estimate = (
        estimated_energy_wh <= available_energy_wh
    )

    return {
        "planning_mode": "SIMULATION_ESTIMATE",
        "route": [location.name for location in route],
        "legs": legs,
        "total_distance_km": round(total_distance_km, 3),
        "estimated_flight_time_minutes": round(
            cruise_time_minutes, 2
        ),
        "estimated_task_time_minutes": round(task_time_minutes, 2),
        "estimated_total_time_minutes": round(total_time_minutes, 2),
        "estimated_energy_wh": round(estimated_energy_wh, 2),
        "estimated_battery_required_percent": round(
            required_battery_percent, 2
        ),
        "energy_available_above_reserve_wh": round(
            available_energy_wh, 2
        ),
        "reserve_percent": request.reserve_percent,
        "feasible_by_energy_estimate": feasible_by_energy_estimate,
        "limitations": [
            "Uses straight-line GPS distances, not obstacle-aware routing.",
            "Uses constant cruise speed and power assumptions.",
            "Does not yet model wind, takeoff, landing, or route uncertainty.",
            "Energy feasibility is not a real-flight safety guarantee.",
        ],
    }
