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
import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';

import { useApi, type EtatDeLaComposition } from '../api';
import { Icone, Texte } from '../components';
import { formatDate } from '../format';
import { useI18n } from '../i18n';
import { ECART_DES_COLONNES } from '../shell/gabarit';
import { elevationDeCarte, radius, useColors, useTheme } from '../theme';
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
  const { color: c, density, matiere } = useTheme();

  return (
    <View
      style={{ flex: 1, backgroundColor: c['bg.page'] }}
      testID="ecran-configuration"
    >
      {/* Le même liseré de rôle que dans `Ecran` : cet écran est une porte
          d'entrée et n'en passe pas par lui. */}
      <View style={{ height: 3, backgroundColor: c[matiere.ligne] }} />
      <View style={{ padding: density.screenPadding, gap: density.gap }}>
        <Texte variante="type.screenTitle">{t('composition.titre')}</Texte>

        {PORTES.map((porte) => (
          <Pressable
            key={porte.cle}
            accessibilityRole="button"
            onPress={() => onOuvrir(porte.cle)}
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              gap: 12,
              padding: 16,
              borderRadius: radius['radius.lg'],
              backgroundColor: c['bg.surface'],
              borderWidth: 1,
              borderColor: c['line.default'],
              // La règle des rayons : un coin de 18 px sans ombre flotte au
              // lieu de se poser. Cette carte y échappait depuis toujours, non
              // par décision mais parce que la garde ne voyait pas les styles
              // fonctionnels — et une carte pressable en écrit un.
              ...elevationDeCarte(),
          opacity: pressed ? 0.7 : 1,
        })}
            testID={`ouvrir-${porte.cle}`}
          >
            <View style={{ flex: 1, gap: 2 }}>
              <Texte variante="type.label">{t(porte.titre)}</Texte>
              <Texte variante="type.caption" couleur="ink.soft">
                {t(porte.corps)}
              </Texte>
            </View>
            <Icone nom="chevron" couleur="ink.mute" taille={18} />
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
  const { api } = useApi();
  const [porte, setPorte] = useState<PorteDeConfiguration>('catalogue');
  const [etat, setEtat] = useState<EtatDeLaComposition | null>(null);

  /**
   * L'état des trois sections, en une requête.
   *
   * **Il se recharge quand on change de section**, parce qu'on vient d'y faire
   * quelque chose : composer une prestature puis revenir sur un menu qui en
   * annonce encore zéro donnerait le sentiment que rien n'a été enregistré.
   *
   * Une erreur ne se remonte pas. Le menu sans ses nombres reste un menu ; y
   * afficher « impossible de charger » là où trois portes attendent serait
   * remplacer une aide par une panne.
   */
  useEffect(() => {
    let vivant = true;
    void api
      .compositionDuCommerce(businessId)
      .then((rendu) => vivant && setEtat(rendu))
      .catch(() => {});
    return () => {
      vivant = false;
    };
  }, [api, businessId, porte]);

  return (
    <View
      testID="composition-du-commerce"
      style={{ flex: 1, flexDirection: 'row', gap: ECART_DES_COLONNES }}
    >
      <ColonneDesSections courante={porte} onChoisir={setPorte} etat={etat} />
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
  etat,
}: {
  courante: PorteDeConfiguration;
  onChoisir: (porte: PorteDeConfiguration) => void;
  /** Nul tant que rien n'est chargé : la section garde alors sa description. */
  etat: EtatDeLaComposition | null;
}) {
  const { t, locale } = useI18n();
  const c = useColors();

  /**
   * Ce que chaque section dit d'elle-même.
   *
   * **Un chiffre plutôt qu'une description, dès qu'on l'a.** « Ce que vous
   * proposez » ne dit pas si l'on propose quelque chose ; « 12 prestations · 3
   * masquées » le dit avant d'entrer. C'est le premier écran qu'ouvre un salon
   * qui vient de s'inscrire, et « rien pour l'instant » y est exactement
   * l'information qu'il cherche.
   */
  const etatDe = (porte: PorteDeConfiguration): string | null => {
    if (etat === null) return null;

    if (porte === 'catalogue') {
      const combien =
        etat.prestations === 0
          ? t('composition.etatAucunePrestation')
          : etat.prestations === 1
            ? t('composition.etatUnePrestation')
            : t('composition.etatPrestations', { count: etat.prestations });
      // Les masquées ne se disent que s'il y en a : « · 0 masquées » est du
      // bruit, et il pousse la ligne sur deux hauteurs pour rien.
      return etat.prestations_masquees > 0
        ? `${combien} · ${t('composition.etatMasquees', { count: etat.prestations_masquees })}`
        : combien;
    }

    if (porte === 'horaires') {
      return etat.jours_ouverts === 0
        ? t('composition.etatAucunJour')
        : t('composition.etatJours', { count: etat.jours_ouverts });
    }

    // **Jamais en ligne et retiré du fil sont deux états différents.** Le
    // premier attend un premier geste, le second en attend un autre ; les dire
    // pareil ferait chercher un bouton qui n'est pas celui qu'il faut.
    if (etat.status === 'active' && etat.en_ligne_depuis) {
      return t('composition.etatEnLigne', {
        date: formatDate(etat.en_ligne_depuis, locale, 'UTC'),
      });
    }
    return etat.en_ligne_depuis
      ? t('composition.etatEnPause')
      : t('composition.etatJamaisEnLigne');
  };

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
      <Texte variante="type.label" couleur="ink.soft" style={{ paddingBottom: 8 }}>
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
            style={({ pressed }) => ({
              gap: 2,
              padding: 12,
              borderRadius: radius['radius.lg'],
              // Deux marques, comme partout ailleurs dans la coquille : un fond
              // et une barre. Jamais la couleur seule.
              backgroundColor: active ? c['brand.50'] : 'transparent',
              borderLeftWidth: 3,
              borderLeftColor: active ? c['brand.700'] : 'transparent',
          opacity: pressed ? 0.7 : 1,
        })}
          >
            <Texte variante="type.label" couleur={active ? 'brand.700' : 'ink.default'}>
              {t(section.titre)}
            </Texte>
            {/* Le chiffre remplace la description dès qu'on l'a : la
                description dit à quoi sert la porte, le chiffre dit où l'on
                en est, et c'est la seconde question. */}
            <Texte
              variante="type.caption"
              couleur="ink.mute"
              testID={`etat-${section.cle}`}
            >
              {etatDe(section.cle) ?? t(section.corps)}
            </Texte>
          </Pressable>
        );
      })}
    </View>
  );
}
