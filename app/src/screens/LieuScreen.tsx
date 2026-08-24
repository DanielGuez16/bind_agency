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
 *
 * **Mais les trois ne se déplient plus ensemble.** « Trop de choses d'un
 * coup », dit la campagne, et elle a raison sur ce point précis : une galerie,
 * un dépôt de carte et sept lignes d'horaires ouverts en même temps font un
 * écran qu'on parcourt au lieu de le lire. Trois sections repliées, une seule
 * ouverte à la fois, et chacune **dit ce qu'elle contient avant qu'on
 * l'ouvre** — c'est le compte qui remplace le contenu, pas un titre.
 *
 * **Repliées et non réparties.** Les trois décrivent le même objet, et les
 * mettre sur trois écrans redonnerait les portes dont la v3.1 vient de réduire
 * le nombre. Ce qui gênait est la hauteur, pas le voisinage.
 */
import { Pressable, View } from 'react-native';

import {
  useApi,
  type ItemDuCatalogue,
  type PageDeLaCarte,
  type PhotoDuCommerce,
} from '../api';
import { Icone, SkeletonLignes, Texte } from '../components';
import { useI18n } from '../i18n';
import { useColors } from '../theme';
import { CarteDuCommerce } from './CarteDuCommerce';
import { GalerieDuCommerce } from './GalerieDuCommerce';
import { HorairesDuCommerce, type Semaine } from './HorairesScreen';
import { Ecran } from './Ecran';
import { AGES } from './cacheDesReponses';
import { useRequete } from './useRequete';
import { useCallback, useState } from 'react';

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

  /**
   * La section ouverte, ou aucune.
   *
   * **Aucune au départ**, et c'est le sujet du retour : l'écran s'ouvrait avec
   * ses trois blocs dépliés. Trois résumés tiennent en un écran et disent
   * chacun ce qu'il y a derrière ; on ouvre ce qu'on vient faire.
   */
  const [ouverte, setOuverte] = useState<'photos' | 'carte' | 'horaires' | null>(null);

  return (
    <Ecran
      requete={requete}
      titre={t('lieu.titre')}
      nature="merchant"
      onRetour={onRetour}
      squelette={<SkeletonLignes combien={5} testID="squelette-lieu" />}
      testID="ecran-lieu"
    >
      {(lieu) => {
        const bloquees = lieu.items
          .filter((item) => item.leaves_choice)
          .map((item) => ({ id: item.id, name: item.name }));
        return (
        <View style={{ gap: 4 }}>
          {/* La galerie en tête : c'est ce qu'un visiteur voit en premier de la
              fiche, et un commerce qui compose sa page commence souvent par là. */}
          <Repliable
            titre={t('lieu.sectionPhotos')}
            resume={t('lieu.photosCompte', { count: lieu.photos.length })}
            ouverte={ouverte === 'photos'}
            onBasculer={() => setOuverte(ouverte === 'photos' ? null : 'photos')}
            testID="section-photos"
          >
            <GalerieDuCommerce
              businessId={businessId}
              photos={lieu.photos}
              couverture={lieu.couverture}
              onChange={requete.recharger}
            />
          </Repliable>

          {/* **La carte suit la galerie et ne s'y mêle pas.** La galerie montre
              le lieu, la carte se consulte : deux dépôts distincts, parce qu'un
              commerce qui les confondrait rendrait la sienne illisible. */}
          <Repliable
            titre={t('lieu.sectionCarte')}
            // **Le blocage passe dans le résumé.** Une prestation qui laisse un
            // choix et ne se publie pas faute de carte est ce qu'on doit voir
            // sans ouvrir : replier une section ne doit rien cacher qui décide.
            resume={
              bloquees.length > 0
                ? t('lieu.carteBloque', { count: bloquees.length })
                : t('lieu.carteCompte', { count: lieu.pagesDeLaCarte.length })
            }
            alerte={bloquees.length > 0}
            ouverte={ouverte === 'carte'}
            onBasculer={() => setOuverte(ouverte === 'carte' ? null : 'carte')}
            testID="section-carte"
          >
            <CarteDuCommerce
              businessId={businessId}
              pages={lieu.pagesDeLaCarte}
              lien={lieu.lienDeLaCarte}
              bloquees={bloquees}
              onChange={requete.recharger}
            />
          </Repliable>

          {/* **Les horaires, ici et plus dans l'offre.** Des heures d'ouverture
              décrivent un endroit : les ranger avec les prestations demandait
              de chercher l'ouverture du salon dans la page de son catalogue. */}
          <Repliable
            titre={t('lieu.sectionHoraires')}
            // Les jours réellement ouverts, et non les sept lignes : une
            // semaine à deux jours fermés n'ouvre pas sept jours.
            resume={t('lieu.joursOuverts', {
              count: new Set(lieu.semaine.regles.map((regle) => regle.weekday)).size,
            })}
            ouverte={ouverte === 'horaires'}
            onBasculer={() => setOuverte(ouverte === 'horaires' ? null : 'horaires')}
            testID="section-horaires"
          >
            <HorairesDuCommerce
              semaine={lieu.semaine}
              businessId={businessId}
              onChange={requete.recharger}
            />
          </Repliable>
        </View>
        );
      }}
    </Ecran>
  );
}

/**
 * Une section qui dit ce qu'elle contient avant qu'on l'ouvre.
 *
 * **Le résumé n'est pas un sous-titre.** Un titre nomme, un compte décide :
 * « 12 photos » dit s'il faut ouvrir, « Photos » ne dit rien de plus que le
 * titre. C'est ce qui permet de replier sans rien cacher d'utile.
 *
 * **Et une section qui retient quelque chose le dit en teinte.** Replier ne
 * doit jamais faire disparaître un blocage : une prestation qui ne se publie
 * pas faute de carte se voit fermé comme ouvert.
 */
function Repliable({
  titre,
  resume,
  alerte = false,
  ouverte,
  onBasculer,
  children,
  testID,
}: {
  titre: string;
  resume: string;
  alerte?: boolean;
  ouverte: boolean;
  onBasculer: () => void;
  children: React.ReactNode;
  testID: string;
}) {
  const c = useColors();

  return (
    <View testID={testID}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: ouverte }}
        accessibilityLabel={`${titre} — ${resume}`}
        onPress={onBasculer}
        testID={`${testID}-entete`}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
          paddingVertical: 14,
          borderBottomWidth: 1,
          borderBottomColor: c['line.default'],
          opacity: pressed ? 0.7 : 1,
        })}
      >
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <Texte variante="type.bodyStrong">{titre}</Texte>
          <Texte
            variante="type.caption"
            // **Le mot, pas la teinte.** L'ambre ne se pose pas sans glyphe —
            // c'est la règle du système — et « 3 services ne peuvent pas
            // paraître sans elle » dit déjà tout ce qu'une couleur dirait, en
            // plus précis. L'encre pleine suffit à le sortir du gris.
            couleur={alerte ? 'ink.default' : 'ink.soft'}
            testID={`${testID}-resume`}
          >
            {resume}
          </Texte>
        </View>
        <View style={{ transform: [{ rotate: ouverte ? '90deg' : '0deg' }] }}>
          <Icone nom="chevron" couleur="ink.soft" taille={20} />
        </View>
      </Pressable>
      {ouverte ? <View style={{ paddingTop: 14 }}>{children}</View> : null}
    </View>
  );
}
