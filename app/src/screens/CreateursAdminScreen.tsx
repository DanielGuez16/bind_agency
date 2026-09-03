/**
 * L'annuaire des créatrices, côté administration.
 *
 * **En lignes, comme celui du commerce, et pour la même raison.** Une grille de
 * portraits se regarde ; une liste se parcourt. L'administration cherche
 * quelqu'un — un pseudonyme entendu au téléphone, un compte dont on vient de
 * lire le dossier en arbitrage — et une ligne par personne est ce qui se
 * parcourt le plus vite.
 *
 * **Ni état civil, et ce n'est pas une commodité.** Le pseudonyme est
 * l'identité de ces écrans ; le nom civil arrive à la réservation, quand une
 * créatrice a choisi ce salon.
 *
 * **Le score et le palier accessible sont servis, et cette phrase disait
 * l'inverse pour les deux.** Le score, parce que l'argument portait sur le
 * classement d'une liste et non sur la donnée elle-même — voir le commentaire
 * de `CreateurAdmin.reliability_score`. Le palier, parce qu'« aucun » disait
 * en fait « pas encore » : le calcul ne demandait pas de salon de référence,
 * seulement une requête d'ensemble qui n'existait pas — voir
 * `eligibility.evaluer_createurs`, trois requêtes pour toute la population,
 * plutôt que trois par créatrice.
 *
 * **Aucune distance, en revanche, et ça tient.** Elle se calcule depuis un
 * salon ; un administrateur n'en a pas, et lui en inventer un rendrait un
 * chiffre faux d'une manière que personne ne verrait.
 */
import { useCallback, useState } from 'react';
import { View } from 'react-native';

import { useApi, type AnnuaireAdmin, type CreateurAdmin } from '../api';
import {
  BandeDeChiffres,
  Chiffre,
  Icone,
  LienExterne,
  Photo,
  SkeletonLignes,
  StatusMessage,
  TableHeader,
  TableRow,
  TextField,
  Texte,
  TierBadge,
  type Colonne,
} from '../components';
import { formatNumber } from '../format';
import { useI18n } from '../i18n';
import { radius, useColors } from '../theme';
import { Ecran } from './Ecran';
import { useRequete } from './useRequete';
import { motion } from '../theme';

export function CreateursAdminScreen() {
  const { api } = useApi();
  const { t, locale } = useI18n();
  const c = useColors();
  const [recherche, setRecherche] = useState('');
  const [demande, setDemande] = useState('');

  // **La recherche part au serveur, pas dans la page rendue.** Un filtre local
  // ne verrait que les cent premiers, c'est-à-dire pas celui qu'on cherche
  // quand on ne le trouve pas.
  const differer = useCallback((valeur: string) => {
    setRecherche(valeur);
    const delai = setTimeout(() => setDemande(valeur), motion.etat);
    return () => clearTimeout(delai);
  }, []);

  const requete = useRequete<AnnuaireAdmin>(
    (signal) => api.createursAdmin(demande || null, signal),
    { estVide: (annuaire) => annuaire.items.length === 0, dependances: [demande] },
  );

  return (
    <Ecran
      requete={requete}
      titre={t('admin.createursTitre')}
      sousTitre={t('admin.createursSousTitre')}
      // **Sept colonnes font 924 points, le repli `merchant` en offrait 672.**
      // Le palier se coupait, le score de fiabilité et le lien vers le profil
      // ne s'affichaient pas du tout — rendus, mais hors du cadre, qui est en
      // `overflow: 'hidden'` sans défilement horizontal. C'est pour ça que les
      // liens Instagram « ne marchaient pas » : ils n'étaient pas atteignables.
      nature="reports"
      squelette={<SkeletonLignes combien={8} testID="squelette-createurs" />}
      testID="ecran-createurs-admin"
      vide={
        <View style={{ gap: 12 }}>
          <BarreDeRecherche valeur={recherche} onChange={differer} />
          <Texte variante="type.caption" couleur="ink.soft" testID="createurs-vide">
            {t(demande ? 'admin.createursVideRecherche' : 'admin.createursVide')}
          </Texte>
        </View>
      }
    >
      {(annuaire) => (
        <View style={{ gap: 12 }}>
          <BarreDeRecherche valeur={recherche} onChange={differer} />

          {/* **Les cinq nombres de tête, mesurés sur la planche.** Ils portent
              sur la recherche entière — `annuaire.total` et non
              `items.length` — sans quoi le plafond de la liste ferait dire
              « 41 sur cent » à une population qui en compte cent vingt-huit.
              La légende de la sous-titre disait déjà le total seul ; la bande
              le remplace plutôt que de le répéter à côté. */}
          <BandeDeChiffres testID="chiffres-createurs">
            <Chiffre
              valeur={formatNumber(annuaire.total, locale)}
              legende={t('admin.createursSurBind')}
              testID="chiffre-total"
            />
            <Chiffre
              valeur={formatNumber(annuaire.peut_reserver, locale)}
              legende={t('admin.createursPeuventReserver')}
              testID="chiffre-peut-reserver"
            />
            <Chiffre
              valeur={formatNumber(annuaire.arrivees_cette_semaine, locale)}
              legende={t('admin.createursArriveesCetteSemaine')}
              testID="chiffre-arrivees"
            />
            <Chiffre
              // **Zéro effectif, zéro chiffre — jamais un zéro qui se lirait
              // « la moins fiable ».** `fiabilite_mediane` est nulle tant
              // qu'aucun score n'existe, exactement pour la même raison que
              // le score lui-même : nul veut dire neutre.
              valeur={
                annuaire.fiabilite_mediane
                  ? formatNumber(Math.round(Number(annuaire.fiabilite_mediane)), locale)
                  : t('admin.createursSansScore')
              }
              legende={t('admin.createursFiabiliteMedianeLegende')}
              // **L'effectif ne s'écrit pas dans le cartouche, il se dit.**
              // La planche pose « 86 » seul ; « 86 sorti de trois scores »
              // n'est pas « 86 sorti de cent vingt-huit », et c'est
              // exactement ce que `createurs_avec_score` distingue. Le
              // taire à l'écran suit la planche, le taire à la voix
              // laisserait perdre l'avertissement que les deux médianes
              // d'abonnement portent déjà.
              accessibilityLabel={t('admin.createursFiabiliteMedianeAvecEffectif', {
                valeur: annuaire.fiabilite_mediane
                  ? formatNumber(Math.round(Number(annuaire.fiabilite_mediane)), locale)
                  : t('admin.createursSansScore'),
                effectif: formatNumber(annuaire.createurs_avec_score, locale),
              })}
              dernier
              testID="chiffre-fiabilite-mediane"
            />
          </BandeDeChiffres>

          {annuaire.total > annuaire.items.length ? (
            <Texte variante="type.caption" couleur="ink.soft" testID="plafond-createurs">
              {t('admin.createursPlafond', { count: annuaire.items.length })}
            </Texte>
          ) : null}

          <View
            style={{
              borderRadius: radius['radius.lg'],
              borderWidth: 1,
              borderColor: c['line.default'],
              backgroundColor: c['bg.surface'],
              overflow: 'hidden',
            }}
          >
            <TableHeader colonnes={COLONNES(t)} testID="entete-createurs" />
            {annuaire.items.map((createur) => (
              <LigneDeCreateur key={createur.creator_id} createur={createur} locale={locale} />
            ))}
          </View>

          {/* **La phrase qui dit pourquoi le chiffre vit ici.** Sans elle,
              l'administration lit une note sur des personnes sans savoir ce
              qu'elle engage — et la première question qu'on se pose devant une
              colonne pareille est « qui d'autre la voit ». La réponse est
              personne, et c'est une promesse qui se dit. */}
          <StatusMessage
            level="neutral"
            body={t('admin.createursFiabiliteRaison')}
            testID="fiabilite-vit-ici"
          />
        </View>
      )}
    </Ecran>
  );
}

function BarreDeRecherche({
  valeur,
  onChange,
}: {
  valeur: string;
  onChange: (v: string) => void;
}) {
  const { t } = useI18n();
  return (
    <TextField
      label={t('admin.createursRecherche')}
      value={valeur}
      onChangeText={onChange}
      testID="recherche-createurs"
    />
  );
}

/**
 * Les sept colonnes de la planche, dans son ordre — TIER compris.
 *
 * **Elle manquait, et l'absence était nommée plutôt que masquée.** La colonne
 * demandait de calculer le palier de cent créatrices contre tous les paliers
 * du produit ; `evaluer_createur` coûtait trois requêtes **par créatrice**,
 * donc trois cents pour la page. `eligibility.evaluer_createurs` le rend en
 * trois requêtes pour l'ensemble — le chantier que ce manque appelait, fait.
 */
const COLONNES = (t: (cle: string) => string): Colonne[] => [
  { cle: 'pseudonyme', label: t('admin.createursColonneCreatrice'), largeur: 240 },
  { cle: 'ville', label: t('admin.createursColonneVille'), largeur: 160 },
  { cle: 'reseau', label: t('admin.createursColonneReseau'), largeur: 80 },
  { cle: 'audience', label: t('admin.createursColonneAudience'), largeur: 100, chiffre: true },
  { cle: 'tier', label: t('admin.createursColonneTier'), largeur: 90 },
  { cle: 'fiabilite', label: t('admin.createursColonneFiabilite'), largeur: 100, chiffre: true },
  { cle: 'profil', label: '', largeur: 130 },
];

/** Une créatrice : sa photo, son pseudonyme, ses réseaux, son volume. */
function LigneDeCreateur({
  createur,
  locale,
}: {
  createur: CreateurAdmin;
  locale: 'en' | 'es';
}) {
  const { api } = useApi();
  const { t } = useI18n();
  const c = useColors();

  // Le compte le plus suivi nomme la personne : l'ordre de rattachement est un
  // accident de parcours, le volume est ce qu'on retient d'elle.
  const tete = [...createur.reseaux].sort(
    (a, b) => (b.followers ?? -1) - (a.followers ?? -1),
  )[0];
  const portrait = tete?.avatar_key ? api.urlDuPortrait(tete.avatar_key) : null;
  const lien = tete?.profil_url ?? null;

  return (
    <TableRow
      testID={`createur-${createur.creator_id}`}
      colonnes={COLONNES(t)}
      valeurs={{
        pseudonyme: tete?.handle ?? t('admin.createursSansReseau'),
        // La ville telle qu'elle est déclarée, et le mot quand elle ne l'est
        // pas : un tiret dans une colonne de mots est un signe à interpréter.
        ville: createur.city ?? t('admin.createursSansVille'),
        audience:
          createur.reseaux.length > 0 ? formatNumber(createur.audience_totale, locale) : '',
        /**
         * **« Aucun relevé » et non « 0 ».**
         *
         * `null` signifie neutre dans le moteur de paliers, pas zéro : la
         * condition de score est *ignorée*, pas échouée. Écrire zéro
         * classerait la créatrice la plus récente au dernier rang d'une
         * colonne de notes, ce qui est exactement la lecture que la règle
         * interdit — et sur cet écran-là, c'est un arbitre qui la ferait.
         */
        fiabilite: createur.reliability_score
          ? formatNumber(Math.round(Number(createur.reliability_score)), locale)
          : t('admin.createursSansScore'),
      }}
      rendus={{
        /* **Le badge à trois marqueurs, comme sur Reviews.** Nul quand elle
           n'ouvre aucun palier — aucun compte vérifié, aucun relevé récent,
           ou aucun format à sa portée. Le mot plutôt qu'un tiret : les
           autres colonnes de texte écrivent déjà en mots ce qu'elles n'ont
           pas, et un tiret dans une colonne de badges se lirait comme un
           signe à interpréter plutôt que comme une absence nommée. */
        tier: createur.tier ? (
          <TierBadge
            tier={createur.tier.content_format}
            size="sm"
            testID={`tier-${createur.creator_id}`}
          />
        ) : (
          <Texte
            variante="type.body"
            couleur="ink.mute"
            testID={`tier-${createur.creator_id}`}
          >
            {t('admin.createursSansPalier')}
          </Texte>
        ),
        // Le portrait accompagne le pseudonyme : c'est la cellule qui nomme.
        pseudonyme: (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 }}>
            {portrait ? (
              <Photo
                uri={portrait}
                hauteur={28}
                style={{ width: 28, borderRadius: radius['radius.pill'] }}
                testID={`portrait-${createur.creator_id}`}
              />
            ) : (
              // Un rond vide plutôt qu'une initiale : un pseudonyme n'a pas
              // d'initiale qui veuille dire quelque chose.
              <View
                testID={`portrait-absent-${createur.creator_id}`}
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: radius['radius.pill'],
                  backgroundColor: c['bg.inset'],
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Icone nom="personne" taille={14} couleur="ink.soft" />
              </View>
            )}
            <Texte
              variante="type.bodyStrong"
              ellipseSurNomPropre
              testID={`pseudonyme-${createur.creator_id}`}
            >
              {tete?.handle ?? t('admin.createursSansReseau')}
            </Texte>
          </View>
        ),
        /* **Le glyphe de la plateforme, copié des primitives.** Le nom du
           réseau écrit en toutes lettres prendrait la largeur d'une colonne de
           texte pour dire ce qu'un logo dit d'un coup d'œil. */
        reseau: tete ? (
          <Icone
            nom={tete.platform === 'tiktok' ? 'tiktok' : 'instagram'}
            taille={18}
            couleur="ink.soft"
            testID={`reseau-${createur.creator_id}`}
          />
        ) : /* **Vide, et non « No network connected » une seconde fois.** La
              phrase tient déjà dans la colonne du nom, qui est celle qui
              nomme ; répétée dans une colonne de glyphes large de quatre-vingts
              points, elle passait sur trois lignes et donnait à cette rangée
              trois fois la hauteur des autres — une table dont les rangées ne
              s'alignent plus cesse d'être une table.

              C'est déjà ce que fait la colonne voisine : `audience` rend une
              chaîne vide quand aucun compte n'est rattaché, pour cette raison
              exacte. */
        null,
        /* **Le seul geste de la ligne, et il quitte l'application.** La fiche
           publique vit sur la plateforme ; le produit n'a pas d'écran de
           créatrice côté administration, et en inventer un demanderait de
           décider ce qu'on y montre — ce que la planche ne tranche pas. */
        profil: lien ? (
          /* **Une vraie ancre, et pas un `Pressable` de rôle « link ».** Le
             clic marchait déjà ; ce qui manquait est tout le reste de ce qu'un
             lien est — l'ouvrir dans un onglet, copier son adresse, voir où il
             mène avant d'appuyer. Sur cet écran c'est le seul geste offert, et
             on l'utilise en série : ouvrir cinq profils sans perdre la liste
             est précisément ce que le clic-milieu sert à faire. */
          <LienExterne
            url={lien}
            accessibilityLabel={t('admin.createursOuvrirLeProfil', {
              pseudonyme: tete?.handle ?? '',
            })}
            testID={`profil-${createur.creator_id}`}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}
          >
            <Texte variante="type.body" couleur="ink.default" style={{ fontWeight: '600' }}>
              {t('admin.createursOuvrir')}
            </Texte>
            <Icone nom="sortie" taille={14} couleur="ink.soft" />
          </LienExterne>
        ) : null,
      }}
    />
  );
}
