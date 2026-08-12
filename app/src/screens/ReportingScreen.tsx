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
 *
 * **Trois repères, puis le détail** (campagne 2). C'était « une longue liste de
 * chiffres sans hiérarchie » : onze lignes de même poids, où le nombre qui
 * répond à la question — est-ce que ça marche — se lisait exactement comme le
 * nombre d'annulations. Les trois chiffres qui répondent passent en tête, en
 * grand ; les onze restent, groupés et nommés, parce qu'un salon qui doute
 * veut pouvoir vérifier.
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
import { formatDate, formatNumber } from '../format';
import { useI18n, type SupportedLocale } from '../i18n';

/**
 * Un jour, avec son mois en lettres.
 *
 * « 10/07/2026 » se lit octobre à Miami et juillet à Paris. Un rapport qui se
 * lit à deux mois d'écart selon le lecteur ne se lit pas. Le format vient de
 * `format.ts` : la même règle écrite deux fois finit par diverger, et c'est
 * exactement ce qui s'était produit sur six écrans.
 */
function jourLisible(instant: string, locale: SupportedLocale): string {
  return formatDate(instant, locale, 'UTC');
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
        // **Le cas de tout salon qui s'inscrit**, et le premier qu'il voit de
        // cette page. « Rien dans cette fenêtre » se lisait comme une panne de
        // filtre ; il n'y a pas de fenêtre à corriger, il n'y a pas encore
        // d'histoire — et il n'y a rien à régler pour qu'elle commence.
        <EmptyState
          title={t('reporting.videTitre')}
          body={`${t('reporting.vide')} ${t('reporting.videSuite')}`}
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

          {/* Les trois chiffres qui répondent à « est-ce que ça marche ».
              Publications livrées, part tenue, portée. Le reste sert à
              vérifier, pas à décider. */}
          <Reperes vue={vue} />

          <Section titre={t('reporting.sectionReservations')}>
            <DataRow label={t('reporting.reservations')} value={String(vue.reservations)} chiffre />
            <DataRow
              label={t('reporting.consommations')}
              value={String(vue.consommations)}
              chiffre
            />
            <DataRow label={t('reporting.absences')} value={String(vue.absences)} chiffre />
            <DataRow label={t('reporting.annulations')} value={String(vue.annulations)} chiffre />
          </Section>

          <Section titre={t('reporting.sectionPublications')}>
            <DataRow
              label={t('reporting.attendues')}
              value={String(vue.publications_attendues)}
              chiffre
            />
            <DataRow label={t('reporting.nonHonorees')} value={String(vue.non_honorees)} chiffre />
          </Section>

          <Section titre={t('reporting.sectionValeur')}>
            <DataRow
              testID="valeur-offerte"
              label={t('reporting.valeurOfferte')}
              value={`${(vue.valeur_offerte_cents / 100).toFixed(2)} ${vue.currency}`}
              chiffre
            />
          </Section>

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


/** Jamais moins : une barre seule n'est pas une évolution. */
const SEMAINES_MINIMUM = 4;
/** Jamais plus : au-delà, les étiquettes ne se lisent plus. */
const SEMAINES_MAXIMUM = 12;

/**
 * L'axe suit la vie du commerce, pas une fenêtre fixe.
 *
 * **Douze semaines en dur donnaient onze barres vides à tout salon de moins de
 * trois mois** — relevé en campagne 2 comme « une seule barre visible sur
 * douze ». Ce n'était pas un défaut du graphique : c'était un axe qui décrivait
 * une histoire que le commerce n'avait pas encore. Un salon qui vient d'ouvrir
 * doit voir ses quatre semaines, pas le vide des huit précédentes.
 *
 * L'axe part donc de la première semaine où quelque chose s'est passé, borné à
 * quatre — une barre seule n'est pas une évolution — et à douze, au-delà
 * desquelles les étiquettes ne se lisent plus.
 *
 * **Les trous à l'intérieur restent.** La base ne rend que les semaines où
 * quelque chose a été publié : un `GROUP BY` ne fabrique pas les vides. Les
 * omettre resserrerait l'axe et ferait croire à une régularité qui n'existe
 * pas — trois publications en trois mois se liraient comme trois semaines de
 * suite. C'est l'inverse du cas précédent : ici le vide est une information,
 * là-bas il était une absence d'histoire.
 */
export function semainesCompletes(vue: Reporting): BarreVerticale[] {
  const parDebut = new Map(vue.par_semaine.map((ligne) => [ligne.debut, ligne.publications]));

  // On remonte depuis la dernière semaine de la fenêtre, pas depuis
  // aujourd'hui : la fenêtre est ce que le commerce a demandé à voir.
  const fin = new Date(vue.fin);
  const lundi = new Date(fin);
  lundi.setUTCDate(fin.getUTCDate() - ((fin.getUTCDay() + 6) % 7));

  // Combien de semaines séparent la plus ancienne trace de la fin de fenêtre.
  // Sans trace, il n'y a pas d'axe à dessiner — l'appelant ne rend rien.
  const premiere = vue.par_semaine
    .map((ligne) => new Date(`${ligne.debut}T00:00:00Z`).getTime())
    .sort((x, y) => x - y)[0];
  const ecoulees =
    premiere === undefined
      ? SEMAINES_MINIMUM
      : Math.floor((lundi.getTime() - premiere) / (7 * 86_400_000)) + 1;

  const semaines = Math.min(SEMAINES_MAXIMUM, Math.max(SEMAINES_MINIMUM, ecoulees));

  return Array.from({ length: semaines }, (_, rang) => {
    const jour = new Date(lundi);
    jour.setUTCDate(lundi.getUTCDate() - (semaines - 1 - rang) * 7);
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

/** Un groupe de lignes, nommé. Onze lignes d'affilée ne se lisent pas. */
function Section({ titre, children }: { titre: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: 4 }}>
      <Texte variante="type.label" couleur="text.secondary">
        {titre}
      </Texte>
      {children}
    </View>
  );
}

/**
 * Les trois chiffres qui répondent à la question de l'écran.
 *
 * **C'est l'écran qui doit convaincre un salon que ça marche**, et la preuve
 * tient en trois nombres : combien de publications sont revenues, quelle part
 * des places données a été tenue, et combien de personnes ont pu le voir. Le
 * reste — annulations, absences, attendues — sert à vérifier, jamais à décider.
 *
 * Le taux nul reste en mots. Zéro sur zéro n'est pas zéro, et l'afficher en
 * grand à un salon qui n'a encore servi personne en ferait un reproche.
 */
function Reperes({ vue }: { vue: Reporting }) {
  const { t, locale } = useI18n();

  // **La note suit son chiffre.** Un pourcentage qui nomme ses deux termes
  // trois blocs plus bas ne les nomme plus ; et une portée annoncée comme
  // approximative loin du nombre laisse le nombre passer pour un résultat.
  const reperes: {
    cle: string;
    valeur: string;
    libelle: string;
    chiffre: boolean;
    note: string | null;
  }[] = [
    {
      cle: 'publications',
      valeur: String(vue.publications),
      libelle: t('reporting.publications'),
      chiffre: true,
      note: null,
    },
    {
      cle: 'taux',
      // **La fraction est le chiffre, et il n'y a plus de pourcentage.**
      // « 29 % » s'affichait au-dessus de « 2 of 7 », qui vaut 28,57 : un seul
      // calcul, mais arrondi à l'entier au-dessus de sa propre fraction. Aucun
      // arrondi ne peut les réconcilier — sur sept prestations, un point de
      // pourcentage n'existe pas. La maison sait déjà le dire : « 2 étapes sur
      // 4 » se comprend, « 50 % » ne dit pas laquelle manque.
      valeur:
        vue.taux_d_honoration === null
          ? t('reporting.tauxInconnu')
          : t('reporting.tauxFraction', {
              publications: vue.publications,
              consommations: vue.consommations,
            }),
      libelle: t('reporting.taux'),
      chiffre: vue.taux_d_honoration !== null,
      note: vue.taux_d_honoration === null ? null : t('reporting.tauxAide'),
    },
    {
      cle: 'portee',
      // Séparateur de milliers : « 128000 » se compte à la main.
      valeur: formatNumber(vue.portee_approximative, locale),
      libelle: t('reporting.portee'),
      chiffre: true,
      note: t('reporting.porteeNote'),
    },
  ];

  return (
    <View
      testID="reperes"
      style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 24, paddingBottom: 4 }}
    >
      {reperes.map((repere) => (
        <View key={repere.cle} style={{ width: 260, gap: 2 }} testID={`repere-${repere.cle}`}>
          <Texte
            variante={repere.chiffre ? 'type.figure' : 'type.heading'}
            testID={repere.cle === 'taux' ? 'taux' : undefined}
          >
            {repere.valeur}
          </Texte>
          <Texte variante="type.caption" couleur="text.secondary">
            {repere.libelle}
          </Texte>
          {repere.note ? (
            <Texte
              variante="type.caption"
              couleur="text.muted"
              testID={repere.cle === 'taux' ? 'taux-aide' : 'note-portee'}
            >
              {repere.note}
            </Texte>
          ) : null}
        </View>
      ))}
    </View>
  );
}
