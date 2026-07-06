from dataclasses import dataclass


@dataclass(frozen=True)
class SoftwareSubscription:
    id: int
    name: str
    description: str
    point_of_contact: str
    assigned_users: str
    cost_2024_2025: float | None
    cost_2025_2026: float | None
    cost_2026_2027: float | None
    renewal_time_frame: str
    vendor_rep: str
    subscribed_since: str
    status: str
    notes: str
    created_at: str
    updated_at: str

    @classmethod
    def from_row(cls, row):
        return cls(**dict(row))
