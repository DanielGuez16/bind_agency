"""Schémas d'entrée et de sortie de l'authentification."""

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field, model_validator

from app.core import passwords
from app.models.enums import Locale, UserRole, UserStatus

# Les deux bornes restent ici pour les schémas ; la **force**, elle, vit dans
# `app.core.passwords`. Une exigence de composition — majuscule, chiffre,
# symbole — a été écartée et le reste : elle accepte `Password1!` et refuse une
# phrase de passe longue, c'est-à-dire l'inverse de ce qu'on veut.
PASSWORD_MIN_LENGTH = passwords.LONGUEUR_MINIMALE
PASSWORD_MAX_LENGTH = passwords.LONGUEUR_MAXIMALE


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=PASSWORD_MIN_LENGTH, max_length=PASSWORD_MAX_LENGTH)
    role: UserRole
    locale: Locale = Locale.EN

    @model_validator(mode="after")
    def _mot_de_passe_solide(self) -> "RegisterRequest":
        """**Vérifié avec l'adresse**, et c'est pourquoi c'est un validateur de
        modèle et non de champ : le refus le plus utile — « votre mot de passe
        contient votre adresse » — ne se voit pas sur le seul mot de passe.

        Le code du refus remonte tel quel dans le 422 : l'interface le traduit,
        et une phrase écrite ici n'existerait qu'en anglais.
        """
        try:
            passwords.verifier(self.password, email=self.email)
        except passwords.MotDePasseFaible as faible:
            raise ValueError(str(faible)) from faible
        return self


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
    #: Quand l'adresse a été confirmée. **Nulle veut dire « pas encore »**, et
    #: l'écran doit le dire : sans elle, réserver et mettre un commerce en ligne
    #: sont refusés, et découvrir le refus au moment de réserver serait le pire
    #: endroit pour l'apprendre.
    email_verified_at: datetime | None
    #: Quand la suppression demandée prendra effet, nulle si aucune ne court.
    #:
    #: **Servie sur `/me` et non sur une route à part** : c'est un état du
    #: compte, et l'écran qui l'affiche est celui des réglages, qui lit déjà
    #: `/me`. Une seconde route ferait un second appel pour un champ.
    #:
    #: L'échéance et non le temps restant : elle ne bouge pas, un compte à
    #: rebours de trente jours n'a pas besoin d'être compté à la seconde, et un
    #: écran laissé ouvert se recale dessus tout seul.
    deletion_effective_at: datetime | None
