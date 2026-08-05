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
    not_found: 'No hemos encontrado lo que buscabas.',
    internal_error: 'Algo ha salido mal por nuestra parte.',
  },
};
