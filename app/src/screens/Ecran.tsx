/**
 * L'enveloppe d'un écran, et le rendu de ses quatre états.
 *
 * Un écran décrit ce qu'il montre quand tout va bien, et fournit trois
 * descriptions courtes pour le reste. Il n'écrit pas la mécanique : c'est ce
 * qui garantit que les quatre états existent partout, y compris sur l'écran
 * qu'on a écrit un vendredi.
 *
 * **Une donnée périmée s'affiche datée plutôt que masquée.** Quand un
 * rechargement échoue mais qu'on avait déjà quelque chose, l'écran montre ce
 * qu'il avait, avec un bandeau qui dit depuis quand. Masquer reviendrait à
 * effacer une information juste parce qu'elle a vieilli.
 *
 * **Le liseré du rôle est ici**, pas dans chaque écran : 3 px en haut. C'est le
 * seul repère qui distingue les deux applications quand un téléphone passe de
 * main en main au comptoir — et il est le seul, parce qu'en compact il n'y a
 * pas de barre latérale pour porter la matière du rôle.
 *
 * **Il ne porte plus de teinte.** La v1.0 supprime `role.merchant` ; ce qui
 * reste est la matière du rôle, dont ce filet prend la ligne : sourde et chaude
 * pour le commerce, encre pour l'administration, rien pour la créatrice, dont
 * la matière est le papier — c'est-à-dire l'absence de marque.
 */
import type { ReactNode } from 'react';
import { Animated, FlatList, Pressable, RefreshControl, ScrollView, View } from 'react-native';

import {
  Button,
  EmptyState,
  Icone,
  SkeletonLignes,
  StatusMessage,
  Texte,
  useAttenteVisible,
  useRecomposition,
} from '../components';
import { useI18n, type SupportedLocale } from '../i18n';
import { formatDate } from '../format';
import { BarreDeTitre } from '../shell/BarreDeTitre';
import { useGabarit, largeurMaximale, type NatureDeContenu } from '../shell/gabarit';
import { useApi } from '../api';
import { useTheme } from '../theme';
import type { Requete } from './useRequete';

export type EcranProps<T> = {
  requete: Requete<T>;
  /** Le titre, déjà traduit par l'appelant. Ignoré si `entete` est fourni. */
  titre?: string;
  /**
   * La seconde ligne de la barre de titre, quand le titre ne nomme plus
   * l'écran mais compte ce qu'il attend de vous. Voir `BarreDeTitre`.
   *
   * Rendue seulement en grand écran, comme le titre : en compact, le titre
   * vit dans le flux et une sous-ligne s'y ajouterait à la place du contenu.
   */
  sousTitre?: string | null;
  /**
   * L'en-tête complet, quand l'écran a mieux à offrir qu'un titre : une
   * salutation, des compteurs, la marque. Il est rendu avant le corps et **hors
   * des quatre états** — un écran en chargement garde son en-tête, sinon la
   * page saute à chaque rafraîchissement.
   */
  entete?: ReactNode;
  /**
   * Le retour, quand l'écran naît d'un autre.
   *
   * Ici et non dans chaque écran : un écran de pile sans retour ne se quitte
   * qu'en changeant d'onglet, et le geste de balayage n'existe pas sur le web.
   */
  onRetour?: () => void;
  /** « il y a 2 h ». Rendue dans la barre de titre, sur grand écran. */
  fraicheur?: string | null;
  /**
   * Ce que l'écran est, pour savoir jusqu'où son contenu s'étend. Déduit du
   * rôle par défaut ; un écran en deux colonnes doit le dire, sa liste et son
   * détail ne tiennent pas dans la borne du détail seul.
   */
  nature?: NatureDeContenu;
  /** Ce que l'écran montre quand tout va bien. */
  children: (donnees: T) => ReactNode;
  /**
   * Le corps rendu en **liste virtualisée** plutôt qu'en bloc défilant.
   *
   * **Pour un écran dont le contenu monte des images par dizaines.** Le mur
   * rendait toutes ses rangées d'un coup — un `ScrollView` et un `.map` — donc
   * quatre-vingts `Image` montées à la première image du fil, sur un fil de
   * vingt salons. Le poids du réseau a été réglé ailleurs ; ce qui reste est le
   * décodage, que `Image` fait avant de réduire et qui ne dépend pas du cadre.
   *
   * **Le corps seul passe en liste.** Les états de chargement, d'erreur et de
   * vide restent dans le défileur ordinaire : ils tiennent en un écran, et leur
   * donner deux chemins de rendu doublerait ce qu'il faut vérifier pour rien.
   *
   * Les éléments portent un `ReactNode` déjà construit. C'est un **descripteur**,
   * pas un rendu : la fonction du composant ne s'exécute — et son image ne se
   * monte — que lorsque la liste décide d'afficher la rangée. Construire les
   * descripteurs en avance ne coûte que leur allocation.
   */
  liste?: (donnees: T) => {
    elements: readonly { cle: string; rendu: ReactNode }[];
    /** Ce qui précède la liste et défile avec elle. */
    entete?: ReactNode;
    /** Ce qui la suit. */
    pied?: ReactNode;
    /**
     * Le repère du défileur, quand l'écran en avait déjà un pour son bloc.
     *
     * Le mur portait `le-mur` sur le conteneur qui tenait ses rangées ; en
     * liste, c'est le défileur qui les tient. Le lui donner garde le repère
     * attaché à la même chose — et ce que les tests vérifient dessus, les
     * marges à fond perdu par exemple, reste vrai du même nœud.
     */
    testID?: string;
  };
  /** Le squelette. À défaut, trois cartes à la géométrie du contenu. */
  squelette?: ReactNode;
  /** L'état vide. Jamais un cul-de-sac : chaque issue annonce son gain. */
  vide?: ReactNode;
  /**
   * L'écran prend toute la largeur, et pose lui-même ses marges latérales.
   *
   * **Pour le mur, et pour lui seul jusqu'ici.** Ses photos vont à fond perdu :
   * encadrées de vingt points, elles perdent la moitié de leur effet, et les
   * cartes des rangées cessent de dépasser le bord — c'est ce dépassement qui
   * annonce le glissement horizontal, sans flèche.
   *
   * **La règle qui en sort : `Ecran` marge ce qu'il compose, l'appelant marge
   * ce qu'il fournit.** Le bandeau d'erreur et le squelette par défaut sont
   * écrits ici, donc ils gardent leur marge même à fond perdu ; l'en-tête, le
   * corps, l'état vide et un squelette fourni viennent de l'écran, qui sait
   * lesquels de ses blocs touchent le bord. Une marge négative aurait été plus
   * courte à écrire et se serait fait rogner par le défileur sur un téléphone,
   * où le conteneur occupe déjà toute la largeur.
   */
  bordAbord?: boolean;
  testID?: string;
};

export function Ecran<T>({
  requete,
  titre,
  sousTitre,
  entete,
  onRetour,
  fraicheur,
  nature,
  children,
  liste,
  squelette,
  vide,
  bordAbord = false,
  testID,
}: EcranProps<T>) {
  const { color: c, role, density, matiere } = useTheme();
  const { large } = useGabarit();
  const { t } = useI18n();
  const { messageDErreur } = useApi();

  const attenteVisible = useAttenteVisible(requete.etat === 'chargement');
  // `useRequete` garde déjà les données pendant un rechargement et le signale :
  // la liste reste montée, il ne manquait que de le montrer.
  const recomposition = useRecomposition(
    requete.etat === 'pret' && requete.rechargement === true,
  );

  const margeLaterale = large ? density.screenPaddingLarge : density.screenPadding;
  /** Ce qu'`Ecran` compose lui-même garde sa marge, même à fond perdu. */
  const margeDeSecours = bordAbord ? { paddingHorizontal: margeLaterale } : null;

  const corps = (() => {
    if (requete.etat === 'chargement') {
      // **Rien ne clignote sous quatre cents millisecondes.** Un squelette qui
      // apparaît et s'en va en deux cents millisecondes est un défaut visuel,
      // pas une information — et il produit exactement ce qu'il prétend
      // soigner : l'écran saute, donc on doute de ce qu'on vient de faire.
      //
      // La vue reste montée et vide pendant le seuil : ce n'est pas un blanc,
      // c'est ce qu'il y avait déjà, et sur une seconde ouverture il y a même
      // l'en-tête, qui vit hors des quatre états.
      if (!attenteVisible) return <View testID="etat-chargement" />;
      return (
        <View testID="etat-chargement" style={[{ gap: density.gap }, squelette ? null : margeDeSecours]}>
          {squelette ?? (
            // **Le défaut ne promet plus rien de précis, et c'est le progrès.**
            // Il promettait une carte à photo — la géométrie de `BusinessCard`,
            // juste sur le fil et fausse partout ailleurs. Le fil ne rend plus
            // de cartes et `BusinessCard` est retirée : un défaut qui aurait
            // continué d'annoncer sa forme aurait annoncé une composition que
            // plus aucun écran ne porte. Des lignes de texte ne ressemblent à
            // rien en particulier, ce qui est exactement ce qu'on sait d'un
            // écran qui n'a pas déclaré sa silhouette.
            //
            // Nommé quand même : une garde vérifie que chaque écran déclare la
            // sienne, et elle a besoin de reconnaître le défaut pour dire qu'il
            // ne sert nulle part.
            <SkeletonLignes testID="squelette-par-defaut" />
          )}
        </View>
      );
    }

    if (requete.etat === 'erreur') {
      return (
        <View testID="etat-erreur" style={[{ gap: density.gap }, margeDeSecours]}>
          <StatusMessage
            level="danger"
            title={t('etats.erreurTitre')}
            body={messageDErreur(requete.erreur)}
            action={{ label: t('common.retry'), onPress: requete.recharger, variant: 'secondary' }}
          />
          {/* Ce qu'on avait, daté. L'effacer punirait l'utilisateur d'une
              panne qui ne le concerne pas. */}
          {requete.donnees !== null ? (
            <>
              <Texte variante="type.caption" couleur="ink.mute">
                {t('etats.vuA', { quand: quand(t, requete.vuA) })}
              </Texte>
              {children(requete.donnees)}
            </>
          ) : null}
        </View>
      );
    }

    if (requete.vide) {
      return (
        <View testID="etat-vide" style={vide ? null : margeDeSecours}>
          {vide ?? (
            <EmptyState title={t('etats.videTitre')} body={t('etats.videCorps')} />
          )}
        </View>
      );
    }

    return (
      // **L'ancienne liste s'atténue, elle ne se vide pas.** Vider avant de
      // remplir fait clignoter l'écran et perdre le repère du doigt : à
      // vingt-cinq pour cent elle reste lisible, et ce qu'on voit est une liste
      // qui se remplace plutôt qu'un voyant qui s'allume.
      //
      // **Le seuil des quatre cents millisecondes ne s'applique pas ici.** Ce
      // n'est pas un indicateur d'attente, c'est la réponse au geste — au même
      // titre que l'enfoncement d'un bouton. L'attendre ferait exactement ce
      // que la règle 1 veut éviter : un écran qui ne répond pas, donc un doute,
      // donc un second appui.
      <Animated.View testID="etat-nominal" style={[{ gap: density.gap }, recomposition.style]}>
        {children(requete.donnees)}
      </Animated.View>
    );
  })();

  /**
   * Ce qui précède le corps et défile avec lui : le retour en compact, puis
   * l'en-tête ou le titre. Écrit une fois, posé dans les deux chemins de rendu
   * — sans quoi le mode liste perdrait son retour, et personne ne s'en
   * apercevrait avant de s'y trouver coincé.
   */
  const enTeteDefilante = (
    <>
      {/* En grand, le retour vit dans la barre de titre, fixe : ici il
          défilerait hors de l'écran dès la troisième ligne. */}
      {onRetour && !large ? (
        <Pressable
          onPress={onRetour}
          accessibilityRole="button"
          accessibilityLabel={t('common.retour')}
          hitSlop={12}
          style={({ pressed }) => ({
            flexDirection: 'row',
            alignItems: 'center',
            gap: 4,
            alignSelf: 'flex-start',
            marginHorizontal: bordAbord ? margeLaterale : 0,
            opacity: pressed ? 0.7 : 1,
          })}
          testID="retour"
        >
          <Icone nom="retour" couleur="ink.soft" taille={18} />
          <Texte variante="type.label" couleur="ink.soft">
            {t('common.retour')}
          </Texte>
        </Pressable>
      ) : null}
      {/* **Le titre ne s'écrit pas deux fois.** En grand il vit dans la barre
          de titre, fixe ; le répéter dans le flux donnait « Today » au-dessus
          de « Today ». Un en-tête fourni par l'écran, lui, reste : il porte
          autre chose que le nom. */}
      {entete ??
        (titre && !large ? (
          <Texte variante="type.screenTitle" style={margeDeSecours}>
            {titre}
          </Texte>
        ) : null)}
    </>
  );

  const conteneur = {
    // **Un cran de densité en grand écran.** Le padding valait celui du
    // téléphone à toute largeur, et le commerce — calibré pour un appareil posé
    // au comptoir — était donc le plus serré des deux rôles sur un bureau de
    // 1512. C'est l'inverse de ce qu'une grande surface demande.
    paddingVertical: margeLaterale,
    paddingHorizontal: bordAbord ? 0 : margeLaterale,
    gap: large ? density.gapLarge : density.gap,
    maxWidth: largeurMaximale(nature ?? (role === 'creator' ? 'creator' : 'merchant'), large),
    width: '100%' as const,
    alignSelf: 'center' as const,
  };

  const rafraichissement = (
    <RefreshControl
      refreshing={requete.etat === 'pret' && requete.rechargement}
      onRefresh={requete.recharger}
      tintColor={c['ink.soft']}
    />
  );

  /**
   * Le corps en liste, quand l'écran l'a demandé **et** que les données sont
   * là. Les trois autres états restent dans le défileur : ils tiennent en un
   * écran, et leur donner deux chemins doublerait ce qu'il faut vérifier.
   */
  const enListe = liste && requete.etat === 'pret' && !requete.vide ? liste(requete.donnees) : null;

  return (
    <View testID={testID} style={{ flex: 1, backgroundColor: c['bg.page'] }}>
      {/* Le liseré du rôle. Trois pixels, une seule fois, ici. */}
      {role === 'creator' ? null : (
        <View
          testID={role === 'merchant' ? 'lisere-commerce' : 'lisere-administration'}
          style={{ height: 3, backgroundColor: c[matiere.ligne] }}
        />
      )}
      {large ? (
        <BarreDeTitre
          titre={titre ?? ''}
          sousTitre={sousTitre}
          onRetour={onRetour}
          fraicheur={fraicheur}
        />
      ) : null}
      {enListe ? (
        // **L'état nominal garde son repère.** Il ne tient pas sur le défileur,
        // qui porte déjà celui de l'écran ; et sans lui, la table des quatre
        // états ne verrait plus le fil en état nominal. Sans marge ni fond : ce
        // nœud existe pour être nommé, pas pour se voir.
        <View testID="etat-nominal" style={{ flex: 1 }}>
        <FlatList
          testID={enListe.testID ?? 'corps-en-liste'}
          data={enListe.elements}
          keyExtractor={(element) => element.cle}
          renderItem={({ item }) => <>{item.rendu}</>}
          ListHeaderComponent={
            <>
              {enTeteDefilante}
              {enListe.entete}
            </>
          }
          ListFooterComponent={<>{enListe.pied}</>}
          contentContainerStyle={conteneur}
          refreshControl={rafraichissement}
          // **Le nombre de rangées montées d'avance, et pourquoi celui-là.**
          // Une rangée du mur fait deux aperçus de 100 points d'image ; dix
          // remplissent largement l'écran le plus haut, et en garder autant de
          // part et d'autre laisse le défilement rapide sans montrer de blanc.
          // Plus haut, on remonte vers le comportement d'avant.
          initialNumToRender={6}
          windowSize={5}
          removeClippedSubviews
        />
        </View>
      ) : (
      <ScrollView
        contentContainerStyle={conteneur}
        refreshControl={rafraichissement}
      >
        {enTeteDefilante}
        {corps}
      </ScrollView>
      )}
    </View>
  );
}

/**
 * « il y a 2 h ». Jamais une date seule sur une fraîcheur.
 *
 * Une date brute demande de calculer ; ce qu'on veut savoir est si c'est vieux,
 * pas quand c'était. Au-delà d'un jour, on bascule sur la date : « il y a
 * 37 h » ne se lit plus.
 */
export function quand(
  t: (cle: string, params?: Record<string, unknown>) => string,
  instant: number | null,
  locale: SupportedLocale = 'en',
): string {
  if (instant === null) return '';
  const minutes = Math.max(0, Math.round((Date.now() - instant) / 60_000));
  if (minutes < 1) return t('etats.instantMaintenant');
  if (minutes < 60) return t('etats.instantMinutes', { count: minutes });
  const heures = Math.round(minutes / 60);
  if (heures < 24) return t('etats.instantHeures', { count: heures });
  // Mois en lettres. `toLocaleDateString` rendait « 8/11/2026 », qui se lit
  // dans deux ordres selon d'où l'on vient.
  return formatDate(new Date(instant).toISOString(), locale, 'UTC');
}

/** Un bouton de réessai isolé, pour les écrans qui n'utilisent pas `Ecran`. */
export function Reessayer({ onPress }: { onPress: () => void }) {
  const { t } = useI18n();
  return <Button label={t('common.retry')} variant="secondary" onPress={onPress} />;
}
