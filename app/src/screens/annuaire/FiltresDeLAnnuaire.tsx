/**
 * Les quatre filtres de l'annuaire, et l'état qui les porte.
 *
 * **Trois d'entre eux existaient déjà, entièrement, côté serveur.** `palier`,
 * `reseau` et `distance_max_metres` sont déclarés par la route, appliqués par
 * `_retenue`, et éprouvés — total recalculé compris. Ce qui manquait était
 * l'appelant : `annuaireDesCreateurs` n'envoyait que `limite` et `decalage`,
 * si bien qu'aucun geste du produit ne pouvait les atteindre. Un filtre sans
 * appelant ne se voit pas manquer, et celui-ci a tenu des semaines.
 *
 * **Le quatrième est neuf** : les centres d'intérêt, déclarés par la
 * créatrice sur son profil. Il lit la même liste fermée que l'écran de
 * saisie, pour que le salon ne puisse pas filtrer sur une valeur qu'aucune
 * créatrice n'a pu choisir.
 *
 * **Repliés par défaut, et le résumé dit ce qui est posé.** Un salon arrive
 * ici pour voir le compte de son rayon, pas pour trier : déplier quatre
 * groupes de chips au dessus de la première fiche ferait passer l'annuaire
 * pour un formulaire. Le résumé est ce qui empêche d'oublier un filtre resté
 * actif — une liste courte sans explication se lit comme un marché vide.
 */
import { useState } from 'react';
import { View } from 'react-native';

import type { CentreDInteret, ContentFormat, Platform as Reseau } from '../../api';
import { Chip, RangeeDeChips, Repliable, Texte, Toggle, motDuPalier } from '../../components';
import { useI18n } from '../../i18n';
import { ChoixDesInterets } from '../interets/ChoixDesInterets';
import { RAYON_MAX_KM, RayonDeRecherche } from '../mur/RayonDeRecherche';

/** Ce que le salon a posé. Rien de posé : chaque champ vide ou nul. */
export type FiltresAnnuaire = {
  paliers: ContentFormat[];
  reseau: Reseau | null;
  /** En kilomètres à l'écran, en mètres sur le fil. `null` : le rayon entier. */
  distanceMaxKm: number | null;
  interets: CentreDInteret[];
};

export const AUCUN_FILTRE: FiltresAnnuaire = {
  paliers: [],
  reseau: null,
  distanceMaxKm: null,
  interets: [],
};

/** Les trois formats, du moins au plus exigeant : l'ordre des jetons. */
const FORMATS: readonly ContentFormat[] = ['story', 'post', 'reel'] as const;

/**
 * Les réseaux proposés.
 *
 * **Les deux qui ont un fournisseur, et pas les quatre de l'énumération.**
 * Filtrer sur un réseau qu'aucune créatrice ne peut rattacher rendrait une
 * liste vide qui se lirait comme « personne ici », alors que la vérité est
 * « ce réseau n'existe pas encore chez nous ».
 */
const RESEAUX: readonly Reseau[] = ['instagram', 'tiktok'] as const;

/**
 * Combien de filtres sont posés.
 *
 * **Compté, et non « y en a-t-il ».** Le résumé du repli doit dire combien,
 * sinon il faudrait déplier pour savoir ce qu'on a laissé actif — et c'est
 * précisément ce qu'on déplie rarement.
 */
export function combienDePoses(filtres: FiltresAnnuaire): number {
  return (
    (filtres.paliers.length > 0 ? 1 : 0) +
    (filtres.reseau !== null ? 1 : 0) +
    (filtres.distanceMaxKm !== null ? 1 : 0) +
    (filtres.interets.length > 0 ? 1 : 0)
  );
}

/**
 * Ce qui part sur le fil.
 *
 * **Les kilomètres deviennent des mètres ici, et nulle part ailleurs.** La
 * route parle en mètres, l'écran en kilomètres ; laisser la conversion au
 * point d'appel la ferait exister en deux endroits, et le second finirait
 * par envoyer des kilomètres sous un nom qui promet des mètres.
 */
export function enRequete(filtres: FiltresAnnuaire) {
  return {
    paliers: filtres.paliers,
    reseau: filtres.reseau,
    distanceMaxMetres:
      filtres.distanceMaxKm === null ? null : Math.round(filtres.distanceMaxKm * 1000),
    interets: filtres.interets,
  };
}

/**
 * Une clé stable pour les dépendances de requête.
 *
 * **Sans elle, la liste ne se recharge pas.** Les dépendances se comparent par
 * identité ; deux objets de filtres portant la même chose ne sont jamais
 * `===`, et un tableau reconstruit à chaque rendu relancerait la requête en
 * boucle. La chaîne dit le contenu, donc elle change quand et seulement quand
 * le contenu change.
 */
export function cleDesFiltres(filtres: FiltresAnnuaire): string {
  return JSON.stringify([
    [...filtres.paliers].sort(),
    filtres.reseau,
    filtres.distanceMaxKm,
    [...filtres.interets].sort(),
  ]);
}

export function FiltresDeLAnnuaire({
  filtres,
  onChange,
  testID = 'filtres-annuaire',
}: {
  filtres: FiltresAnnuaire;
  onChange: (suivants: FiltresAnnuaire) => void;
  testID?: string;
}) {
  const { t, locale } = useI18n();
  const [ouverte, setOuverte] = useState(false);
  const poses = combienDePoses(filtres);

  return (
    <Repliable
      titre={t('annuaire.filtres')}
      resume={poses === 0 ? t('annuaire.filtresAucun') : t('annuaire.filtresPoses', { combien: poses })}
      ouverte={ouverte}
      onBasculer={() => setOuverte((avant) => !avant)}
      testID={testID}
    >
      <View style={{ gap: 16 }}>
        <View style={{ gap: 6 }}>
          <Texte variante="type.label">{t('annuaire.filtrePalier')}</Texte>
          <RangeeDeChips>
            {FORMATS.map((format) => (
              <Chip
                key={format}
                label={motDuPalier(format, locale)}
                selected={filtres.paliers.includes(format)}
                onPress={() =>
                  onChange({
                    ...filtres,
                    // Au moins un des formats cochés, jamais tous : c'est la
                    // règle du serveur, et cocher story **et** reel élargit
                    // la recherche au lieu de la restreindre.
                    paliers: filtres.paliers.includes(format)
                      ? filtres.paliers.filter((autre) => autre !== format)
                      : [...filtres.paliers, format],
                  })
                }
                testID={`filtre-palier-${format}`}
              />
            ))}
          </RangeeDeChips>
        </View>

        <View style={{ gap: 6 }}>
          <Texte variante="type.label">{t('annuaire.filtreReseau')}</Texte>
          <RangeeDeChips>
            {RESEAUX.map((reseau) => (
              <Chip
                key={reseau}
                // Deux clés littérales et non une clé composée : la garde des
                // traductions ne sait pas résoudre `reseaux.${'$'}{x}`, et ce qu'elle
                // ne résout pas, elle ne vérifie pas.
                label={reseau === 'instagram' ? t('reseaux.instagram') : t('reseaux.tiktok')}
                selected={filtres.reseau === reseau}
                // Un seul réseau : recliquer l'actif l'efface, sans quoi il
                // faudrait un bouton « tous » que rien d'autre ne demande.
                onPress={() =>
                  onChange({ ...filtres, reseau: filtres.reseau === reseau ? null : reseau })
                }
                testID={`filtre-reseau-${reseau}`}
              />
            ))}
          </RangeeDeChips>
        </View>

        <View style={{ gap: 6 }}>
          <Texte variante="type.label">{t('annuaire.filtreInterets')}</Texte>
          <ChoixDesInterets
            choisis={filtres.interets}
            onChange={(suivants) => onChange({ ...filtres, interets: suivants })}
            aide={t('annuaire.filtreInteretsAide')}
            testID="filtre-interets"
          />
        </View>

        <View style={{ gap: 6 }}>
          {/* **Un interrupteur avant le curseur.** Un curseur seul n'a pas de
              position « pas de limite » : il faudrait la coder au maximum, et
              « moins de cinquante kilomètres » n'est pas la même requête que
              « le rayon entier » — la première écarte celles dont on ignore la
              position, la seconde les garde. */}
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
            }}
          >
            <Texte variante="type.label">{t('annuaire.filtreDistance')}</Texte>
            <Toggle
              value={filtres.distanceMaxKm !== null}
              onChange={(actif: boolean) =>
                onChange({ ...filtres, distanceMaxKm: actif ? RAYON_MAX_KM : null })
              }
              accessibilityLabel={t('annuaire.filtreDistance')}
              testID="filtre-distance"
            />
          </View>
          {filtres.distanceMaxKm !== null ? (
            <RayonDeRecherche
              rayonKm={filtres.distanceMaxKm}
              onChange={(km) => onChange({ ...filtres, distanceMaxKm: km })}
              testID="filtre-distance-rayon"
            />
          ) : null}
        </View>
      </View>
    </Repliable>
  );
}
