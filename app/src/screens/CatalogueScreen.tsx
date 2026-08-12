/**
 * 09 · Catalogue et composition par palier.
 *
 * **Les routes existaient depuis la phase 2, aucun écran ne les pilotait.** Un
 * commerce composait son catalogue par l'API. C'est le manque le plus visible
 * du rôle : sans prestation publiée, un salon n'apparaît dans aucun fil, et
 * tout le reste du produit tourne à vide pour lui.
 *
 * **Regroupé par palier, jamais par photo.** Le palier est ce que le commerce
 * décide ; la photo est facultative et ne structure rien. Une prestation
 * publiée sans offre n'apparaît nulle part — elle est montrée à part, sous son
 * propre titre, plutôt que noyée dans un palier auquel elle n'appartient pas.
 *
 * **Ouvrir et fermer passe par sa propre route.** C'est une transition d'état,
 * elle laisse une trace au journal ; l'écrire comme un champ du correctif
 * donnerait deux chemins à la même transition.
 *
 * **La durée est obligatoire à la création.** Sans elle aucun calcul de
 * capacité n'est possible : la prestation serait publiée et n'ouvrirait jamais
 * un créneau. L'API l'accepte nulle pour les imports de carte à valider ; ce
 * formulaire, lui, la réclame.
 */
import { useCallback, useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';

import {
  useApi,
  type ItemDuCatalogue,
  type OffreDePalier,
  type PalierOffrable,
} from '../api';
import {
  Button,
  EmptyState,
  SegmentedTabs,
  StatusMessage,
  Stepper,
  TextField,
  Texte,
  TierBadge,
  Toggle,
  vibration,
} from '../components';
import { useI18n } from '../i18n';
import { Ecran } from './Ecran';
import { useRequete } from './useRequete';

/** Ce que l'écran charge d'un coup : les trois listes se lisent ensemble. */
type Composition = {
  items: ItemDuCatalogue[];
  offres: OffreDePalier[];
  paliers: PalierOffrable[];
};

const ONGLETS = ['toutes', 'ouvertes', 'fermees'] as const;
type Onglet = (typeof ONGLETS)[number];

export function CatalogueScreen({
  businessId,
  onRetour,
}: {
  businessId: string;
  onRetour?: () => void;
}) {
  const { api } = useApi();
  const { t } = useI18n();
  const [onglet, setOnglet] = useState<Onglet>('toutes');
  const [compose, setCompose] = useState(false);

  const charger = useCallback(
    async (signal: AbortSignal): Promise<Composition> => {
      const [items, offres, paliers] = await Promise.all([
        api.itemsDuCatalogue(businessId, signal),
        api.offresDePalier(businessId, signal),
        api.paliersDuCommerce(businessId, signal),
      ]);
      return { items, offres, paliers };
    },
    [api, businessId],
  );

  const requete = useRequete<Composition>(charger, {
    estVide: (c) => c.items.length === 0,
    dependances: [businessId],
  });

  return (
    <Ecran
      requete={requete}
      titre={t('composition.catalogueTitre')}
      onRetour={onRetour}
      // Rendu dans la colonne du menu de configuration, qui borne déjà.
      nature="section"
      testID="ecran-catalogue"
      vide={
        <CatalogueVide
          businessId={businessId}
          onPublie={requete.recharger}
          paliers={requete.etat === 'pret' ? requete.donnees.paliers : []}
        />
      }
    >
      {(composition) => (
        <View style={{ gap: 12 }}>
          <Texte variante="type.caption" couleur="text.secondary" testID="resume-du-catalogue">
            {t('composition.catalogueResume', { n: composition.items.length })}
          </Texte>

          {compose ? (
            <NouvellePrestation
              businessId={businessId}
              paliers={composition.paliers}
              onPublie={() => {
                setCompose(false);
                requete.recharger();
              }}
              onAnnuler={() => setCompose(false)}
            />
          ) : (
            <Button
              label={t('composition.ajouterUnePrestation')}
              onPress={() => setCompose(true)}
              testID="ajouter-une-prestation"
            />
          )}

          <SegmentedTabs
            items={[
              { label: t('composition.filtreToutes'), count: composition.items.length },
              {
                label: t('composition.filtreOuvertes'),
                count: composition.items.filter((i) => i.is_effectively_available).length,
              },
              {
                label: t('composition.filtreFermees'),
                count: composition.items.filter((i) => !i.is_effectively_available).length,
              },
            ]}
            index={ONGLETS.indexOf(onglet)}
            onChange={(i) => setOnglet(ONGLETS[i])}
            testID="filtres-du-catalogue"
          />

          <Groupes
            composition={composition}
            onglet={onglet}
            businessId={businessId}
            onChange={requete.recharger}
          />
        </View>
      )}
    </Ecran>
  );
}

/**
 * Le catalogue, groupé par palier.
 *
 * Les prestations sans offre ont leur propre groupe. Les fondre dans un palier
 * ferait croire qu'elles y sont proposées, alors qu'elles n'apparaissent dans
 * aucun fil — c'est précisément l'information qui manque au commerce.
 */
function Groupes({
  composition,
  onglet,
  businessId,
  onChange,
}: {
  composition: Composition;
  onglet: Onglet;
  businessId: string;
  onChange: () => void;
}) {
  const { t } = useI18n();

  const visible = useCallback(
    (item: ItemDuCatalogue) =>
      onglet === 'toutes' ||
      (onglet === 'ouvertes' ? item.is_effectively_available : !item.is_effectively_available),
    [onglet],
  );

  const groupes = useMemo(() => {
    const parItem = new Map<string, OffreDePalier[]>();
    for (const offre of composition.offres) {
      parItem.set(offre.catalog_item_id, [...(parItem.get(offre.catalog_item_id) ?? []), offre]);
    }

    const rangees = composition.paliers.map((palier) => ({
      palier,
      items: composition.items.filter(
        (item) =>
          visible(item) &&
          (parItem.get(item.id) ?? []).some((offre) => offre.tier_id === palier.id),
      ),
    }));

    const orphelines = composition.items.filter(
      (item) => visible(item) && !parItem.has(item.id),
    );

    return { rangees, orphelines };
  }, [composition, visible]);

  const rien =
    groupes.orphelines.length === 0 && groupes.rangees.every((r) => r.items.length === 0);

  if (rien) {
    return (
      <StatusMessage
        level="neutral"
        body={t('composition.aucuneDansCeFiltre')}
        testID="filtre-sans-resultat"
      />
    );
  }

  return (
    <View style={{ gap: 16 }}>
      {groupes.rangees
        .filter((r) => r.items.length > 0)
        .map(({ palier, items }) => (
          <View key={palier.id} style={{ gap: 8 }} testID={`palier-${palier.id}`}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <TierBadge tier={palier.content_format} />
              <Texte variante="type.caption" couleur="text.secondary">
                {t('composition.abonnesMinimum', { n: palier.min_followers })}
              </Texte>
            </View>
            {items.map((item) => (
              <LignePrestation
                key={item.id}
                item={item}
                businessId={businessId}
                onChange={onChange}
              />
            ))}
          </View>
        ))}

      {groupes.orphelines.length > 0 ? (
        <View style={{ gap: 8 }} testID="sans-palier">
          <Texte variante="type.label">{t('composition.sansPalierTitre')}</Texte>
          {/* Dit, et non deviné : une prestation sans palier n'apparaît dans
              aucun fil, et rien à l'écran ne le laissait supposer. */}
          <Texte variante="type.caption" couleur="text.secondary">
            {t('composition.sansPalierCorps')}
          </Texte>
          {groupes.orphelines.map((item) => (
            <LignePrestation
              key={item.id}
              item={item}
              businessId={businessId}
              onChange={onChange}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}

function LignePrestation({
  item,
  businessId,
  onChange,
}: {
  item: ItemDuCatalogue;
  businessId: string;
  onChange: () => void;
}) {
  const { api, messageDErreur } = useApi();
  const { t } = useI18n();
  const [echec, setEchec] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);

  async function basculer(ouvert: boolean) {
    setEchec(null);
    setEnvoi(true);
    try {
      await api.ouvrirLItem(businessId, item.id, ouvert);
      vibration.action();
      onChange();
    } catch (erreur) {
      vibration.echec();
      setEchec(messageDErreur(erreur));
    } finally {
      setEnvoi(false);
    }
  }

  // Fermée par son parent : l'interrupteur de la ligne ne peut rien y faire, et
  // le laisser actif ferait appuyer sur un bouton sans effet.
  const parLeParent = !item.is_effectively_available && item.is_available;

  return (
    <View style={{ gap: 4 }} testID={`prestation-${item.id}`}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <View style={{ flex: 1, gap: 2 }}>
          <Texte variante="type.label">{item.name}</Texte>
          <Texte variante="type.caption" couleur="text.secondary">
            {item.duration_minutes === null
              ? t('composition.dureeManquante')
              : t('composition.duree', { n: item.duration_minutes })}
          </Texte>
        </View>
        <Toggle
          value={item.is_available}
          disabled={envoi || parLeParent}
          onChange={(v) => void basculer(v)}
          accessibilityLabel={t('composition.ouvrirLaPrestation', { nom: item.name })}
          testID={`ouverture-${item.id}`}
        />
      </View>
      {parLeParent ? (
        <Texte variante="type.caption" couleur="text.muted" testID={`ferme-par-parent-${item.id}`}>
          {t('composition.fermeeParSonParent')}
        </Texte>
      ) : null}
      {echec ? <StatusMessage level="danger" body={echec} testID={`echec-${item.id}`} /> : null}
    </View>
  );
}

/**
 * Composer une prestation, et lui donner son palier dans le même geste.
 *
 * Publier puis rattacher en deux temps laisserait une prestation invisible
 * entre les deux, sans que rien ne le dise.
 */
function NouvellePrestation({
  businessId,
  paliers,
  onPublie,
  onAnnuler,
}: {
  businessId: string;
  paliers: PalierOffrable[];
  onPublie: () => void;
  onAnnuler: () => void;
}) {
  const { api, messageDErreur } = useApi();
  const { t } = useI18n();
  const [nom, setNom] = useState('');
  const [duree, setDuree] = useState(45);
  const [prix, setPrix] = useState('');
  const [palierId, setPalierId] = useState<string | null>(paliers[0]?.id ?? null);
  const [echec, setEchec] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);

  const prixEnCentimes = Math.round(Number(prix.replace(',', '.')) * 100);
  const complet = nom.trim().length > 0 && Number.isFinite(prixEnCentimes) && prixEnCentimes >= 0;

  async function publier() {
    setEchec(null);
    setEnvoi(true);
    try {
      const item = await api.creerUnItem(businessId, {
        name: nom.trim(),
        price_cents: prixEnCentimes,
        duration_minutes: duree,
      });
      if (palierId) await api.offrirAuPalier(businessId, palierId, item.id);
      vibration.reussite();
      onPublie();
    } catch (erreur) {
      vibration.echec();
      setEchec(messageDErreur(erreur));
    } finally {
      setEnvoi(false);
    }
  }

  const choisi = paliers.find((p) => p.id === palierId) ?? null;

  return (
    <View style={{ gap: 12 }} testID="nouvelle-prestation">
      <TextField
        label={t('composition.champNom')}
        value={nom}
        onChangeText={setNom}
        testID="champ-nom"
      />
      <TextField
        label={t('composition.champPrix')}
        value={prix}
        onChangeText={setPrix}
        keyboard="numeric"
        testID="champ-prix"
      />
      <Stepper
        label={t('composition.champDuree')}
        value={duree}
        min={5}
        max={240}
        onChange={setDuree}
        testID="champ-duree"
      />

      <View style={{ gap: 6 }}>
        <Texte variante="type.label">{t('composition.champPalier')}</Texte>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {/* Le badge porte déjà le mot du palier dans la langue courante :
              le réécrire ici en ferait une seconde source, qui divergerait. */}
          {paliers.map((palier) => (
            <Pressable
              key={palier.id}
              accessibilityRole="button"
              accessibilityState={{ selected: palier.id === palierId }}
              onPress={() => setPalierId(palier.id)}
              style={{ opacity: palier.id === palierId ? 1 : 0.45 }}
              testID={`choix-palier-${palier.id}`}
            >
              <TierBadge tier={palier.content_format} />
            </Pressable>
          ))}
        </View>
        {/* La conséquence écrite, pas seulement le choix. Un palier haut réduit
            le nombre de créatrices éligibles, et rien ne le disait. */}
        {choisi ? (
          <Texte variante="type.caption" couleur="text.secondary" testID="consequence-du-palier">
            {t('composition.consequenceDuPalier', { n: choisi.min_followers })}
          </Texte>
        ) : null}
      </View>

      {echec ? <StatusMessage level="danger" body={echec} testID="echec-publication" /> : null}

      <Button
        label={t('composition.publier')}
        loading={envoi}
        disabled={!complet}
        onPress={() => void publier()}
        testID="publier-la-prestation"
      />
      <Button
        label={t('common.annuler')}
        variant="secondary"
        onPress={onAnnuler}
        testID="annuler-la-prestation"
      />
    </View>
  );
}

/**
 * Le vide, avec sa conséquence.
 *
 * Pas un encouragement : ce qui manque au commerce, c'est de savoir que sans
 * prestation publiée son salon n'apparaît dans aucun fil.
 */
function CatalogueVide({
  businessId,
  paliers,
  onPublie,
}: {
  businessId: string;
  paliers: PalierOffrable[];
  onPublie: () => void;
}) {
  const { t } = useI18n();
  const [compose, setCompose] = useState(false);

  if (compose) {
    return (
      <NouvellePrestation
        businessId={businessId}
        paliers={paliers}
        onPublie={onPublie}
        onAnnuler={() => setCompose(false)}
      />
    );
  }

  return (
    <EmptyState
      title={t('composition.videTitre')}
      body={t('composition.videCorps')}
      actions={[{ label: t('composition.videAction'), onPress: () => setCompose(true) }]}
      testID="catalogue-vide"
    />
  );
}
