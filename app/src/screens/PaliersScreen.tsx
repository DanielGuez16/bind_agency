/**
 * 02a · Paliers accessibles, et 02b · éligible à rien.
 *
 * **Tous les paliers actifs sont affichés**, ouverts ou non. Un créateur qui
 * débute verrait sinon un écran vide sans rien savoir de ce qui l'attend.
 * C'est l'inverse du fil, où un palier fermé encombre ; ici il oriente.
 *
 * **Tous les obstacles sont rendus, dans l'ordre du serveur.** N'en montrer
 * qu'un ferait combler le premier pour découvrir le second, puis le troisième.
 *
 * **L'écart n'est chiffré qu'à partir de 60 % du seuil.** En dessous, horizon :
 * le seuil, et rien d'autre. Aucune projection de rythme.
 *
 * Remplace l'ancien écran, écrit avant le système de design : il portait ses
 * couleurs en dur et construisait ses requêtes lui-même.
 */
import { View } from 'react-native';

import { useApi, type PalierAccessible, type VueDesPaliers } from '../api';
import { BadgesDeProfil, Chip, LigneDeContrepartie, StatusMessage, Texte, TierBadge } from '../components';
import { useI18n } from '../i18n';
import { en } from '../i18n/en';
import { useTheme } from '../theme';
import { Ecran } from './Ecran';
import { messageDObstacle, nomDePlateforme } from './obstacle';
import { useRequete } from './useRequete';

const CODES_CONNUS = new Set(Object.keys(en.errors));

export function PaliersScreen() {
  const { api } = useApi();
  const { t } = useI18n();

  const requete = useRequete<VueDesPaliers>((signal) => api.mesPaliers(signal), {
    // Vide veut dire « aucun palier configuré », un cas de plateforme. Un
    // créateur sans accès n'est **pas** vide : il a des paliers à lire, tous
    // fermés, et c'est justement l'écran qui doit le lui expliquer.
    estVide: (vue) => vue.paliers.length === 0,
  });

  return (
    <Ecran
      requete={requete}
      titre={t('parcours.tiersTitre')}
      testID="ecran-paliers"
      vide={<StatusMessage level="neutral" body={t('parcours.tiersVide')} />}
    >
      {(vue) => (
        <View style={{ gap: 12 }}>
          {vue.is_new_creator ? (
            <BadgesDeProfil
              badges={[{ genre: 'nouveau', label: t('parcours.tiersNouveau') }]}
              testID="badge-nouveau"
            />
          ) : null}
          {vue.paliers.map((palier) => (
            <CartePalier key={palier.tier_id} palier={palier} />
          ))}
        </View>
      )}
    </Ecran>
  );
}

function CartePalier({ palier }: { palier: PalierAccessible }) {
  const { color: c } = useTheme();
  const { t } = useI18n();

  return (
    <View
      testID={`palier-${palier.tier_id}`}
      style={{
        gap: 8,
        padding: 14,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: c['border.subtle'],
        backgroundColor: c['bg.surface'],
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <TierBadge tier={palier.content_format} />
        {/* La plateforme, en clair. Sans elle, six paliers portent trois
            libellés répétés deux fois, et « story fermé » juste sous « story
            ouvert » se lit comme une contradiction. */}
        <Chip label={nomDePlateforme(palier.platform)} />
        <Chip label={palier.accessible ? t('parcours.tiersOuvert') : t('parcours.tiersFerme')} />
      </View>
      <LigneDeContrepartie tier={palier.content_format} />

      {/* Tous les obstacles, dans l'ordre renvoyé par le serveur. */}
      {palier.obstacles.map((obstacle, index) => (
        <Texte
          key={`${obstacle.raison}-${index}`}
          variante="type.caption"
          couleur="text.secondary"
          testID={`obstacle-${obstacle.raison}`}
        >
          {messageDObstacle(t, obstacle, CODES_CONNUS, palier.platform)}
        </Texte>
      ))}
    </View>
  );
}
