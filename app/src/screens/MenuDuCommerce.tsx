/**
 * Le quatrième onglet du téléphone : ce qui ne se touche pas tous les jours.
 *
 * **Il ne porte aucun écran de plus.** Il groupe ceux que la barre du bas vient
 * de libérer — huit onglets transposés d'une barre latérale de bureau faisaient
 * des cibles de quarante-huit points en bas d'un iPhone. Le tri est celui de la
 * fréquence : en bas ce qui a une échéance, ici ce qu'on a composé une fois et
 * ce qu'on relit parfois.
 *
 * **Chaque ligne porte son état, et c'est toute la différence.** Un menu qui ne
 * fait que rediriger oblige à ouvrir un écran pour apprendre qu'il n'y avait
 * rien à y faire ; « 6 open · 2 need a photo » répond depuis la liste. Une ligne
 * sans état n'en invente pas — « the place » dit ce qu'elle contient, ce qui est
 * la réponse honnête pour un écran qui n'a pas de compteur.
 *
 * **Deux requêtes, sur un écran qu'on ouvre rarement.** Le catalogue et les
 * rapports servent déjà ces nombres à leurs écrans respectifs ; les recalculer
 * ici en ferait deux sources qui finiraient par diverger, alors que les lire à
 * la même source ne coûte que l'appel.
 */
import { useNavigation } from '@react-navigation/native';
import { Pressable, View } from 'react-native';

import { useApi, type ItemDuCatalogue, type Reporting } from '../api';
import { Icone, Texte } from '../components';
import { useI18n } from '../i18n';
import { elevationDeCarte, radius, useColors } from '../theme';
import { Ecran } from './Ecran';
import { resumeDuCatalogue } from './catalogue/resume';
import { useRequete } from './useRequete';

/** Ce que le menu sait dire de chaque destination. */
type Etats = { catalogue: ItemDuCatalogue[]; rapports: Reporting | null };

export function MenuDuCommerce({ businessId }: { businessId: string }) {
  const { api } = useApi();
  const { t } = useI18n();

  const requete = useRequete<Etats>(
    async (signal) => {
      // **Les rapports ne bloquent pas le menu.** Un salon neuf n'en a pas, et
      // un menu qui refuserait de s'ouvrir pour un état absent serait le
      // contraire de ce qu'il est là pour faire.
      const [catalogue, rapports] = await Promise.all([
        api.itemsDuCatalogue(businessId, signal),
        api.reporting(businessId, {}, signal).catch(() => null),
      ]);
      return { catalogue, rapports };
    },
    {
      estVide: () => false,
      dependances: [businessId],
    },
  );

  return (
    <Ecran
      requete={requete}
      titre={t('onglets.menu')}
      nature="merchant"
      testID="ecran-menu"
    >
      {({ catalogue, rapports }) => {
        const resume = resumeDuCatalogue(catalogue);
        // Les prestations sans photo : c'est le manque que le fil punit — une
        // carte sans photo se réserve rarement — et le seul de cet écran qui
        // appelle un geste.
        const sansPhoto = catalogue.filter(
          (item) => !item.archived_at && item.photo_key === null,
        ).length;

        return (
          <View style={{ gap: 14 }}>
            <Groupe titre={t('commerce.menuVotreOffre')} testID="groupe-offre">
              <Ligne
                titre={t('onglets.lieu')}
                etat={t('commerce.menuLieuEtat')}
                vers="lieu"
                testID="menu-lieu"
              />
              <Ligne
                titre={t('onglets.prestations')}
                etat={
                  sansPhoto > 0
                    ? t('commerce.menuPrestationsEtatPhoto', {
                        ouvertes: resume.visibles,
                        sans: sansPhoto,
                      })
                    : t('commerce.menuPrestationsEtat', { ouvertes: resume.visibles })
                }
                vers="prestations"
                dernier
                testID="menu-prestations"
              />
            </Groupe>

            <Groupe titre={t('commerce.menuEnArriere')} testID="groupe-arriere">
              <Ligne
                titre={t('onglets.reporting')}
                etat={
                  rapports
                    ? t('commerce.menuRapportsEtat', {
                        prestations: rapports.consommations,
                        publications: rapports.publications,
                      })
                    : t('commerce.menuRapportsVide')
                }
                vers="reporting"
                testID="menu-reporting"
              />
              <Ligne
                titre={t('onglets.annuaire')}
                etat={t('commerce.menuAnnuaireEtat')}
                vers="annuaire"
                dernier
                testID="menu-annuaire"
              />
            </Groupe>

            {/* Seuls, parce que les réglages ne sont ni une offre ni un
                regard en arrière : ils sont le compte lui-même. */}
            <Groupe testID="groupe-reglages">
              <Ligne
                titre={t('onglets.reglages')}
                vers="reglages"
                dernier
                testID="menu-reglages"
              />
            </Groupe>
          </View>
        );
      }}
    </Ecran>
  );
}

function Groupe({
  titre,
  children,
  testID,
}: {
  titre?: string;
  children: React.ReactNode;
  testID: string;
}) {
  const c = useColors();
  return (
    <View
      testID={testID}
      style={{
        borderRadius: radius['radius.lg'],
        backgroundColor: c['bg.surface'],
        borderWidth: 1,
        borderColor: c['line.default'],
        overflow: 'hidden',
        // **L'ombre, alors que la planche dessine un simple filet.** La règle
        // des rayons ne souffre pas d'exception par écran : un coin de 18 sans
        // ombre flotte au lieu de se poser, et c'est exactement ainsi qu'elle
        // avait disparu la première fois — surface par surface, sans qu'aucun
        // test ne bouge. Ces groupes se posent sur la page comme des cartes,
        // donc ils portent l'ombre comme des cartes.
        ...elevationDeCarte(),
      }}
    >
      {titre ? (
        <View
          style={{
            paddingHorizontal: 16,
            paddingVertical: 11,
            backgroundColor: c['bg.page'],
            borderBottomWidth: 1,
            borderBottomColor: c['line.default'],
          }}
        >
          <Texte variante="type.dataLabel" couleur="ink.soft">
            {titre}
          </Texte>
        </View>
      ) : null}
      {children}
    </View>
  );
}

function Ligne({
  titre,
  etat,
  vers,
  dernier = false,
  testID,
}: {
  titre: string;
  etat?: string;
  /** Le nom de l'écran dans le navigateur d'onglets. */
  vers: string;
  dernier?: boolean;
  testID: string;
}) {
  const c = useColors();
  const navigation = useNavigation();

  return (
    /**
     * **Un `Pressable`, et la première version n'en était pas un.** Elle posait
     * `onStartShouldSetResponder` et `onResponderRelease` à la main : la ligne
     * répondait au doigt sur un appareil, sans retour visuel, et ne répondait à
     * rien du tout sous test — `fireEvent.press` cherche un gestionnaire de
     * pression, pas un responder brut. Le menu menait donc nulle part, et
     * seule la garde qui appuie pour de bon l'a dit.
     */
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={etat ? `${titre} — ${etat}` : titre}
      onPress={() => navigation.navigate(vers as never)}
      testID={testID}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingHorizontal: 16,
        minHeight: 60,
        opacity: pressed ? 0.7 : 1,
        borderBottomWidth: dernier ? 0 : 1,
        borderBottomColor: c['line.default'],
      })}
    >
      <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
        <Texte variante="type.body">{titre}</Texte>
        {etat ? (
          <Texte variante="type.caption" couleur="ink.soft" testID={`${testID}-etat`}>
            {etat}
          </Texte>
        ) : null}
      </View>
      <Icone nom="chevron" couleur="ink.soft" taille={20} />
    </Pressable>
  );
}
