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
import { View } from 'react-native';

import { useApi, type CommerceVuParLAdministration } from '../api';
import {
  Button,
  EmptyState,
  SkeletonLignes,
  StatusMessage,
  TextField,
  Texte,
} from '../components';
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

/** Le libellé d'un état, quel qu'il soit. */
const ETATS: Record<string, string> = {
  draft: 'admin.commerceDraft',
  onboarding: 'admin.commerceOnboarding',
  active: 'admin.commerceActive',
  suspended: 'admin.commerceSuspended',
};

export function CommercesScreen() {
  const { api } = useApi();
  const { t } = useI18n();

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

  const requete = useRequete<CommerceVuParLAdministration[]>(
    (signal) => api.commercesAdmin(recherche || undefined, signal),
    {
      estVide: (commerces) => commerces.length === 0,
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
      {(commerces) => (
        <View style={{ gap: 8 }}>
          {commerces.map((commerce) => (
            <Ligne
              key={commerce.business_id}
              commerce={commerce}
              ouvert={ouvert === commerce.business_id}
              onOuvrir={() =>
                setOuvert(ouvert === commerce.business_id ? null : commerce.business_id)
              }
            />
          ))}

          {/* **Le bord de la liste, dit.** Sans cette ligne, un salon au-delà
              du centième se lit comme un salon qui n'existe pas — et c'est
              précisément ce qu'on vient vérifier ici. */}
          {commerces.length >= PLAFOND ? (
            <StatusMessage
              level="neutral"
              body={t('admin.commercesPlafond', { count: PLAFOND })}
              testID="plafond-commerces"
            />
          ) : null}
        </View>
      )}
    </Ecran>
  );
}

function Ligne({
  commerce,
  ouvert,
  onOuvrir,
}: {
  commerce: CommerceVuParLAdministration;
  ouvert: boolean;
  onOuvrir: () => void;
}) {
  const { t } = useI18n();
  const c = useColors();

  const situe = [
    commerce.neighborhood ? t(`quartiers.${commerce.neighborhood}`) : null,
    t(ETATS[commerce.status] ?? 'etats.detailIndisponible'),
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <View
      testID={`commerce-${commerce.business_id}`}
      /* **Une ligne, et non une carte.** Les trois marques d'une carte — fond
         de surface, rayon de 18, filet — obligent à l'ombre, et cent cartes à
         ombre dans une liste qu'on parcourt sont exactement le défaut qu'on
         vient de corriger ailleurs. Ce qu'on fait ici est reconnaître un nom
         parmi cent ; un filet en pied sépare, sans poser cent objets. */
      style={{
        gap: 12,
        paddingVertical: 14,
        borderBottomWidth: 1,
        borderBottomColor: c['line.default'],
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Texte variante="type.bodyStrong" ellipseSurNomPropre>
            {commerce.name}
          </Texte>
          <Texte variante="type.caption" couleur="ink.soft">
            {situe}
          </Texte>
        </View>

        {/* **« Tu es déjà dedans », et rien sur les collègues.** Le champ est
            vrai pour l'appelant seul : savoir qu'un autre est entré ne change
            pas ce que je peux faire, et l'afficher inviterait à se demander
            pourquoi lui plutôt que moi. Ce qu'il empêche est d'ouvrir une
            seconde reprise sur un salon où l'on est déjà. */}
        {commerce.reprise_en_cours ? (
          <View
            testID={`reprise-en-cours-${commerce.business_id}`}
            style={{
              paddingHorizontal: 8,
              paddingVertical: 3,
              borderRadius: radius['radius.sm'],
              backgroundColor: c['status.success.surface'],
            }}
          >
            <Texte variante="type.dataLabel" couleur="status.success.text">
              {t('admin.commerceRepriseEnCours')}
            </Texte>
          </View>
        ) : (
          <View style={{ flexDirection: 'row' }}>
            <Button
              label={ouvert ? t('admin.commerceFermer') : t('reprise.entrer')}
              size="sm"
              variant="ghost"
              fullWidth={false}
              onPress={onOuvrir}
              testID={`reprendre-${commerce.business_id}`}
            />
          </View>
        )}
      </View>

      {/* Le formulaire, sous la ligne qu'il concerne. Le même qu'à la tournée :
          deux formulaires de reprise finiraient par ne plus dire la même chose
          au salon, et c'est le motif mot pour mot qui fait tout le mécanisme. */}
      {ouvert && !commerce.reprise_en_cours ? (
        <ReprendreLeCompte businessId={commerce.business_id} nomDuSalon={commerce.name} />
      ) : null}
    </View>
  );
}
