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
import { useEffect, useMemo, useState } from 'react';
import { Animated, Pressable, View } from 'react-native';

import { useApi, type BusinessCategory, type Fil } from '../api';
import { Icone, StatusMessage, Texte } from '../components';
import { useEnfoncement } from '../components/Mouvement';
import { useI18n } from '../i18n';
import { formatNumber } from '../format';
import { motion, size } from '../theme';
import { messageDePosition } from '../shell/messageDePosition';
import type { EtatDePosition } from '../shell/usePosition';
import { en } from '../i18n/en';
import { Ecran } from './Ecran';
import { BarreDuMur } from './mur/BarreDuMur';
import { useFavorisEnVol } from './mur/favorisEnVol';
import { EnTeteDuMur } from './mur/EnTeteDuMur';import { BasDuMur } from './mur/BasDuMur';
import { MurEnChargement, SectionsParQuartier, useMur } from './mur/SectionsParQuartier';
import { RaisonDuVide } from './RaisonDuVide';
import { messageDObstacle } from './obstacle';
import { AGES } from './cacheDesReponses';
import { useRequete } from './useRequete';

const CODES_CONNUS = new Set(Object.keys(en.errors));

/** Une source d'image, ou rien. `Image` refuse une URI vide. */
export function urlImage(url: string | undefined) {
  return url ? { uri: url } : undefined;
}
/**
 * Le rayon de départ.
 *
 * Quinze kilomètres et non deux : Miami est une ville de voiture, où deux
 * kilomètres ne couvrent qu'un quartier et ne montrent qu'un salon. Le fil
 * paraissait vide alors qu'il était seulement myope.
 *
 * **Les élargissements ne sont plus écrits ici.** C'était une liste de trois
 * valeurs dont une seule servait : le serveur rend `rayons`, avec ce que chaque
 * élargissement ouvrirait, et c'est lui que le bas du mur et l'état vide
 * proposent. Deux listes en auraient tôt ou tard désigné deux différentes.
 */
const RAYON_DE_DEPART_KM = 15;

/**
 * La marge des blocs de texte, maintenant que l'écran va au bord.
 *
 * Dix-huit, comme la planche, et non les vingt d'`Ecran` : c'est la même valeur
 * que les titres de rangée et le bord gauche des cartes, et deux marges d'un
 * point d'écart sur le même écran se voient plus qu'une seule mal choisie.
 */
const MARGE = 18;

export type Position = { longitude: number; latitude: number };

export function FilScreen({
  position,
  etatDeLaPosition = { etat: 'jamais_demandee' },
  onDemanderLaPosition,
  onOuvrirLeCommerce,
  onConnecterUnReseau,
  onVoirMonAudience,
  onVoirMesPaliers,
  onVoirMesFavoris,
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
  onDemanderLaPosition: () => void;
  /**
   * La liste des prestations mises de côté.
   *
   * **Le cœur sans liste est un geste sans destination.** Poser un favori qu'on
   * ne peut pas relire n'est pas une capacité, c'est un bouton qui s'allume.
   */
  onVoirMesFavoris: () => void;
  onOuvrirLeCommerce: (businessId: string) => void;
  onConnecterUnReseau?: () => void;
  onVoirMonAudience?: () => void;
  onVoirMesPaliers?: () => void;
  /** Remonte le mur en tête. Absent, la sortie ne s'affiche pas. */
  onRemonterEnHaut?: () => void;
}) {
  const { api } = useApi();
  const { t, locale } = useI18n();
  const [rayonKm, setRayonKm] = useState(RAYON_DE_DEPART_KM);
  /**
   * La catégorie choisie dans l'en-tête. `null` : toutes.
   *
   * **Trois couches étaient prêtes et rien ne les appelait** : la route accepte
   * `categorie`, le client sait la passer, le serveur rend les comptes par
   * catégorie. Il ne manquait que cet état — et un paramètre accepté par un
   * contrat que personne n'envoie est le pendant exact d'un champ accepté par
   * un schéma et ignoré par un service.
   */
  const [categorie, setCategorie] = useState<BusinessCategory | null>(null);

  /**
   * Ce qu'on tape, et ce qu'on demande.
   *
   * **Deux états et non un.** Le champ suit la frappe au caractère près ; la
   * requête ne part qu'après une pause. Les lier ferait une requête par touche
   * — huit pour « massage » — et la dernière réponse n'arriverait pas
   * forcément en dernier.
   *
   * Le délai est celui d'un état qui change sur place. Il ne se règle pas ici :
   * `motion.etat` porte la même valeur pour tout ce qui répond à un geste sans
   * changer d'écran.
   */
  const [saisie, setSaisie] = useState('');
  const [recherche, setRecherche] = useState('');

  useEffect(() => {
    if (saisie === recherche) return;
    const minuteur = setTimeout(() => setRecherche(saisie), motion.etat);
    return () => clearTimeout(minuteur);
  }, [saisie, recherche]);

  /**
   * **La demande part à l'arrivée, et il n'y a plus qu'une question.**
   *
   * Un écran demandait « partagez votre position », puis le système demandait
   * la même chose : deux demandes pour une, dont la première n'apprenait rien
   * que la seconde ne dise mieux — c'est le système qui nomme l'application et
   * qui porte les conséquences. Elle ajoutait seulement un geste avant le geste,
   * et un endroit de plus où abandonner.
   *
   * **`jamais_demandee` est le seul état qui déclenche.** Un refus ne se
   * redemande pas — le système ne rouvrirait rien — et une demande en vol ne se
   * double pas. La condition est donc l'état lui-même et non un drapeau de
   * montage : elle cesse d'être vraie dès que `demander` pose `en_cours`, ce qui
   * arrive avant tout appel réseau.
   *
   * **Le hook garde sa règle et ne demande toujours rien de lui-même.** Elle
   * était bonne : une autorisation réclamée avant d'avoir montré à quoi elle
   * sert se refuse. C'est l'écran qui sait qu'il en a besoin, et le fil est
   * précisément l'écran qui ne peut rien montrer sans elle.
   */
  useEffect(() => {
    if (etatDeLaPosition.etat === 'jamais_demandee') onDemanderLaPosition();
  }, [etatDeLaPosition.etat, onDemanderLaPosition]);

  const requete = useRequete<Fil>(
    (signal) =>
      api.fil(
        position!,
        {
          rayonMetres: rayonKm * 1000,
          categorie: categorie ?? undefined,
          recherche: recherche || undefined,
        },
        signal,
      ),
    {
      estVide: (fil) => fil.commerces.length === 0,
      dependances: [position?.longitude, position?.latitude, rayonKm, categorie, recherche],
      // Sans position, on ne lance rien : une requête sans coordonnées ne
      // renverrait pas « rien près de toi », elle renverrait une erreur de
      // validation que l'écran traduirait mal.
      actif: position !== null,
      // **La clé porte le rayon et la catégorie, pas la position.** Les deux
      // premiers changent par un geste et se retrouvent au lancement suivant ;
      // la position, elle, bouge de quelques mètres à chaque relevé, et la
      // mettre dans la clé donnerait un cache qui ne se relit jamais. Un fil
      // d'il y a six heures pris trois rues plus loin reste le bon fil.
      // **La recherche ne va pas au cache.** Elle est une question qu'on pose
      // une fois, pas un réglage qu'on retrouve : relire au lancement le fil de
      // « massage » tapé la veille montrerait un mur amputé sans dire pourquoi.
      // Le cache entier tombe pendant qu'on cherche, plutôt qu'une clé de plus.
      cache: recherche
        ? undefined
        : { cle: `fil.${rayonKm}.${categorie ?? 'toutes'}`, ageMax: AGES.contenu },
    },
  );

  const filPret = requete.etat === 'pret' ? requete.donnees : null;

  /**
   * Le mur en morceaux, pour que le défileur ne monte que ce qu'il montre.
   *
   * Appelé ici et non dans `liste` : c'est un crochet, et `liste` est une
   * fonction que `Ecran` exécute pendant **son** rendu. L'appeler là violerait
   * l'ordre des crochets à la première fois où le fil passerait de vide à
   * plein.
   *
   * **Et appelé avant le retour anticipé de la position**, pour la même raison
   * et à l'envers. Posé après, il n'existait pas tant qu'aucune position
   * n'était accordée, puis apparaissait au premier relevé : React voyait plus
   * de crochets qu'au rendu précédent, levait, et l'application entière
   * disparaissait — barre d'onglets comprise, puisque rien ne rattrape une
   * erreur de rendu ici. Vu en bout de chaîne seulement : les décors de test
   * partent tous d'une position accordée, donc aucun ne traverse la bascule.
   *
   * **Nul quand aucun quartier n'est déclaré**, ce qui arrive : des salons
   * réservables mais non situés. L'écran retombe alors sur le rendu en bloc,
   * qui rend la même chose et n'a rien à virtualiser.
   */
  /**
   * **Les cœurs touchés, avant que le serveur réponde.** Le fil porte
   * `est_favori` sur chaque article — quatre-vingts cartes ne peuvent pas
   * demander l'état de leur cœur une par une — et cette table ne garde que
   * l'écart, le temps que la réponse arrive.
   */
  const favoris = useFavorisEnVol(
    useMemo(
      () => ({
        mettre: (id: string) => api.mettreEnFavori(id),
        retirer: (id: string) => api.retirerDesFavoris(id),
      }),
      [api],
    ),
  );

  // L'écart se referme quand le fil revient : le garder ferait resurgir un
  // vieux geste sur une donnée neuve.
  const { oublier } = favoris;
  useEffect(() => {
    if (requete.etat === 'pret') oublier();
  }, [requete.etat, filPret, oublier]);

  const mur = useMur(filPret, categorie, onOuvrirLeCommerce, favoris);

  if (position === null) {
    // Ce qu'on dit et ce qu'on propose dépendent de **pourquoi** il n'y a pas
    // de position. Le même message pour tous laissait un bouton « Share my
    // location » qui, après un refus, ne produisait plus rien : le système ne
    // repose pas la question, et presser à nouveau n'ouvre aucune fenêtre.
    // Jamais nul ici : `messageDePosition` ne rend `null` que sur `accordee`,
    // qui porte une position et ne passe donc pas par cette branche.
    const message = messageDePosition(etatDeLaPosition) ?? {
      corps: 'parcours.filPositionEnCours',
      ouReactiver: null,
      action: null,
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
      // **Les deux barres restent, et c'est ce qu'elles coûtent.** Cent quatre
      // points sur sept cent vingt-huit, un septième de l'écran en permanence.
      // Le prix se paie parce que la recherche rachète la ligne unique : une
      // catégorie hors champ serait un cul-de-sac si rien ne la trouvait.
      barre={
        <>
        <BarreDuMur
          fil={filPret}
          categorie={categorie}
          onCategorie={setCategorie}
          recherche={saisie}
          onRecherche={setSaisie}
          onVoirLesFavoris={onVoirMesFavoris}
          // **Le total servi, corrigé de ce qui est en vol.** Le serveur le
          // compte sur l'ensemble des favoris et non sur ce que le fil rend —
          // un favori posé à Wynwood existe encore quand on lit depuis
          // Kendall. L'écart rend l'appui visible tout de suite, sans quoi le
          // compte n'arriverait qu'au rechargement suivant.
          favorisGardes={Math.max(0, (filPret?.favoris_total ?? 0) + favoris.ecart)}
        />
        {/* **Un cœur qui échoue le dit.** Le retour en arrière était muet : le
            cœur se remplissait, revenait, et rien ne distinguait « je n'ai pas
            su enregistrer » de « tu n'as pas appuyé ». C'est exactement ce
            qu'on lit comme « les favoris ne marchent pas » — le geste rate *et*
            le produit se tait, donc il n'y a rien à réessayer et rien à
            raconter. Dans la bande, parce qu'elle ne défile pas : un message
            posé dans la liste part sous le doigt au premier glissement. */}
        {favoris.echec === null ? null : (
          <View style={{ paddingHorizontal: MARGE, paddingTop: 8 }}>
            <StatusMessage
              level="danger"
              body={t('parcours.filFavoriEchec', { prestation: favoris.echec })}
              testID="favori-non-enregistre"
            />
          </View>
        )}
        </>
      }
      /**
       * **Le mur est une liste, pas un bloc.** Il rendait toutes ses rangées
       * d'un coup — quatre-vingts `Image` montées à la première image sur un
       * fil de vingt salons. Le poids du réseau a été réglé en servant la
       * vignette ; ce qui restait est le décodage, que `Image` fait avant de
       * réduire et qui ne dépend pas du cadre où on pose la photo.
       *
       * `liste` ne remplace `children` que sur l'état nominal : le chargement,
       * l'erreur et le vide tiennent en un écran et n'ont rien à virtualiser.
       */
      liste={
        mur === null
          ? undefined
          : () => ({
              testID: 'le-mur',
              // Ce qui précède les rangées et défile avec elles : les obstacles
              // — rendus même quand le fil n'est pas vide, un créateur qui
              // accède au story mais pas au reel doit savoir ce qui lui manque —
              // puis la tête de la section ouverte.
              entete: (
                <>
                  <View style={{ paddingHorizontal: MARGE, paddingBottom: 16 }}>
                    <Obstacles fil={filPret!} />
                  </View>
                  {mur.entete}
                </>
              ),
              elements: mur.elements,
              pied: (
                <>
                  {mur.pied}
                  <BasDuMur
                    fil={filPret!}
                    rayonKm={rayonKm}
                    onElargir={setRayonKm}
                    resserrer={
                      rayonKm > RAYON_DE_DEPART_KM
                        ? {
                            versKm: RAYON_DE_DEPART_KM,
                            onPress: () => setRayonKm(RAYON_DE_DEPART_KM),
                          }
                        : undefined
                    }
                    onRemonter={onRemonterEnHaut}
                  />
                </>
              ),
            })
      }
      // **Le mur va au bord.** Encadré de vingt points, il perd la moitié de
      // son effet, et les cartes des rangées cessent de dépasser le bord droit —
      // c'est ce dépassement qui annonce le glissement, sans flèche. L'écran
      // reprend donc ses marges à sa charge : elles vivent maintenant sur les
      // blocs qui en veulent, et nulle part ailleurs.
      bordAbord
      // L'écran ne rend plus des cartes : le défaut à photo promettrait une
      // forme que le mur n'a pas, et tout sauterait à l'arrivée des images.
      squelette={<MurEnChargement />}
      // **L'en-tête nomme l'endroit, pas l'écran.** « Near you » et un bonjour
      // disaient où l'on était dans l'application ; le quartier, le rayon et
      // son compte disent où l'on est dans la ville, ce qui est la question.
      // Il est rendu hors des quatre états : le mur en chargement le garde,
      // l'état vide aussi — c'est de là qu'on relâche un filtre trop étroit.
      entete={
        <View style={{ paddingHorizontal: MARGE }}>
          <EnTeteDuMur fil={filPret} categorie={categorie} />
        </View>
      }
      vide={
        <View style={{ paddingHorizontal: MARGE }}>
        <RaisonDuVide
          obstacles={filPret?.obstacles ?? []}
          issues={issues}
          rayonKm={rayonKm}
          testID="fil-vide"
        />
        </View>
      }
    >
      {(fil) => (
        <View style={{ gap: 16 }}>
          {/* **La ligne des paliers est partie vers Audience.** « Douze
              prestations vous sont ouvertes » et l'accès aux paliers vivent
              maintenant là où sont déjà les abonnés et le score de fiabilité :
              c'est le même sujet, et il était ici parce que le fil était le
              seul écran qu'on ouvrait. Ce que le fil garde du compte est le
              surtitre de l'en-tête, une fois filtré. */}

          {/* Rendus même quand le fil n'est pas vide : un créateur qui accède
              au palier story mais pas au reel doit savoir ce qui lui manque,
              sinon il croit avoir tout vu. */}
          <View style={{ paddingHorizontal: MARGE }}>
            <Obstacles fil={fil} />
          </View>

          {/* **Un seul rendu, et c'est la correction de la revue.** Le fil
              montrait un mur de six formats sans filtre et des rangées par
              quartier avec — deux compositions pour un même contenu, et la
              seconde n'apparaissait qu'à ceux qui filtraient. La v3 n'en a
              qu'une : le quartier structure le mur dans les deux états, et le
              filtre ne change que ce qu'il y a dedans. */}
          <SectionsParQuartier
            fil={fil}
            categorie={categorie}
            onOuvrir={onOuvrirLeCommerce}
            // **Le bloc porte les mêmes cœurs que la liste.** Sans ce
            // branchement, un fil dont aucun salon n'a déclaré de quartier —
            // ce qui arrive — n'offrait aucun cœur du tout.
            favoris={favoris}
          />

          <BasDuMur
            fil={fil}
            rayonKm={rayonKm}
            onElargir={setRayonKm}
            resserrer={
              rayonKm > RAYON_DE_DEPART_KM
                ? { versKm: RAYON_DE_DEPART_KM, onPress: () => setRayonKm(RAYON_DE_DEPART_KM) }
                : undefined
            }
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
      style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: size.touchMin }}
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


