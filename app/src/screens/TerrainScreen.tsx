/**
 * Le mode terrain : préparer une fiche au comptoir, et la passer au salon.
 *
 * **Ce que cet écran fait de la démonstration.** La fondatrice est debout dans
 * un salon, tablette à la main, et un client attend. Elle saisit des *faits* —
 * le nom, l'adresse, le téléphone — pendant que le gérant finit une couleur.
 * Tout le reste, elle ne peut pas le poser : le mot de passe, les conditions,
 * la mise en ligne appartiennent au salon.
 *
 * **Le QR d'abord, parce que le décideur est souvent là.** Il scanne l'écran,
 * il continue sur son téléphone : rien à taper, et la personne qui assume est
 * manifestement celle qui est présente. Le courriel existe pour l'autre cas —
 * le propriétaire n'est pas dans le salon — et c'est celui-là qui perdait la
 * visite.
 *
 * **L'adresse du lien n'est rendue qu'une fois.** La base n'en garde que
 * l'empreinte : elle est affichée en clair sous le QR, à recopier tant qu'elle
 * est à l'écran. Fermer la carte la perd, et il faut alors réémettre — ce qui
 * ferme le lien précédent, comme il se doit.
 *
 * **Les fiches assumées restent dans la liste.** Sans elles, on ne saurait
 * jamais combien de visites ont abouti, et la tournée ne se jugerait qu'au
 * souvenir qu'on en a.
 *
 * **Le formulaire survit à l'état vide, et c'est le défaut qu'on répare ici.**
 * `Ecran` rend l'état vide *à la place* du contenu : sur un compte neuf — celui
 * de la toute première tournée, exactement celui pour lequel cet écran
 * existe — la liste était vide, le corps n'était donc jamais rendu, et les
 * trois champs n'apparaissaient nulle part. Le mode terrain était complet et
 * inutilisable tant qu'aucune fiche n'existait, c'est-à-dire toujours au
 * premier usage. Le formulaire est donc rendu dans les deux états, et une seule
 * fois : le recopier, c'est le laisser diverger.
 */
import { useState } from 'react';
import { View } from 'react-native';

import { ReprendreLeCompte } from './reprise/ReprendreLeCompte';
import QRCode from 'react-native-qrcode-svg';

import {
  useApi,
  type EtatDeLaTournee,
  type FichePreparee,
  type LienRemis,
} from '../api';
import {
  Button,
  Chip,
  EmptyState,
  FiletSegmente,
  SkeletonLignes,
  StatusMessage,
  Texte,
  TextField,
} from '../components';
import { formatDate, formatNumber } from '../format';
import { useI18n } from '../i18n';
import { codeColors, elevationDeCarte, radius, useColors } from '../theme';
import { Ecran } from './Ecran';
import { mainsDeLaFiche } from './terrain/mains';
import { bilanDeTournee } from './terrain/tournee';
import { useRequete } from './useRequete';

const TAILLE_DU_QR = 220;

/**
 * Le fuseau d'affichage de cet écran.
 *
 * Celui du terminal, et non celui d'un commerce : la fondatrice regarde une
 * liste de salons qui ne partagent pas forcément le même, et l'heure qui
 * l'intéresse est celle de sa montre. C'est le seul écran du produit dans ce
 * cas — partout ailleurs, la date se lit dans le fuseau du commerce concerné.
 */
const FUSEAU = Intl.DateTimeFormat().resolvedOptions().timeZone;

/** Ce que la fondatrice saisit debout. Le strict nécessaire pour géolocaliser. */
type Brouillon = {
  nom: string;
  adresse: string;
  telephone: string;
};

const VIDE: Brouillon = { nom: '', adresse: '', telephone: '' };

/**
 * **L'état vient du serveur, et deux dérivations sont mortes ici.**
 *
 * Cet écran en portait une depuis le premier lot ; j'en avais ajouté une
 * seconde la veille, dans son propre module. Le serveur sert désormais `etat`,
 * et l'ordre y est plus délicat qu'il n'y paraît : une fiche **bloquée puis
 * assumée est assumée**, et regarder `blocked_at` avant `used_at` afficherait
 * « bloquée » pour toujours sur un salon qui travaille depuis un mois — la
 * tournée compterait alors un échec là où elle a réussi.
 *
 * Le vocabulaire servi est celui de la conduite et non de la base : « jamais
 * ouverte » se **revisite**, « abandonnée » se **relance**, « bloquée » ne se
 * démarche pas du tout — c'est le produit qui coince.
 */

/**
 * Les états où un lien court encore : réémettre le remplace, révoquer le
 * retire. Sur une fiche jamais remise il n'y a rien à révoquer, et sur une
 * fiche expirée il n'y a plus rien à retirer.
 */
const EN_COURS = new Set<EtatDeLaTournee>([
  'never_opened',
  'opened_not_claimed',
  'blocked_on_commitment',
]);

export function TerrainScreen() {
  const { t, locale } = useI18n();
  const c = useColors();
  const { api, messageDErreur } = useApi();

  const requete = useRequete<FichePreparee[]>((signal) => api.fichesPreparees(signal), {
    estVide: (lignes) => lignes.length === 0,
  });

  const [brouillon, setBrouillon] = useState<Brouillon>(VIDE);
  const [enCours, setEnCours] = useState(false);
  const [echec, setEchec] = useState<string | null>(null);
  const [lien, setLien] = useState<LienRemis | null>(null);

  async function preparer() {
    setEchec(null);
    setEnCours(true);
    try {
      await api.preparerUneFiche({
        name: brouillon.nom.trim(),
        category: 'beauty',
        currency: 'USD',
        address: brouillon.adresse.trim() || null,
        phone: brouillon.telephone.trim() || null,
      });
      setBrouillon(VIDE);
      requete.recharger();
    } catch (erreur) {
      setEchec(messageDErreur(erreur));
    } finally {
      setEnCours(false);
    }
  }

  async function emettre(fiche: FichePreparee) {
    setEchec(null);
    try {
      // Le QR par défaut : c'est le cas où le décideur est devant la tablette,
      // et il n'a alors rien à taper.
      setLien(await api.emettreLeLien(fiche.business_id, 'qr'));
      requete.recharger();
    } catch (erreur) {
      setEchec(messageDErreur(erreur));
    }
  }

  async function revoquer(fiche: FichePreparee) {
    setEchec(null);
    try {
      await api.revoquerLeLien(fiche.business_id);
      setLien(null);
      requete.recharger();
    } catch (erreur) {
      setEchec(messageDErreur(erreur));
    }
  }

  // Ce qui est réellement saisi, et non ce qui est obligatoire : la fiche part
  // avec le nom seul, et le filet dit ce qu'il reste à gagner, pas ce qui
  // bloque. Une fiche à trois champs vaut mieux qu'une fiche abandonnée.
  const remplis = [brouillon.nom, brouillon.adresse, brouillon.telephone].filter(
    (valeur) => valeur.trim().length > 0,
  ).length;

  /**
   * Ce qui ne dépend pas de la liste : le refus s'il y en a un, et les trois
   * champs. Rendu dans l'état vide comme dans l'état nominal — construit une
   * fois, parce que deux copies finissent par ne plus dire la même chose.
   */
  const saisie = (
    <>
      {echec ? <StatusMessage level="danger" body={echec} testID="echec-terrain" /> : null}

      {/* Préparer, en trois champs. Debout, entre deux clients. */}
      <View style={{ gap: 12 }} testID="formulaire-de-fiche">
        <Texte variante="type.bodyStrong">{t('terrain.preparer')}</Texte>
        {/* **Le filet segmenté, repris des carrousels de la marque.** Il
            remplace le compteur « 2 sur 3 » : debout, à une main, entre deux
            clientes, on voit où l'on en est sans lire. L'orange y est admis
            alors qu'il est compté ailleurs, parce que le filet ne porte aucun
            texte — c'est une surface, comme le filet d'onglet actif, et la
            règle du bloc ne parle que du bloc. */}
        <FiletSegmente
          etapes={3}
          faites={remplis}
          accessibilityLabel={t('terrain.avancement')}
          testID="avancement-de-la-fiche"
        />
        <TextField
          label={t('terrain.nom')}
          value={brouillon.nom}
          onChangeText={(nom) => setBrouillon((avant) => ({ ...avant, nom }))}
          testID="champ-nom"
        />
        <TextField
          label={t('terrain.adresse')}
          value={brouillon.adresse}
          onChangeText={(adresse) => setBrouillon((avant) => ({ ...avant, adresse }))}
          testID="champ-adresse"
        />
        <TextField
          label={t('terrain.telephone')}
          value={brouillon.telephone}
          onChangeText={(telephone) => setBrouillon((avant) => ({ ...avant, telephone }))}
          keyboard="numeric"
          testID="champ-telephone"
        />
        <Button
          label={t('terrain.enregistrer')}
          onPress={() => void preparer()}
          disabled={brouillon.nom.trim().length === 0}
          loading={enCours}
          loadingLabel={t('terrain.enregistrement')}
          testID="enregistrer-la-fiche"
        />
      </View>
    </>
  );

  return (
    <Ecran
      requete={requete}
      titre={t('terrain.titre')}
      // **Le nom de l'écran, et il manquait.** Un parcours de bout en bout se
      // porte par l'écran qu'il éprouve — la garde des sélecteurs l'exige — et
      // sans ce nom il ne pouvait pas s'y porter du tout : l'exploration a dû
      // viser des champs isolés, donc mesurer l'existence d'un contrôle plutôt
      // que celle de la page qui le contient.
      testID="ecran-terrain"
      squelette={<SkeletonLignes combien={5} testID="squelette-terrain" />}
      vide={
        <View style={{ gap: 20 }}>
          <EmptyState title={t('terrain.videTitre')} body={t('terrain.videCorps')} />
          {saisie}
        </View>
      }
    >
      {(fiches) => (
        <View style={{ gap: 20 }}>

          {/* Le lien qu'on vient d'émettre, en grand. Il ne se relit pas. */}
          {lien ? (
            <View
              testID="lien-remis"
              style={{
                alignItems: 'center',
                gap: 12,
                padding: 20,
                borderRadius: radius['radius.lg'],
                backgroundColor: c['bg.surface'],
                borderWidth: 1,
                borderColor: c['line.strong'],
                // « Un coin de 18 px sans ombre flotte au lieu de se poser » : passation §2.
                ...elevationDeCarte(),
              }}
            >
              <Texte variante="type.label" couleur="ink.soft">
                {t('terrain.aScanner')}
              </Texte>
              {/* **Sombre sur clair, et non l'inverse.** Les deux mêmes
                  constantes que l'écran de code — les seules du produit à ne
                  pas venir d'un thème — mais échangées : un code de retrait se
                  lit en blanc sur noir, un QR se scanne en noir sur blanc, et
                  beaucoup de lecteurs refusent un code inversé. */}
              <View
                style={{
                  padding: 12,
                  backgroundColor: codeColors.fg,
                  borderRadius: radius['radius.lg'],
                }}
              >
                <QRCode
                  value={lien.url}
                  size={TAILLE_DU_QR}
                  color={codeColors.bg}
                  backgroundColor={codeColors.fg}
                />
              </View>
              {/* En clair sous le code : un écran qui ne scanne pas se dicte. */}
              <Texte variante="type.data" testID="adresse-du-lien">
                {lien.url}
              </Texte>
              <Texte variante="type.caption" couleur="ink.mute">
                {t('terrain.expire', {
                  quand: formatDate(lien.expires_at, locale, FUSEAU),
                })}
              </Texte>
              <Button
                label={t('terrain.fermerLeLien')}
                variant="ghost"
                onPress={() => setLien(null)}
                testID="fermer-le-lien"
              />
            </View>
          ) : null}

          {saisie}

          {/* **Le bilan de la tournée, avant sa liste.** Les autres blocs de
              cet écran servent une visite ; celui-ci répond à une autre
              question, et c'est la seule qui se lit assise : est-ce que la
              tournée valait le déplacement ? */}
          <BilanDeLaTournee fiches={fiches} />

          {/* Le suivi. Les fiches assumées y restent. */}
          <View style={{ gap: 12 }}>
            <Texte variante="type.bodyStrong">{t('terrain.suivi')}</Texte>
            {fiches.map((fiche) => (
              <LigneDeFiche
                key={fiche.business_id}
                fiche={fiche}
                onEmettre={() => void emettre(fiche)}
                onRevoquer={() => void revoquer(fiche)}
              />
            ))}
          </View>
        </View>
      )}
    </Ecran>
  );
}

/**
 * Ce que la tournée a rapporté, et par quelle voie.
 *
 * **Le chiffre décisif n'est pas le taux d'activation, c'est l'écart entre les
 * deux voies de remise.** Il ne dit pas d'abandonner le lien — un lien vaut
 * mieux qu'une visite perdue — il dit qu'un second passage pour attraper le
 * décideur rapporte plus qu'une relance. Un taux global mélangerait justement
 * les deux méthodes qu'on cherche à comparer.
 */
function BilanDeLaTournee({ fiches }: { fiches: FichePreparee[] }) {
  const { t, locale } = useI18n();
  const bilan = bilanDeTournee(fiches);

  // Rien à dire tant qu'aucune fiche n'est partie : trois zéros et un tiret
  // n'aident personne, et l'écran a déjà son formulaire à montrer.
  if (bilan.remises === 0) return null;

  const nommees = bilan.voies.filter((voie) => voie.taux !== null);

  return (
    <View style={{ gap: 10 }} testID="bilan-de-tournee">
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 24 }}>
        <Chiffre valeur={String(bilan.preparees)} legende={t('terrain.bilanPreparees')} testID="bilan-preparees" />
        <Chiffre valeur={String(bilan.remises)} legende={t('terrain.bilanRemises')} testID="bilan-remises" />
        <Chiffre valeur={String(bilan.activees)} legende={t('terrain.bilanActivees')} testID="bilan-activees" />
        {/* **Le délai n'apparaît qu'avec une activation.** « — » à côté de
            trois chiffres se lit comme une panne ; l'absence de délai n'en est
            pas une, c'est que personne n'a encore repris sa fiche. */}
        {bilan.delaiMedianHeures !== null ? (
          <Chiffre
            valeur={t('terrain.bilanHeures', {
              n: formatNumber(Math.round(bilan.delaiMedianHeures), locale),
            })}
            legende={t('terrain.bilanDelai')}
            testID="bilan-delai"
          />
        ) : null}
      </View>

      {/* **L'écart, en toutes lettres.** Deux pourcentages posés côte à côte
          laisseraient à faire la soustraction ; la phrase dit ce qu'ils
          impliquent, qui est le seul intérêt de les mesurer. */}
      {nommees.length === 2 ? (
        <Texte variante="type.caption" couleur="ink.soft" testID="ecart-des-voies">
          {t('terrain.bilanEcart', {
            enMain: Math.round((nommees.find((v) => v.voie === 'qr')?.taux ?? 0) * 100),
            parLien: Math.round((nommees.find((v) => v.voie === 'email')?.taux ?? 0) * 100),
          })}
        </Texte>
      ) : null}
    </View>
  );
}

/** Un nombre et ce qu'il compte. La légende sous le chiffre, jamais l'inverse. */
function Chiffre({
  valeur,
  legende,
  testID,
}: {
  valeur: string;
  legende: string;
  testID: string;
}) {
  return (
    <View style={{ width: 150, gap: 2 }} testID={testID}>
      <Texte variante="type.figure">{valeur}</Texte>
      <Texte variante="type.caption" couleur="ink.soft">
        {legende}
      </Texte>
    </View>
  );
}

function LigneDeFiche({
  fiche,
  onEmettre,
  onRevoquer,
}: {
  fiche: FichePreparee;
  onEmettre: () => void;
  onRevoquer: () => void;
}) {
  const { t, locale } = useI18n();
  const c = useColors();
  const etat = fiche.etat;
  const mains = mainsDeLaFiche(fiche);
  const [reprise, setReprise] = useState(false);

  return (
    <View
      testID={`fiche-${fiche.business_id}`}
      style={{
        gap: 8,
        padding: 16,
        borderRadius: radius['radius.lg'],
        backgroundColor: c['bg.surface'],
        borderWidth: 1,
        borderColor: c['line.default'],
        // « Un coin de 18 px sans ombre flotte au lieu de se poser » : passation §2.
        ...elevationDeCarte(),
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Texte variante="type.body" style={{ flex: 1 }}>
          {fiche.name}
        </Texte>
        {/* **Le mot, et pas une couleur seule.** L'écart entre « préparée » et
            « lien ouvert » est ce qui dit si la tournée a servi ; le lire
            demande un mot, pas une pastille à interpréter. */}
        <Chip label={t(`terrain.etat.${etat}`)} testID={`etat-${fiche.business_id}`} />
      </View>
      {fiche.address ? (
        <Texte variante="type.caption" couleur="ink.mute">
          {fiche.address}
        </Texte>
      ) : null}
      <Texte variante="type.caption" couleur="ink.mute" ellipseSurNomPropre>
        {mains.preparee
          ? t('terrain.prepareePar', {
              quand: formatDate(fiche.prepared_at, locale, FUSEAU),
              par: mains.preparee,
            })
          : t('terrain.preparee', { quand: formatDate(fiche.prepared_at, locale, FUSEAU) })}
      </Texte>

      {/* **La seconde main ne paraît que si c'en est une autre.** Le cas
          courant est que la même personne prépare et remet ; écrire son adresse
          deux fois sur la même ligne n'ajoute rien et allonge une liste qu'on
          parcourt. */}
      {mains.remiseParUnAutre ? (
        <Texte
          variante="type.caption"
          couleur="ink.mute"
          ellipseSurNomPropre
          testID={`remise-par-${fiche.business_id}`}
        >
          {t('terrain.remisePar', { par: mains.remiseParUnAutre })}
        </Texte>
      ) : null}

      {/* **Rien à faire sur une fiche assumée.** Le salon en est propriétaire ;
          lui rouvrir un lien de prise en main n'aurait aucun sens, et le
          serveur le refuse. */}
      {/* **Reprendre le compte n'existe que sur une fiche assumée**, et c'est
          le seul endroit du produit où l'administration a un salon nommé sous
          les yeux. Avant la prise en main, il n'y a pas de compte à reprendre :
          la fiche n'a pas d'utilisateur, et il n'y a personne à prévenir.

          **La place n'est plus la seule.** L'onglet « salons » liste désormais
          tous les commerces, quel que soit leur état, et porte le même
          formulaire : un salon inscrit tout seul était hors d'atteinte du
          support tant que la reprise ne vivait qu'ici. Celle-ci reste, parce
          qu'un administrateur debout dans un salon a déjà sa fiche ouverte et
          n'a pas à la rechercher par son nom. */}
      {etat === 'claimed' ? (
        reprise ? (
          <ReprendreLeCompte businessId={fiche.business_id} nomDuSalon={fiche.name} />
        ) : (
          <View style={{ flexDirection: 'row' }}>
            <Button
              label={t('reprise.entrer')}
              size="sm"
              variant="ghost"
              fullWidth={false}
              onPress={() => setReprise(true)}
              testID={`reprendre-${fiche.business_id}`}
            />
          </View>
        )
      ) : (
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Button
            label={t(EN_COURS.has(etat) ? 'terrain.reemettre' : 'terrain.emettre')}
            size="sm"
            onPress={onEmettre}
            testID={`emettre-${fiche.business_id}`}
          />
          {EN_COURS.has(etat) ? (
            <Button
              label={t('terrain.revoquer')}
              size="sm"
              variant="ghost"
              onPress={onRevoquer}
              testID={`revoquer-${fiche.business_id}`}
            />
          ) : null}
        </View>
      )}
    </View>
  );
}
