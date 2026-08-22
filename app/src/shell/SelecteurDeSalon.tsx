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
 * **Aucun compteur, aucune adresse.** Ce qui distingue deux salons d'un même
 * gérant est leur nom, qu'il a choisi. Ajouter l'adresse ou le nombre de
 * réservations transformerait un choix en tableau de bord, et les deux lignes
 * feraient ce que la journée fait déjà mieux.
 */
import { Pressable, View } from 'react-native';

import { Filet, Icone, Texte } from '../components';
import { useI18n } from '../i18n';
import { radius, useColors } from '../theme';

export type SalonAChoisir = { id: string; name: string };

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
            <Texte
              variante={courant ? 'type.bodyStrong' : 'type.body'}
              style={{ flex: 1, minWidth: 0 }}
              ellipseSurNomPropre
            >
              {salon.name}
            </Texte>
            {courant ? (
              <Icone nom="coche" taille={16} testID={`salon-courant-${salon.id}`} />
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}
