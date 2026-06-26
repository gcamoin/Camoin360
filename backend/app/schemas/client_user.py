from pydantic import BaseModel, ConfigDict, Field, field_validator


class ClientUserBase(BaseModel):
    organization_id: int = Field(gt=0)
    name: str = Field(min_length=1, max_length=160)
    username: str = Field(min_length=1, max_length=160)
    role: str = Field(default="user", min_length=1, max_length=80)

    @field_validator("name", "username", "role", mode="before")
    @classmethod
    def strip_text_fields(cls, value):
        return value.strip() if isinstance(value, str) else value


class ClientUserCreate(ClientUserBase):
    password: str = Field(min_length=8, max_length=256)


class OrganizationClientUserCreate(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    username: str = Field(min_length=1, max_length=160)
    password: str = Field(min_length=8, max_length=256)
    role: str = Field(default="user", min_length=1, max_length=80)

    @field_validator("name", "username", "role", mode="before")
    @classmethod
    def strip_text_fields(cls, value):
        return value.strip() if isinstance(value, str) else value


class ClientUserUpdate(BaseModel):
    organization_id: int | None = Field(default=None, gt=0)
    name: str | None = Field(default=None, min_length=1, max_length=160)
    username: str | None = Field(default=None, min_length=1, max_length=160)
    role: str | None = Field(default=None, min_length=1, max_length=80)

    @field_validator("name", "username", "role", mode="before")
    @classmethod
    def strip_optional_text_fields(cls, value):
        return value.strip() if isinstance(value, str) else value


class ClientUserPasswordReset(BaseModel):
    password: str = Field(min_length=8, max_length=256)


class ClientUserResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    organization_id: int
    organization_name: str
    name: str
    username: str
    password_hash: str
    role: str
    created_at: str
    updated_at: str


class ClientUserListResponse(BaseModel):
    count: int
    data: list[ClientUserResponse]
