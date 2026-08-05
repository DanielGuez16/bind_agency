"""Schémas d'entrée et de sortie de l'authentification."""

import uuid

from pydantic import BaseModel, ConfigDict, EmailStr, Field

from app.models.enums import Locale, UserRole, UserStatus

# Longueur minimale seulement : imposer une composition pousse aux mots de passe
# courts et prévisibles. La longueur maximale protège du déni de service par
# hachage d'une entrée démesurée.
PASSWORD_MIN_LENGTH = 12
PASSWORD_MAX_LENGTH = 256


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=PASSWORD_MIN_LENGTH, max_length=PASSWORD_MAX_LENGTH)
    role: UserRole
    locale: Locale = Locale.EN


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(max_length=PASSWORD_MAX_LENGTH)


class RefreshRequest(BaseModel):
    refresh_token: str


class TokenPair(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int


class UpdateMeRequest(BaseModel):
    """Seule la langue est modifiable ici : le reste du profil relève des phases suivantes."""

    locale: Locale


class UserRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    email: str | None
    role: UserRole
    status: UserStatus
    locale: Locale
