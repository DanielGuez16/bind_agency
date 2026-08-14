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
import QRCode from 'react-native-qrcode-svg';

import { useApi, type FichePreparee, type LienRemis } from '../api';
import { Button, Chip, EmptyState, StatusMessage, TextField, Texte } from '../components';
import { formatDate } from '../format';
import { useI18n } from '../i18n';
import { codeColors, radius, useColors } from '../theme';
import { Ecran } from './Ecran';
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
 * Où en est une fiche, en un mot.
 *
 * Lu sur les dates et non sur le statut seul : « préparée » et « lien envoyé »
 * sont deux moments distincts d'un même `draft`, et c'est justement l'écart
 * entre les deux qui dit si la tournée a servi.
 */
export function etatDeLaFiche(
  fiche: FichePreparee,
  maintenant: Date,
): 'assumee' | 'lien-ouvert' | 'lien-expire' | 'preparee' {
  if (fiche.used_at) return 'assumee';
  if (!fiche.issued_at || fiche.revoked_at) return 'preparee';
  if (fiche.expires_at && new Date(fiche.expires_at) <= maintenant) return 'lien-expire';
  return 'lien-ouvert';
}

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
                borderRadius: radius['radius.none'],
                backgroundColor: c['bg.surface'],
                borderWidth: 1,
                borderColor: c['line.strong'],
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
                  borderRadius: radius['radius.none'],
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
              <Texte variante="type.mono" testID="adresse-du-lien">
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
  const etat = etatDeLaFiche(fiche, new Date());

  return (
    <View
      testID={`fiche-${fiche.business_id}`}
      style={{
        gap: 8,
        padding: 16,
        borderRadius: radius['radius.none'],
        backgroundColor: c['bg.surface'],
        borderWidth: 1,
        borderColor: c['line.default'],
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
      <Texte variante="type.caption" couleur="ink.mute">
        {t('terrain.preparee', { quand: formatDate(fiche.prepared_at, locale, FUSEAU) })}
      </Texte>

      {/* **Rien à faire sur une fiche assumée.** Le salon en est propriétaire ;
          lui rouvrir un lien de prise en main n'aurait aucun sens, et le
          serveur le refuse. */}
      {etat === 'assumee' ? null : (
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Button
            label={t(etat === 'lien-ouvert' ? 'terrain.reemettre' : 'terrain.emettre')}
            size="sm"
            onPress={onEmettre}
            testID={`emettre-${fiche.business_id}`}
          />
          {etat === 'lien-ouvert' ? (
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
