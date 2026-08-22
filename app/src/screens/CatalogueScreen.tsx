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
  ApiError,
  useApi,
  type ItemDuCatalogue,
  type OffreDePalier,
  type PalierOffrable,
  type ContentFormat,
  type PageDeLaCarte,
  type PhotoDuCommerce,
} from '../api';
import {
  Button,
  EmptyState,
  Filet,
  Icone,
  SegmentedTabs,
  SkeletonLignes,
  StatusMessage,
  Stepper,
  Texte,
  TextField,
  TierBadge,
  Toggle,
  vibration,
} from '../components';
import { CarteDuCommerce } from './CarteDuCommerce';
import { GalerieDuCommerce } from './GalerieDuCommerce';
import { useI18n } from '../i18n';
import { suiteDuRefus } from './catalogue/corriger';
import { radius, useColors } from '../theme';
import {
  ecartAuConseil,
  motDuPalier,
  palierRetenu,
  propositionsDuCatalogue,
} from './propositionDePalier';
import { Ecran } from './Ecran';
import { useRequete } from './useRequete';

/** Ce que l'écran charge d'un coup : les trois listes se lisent ensemble. */
type Composition = {
  items: ItemDuCatalogue[];
  offres: OffreDePalier[];
  paliers: PalierOffrable[];
  photos: PhotoDuCommerce[];
  /** La couverture actuelle, pour marquer la photo qui la porte. */
  couverture: string | null;
  /** Les pages de la carte. **Distinctes de la galerie** : voir `CarteDuCommerce`. */
  pagesDeLaCarte: PageDeLaCarte[];
  lienDeLaCarte: string | null;
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
      // La galerie voyage avec le catalogue : les deux composent la même
      // page, et deux requêtes séparées feraient apparaître les photos après
      // les prestations, sous les yeux de qui les regarde.
      const [items, offres, paliers, photos, pagesDeLaCarte, commerce] = await Promise.all([
        api.itemsDuCatalogue(businessId, signal),
        api.offresDePalier(businessId, signal),
        api.paliersDuCommerce(businessId, signal),
        api.photosDuCommerce(businessId, signal),
        api.pagesDeLaCarte(businessId, signal),
        api.commerce(businessId, signal),
      ]);
      return {
        items,
        offres,
        paliers,
        photos,
        couverture: commerce.cover_photo_key,
        pagesDeLaCarte,
        lienDeLaCarte: commerce.menu_url,
      };
    },
    [api, businessId],
  );

  const requete = useRequete<Composition>(charger, {
    // **Un catalogue vide n'est plus un écran vide.** La galerie vit ici : un
    // commerce qui n'a pas encore composé de prestation peut vouloir commencer
    // par ses photos, et l'état vide lui retirerait la seule chose qu'il peut
    // faire tout de suite.
    // La carte compte comme la galerie : un commerce qui a déposé sa carte et
    // rien d'autre a déjà fait quelque chose, et l'état vide le lui nierait.
    estVide: (c) =>
      c.items.length === 0 && c.photos.length === 0 && c.pagesDeLaCarte.length === 0,
    dependances: [businessId],
  });

  return (
    <Ecran
      requete={requete}
      titre={t('composition.catalogueTitre')}
      onRetour={onRetour}
      // Rendu dans la colonne du menu de configuration, qui borne déjà.
      nature="section"
      squelette={<SkeletonLignes combien={6} testID="squelette-catalogue" />}
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
          <Texte variante="type.caption" couleur="ink.soft" testID="resume-du-catalogue">
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

  /**
   * Le palier proposé pour chaque prestation.
   *
   * Calculé sur le catalogue **entier**, une fois : la proposition dépend de la
   * position d'un prix parmi les autres, donc la calculer ligne par ligne
   * reviendrait à la recalculer autant de fois qu'il y a de lignes, avec le
   * même résultat.
   *
   * Les parents de gamme sont écartés : ils ne se réservent pas, leur prix est
   * nul ou décoratif, et les laisser dans la distribution tirerait tous les
   * rangs vers le haut.
   */
  const propositions = useMemo(() => {
    // **Un parent se reconnaît à ce qu'il a des enfants**, jamais à son propre
    // `parent_item_id`, qui est nul comme celui de toute prestation de premier
    // rang. C'est la définition qu'emploient déjà le fil et le semis : un item
    // qui a des variantes ne se réserve pas et ne s'affiche jamais seul.
    const parents = new Set(
      composition.items.map((item) => item.parent_item_id).filter(Boolean) as string[],
    );
    return propositionsDuCatalogue(
      composition.items
        .filter((item) => !parents.has(item.id))
        .map((item) => ({ id: item.id, price_cents: item.price_cents })),
    );
  }, [composition.items]);

  /** Le format le plus exigeant réellement retenu, par prestation. */
  const retenus = useMemo(() => {
    const parItem = new Map<string, ContentFormat[]>();
    for (const offre of composition.offres) {
      if (!offre.is_active) continue;
      parItem.set(offre.catalog_item_id, [
        ...(parItem.get(offre.catalog_item_id) ?? []),
        offre.content_format,
      ]);
    }
    return new Map(
      [...parItem].map(([id, formats]) => [id, palierRetenu(formats)] as const),
    );
  }, [composition.offres]);

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

  return (
    <View style={{ gap: 16 }}>
      {/* La galerie en tête. Elle est ce qu'un visiteur voit en premier de la
          fiche, et un commerce qui compose sa page commence souvent par là —
          la ranger sous les prestations la ferait chercher. */}
      <GalerieDuCommerce
        businessId={businessId}
        photos={composition.photos}
        couverture={composition.couverture}
        onChange={onChange}
      />
      <Filet />

      {/* **La carte suit la galerie, et ne s'y mêle pas.** La galerie montre le
          lieu, la carte se consulte : deux dépôts distincts, parce qu'un
          commerce qui les confondrait rendrait la sienne illisible. */}
      <CarteDuCommerce
        businessId={businessId}
        pages={composition.pagesDeLaCarte}
        lien={composition.lienDeLaCarte}
        // **Ce que l'absence de carte retient.** Le catalogue les a déjà en
        // main ; les faire relire à la carte serait un second appel pour une
        // donnée qu'on tient, et deux listes qui finiraient par diverger.
        bloquees={composition.items
          .filter((item) => item.leaves_choice)
          .map((item) => ({ id: item.id, name: item.name }))}
        onChange={onChange}
      />
      <Filet />

      {/* **Le filtre ne fait pas disparaître la galerie.** Elle vivait sous un
          court-circuit « aucun résultat dans ce filtre » : un commerce sans
          prestation — ou dont le filtre n'en retient aucune — perdait la seule
          chose qu'il pouvait faire tout de suite. */}
      {rien ? (
        <StatusMessage
          level="neutral"
          body={t('composition.aucuneDansCeFiltre')}
          testID="filtre-sans-resultat"
        />
      ) : null}

      {groupes.rangees
        .filter((r) => r.items.length > 0)
        .map(({ palier, items }) => (
          <View key={palier.id} style={{ gap: 8 }} testID={`palier-${palier.id}`}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <TierBadge tier={palier.content_format} />
              <Texte variante="type.caption" couleur="ink.soft">
                {t('composition.abonnesMinimum', { n: palier.min_followers })}
              </Texte>
            </View>
            {items.map((item) => (
              <LignePrestation
                key={item.id}
                item={item}
                businessId={businessId}
                onChange={onChange}
                propose={propositions.get(item.id)}
                retenu={retenus.get(item.id)}
                paliers={composition.paliers}
              />
            ))}
          </View>
        ))}

      {groupes.orphelines.length > 0 ? (
        <View style={{ gap: 8 }} testID="sans-palier">
          <Texte variante="type.label">{t('composition.sansPalierTitre')}</Texte>
          {/* Dit, et non deviné : une prestation sans palier n'apparaît dans
              aucun fil, et rien à l'écran ne le laissait supposer. */}
          <Texte variante="type.caption" couleur="ink.soft">
            {t('composition.sansPalierCorps')}
          </Texte>
          {groupes.orphelines.map((item) => (
            <LignePrestation
              key={item.id}
              item={item}
              businessId={businessId}
              onChange={onChange}
              // C'est ici que le conseil vaut le plus : la prestation n'a aucun
              // palier, donc rien d'autre à lire que ce qu'on lui propose.
              propose={propositions.get(item.id)}
              retenu={undefined}
              paliers={composition.paliers}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}

/**
 * Corriger une prestation : la photo, l'orthographe, la description.
 *
 * **Et rien d'autre, délibérément.** La durée, le palier et la contrepartie
 * n'y sont pas : douze réservations passées citent une prestation de
 * quarante-cinq minutes, et la passer à soixante-quinze réécrirait leur
 * histoire — quelqu'un lirait, dans son historique, avoir reçu une prestation
 * qu'il n'a pas reçue. Ces trois-là demandent une autre prestation, l'ancienne
 * s'archivant.
 *
 * **Le prix n'y est pas non plus.** Design ne le range dans aucune des deux
 * listes ; il ne réécrit l'histoire d'aucune réservation, mais il déplace le
 * palier suggéré. La question est posée à l'API plutôt que tranchée ici.
 */
function CorrigerLaPrestation({
  item,
  businessId,
  onFait,
  onRenoncer,
}: {
  item: ItemDuCatalogue;
  businessId: string;
  onFait: () => void;
  onRenoncer: () => void;
}) {
  const { api, messageDErreur } = useApi();
  const { t } = useI18n();
  const [nom, setNom] = useState(item.name);
  const [description, setDescription] = useState(item.description ?? '');
  const [envoi, setEnvoi] = useState(false);
  const [echec, setEchec] = useState<string | null>(null);

  const change = nom.trim() !== item.name || description.trim() !== (item.description ?? '');

  async function enregistrer() {
    setEchec(null);
    setEnvoi(true);
    try {
      await api.modifierUnItem(businessId, item.id, {
        name: nom.trim(),
        // La chaîne vide efface la description : c'est le seul champ dont
        // l'effacement a un sens ici, et le serveur l'accepte comme tel.
        description: description.trim() || null,
      });
      vibration.action();
      onFait();
    } catch (erreur) {
      vibration.echec();
      setEchec(messageDErreur(erreur));
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <View style={{ gap: 8 }} testID={`correction-${item.id}`}>
      <TextField
        label={t('composition.nom')}
        value={nom}
        onChangeText={setNom}
        testID={`corriger-nom-${item.id}`}
      />
      <TextField
        label={t('composition.description')}
        value={description}
        onChangeText={setDescription}
        lignes={3}
        testID={`corriger-description-${item.id}`}
      />
      {/* **Ce qui ne se corrige pas, dit là où on corrige.** Sans cette
          phrase, un gérant cherche la durée, ne la trouve pas, et conclut que
          l'écran est incomplet — au lieu d'apprendre la règle. */}
      <Texte variante="type.caption" couleur="ink.soft" testID={`corriger-portee-${item.id}`}>
        {t('composition.corrigerPortee')}
      </Texte>

      {echec ? <StatusMessage level="danger" body={echec} testID={`echec-correction-${item.id}`} /> : null}

      <View style={{ flexDirection: 'row', gap: 8 }}>
        {/* Le bouton d'enregistrement reste absent tant que rien n'a changé —
            retiré, jamais grisé : c'est la règle du dépôt. */}
        {change && nom.trim().length > 0 ? (
          <Button
            label={t('composition.enregistrer')}
            size="sm"
            fullWidth={false}
            loading={envoi}
            onPress={() => void enregistrer()}
            testID={`enregistrer-correction-${item.id}`}
          />
        ) : null}
        <Button
          label={t('common.annuler')}
          size="sm"
          variant="ghost"
          fullWidth={false}
          onPress={onRenoncer}
          testID={`renoncer-correction-${item.id}`}
        />
      </View>
    </View>
  );
}

function LignePrestation({
  item,
  businessId,
  onChange,
  propose,
  retenu,
  paliers = [],
}: {
  item: ItemDuCatalogue;
  businessId: string;
  onChange: () => void;
  /** Ce que la plateforme aurait fait. Absent sous trois prix distincts. */
  propose?: ContentFormat;
  /** Le plus exigeant des paliers réellement ouverts sur cette prestation. */
  retenu?: ContentFormat;
  paliers?: PalierOffrable[];
}) {
  const { api, messageDErreur } = useApi();
  const { t, locale } = useI18n();
  const c = useColors();
  const [echec, setEchec] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const [correction, setCorrection] = useState(false);
  const [refusDeSuppression, setRefus] = useState(false);

  async function retirer() {
    setEchec(null);
    setRefus(false);
    setEnvoi(true);
    try {
      await api.supprimerUnItem(businessId, item.id);
      vibration.action();
      onChange();
    } catch (erreur) {
      // **Le code plutôt que le message.** Un refus de suppression n'est pas une
      // panne : c'est la règle du produit qui répond, et elle appelle un autre
      // geste. Le lire au message le rendrait dépendant de la langue.
      const code = erreur instanceof ApiError ? (erreur.code as string) : null;
      if (suiteDuRefus(code) === 'fermer') setRefus(true);
      else setEchec(messageDErreur(erreur));
      vibration.echec();
    } finally {
      setEnvoi(false);
    }
  }

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

  const ecart = ecartAuConseil(propose, retenu);
  const abonnesDe = (format: ContentFormat) =>
    paliers.find((palier) => palier.content_format === format)?.min_followers ?? 0;

  return (
    <View style={{ gap: 4 }} testID={`prestation-${item.id}`}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <View style={{ flex: 1, gap: 2 }}>
          <Texte variante="type.label">{item.name}</Texte>
          <Texte variante="type.caption" couleur="ink.soft">
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
        <Texte variante="type.caption" couleur="ink.mute" testID={`ferme-par-parent-${item.id}`}>
          {t('composition.fermeeParSonParent')}
        </Texte>
      ) : null}

      {/* **Corriger et retirer, là où la prestation est.** Le catalogue se
          composait sans se corriger : une faute d'orthographe ou une photo
          manquante demandait de supprimer et de recommencer, ce qu'un item déjà
          réservé refuse de toute façon. */}
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Button
          label={t('composition.corriger')}
          size="sm"
          variant="ghost"
          fullWidth={false}
          onPress={() => setCorrection(true)}
          testID={`corriger-${item.id}`}
        />
        <Button
          label={t('composition.retirer')}
          size="sm"
          variant="ghost"
          fullWidth={false}
          loading={envoi}
          onPress={() => void retirer()}
          testID={`retirer-${item.id}`}
        />
      </View>

      {/* **Le refus se lit comme la réponse qu'il est.** Une prestation déjà
          réservée ne se supprime pas : douze réservations la citent, et les
          laisser pointer vers rien réécrirait une histoire. Le serveur le
          refuse, l'écran le dit, et propose le geste qui reste. */}
      {refusDeSuppression ? (
        <View style={{ gap: 8 }} testID={`refus-suppression-${item.id}`}>
          <StatusMessage
            level="warning"
            body={t('composition.retraitRefuse')}
            testID={`refus-${item.id}`}
          />
          {item.is_available ? (
            <View style={{ alignSelf: 'flex-start' }}>
              <Button
                label={t('composition.fermerPlutot')}
                size="sm"
                variant="secondary"
                fullWidth={false}
                loading={envoi}
                onPress={() => void basculer(false)}
                testID={`fermer-plutot-${item.id}`}
              />
            </View>
          ) : null}
        </View>
      ) : null}

      {/* **Ce qui se corrige, et rien d'autre.** La durée, le palier et la
          contrepartie n'y sont pas : douze réservations citent une prestation
          de quarante-cinq minutes, et la passer à soixante-quinze réécrirait
          leur histoire. Elles demandent une autre prestation. */}
      {correction ? (
        <CorrigerLaPrestation
          item={item}
          businessId={businessId}
          onFait={() => {
            setCorrection(false);
            onChange();
          }}
          onRenoncer={() => setCorrection(false)}
        />
      ) : null}
      {/* **Le conseil, et jamais la décision.** La plateforme dit ce qu'elle
          aurait fait à partir du prix et de la place de cette prestation dans
          le catalogue ; rien ne bascule, rien n'est écrit. Un commerce qui
          s'écarte lit ce que cela lui coûte, et s'écarte quand même s'il le
          veut — c'est son catalogue. */}
      {/* **L'écart se montre avant de s'expliquer.** Deux badges reliés par un
          chevron : d'où la plateforme partait, où le salon est allé. Une phrase
          seule oblige à reconstituer la comparaison de tête, à l'endroit précis
          où le choix se fait. */}
      {ecart.forme === 'conforme' || ecart.forme === 'sans-avis' ? null : (
        <View style={{ gap: 6 }} testID={`conseil-${item.id}`}>
          <View
            style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}
            testID={`ecart-${item.id}`}
          >
            <TierBadge tier={ecart.propose} size="sm" testID={`badge-propose-${item.id}`} />
            <Icone nom="chevron" couleur="ink.mute" taille={16} />
            <TierBadge tier={ecart.retenu} size="sm" testID={`badge-retenu-${item.id}`} />
            <Texte variante="type.caption" couleur="ink.mute" style={{ flex: 1 }}>
              {t('composition.palierSuggere')}
            </Texte>
          </View>

          {/* **Neutre à glyphe, jamais ambre.** Dans ce système l'ambre est la
              marque : un avertissement en ambre se lit comme une mise en avant.
              C'est la même règle que l'avertissement sans teinte du système, et
              le glyphe est alors son seul marqueur. */}
          <View
            testID={`avertissement-${item.id}`}
            style={{
              gap: 6,
              padding: 12,
              paddingHorizontal: 14,
              borderRadius: radius['radius.md'],
              backgroundColor: c['bg.deep'],
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 9 }}>
              <View style={{ marginTop: 3 }}>
                <Icone nom="alerte" taille={16} />
              </View>
              <Texte variante="type.caption" couleur="ink.soft" style={{ flex: 1 }}>
                {ecart.forme === 'plus-exigeant'
                  ? // **Le coût est chiffré avec ce qu'on a.** La planche veut
                    // « 103 créatrices deviennent 12 » ; ce compte par palier
                    // n'est pas servi. Les seuils d'abonnés le sont, et disent
                    // la même chose dans le même sens : « 10 000 abonnés au
                    // lieu de 1 000 » se mesure, « moins de créatrices » non.
                    // Voir `TASKS.md`.
                    t('composition.palierPlusExigeant', {
                      retenu: motDuPalier(ecart.retenu, locale),
                      propose: motDuPalier(ecart.propose, locale),
                      abonnes: abonnesDe(ecart.retenu),
                      proposeAbonnes: abonnesDe(ecart.propose),
                    })
                  : t('composition.palierMoinsExigeant', {
                      retenu: motDuPalier(ecart.retenu, locale),
                      propose: motDuPalier(ecart.propose, locale),
                    })}
              </Texte>
            </View>
          </View>
        </View>
      )}
      {/* Une prestation sans palier : la proposition est alors la seule chose
          à dire, et elle a d'autant plus de valeur qu'il n'y a rien d'autre. */}
      {retenu === undefined && propose !== undefined ? (
        <Texte variante="type.caption" couleur="brand.700" testID={`propose-${item.id}`}>
          {t('composition.palierPropose', { palier: motDuPalier(propose, locale) })}
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
              style={({ pressed }) => ({
                // Le palier non choisi est déjà pâle ; l'appui le pâlit
                // encore, sans jamais éclaircir celui qui est choisi.
                opacity: (palier.id === palierId ? 1 : 0.45) * (pressed ? 0.7 : 1),
              })}
              testID={`choix-palier-${palier.id}`}
            >
              <TierBadge tier={palier.content_format} />
            </Pressable>
          ))}
        </View>
        {/* La conséquence écrite, pas seulement le choix. Un palier haut réduit
            le nombre de créatrices éligibles, et rien ne le disait. */}
        {choisi ? (
          <Texte variante="type.caption" couleur="ink.soft" testID="consequence-du-palier">
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
