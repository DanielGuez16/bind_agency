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
import { DataRow, EmptyState, Texte, TierBadge } from '../components';
import { useI18n } from '../i18n';
import { Ecran } from './Ecran';
import { useRequete } from './useRequete';

export function ReportingScreen({ businessId }: { businessId: string }) {
  const { api } = useApi();
  const { t } = useI18n();

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
              debut: new Date(vue.debut).toLocaleDateString(),
              fin: new Date(vue.fin).toLocaleDateString(),
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
              value={String(vue.portee_approximative)}
              chiffre
            />
            <Texte variante="type.caption" couleur="text.muted" testID="note-portee">
              {t('reporting.porteeNote')}
            </Texte>
          </View>

          {vue.par_palier.length ? (
            <View style={{ gap: 6 }}>
              <Texte variante="type.label" couleur="text.secondary">
                {t('reporting.parPalier')}
              </Texte>
              {vue.par_palier.map((ligne) => (
                <View
                  key={ligne.tier_id}
                  testID={`palier-${ligne.tier_id}`}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}
                >
                  <TierBadge tier={ligne.content_format} size="sm" />
                  <Texte variante="type.mono">{String(ligne.publications)}</Texte>
                </View>
              ))}
            </View>
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
