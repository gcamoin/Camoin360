from datetime import date

from pydantic import BaseModel, ConfigDict, Field, field_validator


class OrganizationCreate(BaseModel):
    organization_name: str = Field(min_length=1, max_length=160)
    city: str = Field(default="", max_length=80)
    state: str = Field(default="", max_length=50)
    contract_expiration: date | None = None

    @field_validator("organization_name", "city", "state", mode="before")
    @classmethod
    def strip_text_fields(cls, value):
        return value.strip() if isinstance(value, str) else value


class OrganizationUpdate(BaseModel):
    organization_name: str | None = Field(default=None, min_length=1, max_length=160)
    city: str | None = Field(default=None, max_length=80)
    state: str | None = Field(default=None, max_length=50)
    contract_expiration: date | None = None

    @field_validator("organization_name", "city", "state", mode="before")
    @classmethod
    def strip_optional_text_fields(cls, value):
        return value.strip() if isinstance(value, str) else value


class OrganizationResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    dynamics_account_id: str
    organization_name: str
    city: str
    state: str
    user_count: int
    contract_expiration: date | None = None
    created_at: str
    updated_at: str


class OrganizationListResponse(BaseModel):
    count: int
    data: list[OrganizationResponse]
