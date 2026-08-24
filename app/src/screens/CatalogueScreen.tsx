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
import * as ImagePicker from 'expo-image-picker';
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
  Photo,
  Stepper,
  Texte,
  TextField,
  TierBadge,
  Toggle,
  vibration,
} from '../components';
import { useI18n } from '../i18n';
import { gesteDeRetrait, suiteDuRefus } from './catalogue/corriger';
import { resumeDuCatalogue } from './catalogue/resume';
import { useGabarit } from '../shell/gabarit';
import { radius, useColors } from '../theme';
import {
  ecartAuConseil,
  motDuPalier,
  palierRetenu,
  propositionsDuCatalogue,
} from './propositionDePalier';
import { Ecran } from './Ecran';
import { AGES } from './cacheDesReponses';
import { useRequete } from './useRequete';

/** Ce que l'écran charge d'un coup : les trois listes se lisent ensemble. */
type Composition = {
  items: ItemDuCatalogue[];
  offres: OffreDePalier[];
  paliers: PalierOffrable[];
};

const ONGLETS = ['toutes', 'ouvertes', 'fermees'] as const;
type Onglet = (typeof ONGLETS)[number];

/**
 * Les quatre colonnes de la planche, et leurs largeurs.
 *
 * **Elles n'existent qu'au-delà du seuil.** La planche est dessinée à 1512 ;
 * sur 390, quatre colonnes ne sont pas des colonnes. L'état prend ce qui reste
 * parce que c'est un interrupteur : il se pose à droite, quelle que soit la
 * largeur.
 */
const COLONNES = { nom: 260, duree: 96, palier: 96 } as const;

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
      // **Trois listes et plus six.** La galerie, la carte et la couverture
      // sont parties avec le lieu : cet écran ne charge plus que ce qu'il rend,
      // et trois requêtes de moins sur un écran qu'on ouvre en continu.
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
    // Le catalogue d'un salon change quand le salon le change, c'est-à-dire
    // rarement et de son propre fait. La clé porte l'identifiant : deux salons
    // sous la même clé se montreraient l'un pour l'autre.
    cache: { cle: `catalogue.${businessId}`, ageMax: AGES.contenu },
    // **Un catalogue vide n'est plus un écran vide.** La galerie vit ici : un
    // commerce qui n'a pas encore composé de prestation peut vouloir commencer
    // **Vide veut dire « aucune prestation », et rien d'autre.** La galerie et
    // la carte comptaient ici tant qu'elles y vivaient : un commerce qui avait
    // déposé ses photos n'était pas devant un écran vide. Elles sont sur le
    // lieu maintenant, et cet écran ne parle plus que de prestations — le vide
    // redevient ce qu'il dit.
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
          {/* **Ce que le salon a composé, et ce que les créatrices en voient.**
              C'était la fonction du résumé de composition, sous la table des
              matières que la v3.1 retire : dire ce qui manque avant qu'un salon
              apparaisse. « Douze dont trois éteintes » n'est pas la même
              composition que « douze visibles », et c'est la moitié qu'on
              oublie. */}
          <Texte variante="type.caption" couleur="ink.soft" testID="resume-du-catalogue">
            {t('composition.catalogueResume', {
              n: String(resumeDuCatalogue(composition.items).prestations),
              visibles: String(resumeDuCatalogue(composition.items).visibles),
            })}
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
  const c = useColors();
  const { large } = useGabarit();

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
   * position d'une durée parmi les autres, donc la calculer ligne par ligne
   * reviendrait à la recalculer autant de fois qu'il y a de lignes, avec le
   * même résultat.
   *
   * Les parents de gamme sont écartés : ils ne se réservent pas, leur durée est
   * nulle ou décorative, et les laisser dans la distribution fausserait tous
   * les rangs.
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
        .map((item) => ({ id: item.id, duration_minutes: item.duration_minutes })),
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
      {/* **La galerie, la carte et les horaires ont quitté cet écran.** Ils
          décrivent le lieu ; ce qui reste ici décrit ce qu'on y fait. C'est la
          découpe par objet de la v3.1, et elle recoupe la fréquence : un lieu
          se compose une fois, un catalogue vit en continu.

          Ce qui suit
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

      {/* **Les quatre colonnes n'existent que là où la place existe.**
          La planche est dessinée à 1512, où elles tiennent. Sur 390, quatre
          colonnes ne sont pas des colonnes : le nom se tronque au troisième
          mot et la durée passe sous le palier. La carte du comptoir reste
          donc la carte, et la table ne s'ajoute qu'au-dessus du seuil —
          deux compositions pour deux places, jamais une pour les deux. */}
      {large ? (
        <View
          testID="entete-des-prestations"
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 12,
            paddingBottom: 4,
            borderBottomWidth: 1,
            borderBottomColor: c['line.default'],
          }}
        >
          <View style={{ width: COLONNES.nom }}>
            <Texte variante="type.dataLabel" couleur="ink.soft">
              {t('composition.colonneNom').toUpperCase()}
            </Texte>
          </View>
          <View style={{ width: COLONNES.duree }}>
            <Texte variante="type.dataLabel" couleur="ink.soft">
              {t('composition.colonneDuree').toUpperCase()}
            </Texte>
          </View>
          <View style={{ width: COLONNES.palier }}>
            <Texte variante="type.dataLabel" couleur="ink.soft">
              {t('composition.colonnePalier').toUpperCase()}
            </Texte>
          </View>
          <View style={{ flex: 1 }}>
            <Texte variante="type.dataLabel" couleur="ink.soft" align="right">
              {t('composition.colonneEtat').toUpperCase()}
            </Texte>
          </View>
        </View>
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
                large={large}
                // L'offre de **ce** palier : une prestation ouverte à deux
                // paliers a deux offres, et fermer l'une ne ferme pas l'autre.
                offre={composition.offres.find(
                  (o) => o.catalog_item_id === item.id && o.tier_id === palier.id,
                )}
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
              large={large}
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

      {/* **La photo se dépose enfin d'ici.** `photo_key` était déclarée
          corrigeable depuis le début, la route de dépôt existait, et rien ne
          les reliait : le champ se posait par correctif et aucun écran ne
          savait produire de clé. Une capacité déclarée que rien ne sait
          exercer n'est pas une capacité. */}
      <PhotoDeLaPrestation
        businessId={businessId}
        item={item}
        onChange={onFait}
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
            label={t('composition.enregistrerLaCorrection')}
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
  large = false,
  offre,
}: {
  item: ItemDuCatalogue;
  businessId: string;
  onChange: () => void;
  /** Ce que la plateforme aurait fait. Absent sous trois durées distinctes. */
  propose?: ContentFormat;
  /** Le plus exigeant des paliers réellement ouverts sur cette prestation. */
  retenu?: ContentFormat;
  /** Au-delà du seuil, la ligne se range en colonnes. Voir `COLONNES`. */
  large?: boolean;
  paliers?: PalierOffrable[];
  /**
   * L'offre de **ce** palier sur cette prestation, quand la ligne en est une.
   *
   * Absente sous « sans palier » : il n'y a rien à ouvrir ni à fermer là où
   * aucune offre n'existe.
   */
  offre?: OffreDePalier;
}) {
  const { api, messageDErreur } = useApi();
  const { t, locale } = useI18n();
  const c = useColors();
  const [echec, setEchec] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const [correction, setCorrection] = useState(false);
  const [remplacement, setRemplacement] = useState(false);
  const [refusDeSuppression, setRefus] = useState(false);

  const retrait = gesteDeRetrait(item);
  const [bascule, setBascule] = useState(false);

  /**
   * Fermer une offre, et la rouvrir.
   *
   * **Retirer sans supprimer, et c'est la seule voie quand l'offre est
   * réservée.** Supprimer une offre que des réservations citent réécrirait leur
   * histoire ; le serveur le refuse, et il a raison. Fermer laisse tout en
   * place et cesse simplement de la proposer.
   *
   * **Le catalogue se composait sans se corriger.** Un salon pouvait ouvrir une
   * prestation à un palier et n'avait aucun moyen de revenir dessus : la route
   * existait depuis la phase 2, aucun écran ne l'appelait. C'était le dernier
   * geste manquant du produit.
   */
  async function basculerLOffre() {
    if (!offre) return;
    setEchec(null);
    setBascule(true);
    try {
      await api.activerUneOffre(businessId, offre.id, !offre.is_active);
      onChange();
    } catch (erreur) {
      setEchec(messageDErreur(erreur));
    } finally {
      setBascule(false);
    }
  }

  /**
   * Retirer, et le mot dépend de ce que la prestation a derrière elle.
   *
   * **Jamais réservée : elle se supprime vraiment.** Rien ne la cite, rien ne
   * se réécrit. **Déjà réservée : elle s'archive et ne se supprime jamais** —
   * les réservations continuent de citer ce qu'elles ont eu.
   *
   * Le refus reste lu après coup. Il ne devrait plus arriver, puisque le compte
   * décide avant ; il tient la porte si les deux divergent, et c'est justement
   * quand ils divergent qu'on veut une phrase plutôt qu'une erreur nue.
   */
  async function retirer() {
    setEchec(null);
    setRefus(false);
    setEnvoi(true);
    try {
      if (retrait.geste === 'archiver') await api.archiverUnItem(businessId, item.id);
      else await api.supprimerUnItem(businessId, item.id);
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
        {/* **La vignette, ou son absence.** Un cadre pointillé dit qu'il manque
            une photo sans qu'aucun texte n'explique la fonction : le manque se
            signale seul, et c'est ce qui rend la photo par prestation trouvable
            sans la nommer. */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('composition.deposerUnePhoto')}
          onPress={() => setCorrection(true)}
          testID={`vignette-geste-${item.id}`}
          style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
        >
          <Vignette item={item} testID={`vignette-${item.id}`} />
        </Pressable>
        {large ? (
          <>
            {/* Le nom et la durée se séparent : en carte ils s'empilent, en
                table ils tiennent chacun leur colonne. */}
            <View style={{ width: COLONNES.nom - 56 }}>
              <Texte variante="type.label" ellipseSurNomPropre>
                {item.name}
              </Texte>
            </View>
            <View style={{ width: COLONNES.duree }}>
              <Texte variante="type.caption" couleur="ink.soft">
                {item.duration_minutes === null
                  ? t('composition.dureeManquante')
                  : t('composition.duree', { n: item.duration_minutes })}
              </Texte>
            </View>
            <View style={{ width: COLONNES.palier }}>
              {retenu ? <TierBadge tier={retenu} size="sm" /> : null}
            </View>
            <View style={{ flex: 1 }} />
          </>
        ) : (
          <View style={{ flex: 1, gap: 2 }}>
            <Texte variante="type.label">{item.name}</Texte>
            <Texte variante="type.caption" couleur="ink.soft">
              {item.duration_minutes === null
                ? t('composition.dureeManquante')
                : t('composition.duree', { n: item.duration_minutes })}
            </Texte>
          </View>
        )}
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

      {/* **Le cadre pointillé annonçait un geste et n'en portait aucun.** Il
          disait « il manque une photo » sur une `View` inerte : le manque se
          signalait, et rien ne menait au dépôt — un gérant concluait qu'aucun
          endroit n'existait, ce qui était vrai à un appui près. La vignette est
          maintenant le geste, et le mot reste pour qui parcourt sans s'arrêter. */}
      {item.photo_key ? null : (
        <Texte variante="type.caption" couleur="ink.soft" testID={`photo-manque-${item.id}`}>
          {t('composition.photoManque')}
        </Texte>
      )}

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
        {/* **La phrase disait déjà que la durée ne se corrige pas ici ; elle
            dit maintenant où.** Un écran qui explique une impossibilité sans
            donner la suite laisse chercher — et l'on cherche dans la
            suppression, qui est justement le geste qu'on ne veut pas. */}
        {retrait.geste === 'aucun' ? null : (
          <Button
            label={t('composition.remplacer')}
            size="sm"
            variant="ghost"
            fullWidth={false}
            onPress={() => setRemplacement(true)}
            testID={`ouvrir-remplacement-${item.id}`}
          />
        )}
        {/* **Le bouton nomme son écart.** « Archiver » ne se décide pas ;
            « archiver, douze réservations citent cette prestation » se décide.
            Sans le nombre, le gérant ne sait pas ce qu'il déplace — et il n'y a
            jamais les deux gestes : offrir une suppression pour la voir refusée
            apprend que l'écran propose des actions qui échouent. */}
        {retrait.geste === 'aucun' ? null : (
          <Button
            label={
              retrait.geste !== 'archiver'
                ? t('composition.retirerLaPrestation')
                : // Deux branches écrites à la main : `formaterLesNombres` rend
                  // `count` en chaîne, et la pluralisation d'i18n-js ne part
                  // donc jamais. « 1 bookings cite this » est déjà passé une
                  // fois par cet écran.
                  retrait.reservations === 1
                  ? t('composition.archiverUneReservation')
                  : t('composition.archiverAvecReservations', {
                      n: String(retrait.reservations),
                    })
            }
            size="sm"
            variant="ghost"
            fullWidth={false}
            loading={envoi}
            onPress={() => void retirer()}
            testID={`retirer-${item.id}`}
          />
        )}
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

      {/* **Fermer sans supprimer.** Une offre fermée reste à sa place, et c'est
          voulu : la retirer de la liste enlèverait le seul chemin pour la
          rouvrir. Elle dit ce qu'elle est — plus proposée — et ce qu'elle n'a
          pas fait : les réservations passées la citent toujours. */}
      {offre ? (
        <View style={{ gap: 6 }} testID={`offre-${offre.id}`}>
          {offre.is_active ? null : (
            <Texte
              variante="type.caption"
              couleur="ink.mute"
              testID={`offre-fermee-${offre.id}`}
            >
              {t('composition.offreFermeeCorps')}
            </Texte>
          )}
          <View style={{ flexDirection: 'row' }}>
            <Button
              label={t(offre.is_active ? 'composition.fermerLOffre' : 'composition.rouvrirLOffre')}
              variant="secondary"
              fullWidth={false}
              loading={bascule}
              onPress={() => void basculerLOffre()}
              testID={`basculer-offre-${offre.id}`}
            />
          </View>
        </View>
      ) : null}

      {remplacement ? (
        <NouvellePrestation
          businessId={businessId}
          paliers={paliers ?? []}
          remplace={item}
          onPublie={() => {
            setRemplacement(false);
            onChange();
          }}
          onAnnuler={() => setRemplacement(false)}
        />
      ) : null}
      {/* **Le conseil, et jamais la décision.** La plateforme dit ce qu'elle
          aurait fait à partir de la durée et de la place de cette prestation dans
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
              backgroundColor: c['bg.inset'],
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
  remplace,
}: {
  businessId: string;
  paliers: PalierOffrable[];
  onPublie: () => void;
  onAnnuler: () => void;
  /**
   * La prestation que celle-ci remplace, s'il y en a une.
   *
   * **Le même formulaire, parce que c'est le même geste.** Changer une durée
   * *est* composer une autre prestation : la neuve part des valeurs de
   * l'ancienne, qu'on modifie, et l'ancienne s'archive dans la même
   * transaction. En faire deux écrans dirait que ce sont deux choses.
   *
   * **Le palier ne suit pas, et c'est voulu.** Recopier l'offre poserait un
   * accord que personne n'a conclu : une créatrice a accepté un palier sur une
   * prestation de quarante-cinq minutes, et l'offre recopiée la ferait
   * consentir à soixante-quinze. Même principe que `value_cents_snapshot`,
   * appliqué à l'accord au lieu du prix.
   */
  remplace?: ItemDuCatalogue;
}) {
  const { api, messageDErreur } = useApi();
  const { t } = useI18n();
  const [nom, setNom] = useState(remplace?.name ?? '');
  const [duree, setDuree] = useState(remplace?.duration_minutes ?? 45);
  /**
   * **Le prix a quitté l'écran le 2026-08-24.** Le produit ne montre jamais de
   * montant — le créateur ne reçoit pas d'argent, et le prix n'est qu'une donnée
   * de reporting — donc un commerce n'a aucune raison d'en saisir un. Ce que le
   * serveur exige encore part à zéro : la suggestion de palier, seul usage
   * qu'en faisait l'écran, se calcule maintenant sur la durée.
   */
  const prixEnCentimes = 0;
  const [palierId, setPalierId] = useState<string | null>(paliers[0]?.id ?? null);
  const [echec, setEchec] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);

  const complet = nom.trim().length > 0;

  async function publier() {
    setEchec(null);
    setEnvoi(true);
    try {
      const champs = {
        name: nom.trim(),
        price_cents: prixEnCentimes,
        duration_minutes: duree,
      };
      // Remplacer, et non créer puis archiver en deux appels : le serveur fait
      // les deux dans la même transaction. En deux temps, une panne entre les
      // deux laisserait le catalogue avec les deux prestations, ou avec aucune.
      const item = remplace
        ? await api.remplacerUnItem(businessId, remplace.id, champs)
        : await api.creerUnItem(businessId, champs);
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
    <View
      style={{ gap: 12 }}
      testID={remplace ? `remplacer-${remplace.id}` : 'nouvelle-prestation'}
    >
      {remplace ? (
        <StatusMessage
          level="neutral"
          body={t('composition.remplaceExplication', { nom: remplace.name })}
          testID={`remplace-explication-${remplace.id}`}
        />
      ) : null}
      <TextField
        label={t('composition.champNom')}
        value={nom}
        onChangeText={setNom}
        testID="champ-nom"
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


/**
 * La photo d'une prestation, déposée depuis l'écran qui la compose.
 *
 * **Trouvable par son absence.** Une prestation sans photo montre un cadre
 * pointillé, et c'est tout ce qui l'annonce : aucun texte n'explique la
 * fonction, le manque se signale seul. Un intitulé « ajoutez une photo de
 * prestation » aurait décrit une capacité au lieu de la rendre évidente.
 *
 * **Celle-ci, pas la couverture.** Le fil montre la photo de l'article quand
 * elle existe et retombe sur la façade du salon sinon — quatre prestations
 * différentes derrière la même devanture, ce qui est l'inversion de hiérarchie
 * que la v3 a corrigée dans le texte et qui restait dans l'image.
 */
function PhotoDeLaPrestation({
  businessId,
  item,
  onChange,
}: {
  businessId: string;
  item: ItemDuCatalogue;
  onChange: () => void;
}) {
  const { api, messageDErreur } = useApi();
  const { t } = useI18n();
  const c = useColors();
  const [envoi, setEnvoi] = useState(false);
  const [echec, setEchec] = useState<string | null>(null);
  const [aRenvoyer, setARenvoyer] = useState<string | null>(null);

  async function choisir() {
    setEchec(null);
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setEchec(t('composition.photoPermission'));
      return;
    }

    const resultat = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.9,
    });
    const actif = resultat.canceled ? null : resultat.assets[0];
    if (!actif) return;

    await envoyer(actif.uri);
  }

  /**
   * L'envoi, séparé du choix.
   *
   * **Le fichier choisi était une variable locale** : un envoi qui échouait
   * laissait un message et rien d'autre, et réessayer voulait dire rouvrir la
   * galerie. C'est le cas que le défaut de téléversement rendait certain.
   */
  async function envoyer(uri: string) {
    setARenvoyer(uri);
    setEnvoi(true);
    setEchec(null);
    try {
      await api.photographierUnItem(businessId, item.id, uri);
      vibration.reussite();
      setARenvoyer(null);
      onChange();
    } catch (erreur) {
      vibration.echec();
      setEchec(messageDErreur(erreur));
    } finally {
      setEnvoi(false);
    }
  }

  const url = api.urlDeLaVignette(item.photo_key);

  return (
    <View style={{ gap: 8 }} testID={`photo-de-${item.id}`}>
      <Texte variante="type.label" couleur="ink.soft">
        {t('composition.photoTitre')}
      </Texte>

      {envoi ? (
        <Texte variante="type.caption" couleur="ink.soft" testID={`envoi-en-cours-${item.id}`}>
          {t('composition.photoEnvoiEnCours')}
        </Texte>
      ) : null}
      {echec && aRenvoyer ? (
        <View style={{ flexDirection: 'row' }}>
          <Button
            label={t('composition.photoReessayer')}
            size="sm"
            variant="secondary"
            fullWidth={false}
            onPress={() => void envoyer(aRenvoyer)}
            testID={`reessayer-l-envoi-${item.id}`}
          />
        </View>
      ) : null}

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t(url ? 'composition.photoRemplacer' : 'composition.photoAjouter', {
          nom: item.name,
        })}
        disabled={envoi}
        onPress={() => void choisir()}
        style={({ pressed }) => ({
          width: 96,
          height: 96,
          borderRadius: radius['radius.photo'],
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
          opacity: pressed || envoi ? 0.7 : 1,
          // **Le cadre pointillé ne se rend que sur l'absence.** Posé sous la
          // photo, il ne se verrait jamais ; posé à côté, il ferait deux
          // emplacements pour une seule image.
          ...(url
            ? {}
            : {
                borderWidth: 2,
                borderStyle: 'dashed' as const,
                borderColor: c['line.strong'],
              }),
        })}
        testID={`photo-choisir-${item.id}`}
      >
        {url ? (
          <Photo uri={url} hauteur={96} style={{ width: 96 }} testID={`photo-vue-${item.id}`} />
        ) : (
          <Icone nom="image" couleur="ink.mute" taille={22} />
        )}
      </Pressable>

      {echec ? <StatusMessage level="danger" body={echec} testID={`photo-echec-${item.id}`} /> : null}
    </View>
  );
}


/**
 * La vignette d'une prestation dans la liste, ou le cadre qui dit son absence.
 *
 * **Quarante-huit points, et pas un bouton.** Elle situe la ligne du regard ;
 * ce qui dépose vit dans le panneau de correction, où l'on s'est arrêté. Une
 * cible de plus sur chaque ligne d'une liste qu'on parcourt au pouce ferait
 * ouvrir la galerie du téléphone par frôlement.
 */
function Vignette({ item, testID }: { item: ItemDuCatalogue; testID: string }) {
  const { api } = useApi();
  const c = useColors();
  const url = api.urlDeLaVignette(item.photo_key);

  if (url) {
    return (
      <Photo
        uri={url}
        hauteur={48}
        style={{ width: 48, borderRadius: radius['radius.md'] }}
        testID={testID}
      />
    );
  }

  return (
    <View
      testID={testID}
      style={{
        width: 48,
        height: 48,
        borderRadius: radius['radius.md'],
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 2,
        borderStyle: 'dashed',
        borderColor: c['line.strong'],
      }}
    >
      <Icone nom="image" couleur="ink.mute" taille={17} />
    </View>
  );
}
