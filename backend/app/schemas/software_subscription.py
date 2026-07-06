from pydantic import BaseModel, ConfigDict, Field, field_validator


STATUS_VALUES = {"Active", "Pending Renewal", "Needs Review", "Cancelled"}


class SoftwareSubscriptionCreate(BaseModel):
    name: str = Field(min_length=1, max_length=180)
    description: str = Field(default="", max_length=1000)
    point_of_contact: str = Field(min_length=1, max_length=120)
    assigned_users: str = Field(default="", max_length=500)
    cost_2024_2025: float | None = Field(default=None, ge=0)
    cost_2025_2026: float | None = Field(default=None, ge=0)
    cost_2026_2027: float | None = Field(default=None, ge=0)
    renewal_time_frame: str = Field(min_length=1, max_length=120)
    vendor_rep: str = Field(default="", max_length=180)
    subscribed_since: str = Field(default="", max_length=80)
    status: str = Field(min_length=1, max_length=80)
    notes: str = Field(default="", max_length=1500)

    @field_validator(
        "name",
        "description",
        "point_of_contact",
        "assigned_users",
        "renewal_time_frame",
        "vendor_rep",
        "subscribed_since",
        "status",
        "notes",
        mode="before",
    )
    @classmethod
    def strip_text_fields(cls, value):
        return value.strip() if isinstance(value, str) else value

    @field_validator("status")
    @classmethod
    def validate_status(cls, value):
        if value not in STATUS_VALUES:
            raise ValueError(f"Status must be one of: {', '.join(sorted(STATUS_VALUES))}")
        return value


class SoftwareSubscriptionUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=180)
    description: str | None = Field(default=None, max_length=1000)
    point_of_contact: str | None = Field(default=None, min_length=1, max_length=120)
    assigned_users: str | None = Field(default=None, max_length=500)
    cost_2024_2025: float | None = Field(default=None, ge=0)
    cost_2025_2026: float | None = Field(default=None, ge=0)
    cost_2026_2027: float | None = Field(default=None, ge=0)
    renewal_time_frame: str | None = Field(default=None, min_length=1, max_length=120)
    vendor_rep: str | None = Field(default=None, max_length=180)
    subscribed_since: str | None = Field(default=None, max_length=80)
    status: str | None = Field(default=None, min_length=1, max_length=80)
    notes: str | None = Field(default=None, max_length=1500)

    @field_validator(
        "name",
        "description",
        "point_of_contact",
        "assigned_users",
        "renewal_time_frame",
        "vendor_rep",
        "subscribed_since",
        "status",
        "notes",
        mode="before",
    )
    @classmethod
    def strip_optional_text_fields(cls, value):
        return value.strip() if isinstance(value, str) else value

    @field_validator("status")
    @classmethod
    def validate_optional_status(cls, value):
        if value is not None and value not in STATUS_VALUES:
            raise ValueError(f"Status must be one of: {', '.join(sorted(STATUS_VALUES))}")
        return value


class SoftwareSubscriptionResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    description: str
    point_of_contact: str
    assigned_users: str
    cost_2024_2025: float | None = None
    cost_2025_2026: float | None = None
    cost_2026_2027: float | None = None
    renewal_time_frame: str
    vendor_rep: str
    subscribed_since: str
    status: str
    notes: str
    created_at: str
    updated_at: str


class SoftwareSubscriptionListResponse(BaseModel):
    count: int
    data: list[SoftwareSubscriptionResponse]
