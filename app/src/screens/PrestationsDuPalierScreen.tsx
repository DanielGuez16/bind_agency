/**
 * 11c · Les prestations d'un palier.
 *
 * **Le compte est une porte, pas une statistique.** « Douze prestations vous
 * sont ouvertes » répond à la question qu'on se pose en ouvrant l'application ;
 * cet écran est ce qu'il y a derrière. Sans lui, le nombre s'affichait et ne
 * menait nulle part.
 *
 * **Douze au total dont neuf à moins de quinze kilomètres, ce n'est pas la même
 * promesse**, et c'est pourquoi les deux nombres sont dans la même phrase. Ils
 * comptent tous deux des **prestations** : `offres_disponibles` et
 * `offres_dans_le_rayon`. Le second champ a failli compter des salons, ce qui
 * aurait mis deux grandeurs différentes dans une phrase où les deux restent
 * plausibles — donc où personne ne l'aurait jamais remarqué.
 *
 * **`null` n'est pas zéro.** Sans position, le serveur ne rend pas un compte de
 * proximité : zéro dirait « aucun salon autour de vous », ce qui est faux et
 * décourageant. L'écran tait alors la seconde moitié de la phrase, et la
 * bascule avec elle — il n'y a rien à basculer quand on ignore où l'on est.
 *
 * **L'ordre vient du serveur et ne se rejoue pas ici** : par quartier, puis par
 * nom de prestation. C'est le seul axe que le produit connaît et qui ne classe
 * personne — trier par palier hiérarchiserait des prestations qu'on peut toutes
 * réserver, et trier par salon supposerait un ordre entre eux. C'est aussi
 * l'axe des rangées du fil : le même des deux côtés.
 */
import { useState } from 'react';
import { View } from 'react-native';

import { useApi, type OffreDuPalier, type PalierAccessible } from '../api';
import { DataRow, SegmentedTabs, SkeletonLignes, Texte, TierBadge } from '../components';
import { formatNumber } from '../format';
import { useI18n } from '../i18n';
import { Ecran } from './Ecran';
import { useRequete } from './useRequete';

/** Les deux états de la bascule. Le proche d'abord : c'est ce qu'on réserve. */
const VUES = ['proche', 'tout'] as const;
type Vue = (typeof VUES)[number];

export function PrestationsDuPalierScreen({
  palier,
  position,
  rayonKm,
  onRetour,
  onOuvrirLaPrestation,
}: {
  palier: PalierAccessible;
  /** Nulle : le serveur ne rend aucune distance, et la bascule disparaît. */
  position: { longitude: number; latitude: number } | null;
  /** Celui sur lequel les comptes de proximité ont été faits. La phrase le dit. */
  rayonKm: number;
  onRetour: () => void;
  /** La fiche du salon qui la propose : c'est là qu'elle se réserve. */
  onOuvrirLaPrestation?: (offre: OffreDuPalier) => void;
}) {
  const { api } = useApi();
  const { t, locale } = useI18n();
  const [vue, setVue] = useState<Vue>('proche');

  const requete = useRequete<OffreDuPalier[]>(
    (signal) => api.offresDuPalier(palier.tier_id, position, signal),
    { estVide: (offres) => offres.length === 0, dependances: [palier.tier_id] },
  );

  // **La bascule n'existe que si les deux états diffèrent.** Sans position, il
  // n'y a pas de « proche » ; et si tout est dans le rayon, les deux montreraient
  // la même liste — un interrupteur qui ne commande rien, la faute que le
  // produit a déjà retirée deux fois.
  const proche = palier.offres_dans_le_rayon;
  const salons = palier.commerces_dans_le_rayon;
  const bascule = proche !== null && proche < palier.offres_disponibles;
  const montreesToutes = !bascule || vue === 'tout';

  return (
    <Ecran
      requete={requete}
      testID="ecran-prestations-du-palier"
      onRetour={onRetour}
      titre={t('tiers.prestationsTitre')}
      squelette={<SkeletonLignes combien={8} testID="squelette-prestations" />}
      entete={
        <View style={{ gap: 10 }} testID="entete-prestations">
          <TierBadge tier={palier.content_format} />
          <Texte variante="type.heading" testID="compte-ouvert">
            {t('tiers.prestationsOuvertes', {
              count: formatNumber(palier.offres_disponibles, locale),
            })}
          </Texte>
          {/* La seconde moitié de la phrase n'existe que si le compte de
              proximité existe : « on ne sait pas où vous êtes » ne s'écrit pas
              « zéro à moins de quinze kilomètres ». */}
          {/* **Neuf prestations chez un seul salon et neuf chez six sont deux
              offres très différentes.** Le compte de prestations seul ne le
              dit pas — d'où les deux grandeurs dans la même phrase, chacune
              nommée. Elles ne se comparent pas, elles se complètent : c'est ce
              qui distingue « deux nombres » de « deux grandeurs confondues ».

              Les deux comptes sont nuls ensemble ou pleins ensemble — le
              serveur les rend depuis la même position. Le second n'est donc pas
              gardé séparément : une garde qui ne peut pas tomber. */}
          <Texte variante="type.caption" couleur="ink.soft" testID="ou-elles-sont">
            {proche === null || salons === null
              ? t('tiers.prestationsPartout')
              : `${t('tiers.prestationsPartout')} ${t('tiers.prestationsDontProches', {
                  count: formatNumber(proche, locale),
                  rayon: formatNumber(rayonKm, locale),
                  salons: formatNumber(salons, locale),
                })}`}
          </Texte>
          {bascule ? (
            <SegmentedTabs
              testID="bascule-proche-tout"
              index={VUES.indexOf(vue)}
              onChange={(i) => setVue(VUES[i])}
              items={[
                { label: t('tiers.prestationsProches') },
                {
                  label: t('tiers.prestationsToutes'),
                  count: palier.offres_disponibles,
                },
              ]}
            />
          ) : null}
        </View>
      }
    >
      {(offres) => {
        // Filtrer et non redemander : la liste entière est déjà là, et un
        // second appel rendrait exactement le même corps.
        const visibles = montreesToutes
          ? offres
          : offres.filter((offre) => offre.distance_metres !== null);

        return (
          <View style={{ gap: 12 }} testID="liste-des-prestations">
            {visibles.map((offre) => (
              <DataRow
                key={offre.tier_offer_id}
                testID={`prestation-${offre.tier_offer_id}`}
                // **Une liste qui nomme une prestation et n'y mène pas est un
                // cul-de-sac.** C'est l'écran qui répond à « qu'est-ce que ce
                // palier m'ouvre » : y lire un nom sans pouvoir l'ouvrir oblige
                // à retourner au fil et à chercher le salon par son nom.
                onPress={
                  onOuvrirLaPrestation ? () => onOuvrirLaPrestation(offre) : undefined
                }
                label={offre.nom}
                value={[
                  offre.nom_du_commerce,
                  offre.neighborhood ? t(`quartiers.${offre.neighborhood}`) : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              />
            ))}
          </View>
        );
      }}
    </Ecran>
  );
}
