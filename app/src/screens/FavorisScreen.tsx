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
 *
 * **Et l'unique réglage de notification du produit vit ici.** C'est une
 * exception à la règle qui a retiré les préférences, et elle tient à la nature
 * du message : tout ce que le produit dit ailleurs est déclenché par celui qui
 * le reçoit — une réservation qu'il a faite, une publication qu'il a envoyée.
 * L'avis de favori part trois semaines après un cœur posé, un mardi, sans que
 * personne n'ait rien demandé. C'est le premier message non transactionnel, et
 * le genre dont l'absence de refus se paie en désinstallations.
 *
 * **Ici et non dans les réglages** : là-bas, son sujet ne serait pas à l'écran,
 * ce qui est le défaut diagnostiqué sur « profil et mise en ligne ». Ici, il
 * est au-dessus de ce qu'il gouverne — et il n'apparaît pas quand la liste est
 * vide, puisqu'il n'y a alors rien dont on puisse être prévenu.
 */
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { useApi, type EtatDuFavori, type Favori } from '../api';
import { Button, Icone, Photo, SkeletonLignes, StatusMessage, Texte, Toggle } from '../components';
import { formatNumber } from '../format';
import { useI18n } from '../i18n';
import { useSession } from '../session';
import { elevationDeCarte, radius, size, useColors } from '../theme';
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

/**
 * L'écart, quand il est mesurable, et le seul geste qui existe.
 *
 * **Une liste suffit, à une ligne près.** Porter le projet d'une créatrice
 * demanderait un objectif, une progression et une date estimée — et le produit
 * refuse déjà de projeter un délai sur l'écran des paliers, où la règle des
 * 60 % l'interdit. Un écran de favoris qui promettrait mieux serait la seule
 * page du produit à annoncer un avenir.
 *
 * Mais une liste plate laisse la créatrice sans savoir **de quel côté** vient
 * le déblocage. Une seule des trois raisons dépend d'elle — le palier monte
 * avec son audience — et les deux autres ne dépendent que du salon. C'est
 * pourquoi la distinction se voit : sur une seule des trois lignes il y a
 * quelque chose à faire, et cette ligne-là chiffre l'écart et mène aux paliers.
 *
 * **Le chiffre est déjà publié ailleurs.** Il vient de la vue des paliers, la
 * même que l'écran des paliers rend : la ligne ne promet donc rien de neuf,
 * elle **situe**.
 */
export function FavorisScreen({
  onRetour,
  onOuvrirLeCommerce,
  onVoirMesPaliers,
}: {
  onRetour: () => void;
  onOuvrirLeCommerce: (businessId: string) => void;
  onVoirMesPaliers: () => void;
}) {
  const { api } = useApi();
  const { t } = useI18n();

  const requete = useRequete<Favori[]>((signal) => api.mesFavoris(signal), {
    estVide: (favoris) => favoris.length === 0,
  });

  /**
   * Ce qu'on vient de retirer, avant que le serveur réponde.
   *
   * **Optimiste, comme le cœur du mur** : la ligne s'en va au doigt. Attendre
   * le réseau pour un geste sans conséquence est ce qui fait dire « lent », et
   * une ligne qui reste après un appui fait appuyer une seconde fois.
   *
   * **Elle revient si le serveur refuse.** Le retrait n'efface rien d'autre que
   * l'intention de garder ; faire disparaître une ligne qu'on n'a pas su
   * retirer serait mentir sur ce qu'on a fait.
   */
  const [retires, setRetires] = useState<string[]>([]);
  /**
   * Ce qu'on n'a pas su retirer, nommé.
   *
   * **Le retour en arrière était muet.** La ligne s'en allait, revenait, et
   * rien ne disait pourquoi — ce qui se lit comme un écran qui refuse le
   * geste. Une ligne qui revient sans un mot fait appuyer une seconde fois.
   */
  const [echec, setEchec] = useState<string | null>(null);

  function retirer(catalogItemId: string, nom: string) {
    setEchec(null);
    setRetires((avant) => [...avant, catalogItemId]);
    void api.retirerDesFavoris(catalogItemId).catch(() => {
      setRetires((avant) => avant.filter((id) => id !== catalogItemId));
      setEchec(nom);
    });
  }

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
          {/* Ce qu'on n'a pas su retirer, nommé — au-dessus de la liste, là où
              la ligne vient de réapparaître. */}
          {echec === null ? null : (
            <StatusMessage
              level="danger"
              body={t('favoris.retraitEchec', { prestation: echec })}
              testID="favori-non-retire"
            />
          )}
          <AvisDeFavori
            enAttente={favoris.filter((favori) => favori.etat !== 'reservable').length}
          />
          {favoris
            .filter((favori) => !retires.includes(favori.catalog_item_id))
            .map((favori) => (
              <LigneDuFavori
                key={favori.catalog_item_id}
                favori={favori}
                onOuvrir={() => onOuvrirLeCommerce(favori.business_id)}
                onRetirer={() => retirer(favori.catalog_item_id, favori.name)}
                onVoirMesPaliers={onVoirMesPaliers}
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
  onRetirer,
  onVoirMesPaliers,
}: {
  favori: Favori;
  onOuvrir: () => void;
  onRetirer: () => void;
  onVoirMesPaliers: () => void;
}) {
  const { api } = useApi();
  const { t, locale } = useI18n();
  const c = useColors();

  const conduite = CONDUITES[favori.etat] ?? null;

  /**
   * L'écart, ou rien.
   *
   * **Servi par favori, et non pris sur le prochain palier de la créatrice.**
   * Les deux diffèrent dès qu'une prestation n'est offerte qu'à un palier
   * lointain : l'écran demandait la vue des paliers pour chiffrer un écart qui
   * ne parlait pas de cette prestation-là, et la ligne s'arrêtait donc avant
   * « et il s'ouvre » — la promesse aurait pu être fausse. Le palier requis
   * est maintenant sur la ligne, et avec lui la phrase entière.
   *
   * Une requête de moins, aussi : l'écran ne charge plus les paliers.
   *
   * Nul quand le serveur ne chiffre pas l'écart — un jeton mort, un relevé
   * trop vieux — et la ligne se tait alors plutôt que d'arrondir.
   */
  const requis = favori.palier_requis;
  const ecart =
    requis?.abonnes_manquants == null
      ? null
      : formatNumber(requis.abonnes_manquants, locale);

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
        {/* **La ligne entière ouvre le salon.** C'était réservé au bandeau des
            états non réservables : sur une prestation qu'on peut réserver — le
            cas le plus fréquent — la liste ne menait nulle part. */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${favori.name} — ${favori.business_name}`}
          onPress={onOuvrir}
          style={({ pressed }) => ({
            flex: 1,
            minWidth: 0,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 12,
            opacity: pressed ? 0.7 : 1,
          })}
        >
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
        </Pressable>

        {/* **Le cœur se presse ici aussi, et il le fallait.** Il était
            décoratif — « retirer se fait là où l'on a posé » — et c'était faux
            pour la moitié de cette liste : un salon qui ne paraît plus n'est
            dans aucun fil, donc son favori n'aurait jamais pu être retiré. Une
            liste de choses gardées d'où l'on ne peut rien lâcher se remplit une
            fois pour toutes.

            **Il est frère de la ligne, pas son enfant.** Imbriqué, il gagnerait
            l'appui — c'est la règle — mais la lecture d'écran annoncerait un
            bouton dans un bouton, et la cible du cœur mangerait un coin de
            celle de la ligne.

            `brand.700` : `brand.500` est une surface, et à 2,36:1 le cœur
            s'effacerait au moment où il doit signer. */}
        <Pressable
          testID={`favori-retirer-${favori.catalog_item_id}`}
          accessibilityRole="button"
          accessibilityState={{ selected: true }}
          accessibilityLabel={t('favoris.retirer', { nom: favori.name })}
          onPress={onRetirer}
          hitSlop={8}
          style={({ pressed }) => ({
            width: size.touchMin,
            height: size.touchMin,
            alignItems: 'center',
            justifyContent: 'center',
            opacity: pressed ? 0.6 : 1,
          })}
        >
          <Icone nom="coeur" couleur="brand.700" taille={20} rempli />
        </Pressable>
      </View>

      {conduite ? (
        <StatusMessage
          level={conduite.niveau}
          body={t(conduite.cle, { salon: favori.business_name })}
          testID={`favori-etat-${favori.catalog_item_id}`}
        />
      ) : null}

      {/* **La seule ligne de l'écran qui porte un geste.** Elle ne se rend que
          sur `hors_palier` : c'est la seule des trois raisons qui dépende de la
          créatrice. « Le salon n'est pas listé » et « l'offre est fermée » ne
          portent aucun bouton, parce qu'aucun canal ne va d'elle vers un salon
          — et un bouton qui n'existe pas est pire qu'un fait nu.

          Elle ne se rend pas non plus sans écart chiffrable : la règle des
          60 % de l'écran des paliers interdit d'annoncer un horizon quand le
          compte est loin, et cet écran n'a aucune raison d'en dire plus. */}
      {favori.etat === 'hors_palier' && requis !== null && ecart !== null ? (
        <View style={{ gap: 8, alignItems: 'flex-start' }}>
          <Texte variante="type.caption" testID={`favori-ecart-${favori.catalog_item_id}`}>
            {t('favoris.ecartJusquAuPalier', {
              palier: t(`parcours.format_${requis!.content_format}`),
              ecart,
            })}
          </Texte>
          <Button
            label={t('favoris.voirMesPaliers')}
            size="sm"
            variant="secondary"
            fullWidth={false}
            onPress={onVoirMesPaliers}
            testID={`favori-vers-paliers-${favori.catalog_item_id}`}
          />
        </View>
      ) : null}
    </View>
  );
}


/**
 * L'unique interrupteur de notification du produit.
 *
 * **Un seul, et pas un par favori.** Un par ligne recréerait, une case à la
 * fois, le mur d'interrupteurs que le produit a retiré — et personne n'a jamais
 * réglé quoi que ce soit dans un mur d'interrupteurs.
 *
 * **Optimiste, comme les deux autres gestes de cet écran.** Un interrupteur qui
 * attend le réseau se presse deux fois, et le second appui annule le premier.
 * Il revient si le serveur refuse.
 */
function AvisDeFavori({ enAttente }: { enAttente: number }) {
  const { t } = useI18n();
  const session = useSession();
  const c = useColors();

  const servi =
    session.etat === 'connecte' ? session.utilisateur.favoris_me_previennent : null;
  const [enVol, setEnVol] = useState<boolean | null>(null);

  // **Rien tant qu'on ne sait pas.** Un interrupteur qui part à faux puis
  // bascule tout seul une seconde plus tard fait douter de ce qu'on a réglé.
  if (servi === null) return null;

  const actif = enVol ?? servi;

  return (
    <View
      testID="avis-de-favori"
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        padding: 12,
        borderRadius: radius['radius.lg'],
        backgroundColor: c['bg.inset'],
      }}
    >
      <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
        <Texte variante="type.bodyStrong">{t('favoris.avisCorps')}</Texte>
        {/* **Il compte ce à quoi il sert, donc il se justifie sans notice.**
            Un interrupteur qui annonce ce qu'il fera pour trois lignes précises
            de la liste qu'on regarde n'a pas besoin qu'on explique à quoi il
            sert. Et à zéro, il se tait plutôt que d'écrire « 0 » — le compte
            n'est là que pour dire qu'il y a de quoi attendre. */}
        {enAttente > 0 ? (
          <Texte variante="type.caption" couleur="ink.soft" testID="avis-compte">
            {t('favoris.avisEnAttente', { count: enAttente })}
          </Texte>
        ) : null}
      </View>
      <Toggle
        value={actif}
        accessibilityLabel={t('favoris.avisLabel')}
        onChange={(valeur) => {
          setEnVol(valeur);
          void session
            .reglerLesAvisDeFavori(valeur)
            // La réponse remet l'utilisateur à jour : la dérogation n'a plus
            // rien à dire, et la garder ferait resurgir un vieux geste sur une
            // donnée neuve.
            .then(() => setEnVol(null))
            .catch(() => setEnVol(null));
        }}
        testID="avis-de-favori-interrupteur"
      />
    </View>
  );
}
