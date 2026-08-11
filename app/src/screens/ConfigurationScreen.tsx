/**
 * L'entrée de la configuration du commerce.
 *
 * Trois portes, et rien d'autre : le catalogue, les horaires, le profil. Les
 * mettre côte à côte dans la barre d'onglets aurait ajouté deux onglets à une
 * barre qui en a déjà cinq, pour des écrans qu'on ouvre le premier jour puis
 * une fois par saison.
 *
 * **Chaque porte dit ce qu'elle ouvre.** Un libellé seul obligerait à entrer
 * pour savoir — sur un téléphone posé sur un comptoir, entre deux clientes,
 * c'est un aller-retour de trop.
 *
 * **Sur grand écran, cette page n'existe pas** (campagne 2). Trois cartes au
 * milieu du vide, dont le seul rôle est de mener ailleurs : c'est un clic et
 * une page entière dépensés pour un menu. Là où la place existe, le menu
 * devient une colonne et la section vit à côté — on arrive **dans** le
 * catalogue, avec les deux autres portes sous les yeux. En compact la page
 * garde tout son sens : il n'y a pas de place pour deux colonnes, et la table
 * des matières est alors le seul endroit d'où l'on choisit.
 */
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { Icone, Texte } from '../components';
import { useI18n } from '../i18n';
import { ECART_DES_COLONNES } from '../shell/gabarit';
import { radius, useColors, useTheme } from '../theme';
import { ActivationScreen } from './ActivationScreen';
import { CatalogueScreen } from './CatalogueScreen';
import { HorairesScreen } from './HorairesScreen';

export type PorteDeConfiguration = 'catalogue' | 'horaires' | 'activation';

const PORTES: { cle: PorteDeConfiguration; titre: string; corps: string }[] = [
  {
    cle: 'catalogue',
    titre: 'composition.entreeCatalogue',
    corps: 'composition.entreeCatalogueCorps',
  },
  {
    cle: 'horaires',
    titre: 'composition.entreeHoraires',
    corps: 'composition.entreeHorairesCorps',
  },
  {
    cle: 'activation',
    titre: 'composition.entreeActivation',
    corps: 'composition.entreeActivationCorps',
  },
];

export function ConfigurationScreen({
  onOuvrir,
}: {
  onOuvrir: (porte: PorteDeConfiguration) => void;
}) {
  const { t } = useI18n();
  const { color: c, density } = useTheme();

  return (
    <View
      style={{ flex: 1, backgroundColor: c['bg.canvas'] }}
      testID="ecran-configuration"
    >
      <View style={{ height: 3, backgroundColor: c['role.merchant'] }} />
      <View style={{ padding: density.screenPadding, gap: density.gap }}>
        <Texte variante="type.display">{t('composition.titre')}</Texte>

        {PORTES.map((porte) => (
          <Pressable
            key={porte.cle}
            accessibilityRole="button"
            onPress={() => onOuvrir(porte.cle)}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 12,
              padding: 16,
              borderRadius: radius['radius.lg'],
              backgroundColor: c['bg.surface'],
              borderWidth: 1,
              borderColor: c['border.default'],
            }}
            testID={`ouvrir-${porte.cle}`}
          >
            <View style={{ flex: 1, gap: 2 }}>
              <Texte variante="type.label">{t(porte.titre)}</Texte>
              <Texte variante="type.caption" couleur="text.secondary">
                {t(porte.corps)}
              </Texte>
            </View>
            <Icone nom="chevron" couleur="text.muted" taille={18} />
          </Pressable>
        ))}
      </View>
    </View>
  );
}

/** La colonne des sections, sur grand écran. Assez large pour deux lignes. */
const LARGEUR_DES_SECTIONS = 280;

/**
 * La composition du commerce, sur grand écran : le menu à gauche, la section à
 * droite.
 *
 * **On n'arrive plus sur un menu, on arrive dans le catalogue.** La table des
 * matières reste visible parce qu'elle sert à changer de section, pas parce
 * qu'il faut la traverser. C'est la différence entre une page de garde et une
 * barre latérale : la première se lit une fois et gêne ensuite.
 *
 * **La section ne porte pas de retour.** Il n'y a rien derrière elle : le
 * dessiner donnerait un bouton qui ramènerait à la page qu'on vient de
 * supprimer.
 */
export function CompositionDuCommerce({ businessId }: { businessId: string }) {
  const [porte, setPorte] = useState<PorteDeConfiguration>('catalogue');

  return (
    <View
      testID="composition-du-commerce"
      style={{ flex: 1, flexDirection: 'row', gap: ECART_DES_COLONNES }}
    >
      <ColonneDesSections courante={porte} onChoisir={setPorte} />
      <View style={{ flex: 1, minWidth: 0 }}>
        {porte === 'catalogue' ? <CatalogueScreen businessId={businessId} /> : null}
        {porte === 'horaires' ? <HorairesScreen businessId={businessId} /> : null}
        {porte === 'activation' ? (
          <ActivationScreen businessId={businessId} onActive={() => {}} />
        ) : null}
      </View>
    </View>
  );
}

function ColonneDesSections({
  courante,
  onChoisir,
}: {
  courante: PorteDeConfiguration;
  onChoisir: (porte: PorteDeConfiguration) => void;
}) {
  const { t } = useI18n();
  const c = useColors();

  return (
    <View
      testID="sections-de-configuration"
      style={{
        width: LARGEUR_DES_SECTIONS,
        gap: 4,
        paddingVertical: 16,
        paddingLeft: 16,
      }}
    >
      <Texte variante="type.label" couleur="text.secondary" style={{ paddingBottom: 8 }}>
        {t('composition.titre')}
      </Texte>

      {PORTES.map((section) => {
        const active = section.cle === courante;
        return (
          <Pressable
            key={section.cle}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            onPress={() => onChoisir(section.cle)}
            testID={`section-${section.cle}`}
            style={{
              gap: 2,
              padding: 12,
              borderRadius: radius['radius.md'],
              // Deux marques, comme partout ailleurs dans la coquille : un fond
              // et une barre. Jamais la couleur seule.
              backgroundColor: active ? c['accent.subtle'] : 'transparent',
              borderLeftWidth: 3,
              borderLeftColor: active ? c['accent.default'] : 'transparent',
            }}
          >
            <Texte variante="type.label" couleur={active ? 'accent.default' : 'text.primary'}>
              {t(section.titre)}
            </Texte>
            <Texte variante="type.caption" couleur="text.muted">
              {t(section.corps)}
            </Texte>
          </Pressable>
        );
      })}
    </View>
  );
}
