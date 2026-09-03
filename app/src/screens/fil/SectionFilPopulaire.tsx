/**
 * Le fil de secours — trié par popularité, affiché pendant qu'aucune position
 * n'est disponible.
 *
 * **Un refus de géolocalisation n'est pas une raison de ne rien montrer.**
 * L'écran bloquait entièrement sur `position === null` : un message, un
 * bouton, rien d'autre. Aussi juste que soit le message, il ne remplace pas
 * ce que la créatrice est venue chercher — voir `feed.fil_populaire_du_createur`
 * côté serveur, qui rend cette liste sans jamais demander de coordonnées.
 *
 * **Silencieuse en cas d'échec.** Le panneau au-dessus dit déjà ce qui
 * bloque et propose déjà de réessayer ; une seconde erreur ici, pour une
 * liste qui n'est qu'un complément, encombrerait l'écran d'un problème que
 * personne n'a demandé à résoudre deux fois. `null` plutôt qu'un message —
 * l'écran retombe alors sur le seul panneau du dessus.
 */
import { Animated, Pressable, View } from 'react-native';

import { useApi } from '../../api';
import type { SalonPopulaire } from '../../api';
import { Icone, Texte, useEnfoncement } from '../../components';
import { useI18n } from '../../i18n';
import { formatNumber } from '../../format';
import { size } from '../../theme';
import { useRequete } from '../useRequete';

export function SectionFilPopulaire({
  onOuvrirLeCommerce,
  testID,
}: {
  onOuvrirLeCommerce: (businessId: string) => void;
  testID?: string;
}) {
  const { api } = useApi();
  const { t } = useI18n();

  const requete = useRequete(
    (signal) => api.filPopulaire(signal),
    { estVide: (fil) => fil.salons.length === 0 },
  );

  if (requete.etat !== 'pret' || requete.vide) return null;

  return (
    <View testID={testID} style={{ gap: 8 }}>
      <View style={{ gap: 2 }}>
        <Texte variante="type.label" testID="fil-populaire-titre">
          {t('parcours.filPopulaireTitre')}
        </Texte>
        <Texte variante="type.caption" couleur="ink.soft">
          {t('parcours.filPopulaireSousTitre')}
        </Texte>
      </View>
      {requete.donnees.salons.map((salon) => (
        <LigneDeSalonPopulaire
          key={salon.business_id}
          salon={salon}
          onOuvrir={() => onOuvrirLeCommerce(salon.business_id)}
        />
      ))}
    </View>
  );
}

function LigneDeSalonPopulaire({
  salon,
  onOuvrir,
}: {
  salon: SalonPopulaire;
  onOuvrir: () => void;
}) {
  const { t, locale } = useI18n();
  const enfoncement = useEnfoncement(true);

  const phrase =
    salon.prestations === 1
      ? t('parcours.filPrestationsOuverteUne')
      : t('parcours.filPrestationsOuvertes', { count: formatNumber(salon.prestations, locale) });

  return (
    <Animated.View style={enfoncement.style}>
      <Pressable
        accessibilityRole="button"
        onPress={onOuvrir}
        onPressIn={enfoncement.onPressIn}
        onPressOut={enfoncement.onPressOut}
        testID={`fil-populaire-${salon.business_id}`}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          minHeight: size.touchMin,
          paddingVertical: 8,
        }}
      >
        <View style={{ flex: 1 }}>
          <Texte variante="type.body">{salon.nom}</Texte>
          <Texte variante="type.caption" couleur="ink.soft">
            {phrase}
          </Texte>
        </View>
        <Icone nom="chevron" couleur="ink.soft" taille={20} />
      </Pressable>
    </Animated.View>
  );
}
