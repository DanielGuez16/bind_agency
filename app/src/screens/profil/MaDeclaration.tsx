/**
 * Ce que la créatrice dit d'elle, sur l'écran qui la présente.
 *
 * **Ça se saisissait dans les réglages et ne se lisait nulle part.** La bio et
 * les centres d'intérêt partent à l'annuaire des salons depuis qu'ils
 * existent ; leur autrice, elle, ne les revoyait qu'en rouvrant le formulaire
 * qui les a écrits. Un profil qui montre le pseudonyme et l'audience sans
 * montrer ce qu'on a déclaré donne à lire une identité qu'on n'a pas choisie
 * et tait celle qu'on a écrite.
 *
 * **Le vide est une invitation, pas un trou.** Une carte grise sans contenu se
 * lit comme une panne. Tant que rien n'est déclaré, la section dit ce que le
 * champ sert à faire — les salons filtrent dessus — et où il se remplit. C'est
 * la seule phrase de l'écran qui appelle un geste, donc elle a le droit d'être
 * là ; elle disparaît dès qu'elle a servi.
 *
 * **Les intérêts sont des pastilles, la bio est de la prose.** Deux natures,
 * deux traitements : une liste fermée se lit d'un coup d'œil en pastilles, et
 * la même liste en phrase se relirait mot à mot. Les pastilles sont ici
 * inertes — c'est un profil, pas un formulaire, et une pastille qui répond au
 * doigt promettrait une modification qui n'aurait pas lieu.
 */
import { View } from 'react-native';

import type { CentreDInteret } from '../../api';
import { Chip, RangeeDeChips, Texte } from '../../components';
import { useI18n } from '../../i18n';
import { radius, useColors } from '../../theme';

export function MaDeclaration({
  bio,
  interets,
  testID = 'ma-declaration',
}: {
  bio: string | null;
  interets: CentreDInteret[] | null;
  testID?: string;
}) {
  const { t } = useI18n();
  const c = useColors();

  const choisis = interets ?? [];
  const vide = !bio && choisis.length === 0;

  return (
    <View
      testID={testID}
      style={{
        padding: 14,
        gap: 10,
        borderRadius: radius['radius.md'],
        backgroundColor: c['bg.surface'],
      }}
    >
      <Texte variante="type.label" couleur="ink.soft">
        {t('profil.maDeclaration')}
      </Texte>

      {vide ? (
        // **Une phrase, et elle nomme le lecteur.** « Complète ton profil »
        // demanderait un effort sans dire à quoi il sert ; savoir que des
        // salons filtrent dessus est la seule information qui décide.
        <Texte variante="type.body" couleur="ink.soft" testID={`${testID}-vide`}>
          {t('profil.maDeclarationVide')}
        </Texte>
      ) : null}

      {bio ? (
        <Texte variante="type.body" testID={`${testID}-bio`}>
          {bio}
        </Texte>
      ) : null}

      {choisis.length > 0 ? (
        <RangeeDeChips>
          {choisis.map((valeur) => (
            // Sans `onPress` : la pastille se dessine allumée et n'attend
            // aucun geste. Le rôle reste celui d'un texte pour le lecteur
            // d'écran, qui n'annonce donc pas un bouton.
            <Chip
              key={valeur}
              label={t(`interets.${valeur}`)}
              selected
              testID={`${testID}-interet-${valeur}`}
            />
          ))}
        </RangeeDeChips>
      ) : null}
    </View>
  );
}
