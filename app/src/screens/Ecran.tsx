/**
 * L'enveloppe d'un écran, et le rendu de ses quatre états.
 *
 * Un écran décrit ce qu'il montre quand tout va bien, et fournit trois
 * descriptions courtes pour le reste. Il n'écrit pas la mécanique : c'est ce
 * qui garantit que les quatre états existent partout, y compris sur l'écran
 * qu'on a écrit un vendredi.
 *
 * **Une donnée périmée s'affiche datée plutôt que masquée.** Quand un
 * rechargement échoue mais qu'on avait déjà quelque chose, l'écran montre ce
 * qu'il avait, avec un bandeau qui dit depuis quand. Masquer reviendrait à
 * effacer une information juste parce qu'elle a vieilli.
 *
 * **Le liseré du rôle commerce est ici**, pas dans chaque écran : 3 px en haut,
 * `role.merchant`. C'est le seul repère qui distingue les deux applications
 * quand un téléphone passe de main en main au comptoir.
 */
import type { ReactNode } from 'react';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';

import { Button, EmptyState, Icone, SkeletonCard, StatusMessage, Texte } from '../components';
import { useI18n } from '../i18n';
import { useApi } from '../api';
import { useTheme } from '../theme';
import type { Requete } from './useRequete';

export type EcranProps<T> = {
  requete: Requete<T>;
  /** Le titre, déjà traduit par l'appelant. Ignoré si `entete` est fourni. */
  titre?: string;
  /**
   * L'en-tête complet, quand l'écran a mieux à offrir qu'un titre : une
   * salutation, des compteurs, la marque. Il est rendu avant le corps et **hors
   * des quatre états** — un écran en chargement garde son en-tête, sinon la
   * page saute à chaque rafraîchissement.
   */
  entete?: ReactNode;
  /**
   * Le retour, quand l'écran naît d'un autre.
   *
   * Ici et non dans chaque écran : un écran de pile sans retour ne se quitte
   * qu'en changeant d'onglet, et le geste de balayage n'existe pas sur le web.
   */
  onRetour?: () => void;
  /** Ce que l'écran montre quand tout va bien. */
  children: (donnees: T) => ReactNode;
  /** Le squelette. À défaut, trois cartes à la géométrie du contenu. */
  squelette?: ReactNode;
  /** L'état vide. Jamais un cul-de-sac : chaque issue annonce son gain. */
  vide?: ReactNode;
  testID?: string;
};

export function Ecran<T>({
  requete,
  titre,
  entete,
  onRetour,
  children,
  squelette,
  vide,
  testID,
}: EcranProps<T>) {
  const { color: c, role, density } = useTheme();
  const { t } = useI18n();
  const { messageDErreur } = useApi();

  const corps = (() => {
    if (requete.etat === 'chargement') {
      return (
        <View testID="etat-chargement" style={{ gap: density.gap }}>
          {squelette ?? (
            <>
              <SkeletonCard />
              <SkeletonCard />
              <SkeletonCard />
            </>
          )}
        </View>
      );
    }

    if (requete.etat === 'erreur') {
      return (
        <View testID="etat-erreur" style={{ gap: density.gap }}>
          <StatusMessage
            level="danger"
            title={t('etats.erreurTitre')}
            body={messageDErreur(requete.erreur)}
            action={{ label: t('common.retry'), onPress: requete.recharger, variant: 'secondary' }}
          />
          {/* Ce qu'on avait, daté. L'effacer punirait l'utilisateur d'une
              panne qui ne le concerne pas. */}
          {requete.donnees !== null ? (
            <>
              <Texte variante="type.caption" couleur="text.muted">
                {t('etats.vuA', { quand: quand(t, requete.vuA) })}
              </Texte>
              {children(requete.donnees)}
            </>
          ) : null}
        </View>
      );
    }

    if (requete.vide) {
      return (
        <View testID="etat-vide">
          {vide ?? (
            <EmptyState title={t('etats.videTitre')} body={t('etats.videCorps')} />
          )}
        </View>
      );
    }

    return (
      <View testID="etat-nominal" style={{ gap: density.gap }}>
        {children(requete.donnees)}
      </View>
    );
  })();

  return (
    <View testID={testID} style={{ flex: 1, backgroundColor: c['bg.canvas'] }}>
      {/* Le liseré du rôle. Trois pixels, une seule fois, ici. */}
      {role === 'merchant' ? (
        <View testID="lisere-commerce" style={{ height: 3, backgroundColor: c['role.merchant'] }} />
      ) : null}
      <ScrollView
        contentContainerStyle={{
          padding: density.screenPadding,
          gap: density.gap,
          // Grand écran : le contenu créateur se centre à 760 au plus. Mesuré
          // sur le conteneur, pas par une media query.
          maxWidth: role === 'creator' ? 760 : undefined,
          width: '100%',
          alignSelf: 'center',
        }}
        refreshControl={
          <RefreshControl
            refreshing={requete.etat === 'pret' && requete.rechargement}
            onRefresh={requete.recharger}
            tintColor={c['text.secondary']}
          />
        }
      >
        {onRetour ? (
          <Pressable
            onPress={onRetour}
            accessibilityRole="button"
            accessibilityLabel={t('common.retour')}
            hitSlop={12}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start' }}
            testID="retour"
          >
            <Icone nom="retour" couleur="text.secondary" taille={18} />
            <Texte variante="type.label" couleur="text.secondary">
              {t('common.retour')}
            </Texte>
          </Pressable>
        ) : null}
        {entete ?? (titre ? <Texte variante="type.display">{titre}</Texte> : null)}
        {corps}
      </ScrollView>
    </View>
  );
}

/**
 * « il y a 2 h ». Jamais une date seule sur une fraîcheur.
 *
 * Une date brute demande de calculer ; ce qu'on veut savoir est si c'est vieux,
 * pas quand c'était. Au-delà d'un jour, on bascule sur la date : « il y a
 * 37 h » ne se lit plus.
 */
export function quand(t: (cle: string, params?: Record<string, unknown>) => string, instant: number | null): string {
  if (instant === null) return '';
  const minutes = Math.max(0, Math.round((Date.now() - instant) / 60_000));
  if (minutes < 1) return t('etats.instantMaintenant');
  if (minutes < 60) return t('etats.instantMinutes', { count: minutes });
  const heures = Math.round(minutes / 60);
  if (heures < 24) return t('etats.instantHeures', { count: heures });
  return new Date(instant).toLocaleDateString();
}

/** Un bouton de réessai isolé, pour les écrans qui n'utilisent pas `Ecran`. */
export function Reessayer({ onPress }: { onPress: () => void }) {
  const { t } = useI18n();
  return <Button label={t('common.retry')} variant="secondary" onPress={onPress} />;
}
