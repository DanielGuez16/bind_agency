/**
 * 03 · Fil géolocalisé.
 *
 * **Le fil vide dit pourquoi il l'est.** Le serveur renvoie les obstacles à
 * part, même quand des commerces sont rendus : sans eux, un créateur qui
 * n'accède à rien conclut qu'il n'y a aucun commerce à Miami, alors qu'il lui
 * manque un relevé ou mille abonnés.
 *
 * **Chaque issue de l'état vide annonce son gain chiffré.** « Élargir à 5 km »
 * sans nombre demande de tenter pour voir, et personne ne tente deux fois — ici
 * le nombre n'est connu qu'après l'appel, donc l'action élargit et recharge,
 * et c'est le rayon qui est annoncé.
 *
 * **Les coordonnées viennent de l'appelant, pas du profil.** On consulte le fil
 * là où l'on est, ce qui n'est pas toujours la ville déclarée.
 *
 * **Le fil vide dit toujours laquelle des cinq raisons s'applique.** Aucun
 * compte rattaché, compte refusé, autorisation expirée, compte en
 * vérification, aucun relevé, aucun palier ouvert, ou rien dans le rayon : sept
 * situations, sept actions différentes, et l'écran n'en montrait aucune. Le
 * choix et le rendu vivent dans `RaisonDuVide`, partagés avec l'écran des
 * paliers — deux copies divergeraient au premier code ajouté.
 *
 * Élargir le rayon n'est proposé que dans le seul cas où la distance est en
 * cause. Le proposer ailleurs enverrait chercher plus loin quelque chose qui
 * n'est nulle part.
 *
 * ---
 *
 * **Les paliers ne sont plus un onglet, ils sont une ligne d'ici.** Un onglet
 * répond à une question qu'on se pose en ouvrant l'application ; « quel est mon
 * palier » n'en est pas une. Ce que la créatrice veut savoir en ouvrant l'app,
 * c'est **ce qu'elle peut réserver** — et c'est le fil qui répond.
 *
 * La ligne dit le nombre avant de proposer l'explication : « douze prestations
 * vous sont ouvertes » est la réponse, et les paliers sont la raison. Rangée
 * dans un onglet, la raison était offerte à qui n'avait pas posé la question ;
 * ici elle attend qu'on la pose. L'information ne disparaît pas, elle arrive au
 * moment où elle sert.
 */
import { useState } from 'react';
import { Animated, Pressable, View } from 'react-native';

import { useApi, type Fil } from '../api';
import {
  Apparition,
  BusinessCard,
  Chip,
  EnTeteDEcran,
  Icone,
  RangeeDeChips,
  StatusMessage,
  Texte,
} from '../components';
import { useEnfoncement } from '../components/Mouvement';
import { useI18n } from '../i18n';
import { formatNumber } from '../format';
import { size } from '../theme';
import { messageDePosition } from '../shell/messageDePosition';
import type { EtatDePosition } from '../shell/usePosition';
import { en } from '../i18n/en';
import { Ecran } from './Ecran';
import { BasDuMur, Mur, MurEnChargement } from './mur/Mur';
import { RaisonDuVide } from './RaisonDuVide';
import { messageDObstacle } from './obstacle';
import { useRequete } from './useRequete';

const CODES_CONNUS = new Set(Object.keys(en.errors));

/** Une source d'image, ou rien. `Image` refuse une URI vide. */
export function urlImage(url: string | undefined) {
  return url ? { uri: url } : undefined;
}
/**
 * Le rayon de départ, et les élargissements proposés.
 *
 * Quinze kilomètres et non deux : Miami est une ville de voiture, où deux
 * kilomètres ne couvrent qu'un quartier et ne montrent qu'un salon. Le fil
 * paraissait vide alors qu'il était seulement myope.
 */
const RAYONS_KM = [15, 30, 50];

export type Position = { longitude: number; latitude: number };

export function FilScreen({
  position,
  etatDeLaPosition = { etat: 'jamais_demandee' },
  prenom = null,
  onDemanderLaPosition,
  onOuvrirLeCommerce,
  onConnecterUnReseau,
  onVoirMonAudience,
  onVoirMesPaliers,
  onRemonterEnHaut,
}: {
  /** Nulle tant que l'autorisation n'est pas donnée. */
  position: Position | null;
  /**
   * **Pourquoi** il n'y a pas de position. Sans cela, l'écran ne peut que
   * reproposer la même demande, et après un refus cette demande ne fait plus
   * rien du tout — le système ne repose pas la question.
   */
  etatDeLaPosition?: EtatDePosition;
  /** Résolu par la coquille : l'écran ne lit pas la session. */
  prenom?: string | null;
  onDemanderLaPosition: () => void;
  onOuvrirLeCommerce: (businessId: string) => void;
  onConnecterUnReseau?: () => void;
  onVoirMonAudience?: () => void;
  onVoirMesPaliers?: () => void;
  /** Remonte le mur en tête. Absent, la sortie ne s'affiche pas. */
  onRemonterEnHaut?: () => void;
}) {
  const { api } = useApi();
  const { t, locale } = useI18n();
  const [rayonKm, setRayonKm] = useState(RAYONS_KM[0]);

  const requete = useRequete<Fil>(
    (signal) => api.fil(position!, { rayonMetres: rayonKm * 1000 }, signal),
    {
      estVide: (fil) => fil.commerces.length === 0,
      dependances: [position?.longitude, position?.latitude, rayonKm],
      // Sans position, on ne lance rien : une requête sans coordonnées ne
      // renverrait pas « rien près de toi », elle renverrait une erreur de
      // validation que l'écran traduirait mal.
      actif: position !== null,
    },
  );

  if (position === null) {
    // Ce qu'on dit et ce qu'on propose dépendent de **pourquoi** il n'y a pas
    // de position. Le même message pour tous laissait un bouton « Share my
    // location » qui, après un refus, ne produisait plus rien : le système ne
    // repose pas la question, et presser à nouveau n'ouvre aucune fenêtre.
    // Jamais nul ici : `messageDePosition` ne rend `null` que sur `accordee`,
    // qui porte une position et ne passe donc pas par cette branche.
    const message = messageDePosition(etatDeLaPosition) ?? {
      corps: 'parcours.filSansPosition',
      ouReactiver: null,
      action: { cle: 'parcours.filAutoriser' },
    };
    return (
      <View testID="ecran-fil" style={{ flex: 1, padding: 20, gap: 12 }}>
        <StatusMessage
          level="neutral"
          // Le chemin exact vers le réglage suit le constat, dans le même
          // corps : `StatusMessage` n'a pas de troisième niveau, et lui en
          // ajouter un pour un seul écran ferait diverger la bibliothèque.
          body={[message.corps, message.ouReactiver]
            .filter((cle): cle is string => cle !== null)
            .map((cle) => t(cle))
            .join('\n\n')}
          action={
            message.action
              ? { label: t(message.action.cle), onPress: onDemanderLaPosition }
              : undefined
          }
          testID="fil-sans-position"
        />
      </View>
    );
  }

  const filPret = requete.etat === 'pret' ? requete.donnees : null;

  const issues = {
    onConnecterUnReseau,
    onVoirMonAudience,
    onVoirMesPaliers,
    /**
     * **Les deux issues portent leur nombre.** « Élargir à 30 km » sans chiffre
     * demande de tenter pour voir, et personne ne tente deux fois. Le serveur
     * les compte — `rayons` dit ce que chaque élargissement ouvrirait, filtre de
     * catégorie conservé — et on les rend dans son ordre, du plus étroit au plus
     * large.
     *
     * Un élargissement qui n'ouvrirait rien ne se propose pas : une issue à zéro
     * est un cul-de-sac chiffré, ce qui est pire qu'une issue absente.
     */
    elargir: (filPret?.rayons ?? [])
      .filter((rayon) => rayon.commerces > 0)
      .map((rayon) => ({
        label: t('parcours.filElargirCompte', {
          rayon: formatNumber(Math.round(rayon.rayon_metres / 1000), locale),
          count: formatNumber(rayon.commerces, locale),
        }),
        onPress: () => setRayonKm(Math.round(rayon.rayon_metres / 1000)),
      })),
  };

  return (
    <Ecran
      requete={requete}
      testID="ecran-fil"
      // L'écran ne rend plus des cartes : le défaut à photo promettrait une
      // forme que le mur n'a pas, et tout sauterait à l'arrivée des images.
      squelette={<MurEnChargement />}
      entete={
        <EnTeteDEcran
          titre={t('parcours.filTitre')}
          surtitre={prenom ? t('tiers.greeting', { prenom }) : null}
          testID="entete-fil"
        />
      }
      vide={
        <RaisonDuVide
          obstacles={filPret?.obstacles ?? []}
          issues={issues}
          rayonKm={rayonKm}
          testID="fil-vide"
        />
      }
    >
      {(fil) => (
        <View style={{ gap: 16 }}>
          {/* Le rayon se règle depuis le fil lui-même, pas seulement depuis
              l'état vide : un fil maigre n'est pas un fil vide, et il faut
              pouvoir l'élargir sans avoir à le vider d'abord. */}
          <RangeeDeChips>
            {RAYONS_KM.map((rayon) => (
              <Chip
                key={rayon}
                label={t('parcours.filRayon', { rayon })}
                selected={rayon === rayonKm}
                onPress={() => setRayonKm(rayon)}
              />
            ))}
          </RangeeDeChips>

          {/* **La réponse, puis la raison.** Le nombre est ce que la créatrice
              est venue chercher ; les paliers sont ce qui l'explique, et ils
              s'ouvrent d'ici plutôt que d'occuper un onglet. */}
          <PrestationsOuvertes total={fil.total_prestations} onOuvrir={onVoirMesPaliers} />

          {/* Rendus même quand le fil n'est pas vide : un créateur qui accède
              au palier story mais pas au reel doit savoir ce qui lui manque,
              sinon il croit avoir tout vu. */}
          <Obstacles fil={fil} />
          {/* **Le mur.** Un salon occupe l'écran, six positions dans un
              ordre fixe, huit salons puis une respiration. Les salons arrivent
              triés par distance et se posent dans les positions : personne ne
              décide quel salon mérite le grand format. */}
          <Mur fil={fil} onOuvrir={onOuvrirLeCommerce} />

          {/* Le seul fond d'encre du fil : il ferme, là où l'os des
              respirations ouvrait. */}
          <BasDuMur
            fil={fil}
            rayonKm={rayonKm}
            onElargir={setRayonKm}
            onRemonter={onRemonterEnHaut}
          />
        </View>
      )}
    </Ecran>
  );
}

/**
 * « Douze prestations vous sont ouvertes », et de quoi savoir pourquoi.
 *
 * **Le nombre d'abord, l'explication ensuite.** C'est la réponse à la question
 * qu'on se pose en ouvrant l'application, et les paliers en sont la raison —
 * pas l'inverse. L'écran des paliers s'ouvre d'ici, quand la question se pose,
 * au lieu d'attendre dans un onglet qu'on ne visite qu'une fois.
 *
 * **Il n'y a pas de cas zéro à traiter, et c'est vérifié côté serveur.**
 * `total_prestations` vaut `sum(len(commerce.items))` : il est nul exactement
 * quand le fil est vide, et un fil vide rend `RaisonDuVide` à la place de ce
 * corps. Une garde `total <= 0` ici protégerait donc un état qu'aucun appel
 * n'atteint — et il faudrait, pour l'éprouver, fabriquer une réponse que le
 * serveur ne produit pas. Le coût d'un repli défensif n'est pas nul : il crée
 * un chemin que rien ne parcourt et un test qui ment sur ce qu'il couvre.
 *
 * La ligne est donc un résumé de ce qui est **sous** elle, pas un fait séparé :
 * les douze prestations annoncées sont celles des cartes qui suivent.
 */
function PrestationsOuvertes({
  total,
  onOuvrir,
}: {
  total: number;
  onOuvrir?: () => void;
}) {
  const { t, locale } = useI18n();
  const enfoncement = useEnfoncement(Boolean(onOuvrir));

  const phrase =
    total === 1
      ? t('parcours.filPrestationsOuverteUne')
      : t('parcours.filPrestationsOuvertes', { count: formatNumber(total, locale) });

  // Sans issue vers l'explication, la ligne reste une phrase : elle informe
  // toujours, et un appui qui ne mène nulle part vaut moins que pas d'appui.
  if (!onOuvrir) {
    return (
      <Texte variante="type.body" testID="prestations-ouvertes">
        {phrase}
      </Texte>
    );
  }

  return (
    // Le même enfoncement que les cartes du fil : sur un écran où tout ce qui
    // s'appuie répond au doigt, une ligne qui ne répond pas se lit comme du
    // texte, et personne n'essaie deux fois.
    <Animated.View style={enfoncement.style}>
    <Pressable
      accessibilityRole="button"
      onPress={onOuvrir}
      onPressIn={enfoncement.onPressIn}
      onPressOut={enfoncement.onPressOut}
      testID="prestations-ouvertes"
      style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: size.hit }}
    >
      <Texte variante="type.body" style={{ flex: 1 }}>
        {phrase}
      </Texte>
      {/* Le mot qui nomme ce qu'on ouvre, et non un chevron seul : « pourquoi »
          est ce qu'on cherche, « paliers » est un mot du produit qu'il faut
          déjà connaître pour vouloir appuyer dessus. */}
      <Texte variante="type.label" couleur="brand.700" testID="prestations-ouvertes-issue">
        {t('parcours.filPourquoi')}
      </Texte>
      <Icone nom="chevron" couleur="brand.700" taille={20} />
    </Pressable>
    </Animated.View>
  );
}

function Obstacles({ fil }: { fil: Fil | null }) {
  const { t, locale } = useI18n();
  if (!fil?.obstacles.length) return null;

  return (
    <View style={{ gap: 4 }} testID="obstacles-du-fil">
      {fil.obstacles.map((obstacle, index) => (
        <Texte
          key={`${obstacle.raison}-${index}`}
          variante="type.caption"
          couleur="ink.soft"
          testID={`obstacle-${obstacle.raison}`}
        >
          {messageDObstacle(t, obstacle, CODES_CONNUS, undefined, locale)}
        </Texte>
      ))}
    </View>
  );
}


