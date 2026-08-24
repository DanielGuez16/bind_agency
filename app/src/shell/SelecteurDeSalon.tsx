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
 *
 * **Et chaque ligne porte ce qui l'attend.** Un gérant qui ouvre cette liste
 * cherche rarement « l'autre salon » ; il cherche celui qui a besoin de lui, et
 * deux noms ne le disent pas. Le nombre est le même que la file « à trancher »
 * de la journée — donc pas un compte du jour : une demande d'avant-hier attend
 * toujours, et l'écarter ferait disparaître précisément celle qui a le plus
 * attendu. C'est aussi pourquoi la ligne ne dit pas « aujourd'hui ».
 *
 * **Zéro ne s'écrit pas.** Un « 0 » sur chaque ligne est le cas normal, et une
 * colonne de zéros apprend à ne plus regarder la colonne. La marque n'apparaît
 * que là où quelqu'un attend.
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
  /**
   * Combien de réservations attendent une décision de ce salon.
   *
   * **C'est ce qui fait basculer un gérant qui ne savait pas qu'on
   * l'attendait.** Deux noms de salons ne disent pas lequel a besoin de lui ce
   * matin ; sans ce nombre la liste reste utilisable et perd sa raison d'être
   * ouverte.
   *
   * Facultatif : le sélecteur sert aussi là où le compte n'est pas servi, et
   * une ligne sans compte vaut mieux qu'une ligne qui en invente un.
   */
  decisions_en_attente?: number;
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
              // `bg.inset` : `bg.onDark` est le creux du kit sombre, et il
              // peignait la ligne du salon courant en noir.
              backgroundColor: courant ? c['bg.inset'] : 'transparent',
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
            {/* **Avant la coche**, parce que la coche dit où l'on est et que
                le compte dit où aller : l'ordre de lecture suit celui de la
                décision.

                **Le registre de la marque, et non celui de l'avertissement.**
                La pastille portait `status.warning` : un salon qui attend n'est
                pas en défaut, et l'avertissement d'Ambre annonce un problème
                — par son glyphe, puisque sa teinte est neutre. Il n'y avait
                donc ni la couleur qu'on croyait poser, ni le sens qu'on voulait
                dire. Le pâle de la marque attire l'œil sans accuser, et c'est
                déjà le registre de la ligne active. */}
            {salon.decisions_en_attente ? (
              <View
                testID={`decisions-${salon.id}`}
                style={{
                  paddingHorizontal: 8,
                  paddingVertical: 2,
                  borderRadius: radius['radius.sm'],
                  backgroundColor: c['brand.100'],
                }}
              >
                <Texte variante="type.monoSmall" couleur="brand.900">
                  {t('commerce.selecteurDecisions', { count: salon.decisions_en_attente })}
                </Texte>
              </View>
            ) : null}
            {courant ? (
              <Icone nom="coche" taille={16} testID={`salon-courant-${salon.id}`} />
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}
