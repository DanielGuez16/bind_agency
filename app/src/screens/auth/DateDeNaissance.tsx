/**
 * Trois champs, et rien qui annonce la règle.
 *
 * **Neutre, et c'est une contrainte réglementaire avant d'être un choix de
 * composition.** Un portail d'âge qui écrit « vous devez avoir 18 ans » au-
 * dessus du champ suggère sa propre bonne réponse : il apprend quoi taper à qui
 * n'a pas l'âge. C'est la forme que la FTC a sanctionnée, et c'est pourquoi ce
 * champ est **le seul du formulaire dont l'aide ne dit pas sa contrainte** —
 * celle du mot de passe annonce « au moins douze caractères », celle-ci
 * n'annonce que le format.
 *
 * **Trois champs numériques plutôt qu'un calendrier.** Le dépôt n'a jamais
 * voulu de composant de date : sa seule grille est celle des trente prochains
 * jours, et son commentaire dit pourquoi — « au-delà, la grille devient un
 * calendrier, et un calendrier demande un composant que le système n'a pas ».
 * Une date de naissance remonte cent ans ; elle ne se choisit pas dans une
 * grille, et importer une dépendance pour un champ rendrait le portail
 * dépendant d'un paquet tiers.
 *
 * **Et surtout : trois champs ne s'épellent pas.** Le défaut d'un champ unique
 * est celui que la grille des jours a déjà corrigé — « on y tapait un jour dans
 * une syntaxe à retenir, et une faute de frappe visait une autre date que celle
 * qu'on voulait ». `JJ`, `MM`, `AAAA` séparés ne laissent aucune syntaxe à
 * deviner.
 *
 * **L'ordre suit la langue.** Jour-mois-année en français et en espagnol,
 * mois-jour-année en anglais : un Américain qui lit `04 / 09` comprend le
 * 9 avril, et l'inverse pour tout le monde. C'est la même raison qui a fait
 * écrire les mois en lettres ailleurs dans le produit.
 */
import { View } from 'react-native';

import { TextField, Texte } from '../../components';
import { useI18n } from '../../i18n';

/** Ce que les trois champs portent, avant d'être une date. */
export type SaisieDeDate = { jour: string; mois: string; annee: string };

export const DATE_VIDE: SaisieDeDate = { jour: '', mois: '', annee: '' };

/**
 * La date ISO, ou `null` tant que la saisie n'en forme pas une.
 *
 * **`null` couvre deux cas qu'il ne faut pas distinguer ici : incomplet et
 * impossible.** Le 31 février est refusé au même titre qu'un champ vide, parce
 * que dans les deux cas il n'y a rien à envoyer. Ce que le portail refuse — un
 * âge insuffisant, une date future — se juge au serveur, qui est le seul à
 * connaître la règle et le seul dont le refus fasse foi.
 *
 * Le contrôle de cohérence est celui qui attrape le 31 avril : reconstruire la
 * date et vérifier qu'elle porte bien le jour demandé. `new Date(2026, 3, 31)`
 * rend le 1er mai sans se plaindre.
 */
export function dateIso({ jour, mois, annee }: SaisieDeDate): string | null {
  if (!/^\d{1,2}$/.test(jour) || !/^\d{1,2}$/.test(mois) || !/^\d{4}$/.test(annee)) return null;

  const j = Number(jour);
  const m = Number(mois);
  const a = Number(annee);
  if (m < 1 || m > 12 || j < 1 || j > 31) return null;

  const construite = new Date(Date.UTC(a, m - 1, j));
  if (
    construite.getUTCFullYear() !== a ||
    construite.getUTCMonth() !== m - 1 ||
    construite.getUTCDate() !== j
  ) {
    return null;
  }
  return `${String(a).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(j).padStart(2, '0')}`;
}

export function DateDeNaissance({
  valeur,
  onChange,
  testID = 'date-de-naissance',
}: {
  valeur: SaisieDeDate;
  onChange: (suivante: SaisieDeDate) => void;
  testID?: string;
}) {
  const { t, locale } = useI18n();

  /** Ne garde que des chiffres : un clavier numérique n'empêche pas un collage. */
  const chiffres = (brut: string, combien: number) =>
    brut.replace(/\D/g, '').slice(0, combien);

  const champJour = (
    <TextField
      label={t('auth.naissanceJour')}
      value={valeur.jour}
      onChangeText={(v) => onChange({ ...valeur, jour: chiffres(v, 2) })}
      keyboard="numeric"
      maxLength={2}
      testID={`${testID}-jour`}
    />
  );
  const champMois = (
    <TextField
      label={t('auth.naissanceMois')}
      value={valeur.mois}
      onChangeText={(v) => onChange({ ...valeur, mois: chiffres(v, 2) })}
      keyboard="numeric"
      maxLength={2}
      testID={`${testID}-mois`}
    />
  );

  return (
    <View style={{ gap: 6 }} testID={testID}>
      <Texte variante="type.label" couleur="ink.soft">
        {t('auth.naissanceTitre')}
      </Texte>
      <View style={{ flexDirection: 'row', gap: 10 }}>
        {/* L'ordre de lecture de la langue, voir l'en-tête. */}
        <View style={{ flex: 1 }}>{locale === 'en' ? champMois : champJour}</View>
        <View style={{ flex: 1 }}>{locale === 'en' ? champJour : champMois}</View>
        <View style={{ flex: 1.4 }}>
          <TextField
            label={t('auth.naissanceAnnee')}
            value={valeur.annee}
            onChangeText={(v) => onChange({ ...valeur, annee: chiffres(v, 4) })}
            keyboard="numeric"
            maxLength={4}
            testID={`${testID}-annee`}
          />
        </View>
      </View>
      {/* **Le format, et rien que le format.** Voir l'en-tête : ce champ est le
          seul du formulaire dont l'aide ne dit pas sa contrainte. */}
      <Texte variante="type.caption" couleur="ink.mute">
        {t('auth.naissanceAide')}
      </Texte>
    </View>
  );
}
