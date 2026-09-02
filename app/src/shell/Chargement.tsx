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
 * Le plafond de l'écran, repos compris. **Un plafond, plus un plancher.**
 *
 * **Ce qui se perçoit est le mouvement, jamais le repos**, et c'est la cause
 * que Design a fini par trouver. Un écran où plus rien ne bouge n'est pas perçu
 * comme *durant*, il est perçu comme *fini* : la mémoire estime une séquence à
 * sa densité d'événements, pas à son temps d'horloge. 760 ms de mouvement
 * suivis de 1 240 d'immobilité se souvenaient comme 760, et le repos ajouté se
 * lisait comme une attente.
 *
 * **J'avais donc allongé la seule chose qui ne se voit pas.** Deux fois : en
 * étirant les temps du mouvement au-delà de leur borne, puis en gonflant le
 * repos. Le mouvement est réétalé à sa place — l'entrée des lettres ralentie de
 * moitié, la chute portée à 660 sous le plafond de 700, plus un fondu de sortie
 * qui est du mouvement lui aussi.
 *
 * **Et le repos redevient ce qu'il est : de la marge.** Si l'application est
 * prête avant, l'écran part avant — le repos se coupe, jamais le mouvement.
 * C'est pourquoi ce nombre est un plafond et `MOUVEMENT` un plancher, ce qui
 * renverse une seconde fois le sens de cette constante.
 *
 * **Porté de 2 400 à 4 800 le 2026-09-01, et ce que cela change est étroit.**
 * L'ouverture restait jugée trop courte. Mais ce plafond ne se joue que si
 * l'application **n'est pas prête** : prête, l'écran cède à `MOUVEMENT`, et
 * `peutCeder(MOUVEMENT, true)` le dit noir sur blanc. Le doubler allonge donc
 * l'ouverture d'un démarrage lent, jamais celle d'un démarrage tiède.
 *
 * Ce qui se ressent reste le mouvement, et il est borné ailleurs : la chute du
 * point tient sous les 700 ms qui la séparent d'une mascotte. Rallonger le
 * ressenti demanderait donc de reprendre le mouvement avec Design, pas de
 * pousser ce nombre — et c'est pour cela qu'il est écrit ici plutôt que
 * découvert deux fois.
 */
export const DUREE_DE_L_OUVERTURE = 4800;

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
 * Vrai quand l'écran de marque peut céder la place.
 *
 * **Deux bornes, dans cet ordre, et l'ordre est la règle.** Le mouvement va au
 * bout, toujours : il est ce qu'on perçoit, l'interrompre revient à n'avoir rien
 * joué. Au-delà, il ne reste que du repos, et le repos se coupe dès que
 * l'application est prête. Elle ne l'est pas au bout de `DUREE_DE_L_OUVERTURE` :
 * on part quand même, l'attente prend le relais et ne ressemble pas à la marque.
 *
 * `pret` est rendu par l'appelant : la coquille sait ce qu'elle attend — ses
 * fontes, sa session — et l'écran de chargement n'a pas à le deviner.
 */
export function useOuvertureTenue(pret: boolean): boolean {
  const [tenue, setTenue] = useState(false);

  useEffect(() => {
    if (tenue) return;
    const ecoule = Date.now() - LANCEMENT;
    if (peutCeder(ecoule, pret)) {
      setTenue(true);
      return;
    }
    const minuterie = setTimeout(() => setTenue(true), prochainRendezVous(ecoule));
    return () => clearTimeout(minuterie);
  }, [pret, tenue]);

  return tenue;
}

/**
 * La règle, seule et sans horloge. **Deux bornes, dans cet ordre.**
 *
 * Extraite du crochet parce que c'est elle qu'on veut éprouver : une ouverture
 * qui rendrait la main trop tôt ressemble à une ouverture rapide, pas à une
 * animation coupée, et rien à l'écran ne les distingue. Montée, elle
 * demanderait de figer l'instant du lancement — qui l'est à l'import, donc
 * après plusieurs secondes de temps réel en suite de tests.
 */
export function peutCeder(ecoule: number, pret: boolean): boolean {
  // Le mouvement va au bout, toujours : il est ce qu'on perçoit, l'interrompre
  // revient à n'avoir rien joué.
  if (ecoule < MOUVEMENT) return false;
  // Au-delà il ne reste que du repos, et le repos se coupe dès qu'il n'y a plus
  // rien à attendre. Au bout du plafond on part de toute façon, et l'attente
  // prend le relais — elle ne ressemble pas à la marque.
  return pret || ecoule >= DUREE_DE_L_OUVERTURE;
}

/** Quand se reposer la question, au plus tôt. */
function prochainRendezVous(ecoule: number): number {
  return ecoule < MOUVEMENT ? MOUVEMENT - ecoule : DUREE_DE_L_OUVERTURE - ecoule;
}

/**
 * Les temps de la direction A, **réétalés par la planche**.
 *
 * 0 encre pleine · 240 les lettres montent · 520 elles sont posées, le point
 * entre par le haut · il descend · 1 180 il cale à sa place · puis le fondu de
 * sortie, qui est du mouvement et compte dans le perçu.
 *
 * **L'entrée est ralentie de moitié et la chute portée à 660.** Elle occupait
 * 500 ms sur les 760 du mouvement d'avant, et n'était donc pas au bout de sa
 * marge : 660 reste sous le plafond de 700 qui la sépare d'une mascotte, et
 * au-dessus des 400 où elle devient sèche.
 */
const LETTRES_DEBUT = 240;
const LETTRES_DUREE = 280;
/** L'apparition du point, plus vive que sa chute : il arrive, il ne se pose pas. */
const POINT_APPARITION = 180;
/** Un aller de la barre indéterminée. C'est une boucle, pas une transition. */
const COURSE_DUREE = 1000;
const POINT_DEBUT = 520;
const POINT_DUREE = 660;

/**
 * Le fondu de sortie. **C'est du mouvement, et il compte dans le perçu.**
 *
 * Une marque qui disparaît d'un coup se termine sans se terminer : la coupure
 * franche est le seul instant de la séquence qu'on ne peut pas attribuer à la
 * marque, donc le seul qui ne lui profite pas.
 */
export const FONDU_DE_SORTIE = 320;

/**
 * Quand le mouvement s'arrête, fondu compris : **1 500 ms**.
 *
 * **C'est le plancher de l'écran, et la seule durée qui se ressent.** Contre
 * 760 auparavant : la durée perçue double sans qu'on touche au repos. Une garde
 * le tient — il ne suit pas `DUREE_DE_L_OUVERTURE`, et il ne la dépasse pas.
 */
export const MOUVEMENT = POINT_DEBUT + POINT_DUREE + FONDU_DE_SORTIE;

/**
 * Le plafond : au-delà, l'attente prend le relais.
 *
 * **Il vaut le mouvement, exactement.** L'entrée se pose et s'arrête ; si l'on
 * est encore là, c'est que ça traîne, et c'est le filet qui le dit — jamais la
 * marque, qui ne boucle pas. Le placer plus loin laisserait un écran noir muet
 * entre la fin du fondu et lui.
 */
export const PLAFOND_MS = MOUVEMENT;

/**
 * La marge au-dessus du mouvement : **du repos, et rien de plus**.
 *
 * Il ne se joue que si l'application n'est pas prête, et il se coupe dès
 * qu'elle l'est. On ne le compte plus comme de la durée — il ne s'en perçoit
 * rien — mais il reste borné : trois secondes trois, au-delà desquelles on part
 * de toute façon. **Dérivé, jamais écrit à la main** : le plafond bouge, la
 * marge suit, et les deux ne peuvent pas se contredire.
 */
export const REPOS = DUREE_DE_L_OUVERTURE - MOUVEMENT;

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
  // **La troisième valeur, et elle sort au lieu d'entrer.** Le fondu de sortie
  // est du mouvement : il compte dans ce qu'on perçoit de la marque, et une
  // coupure franche serait le seul instant de la séquence qui ne lui profite
  // pas.
  const sortie = useRef(new Animated.Value(1)).current;

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
      // Le fondu enchaîne sur la chute, sans attendre : le repos, quand il a
      // lieu, se joue **après** le mouvement — c'est la marge, pas la marque.
      Animated.sequence([
        Animated.delay(POINT_DEBUT + POINT_DUREE),
        Animated.timing(sortie, {
          toValue: 0,
          duration: FONDU_DE_SORTIE,
          easing: Easing.in(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    ]);

    entree.start();
    return () => entree.stop();
  }, [reduit, opaciteDesLettres, opaciteDuPoint, chuteDuPoint, sortie]);

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
      <Animated.View testID={`${testID}-marque`} style={{ opacity: sortie }}>
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
      </Animated.View>

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
