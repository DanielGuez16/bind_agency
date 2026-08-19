/**
 * Ce à quoi on s'engage, écrit avant de s'y engager.
 *
 * **C'est le seul moment du parcours où l'engagement peut être dit avant d'être
 * pris.** Après le bouton, il n'est plus une information mais une obligation ;
 * derrière un lien, il n'est plus lu. Il vit donc au-dessus du bouton, en trois
 * lignes qui tiennent dans un regard.
 *
 * **Trois lignes, et chacune répond à une question qu'on se pose vraiment** :
 * qu'est-ce que je dois publier, qui dois-je citer, et pour quand. La
 * troisième était « within 48 h » — un délai qu'il fallait compter depuis une
 * date qu'on venait de choisir. Elle est maintenant une échéance calculée, en
 * toutes lettres.
 *
 * **L'annulation est dans le même bloc et pas dans des conditions générales.**
 * Ce qu'on risque en ne venant pas fait partie de ce à quoi on s'engage ; le
 * ranger ailleurs revient à ne le dire qu'à ceux qui le cherchent, c'est-à-dire
 * à ceux qui l'ont déjà compris.
 */
import { View } from 'react-native';

import type { OffreDeLaFiche } from '../../api';
import { Icone, LigneDeContrepartie, Texte } from '../../components';
import { formatNumber, nomDeJour } from '../../format';
import { useI18n } from '../../i18n';
import produit from '../../theme/produit.json';
import { elevationDeCarte, radius, useTheme } from '../../theme';
import { nomDePlateforme } from '../obstacle';

/**
 * Le délai d'annulation sans conséquence, en heures.
 *
 * Vingt-quatre heures : c'est le délai que le produit applique déjà au
 * décompte de fiabilité, et le répéter ici en un autre nombre ferait deux
 * règles pour un même refus.
 */
export const ANNULATION_LIBRE_H = 24;

export function Engagement({
  offre,
  quand,
  nomDuSalon,
  timezone,
}: {
  offre: OffreDeLaFiche;
  /** L'instant réservé, en ISO. Nul quand la prestation ne se réserve pas. */
  quand: string | null;
  nomDuSalon: string;
  timezone: string;
}) {
  const { t, locale } = useI18n();
  const { color: c } = useTheme();

  const limite = quand ? echeance(quand, offre.content_format, locale, timezone) : null;

  const attendu = [
    offre.required_mention ? offre.required_mention : null,
    offre.required_geotag ? nomDuSalon : null,
  ].filter(Boolean);

  return (
    <View style={{ gap: 10 }} testID="engagement">
      <Texte variante="type.section">{t('parcours.creneauxEngagementTitre')}</Texte>

      <View
        style={{
          borderRadius: radius['radius.lg'],
          backgroundColor: c['bg.surface'],
          borderWidth: 1,
          borderColor: c['line.default'],
          overflow: 'hidden',
          // « Un coin de 18 px sans ombre flotte au lieu de se poser » :
          // passation §2. La planche dessine ce bloc sans ombre ; la règle est
          // catégorique et vient avec les rayons, pas par écran.
          ...elevationDeCarte(),
        }}
      >
        <LigneDEngagement glyphe="paliers" premiere testID="engagement-contrepartie">
          <LigneDeContrepartie
            tier={offre.content_format}
            plateforme={nomDePlateforme(offre.platform)}
          />
        </LigneDEngagement>

        {/* **Ce que le commerce attend, rappelé avant la réservation.** Mention
            et lieu sont les deux éléments contrôlés ; les découvrir sur l'écran
            de preuve serait les découvrir trop tard. Absente quand il n'y a
            rien à citer — une ligne vide ferait chercher ce qu'elle demande. */}
        {attendu.length ? (
          <LigneDEngagement glyphe="lieu" testID="engagement-mention">
            <Texte variante="type.body" couleur="ink.soft">
              {t('parcours.creneauxEngagementCiter', { quoi: attendu.join(' · ') })}
            </Texte>
          </LigneDEngagement>
        ) : null}

        {/* **L'échéance, calculée et écrite.** « Sous 48 h » demandait de
            compter depuis une date qu'on venait de choisir, sur un écran où
            l'on décide. Absente sans instant réservé : une prestation qui ne se
            réserve pas n'a pas d'échéance à annoncer. */}
        {quand && limite ? (
          <LigneDEngagement glyphe="horloge" testID="engagement-echeance">
            <Texte variante="type.body" couleur="ink.soft">
              {t('parcours.creneauxEngagementPublierAvant')}
              <Texte variante="type.bodyStrong" couleur="ink.default">
                {limite}
              </Texte>
            </Texte>
          </LigneDEngagement>
        ) : null}
      </View>

      <View
        testID="si-vous-ne-venez-pas"
        style={{
          borderRadius: radius['radius.lg'],
          backgroundColor: c['bg.deep'],
          padding: 16,
          gap: 9,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
          {/* Le glyphe est obligatoire : l'avertissement n'a pas de teinte dans
              cette direction, et c'est le seul marqueur qui lui reste. */}
          <View style={{ marginTop: 4 }}>
            <Icone nom="alerte" couleur="ink.default" taille={18} />
          </View>
          <Texte variante="type.bodyStrong" style={{ flex: 1 }}>
            {t('parcours.creneauxAnnulationTitre')}
          </Texte>
        </View>
        <Texte variante="type.body" couleur="ink.soft">
          {t('parcours.creneauxAnnulationCorps', {
            heures: formatNumber(ANNULATION_LIBRE_H, locale),
          })}
        </Texte>
        {/* **Le score est gradué et se rattrape**, et le dire ici n'est pas une
            douceur : un décompte présenté comme définitif fait renoncer à
            réserver plutôt qu'à annuler. */}
        <Texte variante="type.caption" couleur="ink.soft">
          {t('parcours.creneauxAnnulationScore')}
        </Texte>
      </View>
    </View>
  );
}

/** Une ligne du bloc : son glyphe, et ce qu'elle dit. */
function LigneDEngagement({
  glyphe,
  children,
  premiere = false,
  testID,
}: {
  glyphe: 'paliers' | 'lieu' | 'horloge';
  children: React.ReactNode;
  premiere?: boolean;
  testID: string;
}) {
  const { color: c } = useTheme();
  return (
    <View
      testID={testID}
      style={{
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: 10,
        padding: 15,
        borderTopWidth: premiere ? 0 : 1,
        borderTopColor: c['line.default'],
      }}
    >
      <View style={{ marginTop: 4 }}>
        <Icone nom={glyphe} couleur="ink.soft" taille={18} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>{children}</View>
    </View>
  );
}

/**
 * L'échéance de publication : le créneau, plus le délai du palier.
 *
 * **Calculée ici et non servie**, parce qu'elle n'existe pas encore : la
 * réservation n'est pas prise, et `deadline_at` n'arrive qu'avec elle. Ce qu'on
 * annonce est donc une promesse du palier appliquée à l'heure choisie — la
 * même arithmétique que le serveur fera, sur les deux mêmes nombres.
 */
function echeance(
  quand: string,
  palier: string,
  locale: 'en' | 'es',
  timezone: string,
): string | null {
  // **Un palier inconnu ne fait pas tomber l'écran, il retire la ligne.** Le
  // format vient du serveur ; s'il en invente un troisième, annoncer une
  // échéance calculée sur un délai absent serait pire que se taire. Le
  // `delaiHeures` d'un palier connu, lui, est garanti par un test d'accord.
  const regle = produit.tier[palier as 'story' | 'post' | 'reel'];
  if (!regle) return null;

  const limite = new Date(new Date(quand).getTime() + regle.delaiHeures * 3_600_000);
  const jourNu = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, dateStyle: 'short' }).format(
    limite,
  );
  const heure = new Intl.DateTimeFormat(locale, { timeStyle: 'short', timeZone: timezone }).format(
    limite,
  );
  return `${nomDeJour(jourNu, locale, 'long')}, ${heure}`;
}
