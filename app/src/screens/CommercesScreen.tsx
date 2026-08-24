/**
 * Les salons, du point de vue de l'administration.
 *
 * **L'écran de reprise était greffé sur la fiche de tournée**, faute d'un
 * endroit où l'administration ait un salon nommé sous les yeux. La conséquence
 * dépassait la mise en page : on ne pouvait reprendre **que les salons venus du
 * terrain**. Un salon inscrit tout seul — ce que le produit veut rendre
 * possible — était hors d'atteinte du support, et rien ne le disait.
 *
 * **Tous les états, et c'est le point.** Un salon en inscription est celui
 * qu'on vient débloquer, un suspendu celui dont on vient comprendre pourquoi.
 * Ne lister que les ouverts aurait écarté les deux cas qui motivent une
 * reprise.
 *
 * **Lire cette liste n'ouvre rien.** C'est la propriété qui permet de la rendre
 * large : elle se parcourt, se cherche, et ne donne accès à rien. La reprise
 * reste ce qu'elle était — un geste explicite, motivé mot pour mot, borné par
 * une portée, et dont le salon est prévenu. L'écran ne fait que donner à ce
 * geste un salon à désigner.
 *
 * **Le nom se cherche au serveur, pas dans la liste rendue.** Un filtre local
 * ne verrait que les cent premiers, donc mentirait exactement là où il sert :
 * quand on cherche celui qu'on ne trouve pas.
 *
 * **Et la coupure se dit.** La route rend cent salons au plus. Un écran qui
 * s'arrête à cent sans le dire fait conclure qu'un salon n'existe pas — c'est
 * la faute que la liste existe pour empêcher, et elle serait invisible.
 */
import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';

import { useApi, type CommerceVuParLAdministration, type ListeDesCommerces } from '../api';
import {
  EmptyState,
  SkeletonLignes,
  StatusMessage,
  TableHeader,
  TableRow,
  TextField,
  Texte,
  type Colonne,
} from '../components';
import { formatNumber } from '../format';
import { useI18n } from '../i18n';
import { motion, radius, useColors } from '../theme';
import { Ecran } from './Ecran';
import { ReprendreLeCompte } from './reprise/ReprendreLeCompte';
import { useRequete } from './useRequete';

/**
 * Ce que la route rend au plus. Le même nombre que le défaut du serveur.
 *
 * Il est ici pour être **comparé**, pas pour être envoyé : c'est le serveur qui
 * décide combien il rend, et l'écran ne fait que reconnaître qu'il a atteint le
 * bord. Le poser en dur des deux côtés serait le seul moyen de le désaccorder.
 */
export const PLAFOND = 100;

/**
 * La largeur du dernier bloc, celui qui porte le seul mot cliquable.
 *
 * Partagée par l'en-tête et la rangée : la colonne vide de l'un et la fente de
 * l'autre lisent la même valeur, et ne peuvent donc pas se désaligner.
 */
const LARGEUR_ACTION = 104;

/** Le libellé d'un état, quel qu'il soit. */
const ETATS: Record<string, string> = {
  draft: 'admin.commerceDraft',
  onboarding: 'admin.commerceOnboarding',
  active: 'admin.commerceActive',
  suspended: 'admin.commerceSuspended',
};

/**
 * Quatre faits, et rien de plus.
 *
 * Ce n'est pas la fiche du salon : elle existe et se lit derrière une reprise
 * ouverte. Ce qu'il faut ici est de reconnaître le bon parmi cent — un nom, un
 * quartier, un état — et de savoir si on est déjà dedans.
 *
 * La dernière colonne n'a pas de libellé : elle tient la place du seul mot
 * cliquable de la rangée, et un en-tête au-dessus d'un lien le ferait lire
 * comme une donnée.
 */
const COLONNES = (t: (cle: string) => string): Colonne[] => [
  { cle: 'nom', label: t('admin.commercesColonneNom'), largeur: 300 },
  { cle: 'quartier', label: t('admin.commercesColonneQuartier'), largeur: 170 },
  { cle: 'etat', label: t('admin.commercesColonneEtat'), largeur: 150 },
  { cle: 'action', label: '', largeur: LARGEUR_ACTION },
];

export function CommercesScreen() {
  const { api } = useApi();
  const { t, locale } = useI18n();
  const c = useColors();

  /**
   * La saisie et la question, séparées.
   *
   * Le délai est celui d'un état qui change sur place : `motion.etat` porte la
   * même valeur pour tout ce qui répond à un geste sans changer d'écran. Sans
   * lui, chaque lettre part au serveur et les réponses reviennent dans un ordre
   * qui n'est pas celui des questions.
   */
  const [saisie, setSaisie] = useState('');
  const [recherche, setRecherche] = useState('');

  useEffect(() => {
    if (saisie === recherche) return;
    const minuteur = setTimeout(() => setRecherche(saisie), motion.etat);
    return () => clearTimeout(minuteur);
  }, [saisie, recherche]);

  const requete = useRequete<ListeDesCommerces>(
    (signal) => api.commercesAdmin(recherche || undefined, signal),
    {
      estVide: (liste) => liste.items.length === 0,
      dependances: [recherche],
      // **Pas de cache.** Un état de salon change sous nos yeux le jour où on
      // vient le débloquer, et c'est ce jour-là qu'on ouvre cet écran.
    },
  );

  /** Le salon dont le formulaire est ouvert, ou aucun. */
  const [ouvert, setOuvert] = useState<string | null>(null);

  return (
    <Ecran
      requete={requete}
      titre={t('admin.commercesTitre')}
      squelette={<SkeletonLignes combien={6} testID="squelette-commerces" />}
      testID="ecran-commerces"
      vide={
        <EmptyState
          title={t('admin.commercesVideTitre')}
          body={recherche ? t('admin.commercesVideRecherche') : t('admin.commercesVide')}
        />
      }
      barre={
        <TextField
          label={t('admin.commercesRecherche')}
          value={saisie}
          placeholder={t('admin.commercesRecherchePlaceholder')}
          onChangeText={setSaisie}
          testID="recherche-commerces"
        />
      }
    >
      {({ items: commerces, total }) => (
        <View style={{ gap: 14 }}>
          <View
            style={{
              borderRadius: radius['radius.lg'],
              borderWidth: 1,
              borderColor: c['line.default'],
              backgroundColor: c['bg.surface'],
              overflow: 'hidden',
            }}
          >
            <TableHeader colonnes={COLONNES(t)} testID="entete-commerces" />
            {commerces.map((commerce) => (
              <Rangee
                key={commerce.business_id}
                commerce={commerce}
                colonnes={COLONNES(t)}
                ouvert={ouvert === commerce.business_id}
                onOuvrir={() =>
                  setOuvert(ouvert === commerce.business_id ? null : commerce.business_id)
                }
              />
            ))}
          </View>

          {/* **Le compte de la recherche, sous la liste.** Il dit d'abord
              combien de lignes on regarde ; et quand la liste touche son bord,
              il dit le plafond **avec son remède** — resserrer le nom plutôt
              que défiler. Sans le remède, la phrase constate une limite sans
              donner de conduite, et un salon au-delà du centième se lit comme
              un salon qui n'existe pas.

              **Le total vient du serveur, jamais des lignes rendues.** « 100
              salons » était tout ce que l'écran pouvait dire d'une recherche
              qui en ramenait sept cent quarante-deux, et c'est ce chiffre-là
              qui donne au plafond son sens : sans lui la phrase dit qu'on
              tronque, sans dire de combien. */}
          <Texte variante="type.caption" couleur="ink.soft" testID="compte-commerces">
            {total > commerces.length
              ? t('admin.commercesCompteSurTotal', {
                  montres: formatNumber(commerces.length, locale),
                  total: formatNumber(total, locale),
                })
              : t('admin.commercesCompte', { count: commerces.length })}
          </Texte>
          {total > commerces.length ? (
            <Texte variante="type.caption" couleur="ink.soft" testID="plafond-commerces">
              {t('admin.commercesPlafond', { count: PLAFOND })}
            </Texte>
          ) : null}

          {/* **Lire une ligne n'ouvre rien**, et c'est la propriété qui permet
              de rendre cette liste large. La dire vaut mieux que la faire
              deviner : un administrateur qui croit pouvoir consulter cherche où
              cliquer, et c'est ce doute qui use la retenue. */}
          <StatusMessage
            level="neutral"
            title={t('admin.commercesLireTitre')}
            body={t('admin.commercesLireCorps')}
            testID="lire-n-ouvre-rien"
          />
        </View>
      )}
    </Ecran>
  );
}

/**
 * Une rangée : quatre faits, et un seul mot cliquable.
 *
 * **La retenue s'obtient en n'offrant qu'une porte, pas en avertissant.** Aucune
 * ligne ne s'ouvre — ni la rangée, ni le nom, ni l'état. Ce qui existe est
 * « reprendre », qui coûte un motif écrit à la main et que le salon lira mot
 * pour mot. Un écran qui laisserait consulter puis dirait « attention » aurait
 * déjà laissé consulter.
 */
function Rangee({
  commerce,
  colonnes,
  ouvert,
  onOuvrir,
}: {
  commerce: CommerceVuParLAdministration;
  colonnes: Colonne[];
  ouvert: boolean;
  onOuvrir: () => void;
}) {
  const { t } = useI18n();
  const c = useColors();

  return (
    <View>
      <TableRow
        testID={`commerce-${commerce.business_id}`}
        colonnes={colonnes}
        valeurs={{
          nom: commerce.name,
          quartier: commerce.neighborhood ? t(`quartiers.${commerce.neighborhood}`) : '—',
          etat: t(ETATS[commerce.status] ?? 'etats.detailIndisponible'),
        }}
        fin={
          <View style={{ width: LARGEUR_ACTION, alignItems: 'flex-end' }}>
            {commerce.reprise_en_cours ? (
              /* **« Tu es déjà dedans », et rien sur les collègues.** Le champ
                 est vrai pour l'appelant seul : savoir qu'un autre est entré ne
                 change pas ce que je peux faire, et l'afficher inviterait à se
                 demander pourquoi lui plutôt que moi. */
              <Texte
                variante="type.dataLabel"
                couleur="status.success.text"
                testID={`reprise-en-cours-${commerce.business_id}`}
              >
                {t('admin.commerceRepriseEnCours')}
              </Texte>
            ) : (
              <Pressable
                accessibilityRole="button"
                onPress={onOuvrir}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                testID={`reprendre-${commerce.business_id}`}
                style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
              >
                <Texte variante="type.caption" couleur="brand.700" style={{ fontWeight: '600' }}>
                  {ouvert ? t('admin.commerceFermer') : t('reprise.entrer')}
                </Texte>
              </Pressable>
            )}
          </View>
        }
      />

      {/* Le formulaire, sous la rangée qu'il concerne. Le même qu'à la tournée :
          deux formulaires de reprise finiraient par ne plus dire la même chose
          au salon, et c'est le motif mot pour mot qui fait tout le mécanisme. */}
      {ouvert && !commerce.reprise_en_cours ? (
        <View style={{ padding: 16, backgroundColor: c['bg.inset'] }}>
          <ReprendreLeCompte businessId={commerce.business_id} nomDuSalon={commerce.name} />
        </View>
      ) : null}
    </View>
  );
}
