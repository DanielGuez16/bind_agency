/**
 * Ce qu'on a mis de côté, et ce qu'on peut en faire aujourd'hui.
 *
 * **Le cœur sans liste est un geste sans destination.** Mettre en favori sans
 * pouvoir relire ses favoris n'est pas une capacité, c'est un bouton qui
 * s'allume.
 *
 * **Une prestation qui n'est plus réservable reste dans la liste.** La retirer
 * sans un mot ferait croire à un mauvais appui — et les quatre états appellent
 * quatre conduites : attendre la réouverture, monter d'un palier, choisir autre
 * chose, ou réserver. « Indisponible » les aurait tous couverts et n'aurait
 * rien dit.
 *
 * **Aucune coordonnée.** La liste se relit d'où l'on est : un favori posé à
 * Wynwood doit se retrouver depuis Kendall. La brancher sur le rayon en ferait
 * une seconde version du fil, qui oublie ce qu'on lui a confié.
 */
import { View } from 'react-native';

import { useApi, type EtatDuFavori, type Favori } from '../api';
import { Icone, Photo, SkeletonLignes, StatusMessage, Texte } from '../components';
import { useI18n } from '../i18n';
import { elevationDeCarte, radius, useColors } from '../theme';
import { Ecran } from './Ecran';
import { useRequete } from './useRequete';

/** La hauteur de la vignette. Connue avant l'image, comme partout ailleurs. */
const VIGNETTE = 72;

/**
 * Ce que chaque état appelle comme conduite.
 *
 * **Une table et non un aiguillage épars.** Les quatre existent pour dire
 * quatre choses différentes ; les écrire à quatre endroits ferait diverger le
 * ton, et c'est le ton qui distingue « elle rouvrira » de « elle ne rouvrira
 * pas ».
 */
const CONDUITES: Record<EtatDuFavori, { cle: string; niveau: 'neutral' | 'warning' } | null> = {
  // Réservable : rien à dire. Un bandeau qui annonce que tout va bien est du
  // bruit sur la seule ligne qui n'en demande pas.
  reservable: null,
  fermee: { cle: 'favoris.etatFermee', niveau: 'neutral' },
  salon_indisponible: { cle: 'favoris.etatSalonIndisponible', niveau: 'neutral' },
  hors_palier: { cle: 'favoris.etatHorsPalier', niveau: 'warning' },
};

export function FavorisScreen({
  onRetour,
  onOuvrirLeCommerce,
}: {
  onRetour: () => void;
  onOuvrirLeCommerce: (businessId: string) => void;
}) {
  const { api } = useApi();
  const { t } = useI18n();

  const requete = useRequete<Favori[]>((signal) => api.mesFavoris(signal), {
    estVide: (favoris) => favoris.length === 0,
  });

  return (
    <Ecran
      requete={requete}
      titre={t('favoris.titre')}
      nature="creator"
      onRetour={onRetour}
      testID="ecran-favoris"
      // La silhouette de ce qui arrive : des lignes, pas des cartes à photo.
      // Un squelette qui promet une grille sur un écran qui rend une liste
      // fait sauter la page au moment où elle se remplit.
      squelette={<SkeletonLignes combien={5} testID="squelette-favoris" />}
      vide={
        <StatusMessage
          level="neutral"
          title={t('favoris.videTitre')}
          body={t('favoris.videCorps')}
          testID="favoris-vide"
        />
      }
    >
      {(favoris) => (
        <View style={{ gap: 12 }}>
          {favoris.map((favori) => (
            <LigneDuFavori
              key={favori.catalog_item_id}
              favori={favori}
              onOuvrir={() => onOuvrirLeCommerce(favori.business_id)}
            />
          ))}
        </View>
      )}
    </Ecran>
  );
}

function LigneDuFavori({
  favori,
  onOuvrir,
}: {
  favori: Favori;
  onOuvrir: () => void;
}) {
  const { api } = useApi();
  const { t } = useI18n();
  const c = useColors();

  const conduite = CONDUITES[favori.etat] ?? null;

  return (
    <View
      testID={`favori-${favori.catalog_item_id}`}
      style={{
        gap: 10,
        padding: 12,
        borderRadius: radius['radius.lg'],
        backgroundColor: c['bg.surface'],
        borderWidth: 1,
        borderColor: c['line.default'],
        // « Un coin de 18 px sans ombre flotte au lieu de se poser » : la règle
        // des rayons vaut des douze surfaces, pas d'une seule.
        ...elevationDeCarte(),
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <Photo
          uri={api.urlDeLaVignette(favori.photo_key)}
          hauteur={VIGNETTE}
          style={{ width: VIGNETTE, borderRadius: radius['radius.photo'] }}
          testID={`favori-photo-${favori.catalog_item_id}`}
        />
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <Texte variante="type.bodyStrong">{favori.name}</Texte>
          <Texte variante="type.caption" couleur="ink.soft">
            {[
              favori.business_name,
              favori.duration_minutes === null
                ? null
                : t('favoris.duree', { n: String(favori.duration_minutes) }),
            ]
              .filter(Boolean)
              .join(' · ')}
          </Texte>
        </View>
        {/* Le cœur est plein : c'est la liste de ce qui est gardé, et chaque
            ligne y est par définition. Il ne se presse pas ici — retirer se
            fait là où l'on a posé, sur la carte du mur. */}
        {/* `brand.700` : l'encre calibrée de la marque. `brand.500` est une
            surface, et à 2,36:1 sur cette carte le cœur s'effacerait. */}
        <Icone nom="coeur" couleur="brand.700" taille={20} rempli />
      </View>

      {conduite ? (
        <StatusMessage
          level={conduite.niveau}
          body={t(conduite.cle, { salon: favori.business_name })}
          action={
            favori.etat === 'salon_indisponible'
              ? undefined
              : { label: t('favoris.voirLeSalon'), onPress: onOuvrir }
          }
          testID={`favori-etat-${favori.catalog_item_id}`}
        />
      ) : null}
    </View>
  );
}
