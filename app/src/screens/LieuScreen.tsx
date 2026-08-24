/**
 * Le lieu : ce qui décrit l'endroit, et se compose une fois.
 *
 * **La découpe est par objet, et elle recoupe la fréquence.** La v3 séparait
 * par fréquence — le geste rare d'un côté, le geste du matin sur la journée —
 * et son seau « rare » contenait deux fréquences confondues : un lieu se
 * compose **une fois**, un catalogue vit **en continu**. Séparer par objet
 * révèle la fréquence que la maille précédente avait manquée.
 *
 * **Les horaires rejoignent la couverture**, et c'est la conséquence la moins
 * évidente : des heures d'ouverture décrivent un endroit, pas une prestation.
 * « Your week » quitte donc la page de l'offre, ce qui la réduit une seconde
 * fois sans rien retirer.
 *
 * **La carte y vit aussi.** Elle était dans son propre écran, avant cette
 * séparation ; une carte décrit le lieu. Et le blocage qu'elle porte — une
 * prestation qui laisse un choix ne se publie pas sans elle — se lit alors
 * depuis les deux côtés, ce qui est correct puisqu'il tient aux deux.
 */
import { View } from 'react-native';

import {
  useApi,
  type ItemDuCatalogue,
  type PageDeLaCarte,
  type PhotoDuCommerce,
} from '../api';
import { Filet, SkeletonLignes } from '../components';
import { useI18n } from '../i18n';
import { CarteDuCommerce } from './CarteDuCommerce';
import { GalerieDuCommerce } from './GalerieDuCommerce';
import { HorairesDuCommerce, type Semaine } from './HorairesScreen';
import { Ecran } from './Ecran';
import { AGES } from './cacheDesReponses';
import { useRequete } from './useRequete';
import { useCallback } from 'react';

/** Ce que le lieu charge d'un coup : les trois blocs composent la même page. */
type Lieu = {
  photos: PhotoDuCommerce[];
  couverture: string | null;
  pagesDeLaCarte: PageDeLaCarte[];
  lienDeLaCarte: string | null;
  /**
   * Les prestations qui laissent un choix, et que l'absence de carte bloque.
   *
   * **Lues ici plutôt que demandées à la carte.** Le blocage tient aux deux
   * objets — une prestation qui laisse choisir a besoin d'une carte à lire —
   * et le rendre visible du côté du lieu est ce qui permet de le lever là où
   * on le lève.
   */
  items: ItemDuCatalogue[];
  /** La semaine et ses exceptions : les horaires décrivent le lieu. */
  semaine: Semaine;
};

export function LieuScreen({
  businessId,
  onRetour,
}: {
  businessId: string;
  onRetour?: () => void;
}) {
  const { api } = useApi();
  const { t } = useI18n();

  const charger = useCallback(
    async (signal: AbortSignal): Promise<Lieu> => {
      // Les cinq d'un coup : elles composent la même page, et des requêtes
      // séparées feraient apparaître les blocs l'un après l'autre sous les
      // yeux de qui les regarde.
      const [photos, pagesDeLaCarte, commerce, items, regles, exceptions] = await Promise.all([
        api.photosDuCommerce(businessId, signal),
        api.pagesDeLaCarte(businessId, signal),
        api.commerce(businessId, signal),
        api.itemsDuCatalogue(businessId, signal),
        api.reglesDeCapacite(businessId, signal),
        api.exceptionsDeCapacite(businessId, signal),
      ]);
      return {
        photos,
        couverture: commerce.cover_photo_key,
        pagesDeLaCarte,
        lienDeLaCarte: commerce.menu_url,
        items,
        semaine: { regles, exceptions },
      };
    },
    [api, businessId],
  );

  const requete = useRequete<Lieu>(charger, {
    // **Jamais vide.** Un lieu sans photo n'est pas un écran vide : c'est un
    // lieu à composer, et chaque bloc dit lui-même ce qui lui manque. Un état
    // vide global effacerait les trois endroits où l'on peut agir.
    estVide: () => false,
    dependances: [businessId],
    cache: { cle: `lieu.${businessId}`, ageMax: AGES.contenu },
  });

  return (
    <Ecran
      requete={requete}
      titre={t('lieu.titre')}
      nature="merchant"
      onRetour={onRetour}
      squelette={<SkeletonLignes combien={5} testID="squelette-lieu" />}
      testID="ecran-lieu"
    >
      {(lieu) => (
        <View style={{ gap: 16 }}>
          {/* La galerie en tête : c'est ce qu'un visiteur voit en premier de la
              fiche, et un commerce qui compose sa page commence souvent par là. */}
          <GalerieDuCommerce
            businessId={businessId}
            photos={lieu.photos}
            couverture={lieu.couverture}
            onChange={requete.recharger}
          />
          <Filet />

          {/* **La carte suit la galerie et ne s'y mêle pas.** La galerie montre
              le lieu, la carte se consulte : deux dépôts distincts, parce qu'un
              commerce qui les confondrait rendrait la sienne illisible. */}
          <CarteDuCommerce
            businessId={businessId}
            pages={lieu.pagesDeLaCarte}
            lien={lieu.lienDeLaCarte}
            bloquees={lieu.items
              .filter((item) => item.leaves_choice)
              .map((item) => ({ id: item.id, name: item.name }))}
            onChange={requete.recharger}
          />
          <Filet />

          {/* **Les horaires, ici et plus dans l'offre.** Des heures d'ouverture
              décrivent un endroit : les ranger avec les prestations demandait
              de chercher l'ouverture du salon dans la page de son catalogue. */}
          <HorairesDuCommerce
            semaine={lieu.semaine}
            businessId={businessId}
            onChange={requete.recharger}
          />
        </View>
      )}
    </Ecran>
  );
}
