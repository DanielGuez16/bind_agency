/**
 * Reporting du commerce : ce que sa participation lui a rapporté.
 *
 * **Le seul montant qu'un commerce voit, et il est du côté de ce qu'il
 * donne.** `valeur_offerte_cents` n'est pas un revenu, et le libellé le dit :
 * « ce que vous avez donné ». Sans lui, « douze publications » ne se met en
 * regard de rien.
 *
 * **Le taux nul ne s'affiche pas comme zéro.** Zéro sur zéro n'est pas zéro, et
 * afficher 0 % à un commerce qui n'a encore servi personne serait un reproche
 * pour quelque chose qu'il n'a pas fait.
 *
 * **La portée est annoncée comme approximative, en toutes lettres.** Le nombre
 * d'abonnés d'un compte n'est pas le nombre de personnes ayant vu une story ;
 * le rendre sans le dire ferait prendre une approximation pour un résultat.
 */
import { View } from 'react-native';

import { useApi, type Reporting } from '../api';
import {
  BarresParPalier,
  BarresParPeriode,
  DataRow,
  EmptyState,
  Texte,
  type BarreVerticale,
} from '../components';
import { useI18n } from '../i18n';

/**
 * Un jour, avec son mois en lettres.
 *
 * « 10/07/2026 » se lit octobre à Miami et juillet à Paris. Un rapport qui se
 * lit à deux mois d'écart selon le lecteur ne se lit pas.
 */
function jourLisible(instant: string, locale: string): string {
  return new Date(instant).toLocaleDateString(locale, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}
import { Ecran } from './Ecran';
import { useRequete } from './useRequete';

export function ReportingScreen({ businessId }: { businessId: string }) {
  const { api } = useApi();
  const { t, locale } = useI18n();

  const requete = useRequete<Reporting>((signal) => api.reporting(businessId, {}, signal), {
    // Une fenêtre sans réservation n'est pas une erreur : c'est un commerce qui
    // débute, ou un mois calme. L'écran doit le dire, pas proposer de réessayer.
    estVide: (vue) => vue.reservations === 0,
    dependances: [businessId],
  });

  return (
    <Ecran
      requete={requete}
      titre={t('reporting.titre')}
      testID="ecran-reporting"
      vide={
        <EmptyState
          title={t('reporting.titre')}
          body={t('reporting.vide')}
          testID="reporting-vide"
        />
      }
    >
      {(vue) => (
        <View style={{ gap: 16 }}>
          <Texte variante="type.caption" couleur="text.muted" testID="fenetre">
            {t('reporting.fenetre', {
              // Le mois en lettres : « 10/07/2026 » se lit octobre à Miami et
              // juillet à Paris, et un rapport qui se lit à deux mois d'écart
              // ne se lit pas.
              debut: jourLisible(vue.debut, locale),
              fin: jourLisible(vue.fin, locale),
            })}
          </Texte>

          <View>
            <DataRow label={t('reporting.reservations')} value={String(vue.reservations)} chiffre />
            <DataRow
              label={t('reporting.consommations')}
              value={String(vue.consommations)}
              chiffre
            />
            <DataRow label={t('reporting.absences')} value={String(vue.absences)} chiffre />
            <DataRow label={t('reporting.annulations')} value={String(vue.annulations)} chiffre />
          </View>

          <View>
            <DataRow label={t('reporting.publications')} value={String(vue.publications)} chiffre />
            <DataRow
              label={t('reporting.attendues')}
              value={String(vue.publications_attendues)}
              chiffre
            />
            <DataRow label={t('reporting.nonHonorees')} value={String(vue.non_honorees)} chiffre />
            <DataRow
              testID="taux"
              label={t('reporting.taux')}
              // Nul et non zéro : le premier se dit en mots, le second en
              // pourcentage. Les confondre transformerait une absence de
              // mesure en mauvais résultat.
              value={
                vue.taux_d_honoration === null
                  ? t('reporting.tauxInconnu')
                  : `${Math.round(vue.taux_d_honoration * 100)} %`
              }
              chiffre={vue.taux_d_honoration !== null}
            />
            {/* Le pourcentage nomme ses deux termes. « 29 % » au milieu de
                comptes bruts laisse deviner de quoi il est le pourcentage, et
                chacun devine autre chose. */}
            {vue.taux_d_honoration !== null ? (
              <Texte variante="type.caption" couleur="text.muted" testID="taux-aide">
                {t('reporting.tauxAide', {
                  publications: vue.publications,
                  consommations: vue.consommations,
                })}
              </Texte>
            ) : null}
          </View>

          <View>
            <DataRow
              testID="valeur-offerte"
              label={t('reporting.valeurOfferte')}
              value={`${(vue.valeur_offerte_cents / 100).toFixed(2)} ${vue.currency}`}
              chiffre
            />
            <DataRow
              label={t('reporting.portee')}
              // Séparateur de milliers : « 128000 » se compte à la main.
              value={vue.portee_approximative.toLocaleString(locale)}
              chiffre
            />
            <Texte variante="type.caption" couleur="text.muted" testID="note-portee">
              {t('reporting.porteeNote')}
            </Texte>
          </View>

          {/* **Une évolution, pas seulement un total.** « 62 publications » se
              lit pareil qu'on en ait fait cinq par semaine ou soixante en une
              seule, et c'est la différence qui intéresse un salon. */}
          {vue.par_semaine.length ? (
            <BarresParPeriode
              titre={t('reporting.publicationsParSemaine')}
              soustitre={t('reporting.parSemaineNote')}
              series={semainesCompletes(vue)}
              testID="graphique-par-semaine"
            />
          ) : null}

          {vue.par_palier.length ? (
            <BarresParPalier
              titre={t('reporting.parPalier')}
              series={vue.par_palier.map((ligne) => ({
                palier: ligne.content_format,
                valeur: ligne.publications,
              }))}
              testID="graphique-par-palier"
            />
          ) : null}

          {vue.par_item.length ? (
            <View style={{ gap: 4 }}>
              <Texte variante="type.label" couleur="text.secondary">
                {t('reporting.parItem')}
              </Texte>
              {vue.par_item.map((ligne) => (
                <DataRow
                  key={ligne.catalog_item_id}
                  testID={`item-${ligne.catalog_item_id}`}
                  label={ligne.name}
                  value={`${ligne.consommations} · ${ligne.publications}`}
                  chiffre
                />
              ))}
            </View>
          ) : null}
        </View>
      )}
    </Ecran>
  );
}


/**
 * Douze semaines, trous compris.
 *
 * La base ne rend que les semaines où quelque chose a été publié : un `GROUP BY`
 * ne fabrique pas les vides. Les afficher telles quelles resserrerait l'axe et
 * ferait croire à une régularité qui n'existe pas — trois publications en trois
 * mois se liraient comme trois semaines de suite.
 */
function semainesCompletes(vue: Reporting): BarreVerticale[] {
  const SEMAINES = 12;
  const parDebut = new Map(vue.par_semaine.map((ligne) => [ligne.debut, ligne.publications]));

  // On remonte depuis la dernière semaine de la fenêtre, pas depuis
  // aujourd'hui : la fenêtre est ce que le commerce a demandé à voir.
  const fin = new Date(vue.fin);
  const lundi = new Date(fin);
  lundi.setUTCDate(fin.getUTCDate() - ((fin.getUTCDay() + 6) % 7));

  return Array.from({ length: SEMAINES }, (_, rang) => {
    const jour = new Date(lundi);
    jour.setUTCDate(lundi.getUTCDate() - (SEMAINES - 1 - rang) * 7);
    const cle = jour.toISOString().slice(0, 10);
    return {
      etiquette: `W${numeroDeSemaine(jour)}`,
      valeur: parDebut.get(cle) ?? 0,
    };
  });
}

/** Le numéro ISO de la semaine. Ce que les étiquettes affichent. */
function numeroDeSemaine(jour: Date): number {
  const cible = new Date(Date.UTC(jour.getUTCFullYear(), jour.getUTCMonth(), jour.getUTCDate()));
  cible.setUTCDate(cible.getUTCDate() + 4 - ((cible.getUTCDay() + 6) % 7));
  const janvier = new Date(Date.UTC(cible.getUTCFullYear(), 0, 1));
  return Math.ceil(((cible.getTime() - janvier.getTime()) / 86400000 + 1) / 7);
}
