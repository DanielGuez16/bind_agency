/**
 * L'abonnement du commerce : ce qu'il achète, et comment il le prend.
 *
 * **C'est le trou du produit, et il était complet côté serveur.** Lire l'état,
 * lister les plans, souscrire, résilier — quatre routes, un client qui savait
 * les appeler, et aucun écran. L'annuaire refusait sur un 402 qui ne menait
 * nulle part : un commerce qui butait sur le mur n'avait aucun chemin vers
 * l'autre côté. Trois méthodes sans appelant, trouvées par la garde qui existe
 * pour ça.
 *
 * **Ce que l'abonnement achète est nommé, pas sous-entendu.** « Passer à
 * l'offre supérieure » ne dit rien ; « voir les créatrices autour de vous et
 * leur ouvrir des prestations » dit ce qu'on paie. C'est aussi ce que l'annuaire
 * refuse, et les deux phrases doivent se répondre.
 *
 * **Le paiement sort du produit, et l'écran le dit.** Le glyphe de sortie
 * accompagne l'adresse : la différence se voit avant l'appui, comme sur le
 * profil public d'une créatrice — les deux seuls endroits d'où l'on quitte
 * l'application.
 *
 * **Aucun montant n'est converti ni recomposé.** Le prix vient en centiers et
 * dans sa devise ; la division par cent se fait à l'affichage et nulle part
 * ailleurs.
 */
import { useState } from 'react';
import { Linking, View } from 'react-native';

import { useApi, type Abonnement, type PlanSouscriptible } from '../api';
import { Button, Icone, SkeletonLignes, StatusMessage, Texte } from '../components';
import { formatJour } from '../format';
import { useI18n } from '../i18n';
import { elevationDeCarte, radius, useColors } from '../theme';
import { adresseDePaiement, etatDeLAbonnement } from './abonnement/etat';
import { Ecran } from './Ecran';
import { useRequete } from './useRequete';

type Vue = { abonnement: Abonnement | null; plans: PlanSouscriptible[] };

export function AbonnementScreen({
  businessId,
  onRetour,
}: {
  businessId: string;
  onRetour?: () => void;
}) {
  const { api, messageDErreur } = useApi();
  const { t, locale } = useI18n();
  const c = useColors();
  const [envoi, setEnvoi] = useState<string | null>(null);
  const [echec, setEchec] = useState<string | null>(null);

  const requete = useRequete<Vue>(
    async (signal) => ({
      abonnement: await api.abonnement(businessId, signal),
      plans: await api.plansSouscriptibles(businessId, signal),
    }),
    // **Jamais vide.** Un commerce sans abonnement est le cas que cet écran
    // existe pour traiter, pas une absence de contenu.
    { estVide: () => false, dependances: [businessId] },
  );

  async function agir(cle: string, geste: () => Promise<unknown>) {
    setEchec(null);
    setEnvoi(cle);
    try {
      const rendu = await geste();
      // **L'adresse de paiement s'ouvre tout de suite.** La demander puis
      // attendre un second appui ferait perdre le seul instant où l'intention
      // est là — et la réponse porte l'adresse, elle ne se redemande pas.
      const url = (rendu as Abonnement | undefined)?.checkout_url;
      if (url) await Linking.openURL(url);
      requete.recharger();
    } catch (erreur) {
      setEchec(messageDErreur(erreur));
    } finally {
      setEnvoi(null);
    }
  }

  return (
    <Ecran
      requete={requete}
      onRetour={onRetour}
      titre={t('abonnement.titre')}
      nature="merchant"
      squelette={<SkeletonLignes combien={4} testID="squelette-abonnement" />}
      testID="ecran-abonnement"
    >
      {(vue) => {
        const etat = etatDeLAbonnement(vue.abonnement);
        const aRouvrir = adresseDePaiement(vue.abonnement);

        return (
          <View style={{ gap: 20 }}>
            {/* **Ce que l'abonnement ouvre, en tête.** C'est la seule raison de
                payer, et c'est exactement ce que l'annuaire refuse — les deux
                phrases se répondent. */}
            <View style={{ gap: 6 }}>
              <Texte variante="type.section">{t('abonnement.ceQueCaOuvre')}</Texte>
              <Texte variante="type.body" couleur="ink.soft">
                {t('abonnement.ceQueCaOuvreAide')}
              </Texte>
            </View>

            {echec ? <StatusMessage level="danger" body={echec} testID="echec-abonnement" /> : null}

            {etat === 'actif' ? (
              <EtatCourant
                abonnement={vue.abonnement as Abonnement}
                onResilier={() =>
                  void agir('resilier', () => api.resilier(businessId))
                }
                envoi={envoi === 'resilier'}
              />
            ) : null}

            {etat === 'impaye' ? (
              <StatusMessage
                level="warning"
                title={t('abonnement.impayeTitre')}
                body={t('abonnement.impayeAide')}
                testID="abonnement-impaye"
              />
            ) : null}

            {/* **Le paiement inachevé se reprend, il ne se recommence pas.**
                Souscrire de nouveau créerait un second abonnement à côté du
                premier — l'adresse servie est celle du paiement en cours. */}
            {aRouvrir ? (
              <View style={{ gap: 8 }} testID="paiement-a-finir">
                <Texte variante="type.bodyStrong">{t('abonnement.paiementAFinir')}</Texte>
                <Texte variante="type.caption" couleur="ink.soft">
                  {t('abonnement.paiementAFinirAide')}
                </Texte>
                <View style={{ alignSelf: 'flex-start' }}>
                  <Button
                    label={t('abonnement.reprendreLePaiement')}
                    loading={envoi === 'rouvrir'}
                    onPress={() =>
                      void agir('rouvrir', async () => ({ checkout_url: aRouvrir }))
                    }
                    testID="reprendre-le-paiement"
                  />
                </View>
              </View>
            ) : null}

            {/* Les plans, quand il y a un choix à faire. Un commerce en cours
                d'abonnement n'a pas à relire la grille : il l'a déjà choisie. */}
            {etat === 'actif' ? null : (
              <View style={{ gap: 12 }} testID="plans-souscriptibles">
                <Texte variante="type.label" couleur="ink.soft">
                  {t('abonnement.choisirUnPlan')}
                </Texte>
                {vue.plans.map((plan) => (
                  <View
                    key={plan.id}
                    testID={`plan-${plan.id}`}
                    style={{
                      gap: 8,
                      padding: 16,
                      borderRadius: radius['radius.lg'],
                      backgroundColor: c['bg.surface'],
                      borderWidth: 1,
                      borderColor: c['line.default'],
                      ...elevationDeCarte(),
                    }}
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 12 }}>
                      <Texte variante="type.bodyStrong" style={{ flex: 1 }}>
                        {plan.name}
                      </Texte>
                      <Texte variante="type.data" testID={`prix-${plan.id}`}>
                        {montant(plan.price_cents, plan.currency, locale)}
                      </Texte>
                    </View>
                    <Texte variante="type.caption" couleur="ink.mute">
                      {t(
                        plan.billing_interval === 'yearly'
                          ? 'abonnement.parAn'
                          : 'abonnement.parMois',
                      )}
                    </Texte>
                    <View style={{ alignSelf: 'flex-start', flexDirection: 'row', gap: 8 }}>
                      <Button
                        label={t('abonnement.souscrire')}
                        loading={envoi === plan.id}
                        onPress={() => void agir(plan.id, () => api.souscrire(businessId, plan.id))}
                        testID={`souscrire-${plan.id}`}
                      />
                    </View>
                  </View>
                ))}
              </View>
            )}

            {/* **Le paiement quitte l'application, et ça se voit avant
                l'appui.** Même règle que le profil public d'une créatrice : ce
                sont les deux seuls endroits d'où l'on sort. */}
            {etat === 'actif' ? null : (
              <View
                style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}
                testID="paiement-sort-du-produit"
              >
                <Icone nom="sortie" couleur="ink.mute" taille={15} />
                <Texte variante="type.caption" couleur="ink.mute" style={{ flex: 1 }}>
                  {t('abonnement.paiementDehors')}
                </Texte>
              </View>
            )}
          </View>
        );
      }}
    </Ecran>
  );
}

/** L'abonnement en cours : ce qu'il couvre, et comment on l'arrête. */
function EtatCourant({
  abonnement,
  onResilier,
  envoi,
}: {
  abonnement: Abonnement;
  onResilier: () => void;
  envoi: boolean;
}) {
  const { t, locale } = useI18n();

  return (
    <View style={{ gap: 10 }} testID="abonnement-actif">
      <StatusMessage
        level="neutral"
        title={t('abonnement.actifTitre')}
        body={
          abonnement.current_period_end
            ? t('abonnement.actifJusquA', {
                // Par `format.ts` et nulle part à la main : une fin de période
                // est un **jour**, pas un instant, et `formatJour` est la seule
                // forme du dépôt qui n'exige pas de fuseau pour en écrire un.
                date: formatJour(abonnement.current_period_end, locale),
              })
            : t('abonnement.actifCorps')
        }
        testID="abonnement-en-cours"
      />
      <View style={{ alignSelf: 'flex-start' }}>
        {/* **En contour, et sans confirmation en deux temps.** Résilier n'efface
            rien : l'accès court jusqu'à la fin de la période payée, et le
            reprendre est un appui. Une confirmation ici traiterait un geste
            réversible comme une suppression. */}
        <Button
          label={t('abonnement.resilier')}
          variant="secondary"
          loading={envoi}
          onPress={onResilier}
          testID="resilier"
        />
      </View>
    </View>
  );
}

/** Des centimes entiers vers une somme lisible, dans la langue de l'écran. */
function montant(cents: number, devise: string, locale: string): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency: devise }).format(cents / 100);
}
