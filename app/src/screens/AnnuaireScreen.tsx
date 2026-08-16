/**
 * L'annuaire des créateurs, côté commerce abonné.
 *
 * **C'est ce que BIND vend.** Un salon paie pour l'accès à un réseau ; sans cet
 * écran, il ne voit que ce qui est déjà réservable autour de lui, et
 * l'abonnement n'a rien à montrer avant la première collaboration.
 *
 * **Aucun score de fiabilité, et la ligne qui l'explique.** Le produit promet à
 * la créatrice que son score n'est « jamais comparé entre créatrices, jamais
 * montré à un commerce ». Le palier ouvert porte pourtant la même information :
 * un score dégradé la plafonne à un palier inférieur, si bien qu'un salon qui
 * lit « ouvert au palier reel » sait qu'elle tient ses engagements — sans le
 * nombre, et sans pouvoir classer. Encore faut-il le dire : sinon un salon
 * cherche une note qu'il ne trouvera pas, et conclut qu'elle manque.
 *
 * **Lecture seule.** Aucun bouton de contact, aucune invitation directe. On
 * atteint une créatrice en ouvrant une prestation à son palier — c'est le
 * mécanisme du produit, et un raccourci ici en créerait un second, hors du
 * système de paliers.
 */
import { View } from 'react-native';

import { useApi, type CreateurDeLAnnuaire } from '../api';
import {
  Apparition,
  EmptyState,
  Filet,
  SkeletonLignes,
  StatusMessage,
  Texte,
  TierBadge,
} from '../components';
import { formatNumber } from '../format';
import { useI18n } from '../i18n';
import { useGabarit } from '../shell/gabarit';
import { radius, useColors } from '../theme';
import { Ecran } from './Ecran';
import { useRequete } from './useRequete';

/** Le code que le serveur rend à un commerce sans abonnement vivant. */
const SANS_ABONNEMENT = 'subscription_required';

/**
 * L'instant d'une réponse qui n'a rien à dater.
 *
 * Le refus d'abonnement ne vieillit pas : il ne dépend d'aucune lecture, et la
 * mention « vu il y a deux minutes » n'aurait pas d'objet. Zéro dit « pas de
 * fraîcheur à annoncer » plutôt qu'une date inventée.
 */
const DEJA_SU = 0;

export function AnnuaireScreen({ businessId }: { businessId: string }) {
  const { api } = useApi();
  const { t } = useI18n();
  // Lu ici et non dans le corps de rendu d'`Ecran` : ce corps est une fonction
  // appelée pendant le rendu d'un **autre** composant, et un hook y serait
  // appelé hors de son propre composant.
  const c = useColors();

  const requete = useRequete<CreateurDeLAnnuaire[]>(
    (signal) => api.annuaireDesCreateurs(businessId, signal),
    { estVide: (createurs) => createurs.length === 0, dependances: [businessId] },
  );

  // **Le refus d'abonnement n'est pas une panne.** L'écran d'erreur générique
  // proposerait « réessayer », ce qui ne mène nulle part : il n'y a rien à
  // réessayer, il y a un abonnement à prendre. On l'intercepte donc avant.
  const sansAbonnement =
    requete.etat === 'erreur' &&
    typeof requete.erreur === 'object' &&
    requete.erreur !== null &&
    'code' in requete.erreur &&
    (requete.erreur as { code?: string }).code === SANS_ABONNEMENT;

  if (sansAbonnement) {
    // Une réponse **prête**, dont le contenu est l'explication. Réutiliser
    // l'état d'erreur donnerait « réessayer », qui ne mène nulle part : il n'y
    // a rien à réessayer, il y a un abonnement à prendre.
    return (
      <Ecran
        requete={{
          etat: 'pret',
          donnees: [],
          vide: false,
          rechargement: false,
          vuA: DEJA_SU,
          recharger: requete.recharger,
        }}
        titre={t('annuaire.titre')}
        nature="creator"
        testID="ecran-annuaire"
      >
        {() => (
          <StatusMessage
            level="neutral"
            title={t('annuaire.abonnementRequis')}
            body={t('annuaire.abonnementRequisAide')}
            testID="annuaire-sans-abonnement"
          />
        )}
      </Ecran>
    );
  }

  return (
    <Ecran
      requete={requete}
      titre={t('annuaire.titre')}
      nature="creator"
      squelette={<SkeletonLignes combien={6} testID="squelette-annuaire" />}
      testID="ecran-annuaire"
      vide={
        <EmptyState
          title={t('annuaire.videTitre')}
          body={t('annuaire.vide')}
          testID="annuaire-vide"
        />
      }
    >
      {(createurs) => (
        <View style={{ gap: 16 }}>
          <Texte variante="type.body" couleur="ink.soft" testID="annuaire-sous-titre">
            {t('annuaire.sousTitre')}
          </Texte>

          {/* La ligne qui remplace le score. Sans elle, un salon cherche une
              note, ne la trouve pas, et croit à un oubli. */}
          <View
            testID="ce-que-le-palier-dit"
            style={{
              padding: 14,
              borderRadius: radius['radius.none'],
              backgroundColor: c['bg.sunken'],
            }}
          >
            <Texte variante="type.caption" couleur="ink.soft">
              {t('annuaire.ceQueLePalierDit')}
            </Texte>
          </View>

          {createurs.map((createur, rang) => (
            <Apparition key={createur.creator_id} rang={rang}>
              <FicheDeCreateur createur={createur} />
            </Apparition>
          ))}
        </View>
      )}
    </Ecran>
  );
}

function FicheDeCreateur({ createur }: { createur: CreateurDeLAnnuaire }) {
  const { t, locale } = useI18n();
  const c = useColors();
  const { large } = useGabarit();

  const nom =
    [createur.first_name, createur.last_name].filter(Boolean).join(' ') || t('annuaire.sansNom');

  return (
    <View
      testID={`createur-${createur.creator_id}`}
      style={{
        gap: 12,
        padding: 16,
        borderRadius: radius['radius.none'],
        borderWidth: 1,
        borderColor: c['line.default'],
        backgroundColor: c['bg.surface'],
        flexDirection: large ? 'row' : 'column',
        alignItems: large ? 'center' : undefined,
      }}
    >
      <View style={{ flex: large ? 1 : undefined, gap: 2, minWidth: 0 }}>
        <Texte variante="type.bodyStrong">{nom}</Texte>
        {createur.city ? (
          <Texte variante="type.caption" couleur="ink.mute">
            {createur.city}
          </Texte>
        ) : null}
        {createur.bio ? (
          <Texte variante="type.caption" couleur="ink.soft">
            {createur.bio}
          </Texte>
        ) : null}
      </View>

      {large ? <View style={{ width: 1, alignSelf: 'stretch', backgroundColor: c['line.default'] }} /> : <Filet />}

      <View style={{ width: large ? 260 : undefined, gap: 4 }}>
        {/* L'audience, en volume cumulé. Un ordre de grandeur, jamais une
            portée atteinte : la même précaution que sur les rapports. */}
        <Texte variante="type.figureSmall" testID={`audience-${createur.creator_id}`}>
          {formatNumber(createur.audience_totale, locale)}
        </Texte>
        <Texte variante="type.caption" couleur="ink.soft">
          {createur.comptes.length === 1
            ? t('annuaire.audienceUnReseau', { count: createur.audience_totale })
            : t('annuaire.audience', {
                count: createur.audience_totale,
                reseaux: createur.comptes.length,
              })}
        </Texte>
        {createur.comptes.map((compte) => (
          <Texte
            key={`${compte.platform}-${compte.handle}`}
            variante="type.caption"
            couleur="ink.mute"
          >
            {compte.handle ?? compte.platform}
          </Texte>
        ))}
      </View>

      <View style={{ width: large ? 220 : undefined, gap: 6 }}>
        <Texte variante="type.label" couleur="ink.soft">
          {t('annuaire.paliersOuverts')}
        </Texte>
        {createur.paliers_ouverts.length === 0 ? (
          // Aucun palier ouvert n'est pas un défaut de la créatrice : son
          // audience peut simplement ne pas encore atteindre le premier seuil.
          <Texte
            variante="type.caption"
            couleur="ink.mute"
            testID={`sans-palier-${createur.creator_id}`}
          >
            {t('annuaire.aucunPalier')}
          </Texte>
        ) : (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {createur.paliers_ouverts.map((format) => (
              <TierBadge key={format} tier={format} size="sm" />
            ))}
          </View>
        )}
      </View>
    </View>
  );
}
