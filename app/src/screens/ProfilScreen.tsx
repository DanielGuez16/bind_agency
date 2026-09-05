/**
 * Le profil : qui je suis, et ce que j'ai fait.
 *
 * **Il naît de la fusion de deux onglets.** L'audience et les réglages
 * occupaient chacun une place en bas d'écran, sur une barre qui en portait
 * quatre. Or ni l'un ni l'autre n'est un lieu où l'on travaille : on consulte
 * ses chiffres de temps en temps, on change un réglage deux fois par an. Les
 * deux onglets qui coûtaient le plus de place étaient les deux qu'on ouvrait le
 * moins.
 *
 * **Les réglages passent derrière un engrenage, et c'est leur juste rang.** Ce
 * qu'on ouvre deux fois par an n'a pas à porter un nom dans la barre. Ce qui
 * reste visible est ce qui décrit la personne : son visage, son pseudonyme, ce
 * qu'elle a publié, ce qu'elle a mis de côté.
 *
 * **L'audience descend d'un cran, elle ne disparaît pas.** Ses chiffres
 * expliquent quels paliers s'ouvrent — c'est une lecture, pas une identité, et
 * elle se pose donc sous le profil plutôt qu'à sa place.
 */
import { Pressable, View } from 'react-native';

import { useApi, type AudienceDuCompte, type MonProfilDeclare } from '../api';
import { EnTeteDEcran, Icone, Photo, SkeletonLignes, Texte } from '../components';
import { formatNumber } from '../format';
import { useI18n } from '../i18n';
import { radius, useColors } from '../theme';
import { Ecran } from './Ecran';
import { MaDeclaration } from './profil/MaDeclaration';
import { useRequete } from './useRequete';

/** Le compte qui représente la créatrice : celui qui porte le plus d'abonnés. */
export function compteDeTete(comptes: AudienceDuCompte[]): AudienceDuCompte | null {
  // **Le plus suivi, et non le premier rattaché.** L'ordre de rattachement est
  // un accident de parcours ; c'est le compte le plus suivi qu'un salon regarde,
  // et donc celui qui la nomme.
  return (
    [...comptes].sort((a, b) => (b.followers_count ?? -1) - (a.followers_count ?? -1))[0] ?? null
  );
}

export function ProfilScreen({
  onReglages,
  onMesPublications,
  onFavoris,
  onMonAudience,
}: {
  onReglages: () => void;
  onMesPublications: () => void;
  onFavoris: () => void;
  onMonAudience: () => void;
}) {
  const { api } = useApi();
  const { t } = useI18n();
  const c = useColors();

  /**
   * L'audience, et **combien de favoris attendent derrière leur porte**.
   *
   * **Ensemble, en un seul cycle d'attente.** Deux `useRequete` feraient deux
   * squelettes et deux erreurs possibles sur un écran qui n'a qu'un état.
   *
   * **Le compte ne bloque pas le profil.** Il situe, il ne conditionne rien :
   * si sa route échoue, la rangée se tait et les portes restent ouvertes. Un
   * profil qui refuserait de s'afficher parce qu'on n'a pas su compter des
   * favoris serait le défaut qu'on vient de corriger ailleurs, à l'envers.
   *
   * **Le même nombre que la pastille du fil**, et par la même source : la
   * route rend la liste entière, sans plafond, donc sa longueur est le total
   * que `fil.favoris_total` annonce. Deux façons de compter la même chose
   * finiraient par diverger.
   */
  const requete = useRequete<{
    comptes: AudienceDuCompte[];
    favoris: number | null;
    declare: MonProfilDeclare | null;
  }>(
    async (signal) => {
      // **Le profil déclaré ne bloque pas l'écran non plus.** Même règle que
      // le compte de favoris juste à côté : s'il échoue, la section se tait et
      // le reste s'affiche. Un pseudonyme et une audience valent un écran ;
      // une bio manquante ne vaut pas un écran d'erreur.
      const [comptes, favoris, declare] = await Promise.all([
        api.monAudience(signal),
        api.mesFavoris(signal).then((liste) => liste.length).catch(() => null),
        api.monProfil(signal).catch(() => null),
      ]);
      return { comptes, favoris, declare };
    },
    {
      // **Jamais vide.** Une créatrice sans réseau rattaché a quand même un
      // profil : ses favoris et ses réglages vivent ici. Rendre l'état vide
      // fermerait la porte des réglages à qui n'a pas encore branché de compte.
      estVide: () => false,
    },
  );

  return (
    <Ecran
      requete={requete}
      titre={t('profil.titre')}
      squelette={<SkeletonLignes combien={4} testID="squelette-profil" />}
      testID="ecran-profil"
      entete={
        <EnTeteDEcran
          titre={t('profil.titre')}
          droite={
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('profil.ouvrirLesReglages')}
              onPress={onReglages}
              // La cible fait quarante-quatre points : un engrenage de vingt
              // dessiné sans marge se rate une fois sur trois en haut d'écran.
              style={({ pressed }) => ({
                minWidth: 44,
                minHeight: 44,
                alignItems: 'center',
                justifyContent: 'center',
                opacity: pressed ? 0.7 : 1,
              })}
              testID="ouvrir-les-reglages"
            >
              <Icone nom="reglages" taille={22} couleur="ink.soft" />
            </Pressable>
          }
          testID="entete-du-profil"
        />
      }
    >
      {({ comptes, favoris, declare }) => {
        const tete = compteDeTete(comptes);
        const photo = tete?.avatar_key ? api.urlDeLaVignette(tete.avatar_key) : null;

        return (
          <View style={{ gap: 16 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              {photo ? (
                <Photo uri={photo} hauteur={72} style={{ width: 72 }} testID="photo-du-profil" />
              ) : (
                // **Un rond vide plutôt qu'une initiale inventée.** Un
                // pseudonyme n'a pas d'initiale qui veuille dire quelque chose,
                // et le manque se signale mieux qu'un caractère plausible.
                <View
                  testID="photo-du-profil-absente"
                  style={{
                    width: 72,
                    height: 72,
                    borderRadius: radius['radius.pill'],
                    backgroundColor: c['bg.inset'],
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Icone nom="personne" taille={24} couleur="ink.soft" />
                </View>
              )}
              <View style={{ flexShrink: 1, gap: 2 }}>
                <Texte variante="type.heading" testID="nom-du-profil">
                  {tete?.handle ?? t('profil.sansPseudonyme')}
                </Texte>
                {tete?.followers_count !== null && tete?.followers_count !== undefined ? (
                  <Texte variante="type.caption" couleur="ink.soft" testID="abonnes-du-profil">
                    {t('profil.abonnes', { n: String(tete.followers_count) })}
                  </Texte>
                ) : null}
              </View>
            </View>

            {/* **Entre l'identité et les portes.** Ce qu'on a déclaré
                appartient à la présentation, pas à la navigation : le poser
                sous les trois destinations l'aurait rangé parmi des boutons.
                Se tait entièrement si sa route a échoué. */}
            {declare ? (
              <MaDeclaration bio={declare.bio} interets={declare.interests} />
            ) : null}

            <View style={{ gap: 2 }}>
              <Ligne
                titre={t('profil.mesPublications')}
                onPress={onMesPublications}
                testID="vers-mes-publications"
              />
              <Ligne
                titre={t('profil.favoris')}
                compte={favoris ?? undefined}
                onPress={onFavoris}
                testID="vers-les-favoris"
              />
              <Ligne
                titre={t('profil.monAudience')}
                onPress={onMonAudience}
                dernier
                testID="vers-mon-audience"
              />
            </View>
          </View>
        );
      }}
    </Ecran>
  );
}

/** Une destination du profil. Le chevron dit qu'il y a un écran derrière. */
function Ligne({
  titre,
  compte,
  onPress,
  dernier,
  testID,
}: {
  titre: string;
  /**
   * Combien il y a derrière la porte. Absent : la rangée se tait.
   *
   * **Et zéro se tait aussi.** Une rangée qui affiche « 0 » apprend à ne plus
   * regarder le chiffre — c'est la règle que la pastille du fil applique déjà
   * pour le même nombre. Le titre suffit alors : la porte reste ouverte, elle
   * ne promet simplement rien.
   */
  compte?: number;
  onPress: () => void;
  dernier?: boolean;
  testID: string;
}) {
  const { locale } = useI18n();
  const c = useColors();
  const chiffre = compte !== undefined && compte > 0 ? formatNumber(compte, locale) : null;
  return (
    <Pressable
      accessibilityRole="button"
      // **Le compte entre dans le nom du bouton.** Un chiffre posé à côté d'un
      // libellé n'existe pas pour un lecteur d'écran, et c'est précisément
      // l'information qui évite d'ouvrir pour rien.
      accessibilityLabel={chiffre === null ? titre : `${titre} — ${chiffre}`}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        minHeight: 56,
        opacity: pressed ? 0.7 : 1,
        borderBottomWidth: dernier ? 0 : 1,
        borderBottomColor: c['line.default'],
      })}
    >
      <Texte variante="type.body" style={{ flex: 1, minWidth: 0 }}>
        {titre}
      </Texte>
      {chiffre === null ? null : (
        <Texte variante="type.label" couleur="ink.soft" testID={`${testID}-compte`}>
          {chiffre}
        </Texte>
      )}
      <Icone nom="chevron" couleur="ink.soft" taille={20} />
    </Pressable>
  );
}
