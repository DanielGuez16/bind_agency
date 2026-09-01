/**
 * L'écran de chargement : le point tombe et cale les lettres.
 *
 * **Direction A, et c'est un choix de marque plutôt que d'interface.** La
 * signature orange sert au favicon, à l'icône et aux visuels de l'agence : la
 * voir arriver en dernier, mille fois, l'installe mieux que n'importe quelle
 * note de passation. Le point n'est pas un accent décoratif, c'est la marque —
 * et l'animation le dit sans un mot.
 *
 * **Deux tracés, deux temps.** Le point est déjà un tracé distinct dans le
 * fichier, avec sa couleur propre. C'est la seule chose du logotype qui puisse
 * bouger seule : animer les lettres séparément demanderait de découper un tracé
 * unique en quatre, donc de fabriquer un logo qui n'existe pas.
 *
 * **L'alignement est structurel.** Les deux `Marque` superposées partagent la
 * `viewBox` et le repère du fichier : elles retombent l'une sur l'autre sans
 * qu'aucune constante ne l'organise, et à n'importe quelle taille. Une position
 * mesurée en points d'écran dériverait au premier changement d'échelle.
 *
 * **Rien ne se dessine.** Le système n'autorise que l'opacité et la
 * transformation, et ce n'est pas une limite à contourner : un logo qui se
 * dessine raconte sa propre fabrication — c'est un générique, et un générique se
 * regarde une fois. Une marque se pose, et elle peut se poser trente fois sans
 * lasser parce qu'elle n'a rien à raconter.
 *
 * **Aucun rebond.** Un point qui rebondit devient un personnage.
 *
 * **Et rien ne boucle.** Une animation qui tourne en attendant dit « ça rame ».
 * L'entrée se pose et s'arrête ; au-delà du plafond, c'est un état d'attente qui
 * prend le relais — voir `FiletDAttente`.
 */
import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, View } from 'react-native';

import { Marque } from '../components';
import { useMouvementReduit } from '../components/Mouvement';
import { radius, useColors } from '../theme';

/**
 * Ce que l'ouverture dure, et **elle est tenue à chaque lancement**.
 *
 * **C'était un plafond, c'est maintenant un plancher**, et le renversement est
 * délibéré. La règle d'avant — « si l'application est prête à 300 ms, l'écran
 * part à 300 ms » — était juste sur le papier et fausse à l'usage : la session
 * se rétablit en quelques dizaines de millisecondes, si bien que la marque
 * n'était jamais vue. Le point tombait sur un écran déjà remplacé. Une entrée
 * qui ne joue qu'en cas de lenteur n'est pas une entrée, c'est un symptôme.
 *
 * **C'est le seul nombre à toucher pour régler l'ouverture.** Les quatre temps
 * ci-dessous s'y rapportent et le plafond se calcule dessus : le monter suffit
 * à allonger l'entrée sans rien décaler d'autre. Les deux allongements déjà
 * faits sont passés par lui — 560, puis 760, puis 1800.
 */
export const DUREE_DE_L_OUVERTURE = 1800;

/**
 * Le plafond : au-delà, l'attente prend le relais.
 *
 * **Il suit l'ouverture, il ne la borne plus.** Tant que l'entrée était plus
 * courte que lui, le fixer à 800 tenait ; l'ouverture allongée le traverserait,
 * et le filet d'attente se poserait **pendant** l'animation — c'est-à-dire que
 * chaque lancement normal dirait « ça rame ». Il vaut donc l'ouverture plus une
 * marge, et il ne se règle pas séparément.
 *
 * **Six cents millièmes de marge**, parce que le filet répond à une seule
 * question : « est-ce que ça avance encore ». Trop près de l'ouverture il
 * clignote sur des lancements sains ; trop loin, il arrive après qu'on a
 * renoncé.
 */
export const MARGE_AVANT_ATTENTE = 600;
export const PLAFOND_MS = DUREE_DE_L_OUVERTURE + MARGE_AVANT_ATTENTE;

/**
 * L'instant du lancement, figé au chargement du module.
 *
 * **Mesuré une fois, pas à chaque montage.** L'écran de chargement est monté
 * deux fois par ouverture — les fontes, puis le rétablissement de la session —
 * et un plancher compté depuis le montage les additionnerait : l'ouverture
 * durerait le double de ce qu'elle annonce.
 */
const LANCEMENT = Date.now();

/**
 * Vrai quand l'ouverture a eu son temps.
 *
 * Rendu à l'appelant plutôt qu'appliqué ici : c'est la coquille qui décide de
 * ce qu'elle montre, l'écran de chargement ne se retient pas lui-même.
 */
export function useOuvertureTenue(): boolean {
  const [tenue, setTenue] = useState(() => Date.now() - LANCEMENT >= DUREE_DE_L_OUVERTURE);

  useEffect(() => {
    if (tenue) return;
    const reste = DUREE_DE_L_OUVERTURE - (Date.now() - LANCEMENT);
    const minuterie = setTimeout(() => setTenue(true), Math.max(0, reste));
    return () => clearTimeout(minuterie);
  }, [tenue]);

  return tenue;
}

/**
 * Les quatre temps de la direction A.
 *
 * **L'allongement ne va pas dans la chute, et c'est la planche qui l'interdit.**
 * Elle chiffre le défaut des deux côtés : « à 400 ms ça devient sec, à 700 ms ça
 * devient une mascotte ». Un point qui tombe lentement cesse d'être une
 * signature pour devenir un personnage — exactement ce que la direction A
 * cherche à éviter en refusant le rebond. La chute reste donc sous la borne, et
 * ce qui s'allonge est ce qui l'entoure : le noir d'avant, la respiration entre
 * les lettres et le point, et le repos après.
 */
const LETTRES_DEBUT = 200;
const LETTRES_DUREE = 320;
/** L'apparition du point, plus vive que sa chute : il arrive, il ne se pose pas. */
const POINT_APPARITION = 140;
/** Un aller de la barre indéterminée. C'est une boucle, pas une transition. */
const COURSE_DUREE = 1000;
/**
 * Le point part longtemps après que les lettres se sont posées.
 *
 * Les lettres finissent à 520 ; le point n'entre qu'à 720. Ces deux cents
 * millièmes de silence sont ce qui le fait **arriver** au lieu d'accompagner —
 * c'est le seul instant de la direction A où quelque chose manque à l'écran, et
 * c'est lui qui fait remarquer le point quand il vient le combler.
 */
const POINT_DEBUT = 720;
const POINT_DUREE = 620;

/**
 * Ce qui reste une fois le point calé : la marque posée, immobile.
 *
 * **Ce n'est pas du temps mort, c'est la moitié de l'idée.** « Une marque se
 * pose, et elle peut se poser trente fois sans lasser parce qu'elle n'a rien à
 * raconter » : ce qu'on retient d'un logotype n'est pas son entrée, c'est
 * l'image complète qu'on a eu le temps de regarder. Une animation qui s'achève
 * et disparaît dans le même souffle ne laisse rien.
 */
export const REPOS = DUREE_DE_L_OUVERTURE - (POINT_DEBUT + POINT_DUREE);

/** La hauteur du logotype sur cet écran, et la course du point. */
const TAILLE = 34;
/**
 * D'où le point tombe.
 *
 * **Exprimé en hauteurs de logotype et non en pixels.** La course suit
 * l'échelle : à une autre taille, le point tombe d'aussi loin *relativement*, et
 * la chute garde son poids. Une valeur en points d'écran ferait une chute
 * ridicule sur un grand logotype et une chute violente sur un petit.
 */
const CHUTE = TAILLE * 0.9;

export function Chargement({ testID = 'ecran-chargement' }: { testID?: string }) {
  const c = useColors();
  const reduit = useMouvementReduit();
  // **L'attente se constate, elle ne s'anticipe pas.** L'écran ne sait pas
  // combien de temps il vivra ; il pose un rendez-vous au plafond, et si on y
  // est encore, c'est que ça traîne.
  const [tarde, setTarde] = useState(false);

  useEffect(() => {
    const minuterie = setTimeout(() => setTarde(true), PLAFOND_MS);
    return () => clearTimeout(minuterie);
  }, []);

  // **Une valeur par chose qui bouge, et deux seulement.** L'opacité des
  // lettres, la position du point. Le reste est fixe — c'est ce qui rend
  // l'animation tenable sur le fil natif.
  const opaciteDesLettres = useRef(new Animated.Value(reduit ? 1 : 0)).current;
  const chuteDuPoint = useRef(new Animated.Value(reduit ? 0 : -CHUTE)).current;
  const opaciteDuPoint = useRef(new Animated.Value(reduit ? 1 : 0)).current;

  useEffect(() => {
    if (reduit) return;

    const entree = Animated.parallel([
      Animated.sequence([
        Animated.delay(LETTRES_DEBUT),
        Animated.timing(opaciteDesLettres, {
          toValue: 1,
          duration: LETTRES_DUREE,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
      Animated.sequence([
        Animated.delay(POINT_DEBUT),
        Animated.parallel([
          // Le point paraît en entrant : il ne se matérialise pas au-dessus du
          // cadre avant de tomber, il arrive.
          Animated.timing(opaciteDuPoint, {
            toValue: 1,
            duration: POINT_APPARITION,
            useNativeDriver: true,
          }),
          Animated.timing(chuteDuPoint, {
            toValue: 0,
            duration: POINT_DUREE,
            // **Sans rebond, et c'est le seul assouplissement possible.** Un
            // ressort dépasserait sa cible : le point remonterait, et un point
            // qui remonte est un personnage.
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
          }),
        ]),
      ]),
    ]);

    entree.start();
    return () => entree.stop();
  }, [reduit, opaciteDesLettres, opaciteDuPoint, chuteDuPoint]);

  return (
    <View
      testID={testID}
      style={{
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        gap: 20,
        // Encre pleine : c'est la première image, et le logotype blanc y porte
        // 16,71:1.
        backgroundColor: c['bg.inverse'],
      }}
    >
      {/* **Les deux parties superposées, dans la même boîte.** La seconde est
          posée en absolu sur la première : même `viewBox`, même repère, donc
          même place. C'est la superposition qui fait l'alignement, et rien
          d'autre ne le décide. */}
      <View testID={`${testID}-marque`}>
        <Animated.View style={{ opacity: opaciteDesLettres }}>
          <Marque taille={TAILLE} variante="blanc" partie="lettres" testID={`${testID}-lettres`} />
        </Animated.View>
        <Animated.View
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            opacity: opaciteDuPoint,
            transform: [{ translateY: chuteDuPoint }],
          }}
        >
          <Marque taille={TAILLE} variante="blanc" partie="point" testID={`${testID}-point`} />
        </Animated.View>
      </View>

      {/* **Après le plafond seulement.** Le montrer d'emblée ferait de chaque
          ouverture une attente, y compris celles de trois cents
          millisecondes. */}
      {tarde ? <FiletDAttente /> : null}
    </View>
  );
}

/**
 * Ce qui prend le relais quand le réseau traîne au-delà du plafond.
 *
 * **Il ne doit pas ressembler à la marque**, et c'est toute sa raison d'être :
 * si l'attente se dessinait dans le vocabulaire de l'entrée, on ne distinguerait
 * plus « ça s'ouvre » de « ça bloque ». Un filet de deux points qui parcourt une
 * fois par seconde, en `brand.500` — la couleur de surface de la marque, jamais
 * son logotype.
 *
 * **Il n'apparaît qu'après le plafond.** Le montrer d'emblée ferait de chaque
 * ouverture une attente, y compris celles de trois cents millisecondes.
 *
 * **Et sous mouvement réduit, il ne parcourt pas.** Il reste posé, plein
 * largeur : ce qui compte est que l'état soit marqué, pas qu'il bouge. Un
 * balayage imposé à qui a demandé moins de mouvement échangerait une gêne contre
 * une information qu'un trait fixe donne aussi.
 */
export function FiletDAttente({ testID = 'filet-d-attente' }: { testID?: string }) {
  const c = useColors();
  const reduit = useMouvementReduit();
  const course = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (reduit) return;
    const boucle = Animated.loop(
      Animated.timing(course, {
        toValue: 1,
        duration: COURSE_DUREE,
        easing: Easing.inOut(Easing.quad),
        useNativeDriver: true,
      }),
    );
    boucle.start();
    return () => boucle.stop();
  }, [reduit, course]);

  const LARGEUR = 120;
  const PART = 40;

  return (
    <View
      testID={testID}
      style={{
        width: LARGEUR,
        height: 2,
        borderRadius: radius['radius.pill'],
        backgroundColor: c['line.onDark'],
        overflow: 'hidden',
      }}
    >
      <Animated.View
        testID={`${testID}-part`}
        style={{
          width: reduit ? LARGEUR : PART,
          height: 2,
          borderRadius: radius['radius.pill'],
          backgroundColor: c['brand.500'],
          transform: reduit
            ? []
            : [
                {
                  translateX: course.interpolate({
                    inputRange: [0, 1],
                    outputRange: [-PART, LARGEUR],
                  }),
                },
              ],
        }}
      />
    </View>
  );
}
