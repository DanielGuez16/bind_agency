"""Catalogue des codes d'erreur. Source de vérité unique.

L'API ne renvoie jamais de texte destiné à l'affichage. Elle renvoie un code
stable, et c'est l'application qui le traduit : une API qui renvoie des phrases
localisées oblige à redéployer le backend pour corriger une virgule.

Tout code ajouté ici doit l'être aussi dans les catalogues de l'application,
`app/src/i18n/en.ts` et `app/src/i18n/es.ts`. Deux tests tiennent la chaîne :
l'un refuse un code renvoyé par une route qui ne figurerait pas ici, l'autre
refuse un catalogue de l'app auquel il manquerait une clé.
"""

from enum import StrEnum

from fastapi import HTTPException


class ErrorCode(StrEnum):
    # Authentification
    AUTHENTICATION_REQUIRED = "authentication_required"
    INVALID_CREDENTIALS = "invalid_credentials"
    ACCOUNT_NOT_ACTIVE = "account_not_active"
    INVALID_REFRESH_TOKEN = "invalid_refresh_token"
    EMAIL_ALREADY_USED = "email_already_used"

    # Autorisation
    INSUFFICIENT_ROLE = "insufficient_role"
    NOT_A_MEMBER = "not_a_member"

    # Transverses
    VALIDATION_FAILED = "validation_failed"
    NOT_FOUND = "not_found"
    INTERNAL_ERROR = "internal_error"


def api_error(
    status_code: int, code: ErrorCode, *, headers: dict[str, str] | None = None
) -> HTTPException:
    """Seule fabrique d'erreur HTTP autorisée.

    Le type du paramètre interdit qu'un code hors catalogue parte vers l'app.
    """
    return HTTPException(status_code=status_code, detail=code.value, headers=headers)
