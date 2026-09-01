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

import { useApi, type AudienceDuCompte } from '../api';
import { EnTeteDEcran, Icone, Photo, SkeletonLignes, Texte } from '../components';
import { useI18n } from '../i18n';
import { radius, useColors } from '../theme';
import { Ecran } from './Ecran';
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

  const requete = useRequete<AudienceDuCompte[]>((signal) => api.monAudience(signal), {
    // **Jamais vide.** Une créatrice sans réseau rattaché a quand même un
    // profil : ses favoris et ses réglages vivent ici. Rendre l'état vide
    // fermerait la porte des réglages à qui n'a pas encore branché de compte.
    estVide: () => false,
  });

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
      {(comptes) => {
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

            <View style={{ gap: 2 }}>
              <Ligne
                titre={t('profil.mesPublications')}
                onPress={onMesPublications}
                testID="vers-mes-publications"
              />
              <Ligne
                titre={t('profil.favoris')}
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
  onPress,
  dernier,
  testID,
}: {
  titre: string;
  onPress: () => void;
  dernier?: boolean;
  testID: string;
}) {
  const c = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={titre}
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
      <Icone nom="chevron" couleur="ink.soft" taille={20} />
    </Pressable>
  );
}
