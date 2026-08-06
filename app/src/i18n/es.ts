/**
 * Catalogue espagnol.
 *
 * Le type `Catalogue` force la structure : une clé oubliée est une erreur de
 * compilation TypeScript avant même d'être une erreur de test.
 */
import type { Catalogue } from './en';

export const es: Catalogue = {
  common: {
    appName: 'BIND',
    retry: 'Volver a comprobar',
    loading: 'Cargando…',
    language: 'Idioma',
  },
  health: {
    title: 'Estado del servidor',
    reachable: 'API accesible',
    unreachable: 'API inaccesible',
    missingApiUrl: 'No hay dirección de API configurada',
    dependencyOk: 'disponible',
    dependencyDown: 'no disponible',
  },
  errors: {
    generic: 'Algo ha salido mal. Inténtalo de nuevo.',
    authentication_required: 'Inicia sesión para continuar.',
    invalid_credentials: 'Correo electrónico o contraseña incorrectos.',
    account_not_active: 'Esta cuenta ha sido cerrada.',
    invalid_refresh_token: 'Tu sesión ha caducado. Vuelve a iniciar sesión.',
    email_already_used: 'Este correo electrónico ya está registrado.',
    insufficient_role: 'Tu cuenta no puede acceder a esto.',
    not_a_member: 'No perteneces a este negocio.',
    validation_failed: 'Falta información o es incorrecta.',
    business_already_active: 'Este negocio ya está activo.',
    business_missing_address: 'Añade la dirección del negocio antes de activarlo.',
    business_missing_coordinates: 'Añade la ubicación del negocio antes de activarlo.',
    catalog_duration_mismatch: 'Un artículo reservable necesita una duración, y uno que no se reserva no debe tenerla.',
    catalog_item_not_found: 'Este artículo no está en tu catálogo.',
    catalog_item_has_bookings: 'Este artículo tiene reservas y no se puede eliminar. Desactívalo en su lugar.',
    catalog_item_locked_by_bookings: 'Este artículo ya tiene reservas, por lo que su tipo y duración no pueden cambiar. Crea un artículo nuevo.',
    catalog_parent_not_found: 'El artículo principal no existe en tu catálogo.',
    catalog_parent_must_not_be_bookable: 'Un artículo con variantes no se reserva directamente. Se reserva la variante.',
    catalog_variant_depth_exceeded: 'Una variante no puede tener variantes propias.',
    capacity_rule_not_found: 'Esta regla de horario ya no existe.',
    capacity_rule_overlap: 'Estas horas se solapan con otro tramo del mismo día.',
    capacity_exception_not_found: 'Esta excepción ya no existe.',
    capacity_exception_duplicate_date: 'Ya existe una excepción para esa fecha.',
    tier_not_found: 'Este nivel ya no existe.',
    tier_already_exists: 'Ya existe un nivel para esa plataforma y ese formato.',
    tier_in_use: 'Este nivel se usa en ofertas o colaboraciones existentes. Desactívalo en lugar de eliminarlo.',
    tier_offer_not_found: 'Esta oferta ya no existe.',
    tier_offer_already_exists: 'Este artículo ya se ofrece en ese nivel.',
    tier_offer_parent_not_allowed: 'Un artículo con variantes no se puede ofrecer. Ofrece la variante.',
    tier_offer_tier_inactive: 'Este nivel no está abierto ahora mismo.',
    tier_offer_has_bookings: 'Esta oferta tiene reservas y no se puede quitar. Desactívala en su lugar.',
    oauth_state_invalid: 'Este enlace de conexión ya no es válido. Vuelve a empezar desde tu cuenta.',
    social_account_taken: 'Esta cuenta social ya está vinculada a otra cuenta de BIND.',
    social_provider_unavailable: 'No hemos podido contactar con la red social. Inténtalo de nuevo.',
    social_account_not_found: 'No encontramos esta cuenta social en tu perfil.',
    social_account_not_active: 'Esta cuenta social debe volver a conectarse antes de poder actualizarla.',
    social_token_expired: 'Instagram ya no acepta nuestro acceso a esta cuenta. Vuelve a conectarla para seguir colaborando.',
    metrics_refresh_too_soon: 'Tus estadísticas se actualizaron hace poco. Inténtalo de nuevo más tarde.',
    not_found: 'No hemos encontrado lo que buscabas.',
    internal_error: 'Algo ha salido mal por nuestra parte.',
  },
};
