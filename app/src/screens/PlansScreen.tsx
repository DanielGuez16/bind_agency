/**
 * 18a · Plans d'abonnement.
 *
 * **Le seul écran du produit qui affiche des montants.** Il est réservé au rôle
 * administrateur, et rien de ce qu'il montre n'est repris ailleurs.
 *
 * **Le revenu mensuel vient du serveur.** Un plan annuel et un plan mensuel
 * n'ont pas la même unité ; laisser l'écran diviser par douze ferait d'une
 * règle de facturation une décision de mise en page, à réécrire dans chaque
 * client.
 *
 * **Lecture seule, et l'écran le dit une fois, en haut.** La modification d'un
 * plan touche la facturation et attend Stripe : offrir un champ modifiable ici
 * ferait croire à une action qui n'existe pas. Le dire vaut mieux que ne rien
 * dire, et **mieux que de griser un bouton** — un bouton grisé promet qu'il
 * s'allumera, et rien ici ne s'allumera. La règle de la maison est que l'action
 * impossible est retirée ; la mention en haut est ce qui la remplace, une seule
 * fois, plutôt que six fois en gris.
 *
 * **Trois lignes ne se rempliront jamais** (campagne 2). Le catalogue compte
 * trois plans et n'a pas vocation à grossir : cet écran ne gagnera pas sa
 * largeur en lignes, il la gagne en contexte. Le revenu total et le nombre de
 * salons abonnés passent en tête — ce sont les deux nombres qu'on vient
 * chercher — et chaque ligne dit son intervalle de facturation et son état.
 *
 * **Rien ne s'additionne entre devises.** Le total n'existe que si tous les
 * plans partagent la même ; sinon l'écran le dit et n'additionne pas. Un total
 * faux est pire qu'un total absent, surtout sur le seul écran du produit qui
 * affiche de l'argent.
 */
import { View } from 'react-native';

import { useApi, type PlanAdministrateur } from '../api';
import {
  EmptyState,
  SkeletonLignes,
  TableHeader,
  TableRow,
  Texte,
  type Colonne,
} from '../components';
import { useI18n } from '../i18n';
import { Ecran } from './Ecran';
import { useRequete } from './useRequete';

export function PlansScreen() {
  const { api } = useApi();
  const { t } = useI18n();

  const requete = useRequete<PlanAdministrateur[]>((signal) => api.plans(signal), {
    estVide: (plans) => plans.length === 0,
  });

  const colonnes: Colonne[] = [
    { cle: 'name', label: t('admin.plansTitre'), largeur: 200 },
    { cle: 'intervalle', label: t('admin.plansIntervalle'), largeur: 100 },
    { cle: 'prix', label: t('admin.plansPrix'), largeur: 110, chiffre: true },
    { cle: 'abonnes', label: t('admin.plansAbonnes'), largeur: 90, chiffre: true },
    { cle: 'actifs', label: t('admin.plansActifs'), largeur: 90, chiffre: true },
    { cle: 'mrr', label: t('admin.plansMrr'), largeur: 130, chiffre: true },
  ];

  return (
    <Ecran
      requete={requete}
      titre={t('admin.plansTitre')}
      squelette={<SkeletonLignes combien={3} testID="squelette-plans" />}
      testID="ecran-plans"
      vide={<EmptyState title={t('admin.plansTitre')} body={t('admin.plansVide')} />}
    >
      {(plans) => {
        const totaux = totaliser(plans);

        return (
          <View style={{ gap: 20 }}>
            <Texte variante="type.label" couleur="ink.mute" testID="lecture-seule">
              {t('admin.plansLectureSeule')}
            </Texte>

            <Totaux totaux={totaux} />

            <View>
              <TableHeader colonnes={colonnes} />
              {plans.map((plan) => (
                <TableRow
                  key={plan.plan_id}
                  testID={`plan-${plan.plan_id}`}
                  colonnes={colonnes}
                  valeurs={{
                    name: plan.is_active ? plan.name : `${plan.name} · ${t('admin.plansInactif')}`,
                    intervalle:
                      plan.billing_interval === 'yearly'
                        ? t('admin.plansAnnuel')
                        : t('admin.plansMensuel'),
                    prix: montant(plan.price_cents, plan.currency),
                    // **Zéro se dit en mots.** « 0 » dans une colonne de
                    // chiffres se lit comme une mesure ; un plan que personne
                    // n'a pris est une information d'une autre nature.
                    abonnes:
                      plan.subscriptions_count === 0
                        ? t('admin.plansSansPreneur')
                        : String(plan.subscriptions_count),
                    actifs: String(plan.active_subscriptions_count),
                    mrr: montant(plan.mrr_cents, plan.currency),
                  }}
                />
              ))}
              {/* **Un total par groupe qui s'additionne vraiment.** Une
                  seule ligne de somme rendait « — » dès que deux devises se
                  croisaient, et un tiret ne dit rien. */}
              {totaux.map((groupe) => (
                <TableRow
                  key={`${groupe.devise}-${groupe.periodicite}`}
                  testID={`plans-total-${groupe.devise}-${groupe.periodicite}`}
                  colonnes={colonnes}
                  valeurs={{
                    name: t(
                      groupe.periodicite === 'yearly'
                        ? 'admin.plansTotalAnnuel'
                        : 'admin.plansTotalMensuel',
                      { devise: groupe.devise },
                    ),
                    intervalle: '',
                    prix: '',
                    abonnes: String(groupe.abonnes),
                    actifs: String(groupe.actifs),
                    mrr: montant(groupe.revenuCents, groupe.devise),
                  }}
                />
              ))}
            </View>

            {/* **Un mensuel calculé n'est pas un prix mensuel.** Un plan
                facturé à l'année porte un revenu mensuel qui est la division du
                serveur ; posé dans la même colonne qu'un prix mensuel, il se
                lit comme un tarif. La note le dit là où le chiffre est, pas
                dans une légende générale. */}
            {plans.some((plan) => plan.billing_interval === 'yearly') ? (
              <Texte variante="type.caption" couleur="ink.mute" testID="note-annuel">
                {t('admin.plansNoteAnnuel')}
              </Texte>
            ) : null}

            {/* **Pourquoi deux totaux et jamais un.** La règle se dit là où
                elle s'applique : c'est le seul écran du produit qui montre de
                l'argent, et aucun taux de change n'est stocké. */}
            {totaux.length > 1 ? (
              <Texte variante="type.caption" couleur="ink.mute" testID="devises-melees">
                {t('admin.plansDevisesMelees')}
              </Texte>
            ) : null}
          </View>
        );
      }}
    </Ecran>
  );
}

/**
 * Des centimes entiers vers une somme lisible.
 *
 * La division par cent se fait à l'affichage et nulle part ailleurs : les
 * montants restent des entiers partout dans le produit, parce qu'un flottant
 * finit toujours par perdre un centime.
 */
function montant(cents: number, devise: string): string {
  return `${(cents / 100).toFixed(2)} ${devise}`;
}

/**
 * Un total, pour un groupe qui s'additionne vraiment.
 *
 * La devise **et** la périodicité : additionner un mensuel et un annuel dans la
 * même devise donnerait un nombre qui n'est ni l'un ni l'autre.
 */
export type TotalDUnGroupe = {
  devise: string;
  periodicite: 'monthly' | 'yearly';
  revenuCents: number;
  abonnes: number;
  actifs: number;
};

/**
 * Les sommes, et le refus d'additionner ce qui ne s'additionne pas.
 *
 * **Deux totaux, jamais un seul — et jamais un tiret.** La version d'avant
 * additionnait tout et rendait « — » dès que deux devises se croisaient : un
 * tiret ne dit rien, et c'était la seule chose que l'écran affichait alors du
 * revenu. Un groupe par devise et périodicité dit tout, et n'invente rien :
 * **aucun taux de change n'est stocké**, donc un chiffre combiné serait un
 * chiffre inventé — sur le seul écran du produit qui montre de l'argent.
 *
 * Exporté pour être éprouvé sans écran : « ne pas totaliser deux devises » est
 * une règle, pas une mise en page, et c'est la seule de cet écran qui puisse
 * produire un chiffre faux.
 */
export function totaliser(plans: PlanAdministrateur[]): TotalDUnGroupe[] {
  const groupes = new Map<string, TotalDUnGroupe>();

  for (const plan of plans) {
    const cle = `${plan.currency}·${plan.billing_interval}`;
    const groupe = groupes.get(cle) ?? {
      devise: plan.currency,
      periodicite: plan.billing_interval,
      revenuCents: 0,
      abonnes: 0,
      actifs: 0,
    };
    groupe.revenuCents += plan.mrr_cents;
    groupe.abonnes += plan.subscriptions_count;
    groupe.actifs += plan.active_subscriptions_count;
    groupes.set(cle, groupe);
  }

  // L'ordre du serveur, stable : deux totaux qui changent de place d'un
  // chargement à l'autre se relisent à chaque fois.
  return [...groupes.values()];
}

/**
 * Ce qu'on vient chercher avant de lire le détail.
 *
 * **Un cartouche par groupe qui s'additionne, et pas un de plus.** La version
 * d'avant posait un revenu unique et rendait « — » dès que deux devises se
 * croisaient : le seul chiffre d'argent de l'écran était alors un tiret. Deux
 * cartouches côte à côte disent chacun une vérité entière, et leur juxtaposition
 * dit ce qu'aucun total combiné ne pourrait dire sans taux de change.
 *
 * **Le plan annuel affiche son revenu tel qu'il est facturé.** Aucun mensuel
 * n'est calculé pour lui : un chiffre divisé, posé à côté de deux prix mensuels
 * réels, se lit comme un troisième prix — et ce n'en est pas un.
 */
function Totaux({ totaux }: { totaux: TotalDUnGroupe[] }) {
  const { t } = useI18n();

  return (
    <View
      testID="totaux"
      style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 24, paddingBottom: 4 }}
    >
      {totaux.map((groupe) => (
        <View
          key={`${groupe.devise}-${groupe.periodicite}`}
          style={{ width: 260, gap: 2 }}
          testID={`total-${groupe.devise}-${groupe.periodicite}`}
        >
          <Texte variante="type.figure">{montant(groupe.revenuCents, groupe.devise)}</Texte>
          <Texte variante="type.caption" couleur="ink.soft">
            {t(
              groupe.periodicite === 'yearly'
                ? 'admin.plansTotalAnnuel'
                : 'admin.plansTotalMensuel',
              { devise: groupe.devise },
            )}
          </Texte>
        </View>
      ))}
      <View style={{ width: 260, gap: 2 }} testID="total-abonnes">
        <Texte variante="type.figure">
          {String(totaux.reduce((somme, groupe) => somme + groupe.actifs, 0))}
        </Texte>
        <Texte variante="type.caption" couleur="ink.soft">
          {t('admin.plansSalonsAbonnes')}
        </Texte>
      </View>
    </View>
  );
}
