/**
 * Ce que j'ai publié, et pour qui.
 *
 * **Aucune route ne sert cette liste, et il n'en faut pas une.** Une
 * publication est une contrepartie honorée : `/me/bookings` porte déjà les
 * réservations et l'état de leur contrepartie. Ouvrir une route pour recomposer
 * la même chose ferait deux sources du même fait, qui finiraient par diverger —
 * c'est exactement ce que le menu du commerce a évité en lisant le catalogue
 * plutôt qu'en recomptant.
 *
 * **Honorée veut dire acceptée, pas envoyée.** Une preuve soumise et en cours
 * de contrôle n'est pas une publication : la compter ici ferait dire à
 * quelqu'un qu'il a tenu un engagement que le salon peut encore refuser.
 *
 * **L'image est celle de la publication, et c'était le défaut.** L'écran
 * montrait `item_photo_key` — la photo du **service au catalogue du salon**.
 * Une liste de mes publications illustrée par les images d'autrui n'est pas une
 * liste de mes publications : on y reconnaissait le salon, jamais ce qu'on y
 * avait fait. L'objet archivé existe depuis la phase 7, il ne descendait
 * simplement pas jusqu'ici.
 *
 * **La photo du service reste, en dernier recours.** Une capture de niveau 2
 * peut n'avoir qu'une adresse sans objet archivé ; un trou gris à la place
 * serait pire que l'image approchante, du moment que la ligne dit où mène le
 * lien.
 */
import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';

import { useApi, type BookingStatus, type ReservationDuCreateur } from '../api';
import {
  EmptyState,
  Icone,
  LienExterne,
  MediaFallback,
  Photo,
  SkeletonLignes,
  Texte,
} from '../components';
import { formatDate } from '../format';
import { useI18n } from '../i18n';
import { radius, useColors } from '../theme';
import { Ecran } from './Ecran';
import { usePhotoDeLaPublication } from './publications/usePhotoDeLaPublication';
import { useRequete } from './useRequete';

/** Le côté de la vignette. */
const VIGNETTE = 56;

/**
 * Combien de réservations on demande par page.
 *
 * **Le filtre serveur ne remplace pas la pagination, il la rend utile.** Sans
 * lui, cinquante lignes pouvaient ne contenir aucune publication ; avec lui
 * elles n'en contiennent que des candidates. Mais une créatrice active en aura
 * plus de cinquante, et c'est le second défaut — celui qui ne se voyait pas en
 * démonstration parce qu'il faut un vrai historique pour l'atteindre.
 */
const PAGE = 50;

/** Les réservations dont la contrepartie a été acceptée. */
export function publications(items: ReservationDuCreateur[]): ReservationDuCreateur[] {
  return items.filter((item) => item.contrepartie?.status === 'approved');
}

/**
 * Les réservations à demander : celles qui ont été consommées.
 *
 * **Le tri du serveur est celui de la prise de rendez-vous, pas celui de la
 * publication.** Une publication est datée de plusieurs semaines en arrière ;
 * les réservations à venir, elles, viennent d'être prises. Sans filtre, la
 * page des cinquante plus récentes est donc pleine de rendez-vous futurs et ne
 * contient aucune publication — mesuré sur le jeu de démonstration : quinze
 * publications, toutes au-delà de la deux-cent-vingtième ligne, donc invisibles
 * sur une page de cinquante **et** sur une page de deux cents.
 *
 * `consumed` **et `closed`** : c'est le plus petit ensemble qui contienne
 * toutes les publications. Une contrepartie n'est approuvée qu'après le passage
 * au comptoir, donc jamais avant `consumed` ; et elle en fait sortir la
 * réservation dans la foulée, puisqu'une publication acceptée ferme l'échange.
 *
 * **`consumed` seul était juste la veille, et faux le lendemain.** La note
 * précédente disait « vérifié en base, aucune contrepartie approuvée ne porte
 * un autre statut de réservation » — exact tant que `consumed` était terminal.
 * Depuis que l'échange se ferme, une publication approuvée porte `closed`, et
 * ce filtre à lui seul aurait vidé cet écran en entier : toutes les
 * publications, tout le temps, sans erreur nulle part pour le dire.
 */
const STATUTS: BookingStatus[] = ['consumed', 'closed'];

function Publication({ item }: { item: ReservationDuCreateur }) {
  const { api } = useApi();
  const { t, locale } = useI18n();
  const c = useColors();

  const contrepartie = item.contrepartie;
  const publiee = usePhotoDeLaPublication(
    contrepartie?.proof_id ?? null,
    contrepartie?.post_a_une_image ?? false,
  );
  // Le repli, et il est nommé : la photo du service n'est pas la publication,
  // elle en tient lieu quand rien n'a été archivé.
  const image = publiee ?? api.urlDeLaVignette(item.item_photo_key);
  const lien = contrepartie?.post_url ?? null;

  const ligne = (
    <View
      testID={`publication-${item.booking_id}`}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}
    >
      <View
        style={{
          width: VIGNETTE,
          height: VIGNETTE,
          borderRadius: radius['radius.photo'],
          overflow: 'hidden',
          backgroundColor: c['media.placeholder'],
        }}
      >
        <Photo
          uri={image}
          hauteur={VIGNETTE}
          style={{ width: VIGNETTE }}
          testID={`publication-${item.booking_id}-image`}
          replit={<MediaFallback monogramme={item.business_name} height={VIGNETTE} />}
        />
      </View>
      <View style={{ flexShrink: 1, gap: 2 }}>
        {/* Même donnée, même défaut, même correction que la carte des
            réservations à venir : `duration_minutes` existait déjà sur ce
            type et seul le nom était rendu. */}
        <Texte variante="type.body">
          {item.duration_minutes
            ? t('parcours.prestationEtDuree', {
                prestation: item.item_name,
                minutes: item.duration_minutes,
              })
            : item.item_name}
        </Texte>
        <Texte variante="type.caption" couleur="ink.soft">
          {[
            item.business_name,
            // **Dans le fuseau du salon, comme partout ailleurs.** Une
            // publication datée sur le fuseau du téléphone changerait de
            // jour en voyageant, sur une liste qui dit ce qu'on a fait.
            item.starts_at ? formatDate(item.starts_at, locale, item.business_timezone) : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </Texte>
      </View>
      {/* **Le glyphe de sortie dit que la ligne quitte le produit.** Sans lui,
          une ligne pressable au milieu d'une liste qui ne l'est pas ailleurs ne
          se distingue qu'à l'appui. */}
      {lien ? (
        <View style={{ marginLeft: 'auto' }}>
          <Icone nom="sortie" couleur="ink.soft" taille={16} />
        </View>
      ) : null}
    </View>
  );

  // **Pressable seulement s'il y a où aller.** Une adresse d'origine n'existe
  // que si la créatrice l'a donnée ; une ligne qui répond sans rien ouvrir se
  // lit comme une panne.
  if (!lien) return ligne;

  return (
    <LienExterne
      url={lien}
      accessibilityLabel={t('profil.publicationOuvrir', { prestation: item.item_name })}
      testID={`publication-${item.booking_id}-ouvrir`}
    >
      {ligne}
    </LienExterne>
  );
}

/**
 * Une page lue, et ce qu'elle laisse derrière elle.
 *
 * **Le curseur porte sur la réservation, pas sur la publication.** Le serveur
 * pagine sur `created_at`, la colonne de son tri ; c'est donc la dernière
 * ligne **reçue** qui ouvre la page suivante, et non la dernière retenue. Les
 * confondre sauterait toutes les réservations consommées sans publication qui
 * se trouvent entre les deux.
 */
type Page = { retenues: ReservationDuCreateur[]; curseur: string | null; pleine: boolean };

function pageDe(items: ReservationDuCreateur[]): Page {
  return {
    retenues: publications(items),
    // **`null` sur une page vide, et non « la dernière de rien ».** Une page
    // sans ligne n'ouvre rien : elle dit qu'on est au bout.
    curseur: items.length > 0 ? items[items.length - 1].created_at : null,
    // **Pleine veut dire « il y en a peut-être d'autres », jamais « il y en
    // a ».** Le serveur ne dit pas combien de publications existent — ses
    // compteurs portent sur les réservations, pas sur les contreparties. On ne
    // promet donc pas de total : on propose de continuer tant que la dernière
    // page était pleine, ce qui est la seule chose qu'on sache.
    pleine: items.length >= PAGE,
  };
}

export function MesPublicationsScreen({ onRetour }: { onRetour: () => void }) {
  const { api } = useApi();
  const { t } = useI18n();

  const requete = useRequete<Page>(
    async (signal) =>
      pageDe((await api.mesReservations({ statuts: STATUTS, limite: PAGE }, signal)).items),
    { estVide: (page) => page.retenues.length === 0 },
  );

  /**
   * Les pages suivantes, à côté de la première.
   *
   * Recharger la requête entière pour une page de plus ferait clignoter
   * l'écran au complet alors que seul le bas s'allonge — c'est la forme que
   * l'annuaire du commerce emploie déjà, à une différence près : là-bas la
   * pagination est un décalage numérique, ici c'est un curseur, parce que la
   * route l'a voulu ainsi et le dit dans sa propre documentation.
   */
  const [suite, setSuite] = useState<Page[]>([]);
  const [enCours, setEnCours] = useState(false);

  const derniere = suite.length > 0 ? suite[suite.length - 1] : null;
  const premiere = requete.etat === 'pret' ? requete.donnees : null;

  // **On repart de zéro quand la première page change.** Sans cela, une suite
  // chargée avant un rechargement resterait collée sous la nouvelle tête.
  useEffect(() => {
    setSuite([]);
  }, [premiere]);

  async function charger(curseur: string) {
    setEnCours(true);
    try {
      const page = pageDe(
        (await api.mesReservations({ statuts: STATUTS, limite: PAGE, avant: curseur })).items,
      );
      setSuite((avant) => [...avant, page]);
    } finally {
      setEnCours(false);
    }
  }

  return (
    <Ecran
      requete={requete}
      titre={t('profil.mesPublications')}
      onRetour={onRetour}
      squelette={<SkeletonLignes combien={5} testID="squelette-publications" />}
      testID="ecran-mes-publications"
      vide={
        <EmptyState
          title={t('profil.publicationsVideTitre')}
          body={t('profil.publicationsVideCorps')}
          testID="publications-vide"
        />
      }
    >
      {(page) => {
        const liste = [page, ...suite].flatMap((p) => p.retenues);
        // Le curseur de la dernière page reçue, et « pleine » lu sur elle
        // aussi : c'est elle qui dit s'il reste quelque chose derrière.
        const bout = derniere ?? page;
        return (
          <View style={{ gap: 12 }} testID="liste-des-publications">
            {liste.map((item) => (
              <Publication key={item.booking_id} item={item} />
            ))}

            {/* **Rien à proposer quand la dernière page n'était pas pleine.**
                Un bouton qui ne ramène jamais rien apprend à ne plus
                l'appuyer, et c'est la fin de liste qu'il ferait douter. */}
            {bout.pleine && bout.curseur !== null ? (
              <Pressable
                testID="voir-plus-publications"
                accessibilityRole="button"
                disabled={enCours}
                onPress={() => void charger(bout.curseur!)}
                style={({ pressed }) => ({
                  opacity: pressed || enCours ? 0.7 : 1,
                  minHeight: 44,
                  alignItems: 'center',
                  justifyContent: 'center',
                })}
              >
                <Texte variante="type.label" couleur="brand.700">
                  {t(enCours ? 'annuaire.chargement' : 'annuaire.voirPlus')}
                </Texte>
              </Pressable>
            ) : null}
          </View>
        );
      }}
    </Ecran>
  );
}
