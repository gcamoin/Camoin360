from dataclasses import dataclass


@dataclass(frozen=True)
class ClientUser:
    id: int
    organization_id: int
    organization_name: str
    name: str
    username: str
    password_hash: str
    role: str
    created_at: str
    updated_at: str

    @classmethod
    def from_row(cls, row):
        return cls(**dict(row))
