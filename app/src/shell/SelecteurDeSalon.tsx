/**
 * Choisir entre deux salons.
 *
 * **Il ne se rend qu'à partir de deux.** Un sélecteur qui n'offre aucun choix
 * occupe la place et fait douter : c'est la même règle que le bouton qu'on
 * retire plutôt que de le griser. Avec un seul salon, le nom reste ce qu'il
 * était — une ligne qui situe la session.
 *
 * **Le salon courant est marqué, pas retiré de la liste.** Le retirer ferait
 * lire la liste comme « les autres », et on ne saurait plus lequel on regarde
 * en l'ouvrant. La coche dit où l'on est ; les lignes disent où l'on peut
 * aller.
 *
 * **Le quartier identifie, pas le nom.** Deux salons d'une enseigne portent le
 * même nom : « Vela Nail Studio » deux fois ne distingue rien. Le quartier prend
 * donc le gras et passe au-dessus, le nom d'enseigne descend en second. Hors des
 * quartiers ouverts il n'y en a pas — l'adresse prend alors le relais, et à
 * défaut le nom remonte, parce qu'une ligne sans titre ne se presse pas.
 *
 * **L'adresse est la seconde ligne**, et non une décoration : c'est ce qui
 * distingue deux salons d'un même quartier, cas que rien n'interdit.
 */
import { Pressable, View } from 'react-native';

import { Filet, Icone, Texte } from '../components';
import { useI18n } from '../i18n';
import { radius, useColors } from '../theme';

export type SalonAChoisir = {
  id: string;
  name: string;
  neighborhood?: string | null;
  address?: string | null;
};

/**
 * Ce qui identifie un salon dans la liste, et ce qui le situe.
 *
 * Pure et exportée : la règle de repli — quartier, puis adresse, puis nom — se
 * lit sans monter d'écran, et c'est elle qu'on éprouve.
 */
export function identiteDuSalon(
  salon: SalonAChoisir,
  t: (cle: string) => string,
): { titre: string; dessous: string | null } {
  if (salon.neighborhood) {
    return { titre: t(`quartiers.${salon.neighborhood}`), dessous: salon.name };
  }
  // Sans quartier, l'adresse identifie mieux que le nom — mais elle ne peut
  // pas titrer : une rue en gras se lit comme une consigne, pas comme un lieu.
  if (salon.address) return { titre: salon.name, dessous: salon.address };
  return { titre: salon.name, dessous: null };
}

export function SelecteurDeSalon({
  commerces,
  choisi,
  onChoisir,
  testID = 'selecteur-de-salon',
}: {
  commerces: readonly SalonAChoisir[];
  choisi: string | null;
  onChoisir: (id: string) => void;
  testID?: string;
}) {
  const { t } = useI18n();
  const c = useColors();

  if (commerces.length < 2) return null;

  return (
    <View style={{ gap: 6 }} testID={testID}>
      <Texte variante="type.label" couleur="ink.soft">
        {t('commerce.selecteurTitre')}
      </Texte>
      <Filet />
      {commerces.map((salon) => {
        const courant = salon.id === choisi;
        const identite = identiteDuSalon(salon, t);
        return (
          <Pressable
            key={salon.id}
            accessibilityRole="button"
            accessibilityState={{ selected: courant }}
            onPress={() => onChoisir(salon.id)}
            testID={`salon-${salon.id}`}
            style={({ pressed }) => ({
              opacity: pressed ? 0.7 : 1,
              minHeight: 44,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 10,
              paddingHorizontal: 12,
              borderRadius: radius['radius.md'],
              backgroundColor: courant ? c['bg.sunken'] : 'transparent',
            })}
          >
            <View style={{ flex: 1, minWidth: 0 }}>
              <Texte variante="type.bodyStrong" ellipseSurNomPropre>
                {identite.titre}
              </Texte>
              {identite.dessous ? (
                <Texte variante="type.caption" couleur="ink.soft" ellipseSurNomPropre>
                  {identite.dessous}
                </Texte>
              ) : null}
            </View>
            {courant ? (
              <Icone nom="coche" taille={16} testID={`salon-courant-${salon.id}`} />
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}
