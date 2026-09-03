/**
 * L'annuaire des créatrices, côté administration.
 *
 * **En lignes, comme celui du commerce, et pour la même raison.** Une grille de
 * portraits se regarde ; une liste se parcourt. L'administration cherche
 * quelqu'un — un pseudonyme entendu au téléphone, un compte dont on vient de
 * lire le dossier en arbitrage — et une ligne par personne est ce qui se
 * parcourt le plus vite.
 *
 * **Ni état civil, ni score, et ce n'est pas une commodité.** La règle qui les
 * tient hors de l'annuaire du commerce ne vient pas du rôle de celui qui
 * regarde : elle vient de ce qu'un classement de personnes par note produit.
 * L'administration a l'écran d'arbitrage pour juger, et il juge **un dossier**.
 *
 * **Aucune distance, aucun palier accessible.** Les deux existent sur l'annuaire
 * du commerce parce qu'ils se calculent depuis un salon. Un administrateur n'en
 * a pas : les rendre ici demanderait d'inventer un salon de référence, dont
 * chaque chiffre serait faux d'une manière invisible.
 */
import { useCallback, useState } from 'react';
import { Linking, Pressable, View } from 'react-native';

import { useApi, type AnnuaireAdmin, type CreateurAdmin } from '../api';
import {
  Icone,
  Photo,
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

          {/* **Le total, et non le compte des lignes rendues.** La liste
              s'arrête à cent : écrire sa longueur ferait dire « 100 créateurs »
              à un produit qui en a cent vingt-huit, et le plafond dirait qu'on
              tronque sans dire de combien. */}
          <Texte variante="type.caption" couleur="ink.soft" testID="compte-createurs">
            {t('admin.createursCompte', { n: String(annuaire.total) })}
          </Texte>

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
 * Les colonnes de la planche, dans son ordre.
 *
 * **Il manque « TIER », et l'inventer aurait été pire que l'omettre.** La
 * planche dessine le palier qu'une créatrice ouvre. Il se calcule contre tous
 * les paliers du produit — c'est faisable — mais le service qui le fait est
 * `evaluer_createur`, trois requêtes **par créatrice** : cent lignes en
 * demanderaient trois cents. Il faut une requête d'ensemble côté serveur, et
 * elle n'existe pas. Une colonne remplie à l'estime aurait été fausse d'une
 * manière que personne ne voit, ce que l'en-tête de cette route interdit déjà
 * pour la distance.
 */
const COLONNES = (t: (cle: string) => string): Colonne[] => [
  { cle: 'pseudonyme', label: t('admin.createursColonneCreatrice'), largeur: 260 },
  { cle: 'ville', label: t('admin.createursColonneVille'), largeur: 180 },
  { cle: 'reseau', label: t('admin.createursColonneReseau'), largeur: 90 },
  { cle: 'audience', label: t('admin.createursColonneAudience'), largeur: 120, chiffre: true },
  { cle: 'fiabilite', label: t('admin.createursColonneFiabilite'), largeur: 120, chiffre: true },
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
        ) : (
          <Texte variante="type.body" couleur="ink.mute">
            {t('admin.createursSansReseau')}
          </Texte>
        ),
        /* **Le seul geste de la ligne, et il quitte l'application.** La fiche
           publique vit sur la plateforme ; le produit n'a pas d'écran de
           créatrice côté administration, et en inventer un demanderait de
           décider ce qu'on y montre — ce que la planche ne tranche pas. */
        profil: lien ? (
          <Pressable
            accessibilityRole="link"
            accessibilityLabel={t('admin.createursOuvrirLeProfil', {
              pseudonyme: tete?.handle ?? '',
            })}
            onPress={() => void Linking.openURL(lien)}
            testID={`profil-${createur.creator_id}`}
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              gap: 6,
              opacity: pressed ? 0.6 : 1,
            })}
          >
            <Texte variante="type.body" couleur="ink.default" style={{ fontWeight: '600' }}>
              {t('admin.createursOuvrir')}
            </Texte>
            <Icone nom="sortie" taille={14} couleur="ink.soft" />
          </Pressable>
        ) : null,
      }}
    />
  );
}
