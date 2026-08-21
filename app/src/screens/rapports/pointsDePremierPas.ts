/**
 * Ce qui manque à un salon pour être trouvé, et ce qu'il a déjà fait.
 *
 * **À zéro donnée, ce n'est plus un écran de rapports.** C'est la décision de
 * Design et elle est structurelle : un salon qui vient de s'inscrire n'a pas
 * besoin d'un rapport vide, ni de zéros, ni d'un graphique plat. Il a besoin de
 * savoir pourquoi rien ne s'est encore passé et quoi faire. L'écran change donc
 * de nature au lieu de changer de contenu.
 *
 * **Ce qui est fait se dit avant ce qui manque.** L'ordre n'est pas cosmétique :
 * une liste qui ouvre sur quatre manques se lit comme un reproche adressé à
 * quelqu'un qui vient d'arriver, et c'est le moment du produit où il est le
 * plus facile de partir.
 *
 * **Chaque point porte son gain, jamais un encouragement.** « 62 créatrices de
 * plus » se décide ; « améliorez votre visibilité » ne se décide pas. Un point
 * dont le gain n'est pas connu porte le fait à sa place — combien de
 * prestations, combien de jours — et jamais un nombre inventé.
 */
import type { ItemDuCatalogue, OffreDePalier, RegleDeCapacite } from '../../api';

/** Un point de la liste : ce qu'il dit, ce qu'il vaut, et où il mène. */
export type PointDePremierPas = {
  cle: 'catalogue' | 'photos' | 'paliers' | 'horaires';
  /** Vrai quand il n'y a plus rien à faire sur ce point. */
  fait: boolean;
  /** Le nombre que le libellé cite. Nul quand le point n'en cite aucun. */
  compte: number | null;
};

/** Les sept jours de la semaine, tels que les règles de capacité les numérotent. */
const SEMAINE = [0, 1, 2, 3, 4, 5, 6];

/**
 * Les quatre points, dans l'ordre où ils se lisent : faits d'abord.
 *
 * **Le tri est stable, et c'est ce qui le rend lisible.** Deux points faits
 * gardent leur ordre d'origine, deux manques aussi : la liste ne se réorganise
 * pas sous les yeux du gérant quand il vient d'en régler un, elle remonte
 * seulement celui qu'il vient de faire.
 */
export function premiersPas({
  items,
  offres,
  regles,
}: {
  items: ItemDuCatalogue[];
  offres: OffreDePalier[];
  regles: RegleDeCapacite[];
}): PointDePremierPas[] {
  // **Ce qu'une créatrice peut réellement réserver**, pas ce qui existe en
  // base. `is_effectively_available` porte déjà la composition — un item fermé,
  // ou dont le parent l'est, n'ouvre rien.
  const ouverts = items.filter((item) => item.is_effectively_available);
  const sansPhoto = ouverts.filter((item) => !item.photo_key);

  // Les formats réellement offerts, dédoublonnés : trois offres sur le palier
  // story ne font pas trois paliers ouverts.
  const formats = new Set(
    offres.filter((offre) => offre.is_effectively_offered).map((offre) => offre.content_format),
  );

  const joursOuverts = new Set(regles.map((regle) => regle.weekday));
  const joursFermes = SEMAINE.filter((jour) => !joursOuverts.has(jour));

  const points: PointDePremierPas[] = [
    { cle: 'catalogue', fait: ouverts.length > 0, compte: ouverts.length },
    // **Sans prestation ouverte, la photo n'est pas un manque.** Reprocher zéro
    // photo à un catalogue vide dirait deux fois la même chose, et la seconde
    // fois à tort : ce qui manque est la prestation, pas son image.
    {
      cle: 'photos',
      fait: ouverts.length === 0 || sansPhoto.length === 0,
      compte: sansPhoto.length,
    },
    // Un seul palier ouvert n'est pas une faute — c'est le réglage par défaut.
    // C'est un point qui reste à faire tant qu'il en reste à ouvrir.
    { cle: 'paliers', fait: formats.size > 1, compte: formats.size },
    { cle: 'horaires', fait: joursFermes.length === 0, compte: joursFermes.length },
  ];

  return [...points].sort((a, b) => Number(b.fait) - Number(a.fait));
}
